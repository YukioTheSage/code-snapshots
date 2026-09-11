import * as assert from "assert";
import * as crypto from "crypto";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import * as vscode from "vscode";

/**
 * The CLI connector: the newline-delimited JSON (NDJSON) server the extension
 * opens on a named pipe so external tools can drive it.
 *
 * Contract read out of `src/services/cliConnectorService.ts` before asserting
 * anything here. Anchored to symbols rather than line numbers: Task 5/6/12
 * shifted this file's targets by 12-19 lines and left every numeric cite
 * confidently wrong, which is a failure mode a symbol cannot have.
 *
 *  - `createConnectionFile()` -- once `startServer`'s `server.listen` callback
 *    runs, the service publishes
 *    `<workspaceRoot>/.vscode/codelapse-connection.json` with
 *    `{ socketPath, workspaceRoot, extensionVersion, apiVersion, authToken, created }`.
 *  - the connector's constructor -- on Windows `socketPath` is
 *    `\\.\pipe\codelapse-<workspaceId>`, where `getWorkspaceId()` is the first 8
 *    hex characters of the MD5 of the workspace root.
 *  - `startServer`'s socket handler -- framing is one JSON object per line: the
 *    server accumulates chunks, splits on `\n`, and writes exactly one line per
 *    request.
 *  - `startServer`'s socket handler -- authentication is a handshake *message*,
 *    not a header, and the success reply is
 *    `{ success: true, id, result: { authenticated: true } }`.
 *  - `startServer`'s socket handler -- a wrong token is answered
 *    `{ success: false, id, error: "Authentication failed: invalid token" }`
 *    and the socket is destroyed.
 *  - `startServer`'s socket handler -- any request before authenticating is
 *    answered
 *    `{ success: false, id, error: "Not authenticated. Send authenticate message first." }`
 *    and the socket is destroyed.
 *  - `handleCliRequest` -- the method table. `getConnectionStatus` and
 *    `terminalApiService.getWorkspaceInfo` are read-only, so this suite never
 *    mutates the store the other suites share.
 *
 * Every socket is bounded by a timeout and destroyed in a `finally`: a test that
 * failed halfway must not leave the pipe -- and the mocha run -- hanging.
 *
 * Not covered here, deliberately: `dispose()` in the connector service closes
 * the server, destroys live sockets and unlinks the connection file, but the
 * service is disposed through `context.subscriptions` when the extension host
 * shuts down -- after mocha has finished -- and VS Code exposes no way to
 * deactivate an extension from inside a test. Asserting that path without being
 * able to reach it would mean asserting something other than the code under
 * test, so it is reported as a coverage gap instead.
 */

const EXPECTED_ID = process.env.CODELAPSE_EXPECTED_ID as string;
const FIXTURE_ROOT = process.env.CODELAPSE_FIXTURE_ROOT as string;
const CONNECTION_FILE = path.join(
  FIXTURE_ROOT ?? "",
  ".vscode",
  "codelapse-connection.json",
);

/** Published by `createConnectionFile()` and reported by `getConnectionStatus`. */
const API_VERSION = "1.0.0";
/** The connection file is written from a `listen` callback activation does not await. */
const CONNECTION_FILE_TIMEOUT_MS = 15000;
const CONNECT_TIMEOUT_MS = 5000;
const REPLY_TIMEOUT_MS = 10000;
const CLOSE_TIMEOUT_MS = 5000;

interface ConnectionInfo {
  socketPath: string;
  workspaceRoot: string;
  extensionVersion: string;
  apiVersion: string;
  authToken: string;
  created: string;
}

/**
 * Comparison key for a workspace path: absolute, without a trailing separator,
 * and -- on Windows -- case-insensitive, because the extension reports the
 * workspace folder through `uri.fsPath` while the fixture root arrives from
 * `%TEMP%`.
 */
