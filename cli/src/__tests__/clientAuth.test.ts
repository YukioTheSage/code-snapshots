import { CodeLapseClient } from '../client';
import * as net from 'net';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// `jest.spyOn(net, 'createConnection')` cannot redefine the property -- the
// transpiled namespace is not configurable -- so the module is mocked instead.
jest.mock('net', () => {
  const actual = jest.requireActual('net');
  return { ...actual, createConnection: jest.fn() };
});

const createConnection = net.createConnection as unknown as jest.Mock;

/**
 * A stand-in for the connected socket: records what the client writes and lets
 * the test deliver server replies.
 *
 * A real `net.Server` on a named pipe was tried first and **hangs under Jest in
 * this environment** even with no production code involved -- a bare
 * `net.createServer` + `createConnection` round trip never settles, while the
 * same script works under plain `node`. A fake socket keeps the assertions
 * meaningful and portable: no pipe name, no port, nothing to leak between suites.
 *
 * That the token genuinely reaches the wire first is verified against a real
 * server outside Jest; see the commit message.
 */
class FakeSocket extends EventEmitter {
  public written: string[] = [];
  public destroyed = false;
  /** How many frames the test has already answered. */
  public answered = 0;

  write(chunk: string): boolean {
    this.written.push(chunk);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  /** Frames the client has written, parsed. */
  frames(): any[] {
    return this.written
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  }

  /** Deliver one server reply to the client. */
  reply(message: unknown): void {
    this.emit('data', Buffer.from(JSON.stringify(message) + '\n'));
  }

  /**
   * Answer every frame written so far, the way the extension does:
   * `authenticate` replies with `result: { authenticated: true }`, mirroring
   * `cliConnectorService.ts:106-113`.
   */
  autoRespond(authenticateResult: unknown = { authenticated: true }): void {
    const frames = this.frames();
    for (let i = this.answered; i < frames.length; i++) {
      const frame = frames[i];
      this.reply({
        success: true,
        id: frame.id,
        result: frame.method === 'authenticate' ? authenticateResult : {},
      });
    }
    this.answered = frames.length;
  }

  /** Answer the next un-answered frame for `method` with a refusal. */
  refuse(method: string, error: string): void {
    const frames = this.frames();
    for (let i = this.answered; i < frames.length; i++) {
      if (frames[i].method === method) {
        this.reply({ success: false, id: frames[i].id, error });
        this.answered = i + 1;
        return;
      }
    }
  }
}

describe('CodeLapseClient authentication', () => {
  let dir: string;
  let socket: FakeSocket;
  let pumps: NodeJS.Timeout[] = [];

  /** Make `net.createConnection` hand back `target`, connecting asynchronously. */
  function useSocket(target: FakeSocket) {
    createConnection.mockImplementation((...args: any[]) => {
      const onConnect = args.find((a) => typeof a === 'function');
      if (typeof onConnect === 'function') {
        // Connect asynchronously, like a real socket does.
        setImmediate(() => onConnect());
      }
      return target as any;
    });
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-auth-'));
    socket = new FakeSocket();
    pumps = [];
    useSocket(socket);
  });

  afterEach(() => {
    for (const p of pumps) clearInterval(p);
    createConnection.mockReset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function clientWithToken(token: string): CodeLapseClient {
    const client = new CodeLapseClient();
    (client as any).findConnectionInfo = () => ({
      socketPath: 'test-pipe',
      workspaceRoot: dir,
      extensionVersion: '0.9.5',
      apiVersion: '1.0.0',
      authToken: token,
      created: new Date().toISOString(),
    });
    return client;
  }

  /** Keep answering frames on `target` while the client works. */
  function startAutoRespond(target: FakeSocket = socket, result?: unknown) {
    const pump = setInterval(() => target.autoRespond(result), 1);
    pumps.push(pump);
    return () => clearInterval(pump);
  }

  it('sends authenticate with the discovery-file token before any other call', async () => {
    const client = clientWithToken('test-token-abc');
    const stop = startAutoRespond();

    try {
      await client.callApi('getStatus', {});
    } finally {
      stop();
    }

    const frames = socket.frames();
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames[0].method).toBe('authenticate');
    expect(frames[0].data).toEqual({ token: 'test-token-abc' });
    expect(frames[1].method).toBe('getStatus');
  });

  it('authenticates only once across several calls', async () => {
    const client = clientWithToken('test-token-abc');
    const stop = startAutoRespond();

    try {
      await client.callApi('getStatus', {});
      await client.callApi('getSnapshots', {});
      await client.callApi('getWorkspaceInfo', {});
    } finally {
      stop();
    }

    const authFrames = socket
      .frames()
      .filter((f) => f.method === 'authenticate');
    expect(authFrames).toHaveLength(1);
  });

  it('reads authToken from the discovery file', () => {
    // The setup file mocks fs, so use the real implementations to create the
    // file, then stub only the existence check the lookup depends on.
    const realFs = jest.requireActual('fs');
    const connectionDir = path.join(dir, '.vscode');
    const connectionFile = path.join(
      connectionDir,
      'codelapse-connection.json',
    );
    realFs.mkdirSync(connectionDir, { recursive: true });
    realFs.writeFileSync(
      connectionFile,
      JSON.stringify({
        socketPath: 'test-pipe',
        workspaceRoot: dir,
        extensionVersion: '0.9.5',
        apiVersion: '1.0.0',
        authToken: 'test-token-abc',
        created: new Date().toISOString(),
      }),
    );

    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      const client = new CodeLapseClient();
      (fs as any).existsSync.mockImplementation(
        (p: string) => p === connectionFile,
      );
      const info = (client as any).findConnectionInfo();
      expect(info).not.toBeNull();
      expect(info.authToken).toBe('test-token-abc');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('rejects when the server refuses the token', async () => {
    // The rejection path the original `if (!response?.success)` check could
    // never reach: a refused login makes the pending request reject inside
    // handleMessage, so performHandshake throws before any response is bound.
    const client = clientWithToken('wrong-token');

    const refusePump = setInterval(() => {
      socket.refuse('authenticate', 'Authentication failed: invalid token');
    }, 1);
    pumps.push(refusePump);

    await expect(client.callApi('getStatus', {})).rejects.toThrow(
      /Authentication failed/,
    );

    // The refused handshake must not let the real call through.
    expect(socket.frames().map((f) => f.method)).toEqual(['authenticate']);
  });

  it('refuses to proceed when the discovery file has no token', async () => {
    // An empty string is falsy: the case a connection file written before the
    // token was introduced would hit.
    const client = clientWithToken('');

    await expect(client.callApi('getStatus', {})).rejects.toThrow(
      /no authToken/,
    );
    expect(socket.frames()).toEqual([]);
  });

  it('rejects when the server accepts but does not confirm authentication', async () => {
    // Guards the reply shape. This is the bug the corrected plan fixes: the old
    // code tested `response.success`, which a resolved envelope never carries,
    // so a *successful* login threw "Authentication rejected".
    const client = clientWithToken('test-token-abc');
    const stop = startAutoRespond(socket, {});

    try {
      await expect(client.callApi('getStatus', {})).rejects.toThrow(
        /did not confirm authentication/,
      );
    } finally {
      stop();
    }
  });

  it('re-authenticates on a fresh socket after the connection closes', async () => {
    const client = clientWithToken('test-token-abc');
    const stop = startAutoRespond();

    try {
      await client.callApi('getStatus', {});

      // The extension went away and came back: the socket closed, so the next
      // call must connect and authenticate again rather than assume the old
      // session is still valid.
      socket.emit('close');

      const second = new FakeSocket();
      useSocket(second);
      const stopSecond = startAutoRespond(second);

      try {
        await client.callApi('getStatus', {});
      } finally {
        stopSecond();
      }

      expect(second.frames()[0].method).toBe('authenticate');
      expect(second.frames()[0].data).toEqual({ token: 'test-token-abc' });
    } finally {
      stop();
    }
  });
});
