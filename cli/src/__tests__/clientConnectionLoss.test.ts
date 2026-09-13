/* eslint-disable @typescript-eslint/no-explicit-any */
import { CodeLapseClient } from '../client';
import { EventEmitter } from 'events';
import * as net from 'net';

// `jest.spyOn(net, 'createConnection')` cannot redefine the property -- the
// transpiled namespace is not configurable -- so the module is mocked instead,
// as `clientAuth.test.ts` does.
jest.mock('net', () => {
  const actual = jest.requireActual('net');
  return { ...actual, createConnection: jest.fn() };
});

const createConnection = net.createConnection as unknown as jest.Mock;

/**
 * A connected socket that can be closed on demand.
 *
 * Deliberately self-contained rather than shared with `clientAuth.test.ts`,
 * which keeps its own variant with a `refuse()` helper this suite does not
 * need. A real `net.Server` on a named pipe hangs under Jest in this
 * environment (see that file), so the socket is faked.
 *
 * The measured timeout is 300ms, so a test that would otherwise wait for the
 * request timeout fails in a third of a second instead of five.
 */
class FakeSocket extends EventEmitter {
  public written: string[] = [];
  public answered = 0;
  public destroyed = false;

  write(chunk: string): boolean {
    this.written.push(chunk);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  frames(): any[] {
    return this.written
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  }

  reply(message: unknown): void {
    this.emit('data', Buffer.from(JSON.stringify(message) + '\n'));
  }

  /** Answer every frame written so far, the way the extension does. */
  autoRespond(): void {
    const frames = this.frames();
    for (let i = this.answered; i < frames.length; i++) {
      this.reply({
        success: true,
        id: frames[i].id,
        result:
          frames[i].method === 'authenticate' ? { authenticated: true } : {},
      });
    }
    this.answered = frames.length;
  }
}

/**
 * An unsolicited close -- the extension window closing, the pipe breaking, the
 * host being recycled -- used to settle nothing. `close` reset three flags,
 * cleared `socket` and emitted `disconnected`, while every request still in
 * flight waited out its own `connectionTimeout` and then reported
 * "Request timeout" for a connection that was simply gone.
 *
 * Measured before the fix: a request on the wire at close time stayed pending,
 * then rejected 314ms later (with a 300ms timeout) as `Request timeout`. With
 * the shipped 5s default, or a larger `--timeout`, that is a wrong answer
 * arriving five to sixty seconds late.
 *
 * `disconnect()` already rejected in-flight requests with `Connection closed`;
 * these tests hold the unsolicited path to the same standard.
 */
describe('CodeLapseClient on an unsolicited disconnect', () => {
  let socket: FakeSocket;
  let pumps: NodeJS.Timeout[] = [];

  beforeEach(() => {
    socket = new FakeSocket();
    pumps = [];
    createConnection.mockImplementation((...args: any[]) => {
      const onConnect = args.find((a) => typeof a === 'function');
      if (typeof onConnect === 'function') {
        // Connect asynchronously, like a real socket does.
        setImmediate(() => onConnect());
      }
      return socket as any;
    });
  });

  afterEach(() => {
    for (const p of pumps) clearInterval(p);
    createConnection.mockReset();
  });

  function connectedClient(): CodeLapseClient {
    const client = new CodeLapseClient({ timeout: 300 });
    (client as any).findConnectionInfo = () => ({
      socketPath: 'test-pipe',
      workspaceRoot: 'x',
      extensionVersion: '0.9.5',
      apiVersion: '1.0.0',
      authToken: 'test-token',
      created: new Date().toISOString(),
    });
    return client;
  }

  /** Keep answering frames until stopped. */
  function startAutoRespond(): () => void {
    const pump = setInterval(() => socket.autoRespond(), 1);
    pumps.push(pump);
    return () => clearInterval(pump);
  }

  /** Wait, briefly and boundedly, for `count` frames to reach the wire. */
  async function untilWritten(count: number): Promise<void> {
    for (let i = 0; i < 100 && socket.frames().length < count; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(socket.frames().length).toBeGreaterThanOrEqual(count);
  }

  it('fails a request that is in flight when the socket closes', async () => {
    const client = connectedClient();
    const stop = startAutoRespond();
    await client.callApi('getStatus', {});
    stop();

    const pending = client.callApi('getStatus', {});
    // Let the frame actually reach the wire, so this is a genuinely in-flight
    // request rather than one that hits the `No socket connection` guard.
    await untilWritten(3);
    expect((client as any).pendingRequests.size).toBe(1);

    socket.emit('close');

    // Rejects with the connection-loss reason, not "Request timeout", and it
    // settles during the synchronous `emit` above rather than at 300ms.
    await expect(pending).rejects.toThrow(/connection closed/i);
    expect((client as any).pendingRequests.size).toBe(0);
  });

  it('fails a handshake interrupted by a close with the same reason', async () => {
    const client = connectedClient();

    // No auto-responder: the handshake stays unanswered until the close.
    const pending = client.callApi('getStatus', {});
    await untilWritten(1);
    expect(socket.frames()[0].method).toBe('authenticate');

    socket.emit('close');

    await expect(pending).rejects.toThrow(/connection closed/i);
    expect((client as any).pendingRequests.size).toBe(0);
  });

  it('still fails an explicit disconnect the same way', async () => {
    const client = connectedClient();
    const stop = startAutoRespond();
    await client.callApi('getStatus', {});
    stop();

    const pending = client.callApi('getStatus', {});
    await untilWritten(3);

    await client.disconnect();

    await expect(pending).rejects.toThrow(/connection closed/i);
    expect((client as any).pendingRequests.size).toBe(0);
  });
});