function canonicalPath(target: string): string {
  const resolved = path.resolve(target).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readConnectionFile(): ConnectionInfo {
  return JSON.parse(fs.readFileSync(CONNECTION_FILE, "utf8")) as ConnectionInfo;
}

/**
 * The handshake message (`startServer` in the connector service): the request
 * envelope is `{ id, method, data }`, and the token travels inside `data` -- it is a
 * handshake *message*, not an `authToken` header and not a `type`-identified
 * frame. The first RED run of this file asserted the latter and was answered
 * `Not authenticated. Send authenticate message first.`
 */
function authenticateMessage(
  id: number,
  token: string,
): Record<string, unknown> {
  return { id, method: "authenticate", data: { token } };
}

interface Waiter {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

/**
 * One NDJSON client connection to the connector's named pipe.
 *
 * Replies are split on `\n` and delivered in order, each wait is bounded, and
 * `close()` destroys the socket, so no test can leak an open pipe.
 */
class PipeClient {
  private readonly socket: net.Socket;
  private readonly closedPromise: Promise<void>;
  private readonly queued: string[] = [];
  private readonly waiters: Waiter[] = [];
  private readonly socketErrors: Error[] = [];
  private buffer = "";
  private closed = false;

  constructor(private readonly socketPath: string) {
    this.socket = net.connect({ path: socketPath });
    this.socket.setEncoding("utf8");
    this.closedPromise = new Promise<void>((resolve) => {
      this.socket.once("close", () => {
        this.closed = true;
        for (const waiter of this.waiters.splice(0)) {
          waiter.reject(
            new Error(`the connector closed ${socketPath} before answering`),
          );
        }
        resolve();
      });
    });
    this.socket.on("data", (chunk: string) => this.onData(chunk));
    // Permanent listener: an unhandled 'error' event would take down the host.
    this.socket.on("error", (error: Error) => {
      this.socketErrors.push(error);
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;

    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      newlineIndex = this.buffer.indexOf("\n");

      if (!line) continue;

      const waiter = this.waiters.shift();
      if (waiter) {
        waiter.resolve(line);
      } else {
        this.queued.push(line);
      }
    }
  }

  /** Resolves once the pipe is connected; rejects on error or timeout. */
  async connected(): Promise<void> {
    if (this.socket.readyState === "open") return;

    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        this.socket.removeListener("connect", onConnect);
        this.socket.removeListener("error", onError);
        this.socket.removeListener("close", onClose);
      };
      const onConnect = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const onClose = (): void => {
        cleanup();
        reject(new Error(`the pipe ${this.socketPath} closed before connecting`));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `timed out after ${CONNECT_TIMEOUT_MS}ms connecting to ${this.socketPath}`,
          ),
        );
      }, CONNECT_TIMEOUT_MS);

      this.socket.once("connect", onConnect);
      this.socket.once("error", onError);
      this.socket.once("close", onClose);
    });
  }

  /** Sends one request line and returns the parsed reply line. */
  async request(
    message: Record<string, unknown>,
    what: string = JSON.stringify(message),
  ): Promise<any> {
    const pending = this.nextLine(what);
    this.socket.write(JSON.stringify(message) + "\n");
    return JSON.parse(await pending);
  }

  private nextLine(what: string): Promise<string> {
    const queued = this.queued.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }

    return new Promise<string>((resolve, reject) => {
      const waiter: Waiter = {
        resolve: (line: string): void => {
          clearTimeout(waiter.timer);
          resolve(line);
        },
        reject: (error: Error): void => {
          clearTimeout(waiter.timer);
          reject(error);
        },
      };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) {
          this.waiters.splice(index, 1);
        }
        reject(
          new Error(
            `timed out after ${REPLY_TIMEOUT_MS}ms waiting for ${what}; ` +
              `socket errors: ${
                this.socketErrors.map((error) => error.message).join("; ") ||
                "none"
              }`,
          ),
        );
      }, REPLY_TIMEOUT_MS);
      this.waiters.push(waiter);
    });
  }

  /** Closes this connection; safe to call more than once. */
  close(): void {
    this.socket.destroy();
  }

  /** Resolves once the connector has closed this connection. */
  async waitForClose(): Promise<void> {
    if (this.closed) return;

    await Promise.race([
      this.closedPromise,
      delay(CLOSE_TIMEOUT_MS).then(() => {
        throw new Error(
          `the connector kept ${this.socketPath} open for ${CLOSE_TIMEOUT_MS}ms`,
        );
      }),
    ]);
  }
}

