import { EventEmitter } from 'events';
import * as net from 'net';
import { MAX_JSON_PAYLOAD_BYTES } from 'codelapse-core';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Client interface for connecting to CodeLapse VSCode extension
 */
export interface ConnectionStatus {
  connected: boolean;
  workspace: string | null;
  totalSnapshots: number;
  currentSnapshot: string | null;
}

export interface EventData {
  type: string;
  data: unknown;
}

interface ConnectionInfo {
  socketPath: string;
  workspaceRoot: string;
  extensionVersion: string;
  apiVersion: string;
  authToken: string;
  created: string;
}

interface PendingRequest {
  resolve: (value?: any) => void;
  reject: (reason?: any) => void;
  /**
   * The request's timeout, kept so that whichever path settles the request
   * first can cancel it. See `takePendingRequest`.
   */
  timer?: NodeJS.Timeout;
}

export class CodeLapseClient extends EventEmitter {
  private socket?: net.Socket;
  private connected = false;
  private connectionTimeout = 5000;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private connectionInfo?: ConnectionInfo | null;
  private messageBuffer = '';
  /**
   * Whether this socket has completed the `authenticate` handshake. The server
   * rejects every other method until it has, so this gates `ensureConnection`.
   */
  private authenticated = false;

  constructor(options?: { timeout?: number }) {
    super();
    if (options?.timeout) {
      this.connectionTimeout = options.timeout;
    }
  }

  /**
   * Whether the socket is connected to a running extension.
   *
   * `UnifiedClient` uses this to tell "no extension answered" (the connection
   * failed) from "the extension answered and its backend refused" (the socket
   * is up and `callApi` rejected with the handler's own error), so a failure
   * is not reported as a missing extension.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get connection status and basic info
   */
  async getStatus(): Promise<ConnectionStatus> {
    await this.ensureConnection();
    return await this.callApi('getStatus', {});
  }

  /**
   * Take a pending request out of the map, cancelling its timeout on the way.
   *
   * Every settle path goes through here: a reply (`handleMessage`), a
   * `disconnect`, and the timeout itself. An armed timer that outlives its
   * request keeps the Node event loop alive after the work is finished -- that
   * is what made jest force-exit a worker ("failed to exit gracefully"), and it
   * would keep a real `codelapse` process alive for up to `connectionTimeout`
   * after its last request.
   *
   * Returns undefined for an unknown or already-settled id, so a late reply or
   * a second settle is a no-op rather than a double resolve.
   */
  private takePendingRequest(id: number): PendingRequest | undefined {
    const entry = this.pendingRequests.get(id);
    if (!entry) {
      return undefined;
    }

    this.pendingRequests.delete(id);
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }

