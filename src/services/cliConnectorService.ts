import * as vscode from 'vscode';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { TerminalApiService } from './terminalApiService';
import { log } from '../logger';

/**
 * Service that enables CLI tools to communicate with the VSCode extension
 */
export class CliConnectorService implements vscode.Disposable {
  private server?: net.Server;
  private connections: Set<net.Socket> = new Set();
  private terminalApiService: TerminalApiService;
  private context: vscode.ExtensionContext;
  private socketPath: string;

  constructor(
    terminalApiService: TerminalApiService,
    context: vscode.ExtensionContext,
  ) {
    this.terminalApiService = terminalApiService;
    this.context = context;

    // Create platform-specific socket path
    const workspaceId = this.getWorkspaceId();
    if (process.platform === 'win32') {
      this.socketPath = `\\\\.\\pipe\\codelapse-${workspaceId}`;
    } else {
      const tmpDir = os.tmpdir();
      this.socketPath = path.join(tmpDir, `codelapse-${workspaceId}.sock`);
    }

    this.startServer();
  }

  /**
   * Start the IPC server for CLI communication
   */
  private async startServer(): Promise<void> {
    try {
      // Clean up existing socket on Unix systems
      if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
        fs.unlinkSync(this.socketPath);
      }

      this.server = net.createServer((socket) => {
        log(`CLI client connected`);
        this.connections.add(socket);

        // Buffer to accumulate partial data chunks from this socket
        let buffer = '';

        socket.on('data', async (data) => {
          buffer += data.toString();

          let newlineIndex: number;
          while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const rawLine = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (!rawLine) continue;

            try {
              const message = JSON.parse(rawLine);
              const response = await this.handleCliRequest(message);
              socket.write(JSON.stringify(response) + '\n');
            } catch (error) {
              const errorResponse = {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              };
              socket.write(JSON.stringify(errorResponse) + '\n');
            }
          }
        });

        socket.on('close', () => {
          log(`CLI client disconnected`);
          this.connections.delete(socket);
        });

        socket.on('error', (error) => {
          log(`CLI client error: ${error.message}`);
          this.connections.delete(socket);
        });
      });

      this.server.listen(this.socketPath, () => {
        log(`CLI connector server listening on ${this.socketPath}`);
        this.createConnectionFile();
      });