suite("CLI connector", function () {
  this.timeout(60000);

  let api: any;
  let extension: vscode.Extension<any>;
  let conn: ConnectionInfo;

  suiteSetup(async () => {
    assert.ok(FIXTURE_ROOT, "CODELAPSE_FIXTURE_ROOT is not set");
    extension = vscode.extensions.getExtension(
      EXPECTED_ID,
    ) as vscode.Extension<any>;
    assert.ok(extension, `extension ${EXPECTED_ID} is not present in the host`);
    await extension.activate();
    api = await vscode.commands.executeCommand("vscode-snapshots.getApi");
    assert.ok(api, "vscode-snapshots.getApi returned nothing");

    // `CliConnectorService`'s constructor calls `startServer()` without awaiting
    // it, so the file can trail `activate()` by a few milliseconds.
    const deadline = Date.now() + CONNECTION_FILE_TIMEOUT_MS;
    while (!fs.existsSync(CONNECTION_FILE) && Date.now() < deadline) {
      await delay(100);
    }
    assert.ok(
      fs.existsSync(CONNECTION_FILE),
      `the CLI connector did not publish ${CONNECTION_FILE} within ` +
        `${CONNECTION_FILE_TIMEOUT_MS}ms of activation, so its named-pipe ` +
        `server did not start in this host`,
    );

    conn = readConnectionFile();
  });

  test("the published connection file describes this fixture workspace", () => {
    const info = readConnectionFile();

    for (const field of [
      "socketPath",
      "workspaceRoot",
      "extensionVersion",
      "apiVersion",
      "authToken",
      "created",
    ] as const) {
      const value = info[field];
      assert.strictEqual(
        typeof value,
        "string",
        `connection file field "${field}" is not a string: ${JSON.stringify(value)}`,
      );
      assert.ok(value.length > 0, `connection file field "${field}" is empty`);
    }

    assert.strictEqual(
      canonicalPath(info.workspaceRoot),
      canonicalPath(FIXTURE_ROOT),
      "the connector published a connection file for a different workspace",
    );

    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, "the host has no workspace folder");
    assert.strictEqual(
      canonicalPath(folders[0].uri.fsPath),
      canonicalPath(FIXTURE_ROOT),
      "the host's workspace folder is not the fixture the file points at",
    );

    assert.strictEqual(
      info.extensionVersion,
      (extension.packageJSON as any).version,
      "extensionVersion is not the installed extension's version",
    );
    assert.strictEqual(info.apiVersion, API_VERSION);
    assert.match(
      info.authToken,
      /^[0-9a-f]{64}$/,
      `authToken is not a 32-byte hex secret: ${JSON.stringify(info.authToken)}`,
    );

    const created = Date.parse(info.created);
    assert.ok(
      !Number.isNaN(created),
      `"created" is not a parseable timestamp: ${JSON.stringify(info.created)}`,
    );
    assert.ok(
      created <= Date.now() + 60_000,
      `"created" is in the future: ${JSON.stringify(info.created)}`,
    );

    if (process.platform === "win32") {
      const workspaceId = crypto
        .createHash("md5")
        .update(info.workspaceRoot)
        .digest("hex")
        .slice(0, 8);
      assert.strictEqual(
        info.socketPath,
        `\\\\.\\pipe\\codelapse-${workspaceId}`,
        "socketPath is not the named pipe derived from the workspace root",
      );
    } else {
      assert.ok(
        path.isAbsolute(info.socketPath),
        `socketPath is not absolute: ${JSON.stringify(info.socketPath)}`,
      );
    }
  });

  test("the named pipe is listening and accepts the published token", async () => {
    const client = new PipeClient(conn.socketPath);
    try {
      await client.connected();

      const reply = await client.request(
        authenticateMessage(1, conn.authToken),
        "the authenticate reply",
      );

      assert.strictEqual(
        reply.success,
        true,
        `the connector refused its own published token: ${JSON.stringify(reply)}`,
      );
      assert.strictEqual(reply.id, 1, "the reply did not echo the request id");
      assert.deepStrictEqual(reply.result, { authenticated: true });
    } finally {
      client.close();
    }
  });

  test("a wrong token is rejected and the connection is dropped", async () => {
    const wrongToken = "0".repeat(64);
    assert.notStrictEqual(
      wrongToken,
      conn.authToken,
      "the published token cannot equal the placeholder used as a wrong token",
    );

    const client = new PipeClient(conn.socketPath);
    try {
      await client.connected();

      const reply = await client.request(
        authenticateMessage(2, wrongToken),
        "the wrong-token reply",
      );

      assert.strictEqual(
        reply.success,
        false,
        `a wrong token was accepted: ${JSON.stringify(reply)}`,
      );
      assert.strictEqual(reply.id, 2, "the reply did not echo the request id");
      assert.match(
        String(reply.error),
        /authentication/i,
        `the rejection does not mention authentication: ${JSON.stringify(reply)}`,
      );

      await client.waitForClose();
    } finally {
      client.close();
    }
  });

  test("a request before authenticating is refused", async () => {
    const client = new PipeClient(conn.socketPath);
    try {
      await client.connected();

      const reply = await client.request(
        { id: 3, method: "getStatus" },
        "the pre-authentication refusal",
      );

      assert.strictEqual(
        reply.success,
        false,
        `an unauthenticated request was served: ${JSON.stringify(reply)}`,
      );
      assert.strictEqual(reply.id, 3, "the reply did not echo the request id");
      assert.match(
        String(reply.error),
        /not authenticated/i,
        `the refusal does not say the request was unauthenticated: ${JSON.stringify(reply)}`,
      );

      await client.waitForClose();
    } finally {
      client.close();
    }
  });

  test("authenticated requests round-trip real methods on one connection", async () => {
    const client = new PipeClient(conn.socketPath);
    try {
      await client.connected();

      const auth = await client.request(
        authenticateMessage(10, conn.authToken),
        "the authenticate reply",
      );
      assert.strictEqual(
        auth.success,
        true,
        `authentication failed on a fresh connection: ${JSON.stringify(auth)}`,
      );

      // `getStatus` -- `getConnectionStatus` in the connector service.
      const statusReply = await client.request(
        { id: 11, method: "getStatus" },
        "the getStatus reply",
      );
      assert.strictEqual(
        statusReply.success,
        true,
        `getStatus failed: ${JSON.stringify(statusReply)}`,
      );
      assert.strictEqual(statusReply.id, 11);

      const status = statusReply.result;
      assert.ok(
        status && typeof status === "object",
        `getStatus returned no result object: ${JSON.stringify(statusReply)}`,
      );
      assert.strictEqual(status.connected, true);
      assert.strictEqual(
        canonicalPath(String(status.workspace)),
        canonicalPath(FIXTURE_ROOT),
        `getStatus reported workspace ${JSON.stringify(status.workspace)}`,
      );
      assert.strictEqual(
        status.extensionVersion,
        (extension.packageJSON as any).version,
      );
      assert.strictEqual(status.apiVersion, API_VERSION);
      assert.ok(
        Number.isInteger(status.totalSnapshots) && status.totalSnapshots >= 0,
        `getStatus reported totalSnapshots=${JSON.stringify(status.totalSnapshots)}`,
      );
      assert.ok(
        status.currentSnapshot === null ||
          typeof status.currentSnapshot === "string",
        `getStatus reported currentSnapshot=${JSON.stringify(status.currentSnapshot)}`,
      );

      // The same store the extension API exposes, counted a moment later.
      const snapshots = await api.getSnapshots();
      assert.strictEqual(
        status.totalSnapshots,
        snapshots.length,
        "getStatus and the extension API disagree about the snapshot count",
      );

      // Second request on the same socket: the connection survives a completed
      // request and the framing keeps working.
      const workspaceReply = await client.request(
        { id: 12, method: "getWorkspaceInfo" },
        "the getWorkspaceInfo reply",
      );
      assert.strictEqual(
        workspaceReply.success,
        true,
        `getWorkspaceInfo failed: ${JSON.stringify(workspaceReply)}`,
      );
      assert.strictEqual(workspaceReply.id, 12);

      // `getWorkspaceInfo` -- `terminalApiService.getWorkspaceInfo`.
      const workspace = workspaceReply.result;
      assert.strictEqual(
        canonicalPath(String(workspace.workspaceRoot)),
        canonicalPath(FIXTURE_ROOT),
      );
      assert.strictEqual(workspace.totalSnapshots, snapshots.length);
      assert.ok(
        Number.isInteger(workspace.currentSnapshotIndex),
        `currentSnapshotIndex=${JSON.stringify(workspace.currentSnapshotIndex)}`,
      );
      if (workspace.currentSnapshotIndex < 0) {
        assert.strictEqual(
          workspace.currentSnapshot,
          undefined,
          "a workspace with no current snapshot still reported one",
        );
      } else {
        assert.ok(workspace.currentSnapshotIndex < workspace.totalSnapshots);
        assert.strictEqual(
          typeof workspace.currentSnapshot?.id,
          "string",
          `the current snapshot has no id: ${JSON.stringify(workspace.currentSnapshot)}`,
        );
      }
    } finally {
      client.close();
    }
  });

  test("an unknown method is refused without dropping the connection", async () => {
    const unknownMethod = "cliConnectorTestNonexistentMethod";
    const client = new PipeClient(conn.socketPath);
    try {
      await client.connected();

      const auth = await client.request(
        authenticateMessage(20, conn.authToken),
        "the authenticate reply",
      );
      assert.strictEqual(
        auth.success,
        true,
        `authentication failed on a fresh connection: ${JSON.stringify(auth)}`,
      );

      const refused = await client.request(
        { id: 21, method: unknownMethod },
        "the unknown-method reply",
      );
      assert.strictEqual(
        refused.success,
        false,
        `an unknown method was accepted: ${JSON.stringify(refused)}`,
      );
      assert.strictEqual(refused.id, 21);
      assert.match(
        String(refused.error),
        new RegExp(`Unknown method: ${unknownMethod}`),
        `the refusal does not name the method: ${JSON.stringify(refused)}`,
      );

      // Only the request was refused: a following valid request is still served.
      const after = await client.request(
        { id: 22, method: "getWorkspaceInfo" },
        "the getWorkspaceInfo reply",
      );
      assert.strictEqual(
        after.success,
        true,
        `the connection stopped working after an unknown method: ${JSON.stringify(after)}`,
      );
      assert.strictEqual(after.id, 22);
      assert.strictEqual(
        canonicalPath(String(after.result?.workspaceRoot)),
        canonicalPath(FIXTURE_ROOT),
      );
    } finally {
      client.close();
    }
  });
});