    return entry;
  }

  /**
   * Reject every request still in flight, cancelling each one's timeout.
   *
   * Used by an explicit `disconnect()` and by an unsolicited socket `close`. A
   * request that outlives its connection must be told the connection is gone:
   * leaving it to its own timer reports "Request timeout" -- or "Authentication
   * timed out" mid-handshake -- for a connection that was simply lost, and
   * delays that wrong answer by up to `connectionTimeout`.
   */
  private rejectAllPending(reason: string): void {
    // Iterating a copy of the keys, because `takePendingRequest` deletes.
    for (const id of [...this.pendingRequests.keys()]) {
      this.takePendingRequest(id)?.reject(new Error(reason));
    }
  }

  /**
   * Execute a direct API call to the extension
   */
  async callApi(method: string, data: any): Promise<any> {
    await this.ensureConnection();

    return new Promise((resolve, reject) => {
      // Checked before registering, so a request that never reaches the wire
      // does not leave an entry behind waiting for a reply that cannot come.
      if (!this.socket) {
        reject(new Error('No socket connection'));
        return;
      }

      const id = ++this.requestId;
      const entry: PendingRequest = { resolve, reject };
      this.pendingRequests.set(id, entry);

      const message = {
        id,
        method,
        data: data || {},
      };

      this.socket.write(JSON.stringify(message) + '\n');

      // Cancelled by `takePendingRequest` on whichever path settles first.
      entry.timer = setTimeout(() => {
        this.takePendingRequest(id)?.reject(new Error('Request timeout'));
      }, this.connectionTimeout);
    });
  }

  /**
   * Not supported. Use `callApi(method, data)` or `batchExecute` instead.
   *
   * This previously returned a fabricated
   * `{ command, result: 'success', timestamp }` **without sending anything**,
   * which made `codelapse batch` report success for commands it never ran. It
   * now refuses rather than inventing a result, so it cannot be mistaken for a
   * working call again.
   */
  async executeCommand(command: any): Promise<any> {
    throw new Error(
      `executeCommand is not supported: it would fabricate a result without sending anything. ` +
        `Use callApi(method, data) or batchExecute() instead. Received: ${JSON.stringify(
          command,
        )}`,
    );
  }

  /**
   * Watch for events from the extension
   */
  async watchEvents(
    eventTypes: string[],
    callback: (event: EventData) => void,
  ): Promise<void> {
    await this.ensureConnection();

    // Events are handled in the socket data handler
    this.on('event', callback);
  }

  /**
   * Find and load connection info from the workspace
   */
  private findConnectionInfo(): ConnectionInfo | null {
    // Look for connection file in current directory and parent directories
    let currentDir = process.cwd();
    const maxLevels = 5;
    let level = 0;

    while (level < maxLevels) {
      const connectionFile = path.join(
        currentDir,
        '.vscode',
        'codelapse-connection.json',
      );

      if (fs.existsSync(connectionFile)) {
        try {
          const content = fs.readFileSync(connectionFile, 'utf8');
          return JSON.parse(content) as ConnectionInfo;
        } catch (error) {
          // Continue searching in parent directories
        }
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break; // Reached filesystem root
      }

      currentDir = parentDir;
      level++;
    }

    return null;
  }

  /**
   * Ensure we have a connection to the extension
   */
  private async ensureConnection(): Promise<void> {
    if (this.connected && this.socket) {
      return;
    }

    // Find connection info
    this.connectionInfo = this.findConnectionInfo();
    if (!this.connectionInfo) {
      throw new Error(
        'Could not find CodeLapse extension connection. Make sure VSCode is running with the extension active.',
      );
    }

    // The connection promise is awaited rather than returned, so the handshake
    // below is reachable. While this was `return new Promise(...)`, anything
    // after it was dead code. The explicit `<void>` is needed now that the
    // promise is not the function's return value.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.connectionTimeout);

      this.socket = net.createConnection(
        this.connectionInfo!.socketPath,
        () => {
          clearTimeout(timeout);
          this.connected = true;
          resolve();
        },
      );

      this.socket.on('error', (error) => {
        clearTimeout(timeout);
        this.connected = false;
        this.authenticated = false;
        reject(
          new Error(
            `Failed to connect to CodeLapse extension: ${error.message}`,
          ),
        );
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.authenticated = false;
        this.socket = undefined;
        // Settle whatever was in flight before notifying listeners: without
        // this, a request on the wire when the connection dropped waited out
        // its own timeout and then blamed itself.
        this.rejectAllPending('Connection closed');
        this.emit('disconnected');
      });

      this.socket.on('data', (data) => {
        this.readResponseData(data.toString());
      });
    });

    // The server rejects every method except `authenticate` until it has seen a
    // valid token, so this must complete before any request is written.
    if (!this.authenticated) {
      await this.performHandshake();
    }
  }

  /**
   * Send the discovery-file token and wait for the server to accept it.
   *
   * There is deliberately no `response.success` check here. `handleMessage`
   * unwraps the envelope before this function sees it: it resolves the pending
   * request with `message.result` and rejects with `new Error(message.error)`.
   * The server's authenticate case replies with `result: { authenticated: true }`
   * (`cliConnectorService.ts:106-113`), so testing `response.success` would read
   * `undefined` on a *successful* login and throw "Authentication rejected",
   * while a *failed* login never reaches the test at all, because the promise
   * rejects first. Assert the field the server actually sends.
   */
  private async performHandshake(): Promise<void> {
    const token = this.connectionInfo?.authToken;
    if (!token) {
      throw new Error(
        'Connection file has no authToken. Restart the CodeLapse extension to regenerate it.',
      );
    }

    const id = ++this.requestId;
    const result = await new Promise<any>((resolve, reject) => {
      const entry: PendingRequest = { resolve, reject };
      this.pendingRequests.set(id, entry);

      this.socket!.write(
        JSON.stringify({ id, method: 'authenticate', data: { token } }) + '\n',
      );

      entry.timer = setTimeout(() => {
        this.takePendingRequest(id)?.reject(
          new Error('Authentication timed out'),
        );
      }, this.connectionTimeout);
    });

    // Resolving at all means the server accepted the token; this assertion only
    // guards against the reply shape changing underneath the client.
    if (result?.authenticated !== true) {
      throw new Error(
        'Extension accepted the connection but did not confirm authentication.',
      );
    }
    this.authenticated = true;
  }

  /**
   * Accumulate and parse complete response lines. Extracted so the buffer cap
   * is testable without a real socket.
   */
  private readResponseData(chunk: string): void {
    this.messageBuffer += chunk;

    // The peer controls how much arrives before a newline. Without a ceiling a
    // peer that never sends one grows this process's heap until it dies, and
    // the repository already defines the limit for every other payload.
    if (this.messageBuffer.length > MAX_JSON_PAYLOAD_BYTES) {
      this.messageBuffer = '';
      this.rejectAllPending('Response exceeded the maximum message size');
      this.socket?.destroy();
      return;
    }

    let newlineIndex: number;
    while ((newlineIndex = this.messageBuffer.indexOf('\n')) !== -1) {
      const rawLine = this.messageBuffer.slice(0, newlineIndex).trim();
      this.messageBuffer = this.messageBuffer.slice(newlineIndex + 1);

      if (!rawLine) continue;

      try {
        const message = JSON.parse(rawLine);
        this.handleMessage(message);
      } catch (error) {
        console.error(
          'Failed to parse message from extension:',
          error,
          '\nRaw line:',
          rawLine,
        );
      }
    }
  }

  /**
   * Handle incoming messages from the extension
   */
  private handleMessage(message: any): void {
    if (message.type === 'event') {
      // Broadcast event
      this.emit('event', message.event);
      return;
    }

    // Handle API response. `takePendingRequest` cancels the request's timeout,
    // so a reply that arrives in time leaves no timer behind.
    const entry =
      message.id === undefined
        ? undefined
        : this.takePendingRequest(message.id);

    if (entry) {
      if (message.success) {
        entry.resolve(message.result);
      } else {
        entry.reject(new Error(message.error || 'Unknown error'));
      }
    }
  }

  /**
   * Disconnect from the extension
   */
  async disconnect(): Promise<void> {
    this.connected = false;

    if (this.socket) {
      this.socket.destroy();
      this.socket = undefined;
    }

    // Reject all pending requests, cancelling each one's timeout as it goes.
    this.rejectAllPending('Connection closed');

    this.removeAllListeners();
  }
}