      this.server.on('error', (error) => {
        log(`CLI connector server error: ${error.message}`);
      });
    } catch (error) {
      log(`Failed to start CLI connector server: ${error}`);
    }
  }

  /**
   * Handle incoming CLI requests
   */
  private async handleCliRequest(message: any): Promise<any> {
    const { method, data, id } = message;

    try {
      let result: any;

      // Route the request to the appropriate Terminal API method
      switch (method) {
        case 'getStatus':
          result = await this.getConnectionStatus();
          break;
        case 'takeSnapshot':
          result = await this.terminalApiService.takeSnapshot(data);
          break;
        case 'getSnapshots':
          result = await this.terminalApiService.getSnapshots(data);
          break;
        case 'getSnapshot':
          result = await this.terminalApiService.getSnapshot(data.id);
          break;
        case 'restoreSnapshot':
          result = await this.terminalApiService.restoreSnapshot(
            data.id,
            data.options,
          );
          break;
        case 'deleteSnapshot':
          result = await this.terminalApiService.deleteSnapshot(data.id);
          break;
        case 'navigateSnapshot':
          result = await this.terminalApiService.navigateSnapshot(
            data.direction,
          );
          break;
        case 'getSnapshotFileContent':
          result = await this.terminalApiService.getSnapshotFileContent(
            data.snapshotId,
            data.filePath,
          );
          break;
        case 'getSnapshotChanges':
          result = await this.terminalApiService.getSnapshotChanges(
            data.snapshotId,
          );
          break;
        case 'compareSnapshots':
          result = await this.terminalApiService.compareSnapshots(
            data.snapshotId1,
            data.snapshotId2,
          );
          break;
        case 'searchSnapshots':
          result = await this.terminalApiService.searchSnapshots(
            data.query,
            data.options,
          );
          break;
        case 'indexSnapshots':
          result = await this.terminalApiService.indexSnapshots(
            data.snapshotIds,
          );
          break;
        case 'getWorkspaceInfo':
          result = await this.terminalApiService.getWorkspaceInfo();
          break;
        case 'getCurrentState':
          result = await this.terminalApiService.getCurrentState();
          break;
        case 'validateSnapshot':
          result = await this.terminalApiService.validateSnapshot(data.id);
          break;
        case 'exportSnapshot':
          result = await this.terminalApiService.exportSnapshot(
            data.id,
            data.format,
          );
          break;
        default:
          throw new Error(`Unknown method: ${method}`);
      }

      return {
        success: true,
        id,
        result,
      };
    } catch (error) {
      return {
        success: false,
        id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get connection status for CLI
   */
  private async getConnectionStatus(): Promise<any> {
    const workspaceInfo = await this.terminalApiService.getWorkspaceInfo();

    return {
      connected: true,
      workspace: workspaceInfo.workspaceRoot,
      totalSnapshots: workspaceInfo.totalSnapshots,
      currentSnapshot: workspaceInfo.currentSnapshot?.description || null,
      extensionVersion: this.context.extension.packageJSON.version,
      apiVersion: '1.0.0',
    };
  }

  /**
   * Create connection info file for CLI tools to discover the socket
   */
  private createConnectionFile(): void {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) return;

      const connectionInfo = {
        socketPath: this.socketPath,
        workspaceRoot,
        extensionVersion: this.context.extension.packageJSON.version,
        apiVersion: '1.0.0',
        created: new Date().toISOString(),
      };

      const connectionFile = path.join(
        workspaceRoot,
        '.vscode',
        'codelapse-connection.json',
      );

      // Ensure .vscode directory exists
      const vsCodeDir = path.dirname(connectionFile);
      if (!fs.existsSync(vsCodeDir)) {
        fs.mkdirSync(vsCodeDir, { recursive: true });
      }

      fs.writeFileSync(connectionFile, JSON.stringify(connectionInfo, null, 2));
      log(`Created connection file: ${connectionFile}`);
    } catch (error) {
      log(`Failed to create connection file: ${error}`);
    }
  }

  /**
   * Get unique workspace identifier
   */
  private getWorkspaceId(): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      return crypto
        .createHash('md5')
        .update(workspaceRoot)
        .digest('hex')
        .substring(0, 8);
    }

    // Fallback to random identifier
    return Math.random().toString(36).substring(2, 10);
  }

  /**
   * Broadcast event to all connected CLI clients
   */
  public broadcastEvent(event: any): void {
    const message = JSON.stringify({ type: 'event', event }) + '\n';

    this.connections.forEach((socket) => {
      try {
        socket.write(message);
      } catch (error) {
        log(`Failed to broadcast to CLI client: ${error}`);
        this.connections.delete(socket);
      }
    });
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    log('Disposing CLI connector service...');

    // Close all connections
    this.connections.forEach((socket) => {
      socket.destroy();
    });
    this.connections.clear();

    // Close server
    if (this.server) {
      this.server.close();
    }

    // Clean up socket file on Unix systems
    try {
      if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
        fs.unlinkSync(this.socketPath);
      }
    } catch (error) {
      log(`Failed to clean up socket file: ${error}`);
    }

    // Clean up connection file
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (workspaceRoot) {
        const connectionFile = path.join(
          workspaceRoot,
          '.vscode',
          'codelapse-connection.json',
        );
        if (fs.existsSync(connectionFile)) {
          fs.unlinkSync(connectionFile);
        }
      }
    } catch (error) {
      log(`Failed to clean up connection file: ${error}`);
    }

    log('CLI connector service disposed');
  }
}
