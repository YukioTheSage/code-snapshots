import { EventEmitter } from 'events';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
  data: any;
}

interface ConnectionInfo {
  socketPath: string;
  workspaceRoot: string;
  extensionVersion: string;
  apiVersion: string;
  created: string;
}

export class CodeLapseClient extends EventEmitter {
  private socket?: net.Socket;
  private connected = false;
  private connectionTimeout = 5000;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();
  private connectionInfo?: ConnectionInfo | null;
  private messageBuffer: string = "";

  constructor(options?: { timeout?: number }) {
    super();
    if (options?.timeout) {
      this.connectionTimeout = options.timeout;
    }
  }

  /**
   * Get connection status and basic info
   */
  async getStatus(): Promise<ConnectionStatus> {
    await this.ensureConnection();
    return await this.callApi('getStatus', {});
  }

  /**
   * Execute a direct API call to the extension
   */
  async callApi(method: string, data: any): Promise<any> {
    await this.ensureConnection();
    
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });

      const message = {
        id,
        method,
        data: data || {},
      };

      if (!this.socket) {
        reject(new Error('No socket connection'));
        return;
      }

      this.socket.write(JSON.stringify(message) + '\n');

      // Set timeout for the request
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, this.connectionTimeout);
    });
  }

  /**
   * Execute a batch command
   */
  async executeCommand(command: any): Promise<any> {
    await this.ensureConnection();
    
    // This would execute the command via the extension API
    return {
      command,
      result: 'success',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Watch for events from the extension
   */
  async watchEvents(eventTypes: string[], callback: (event: EventData) => void): Promise<void> {
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
      const connectionFile = path.join(currentDir, '.vscode', 'codelapse-connection.json');
      
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
      throw new Error('Could not find CodeLapse extension connection. Make sure VSCode is running with the extension active.');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.connectionTimeout);

      this.socket = net.createConnection(this.connectionInfo!.socketPath, () => {
        clearTimeout(timeout);
        this.connected = true;
        resolve();
      });

      this.socket.on('error', (error) => {
        clearTimeout(timeout);
        this.connected = false;
        reject(new Error(`Failed to connect to CodeLapse extension: ${error.message}`));
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.socket = undefined;
        this.emit('disconnected');
      });

      this.socket.on('data', (data) => {
        // Accumulate incoming data into buffer and process complete lines
        this.messageBuffer += data.toString();

        let newlineIndex: number;
        while ((newlineIndex = this.messageBuffer.indexOf('\n')) !== -1) {
          const rawLine = this.messageBuffer.slice(0, newlineIndex).trim();
          this.messageBuffer = this.messageBuffer.slice(newlineIndex + 1);

          if (!rawLine) continue;

          try {
            const message = JSON.parse(rawLine);
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse message from extension:', error, '\nRaw line:', rawLine);
          }
        }
      });
    });
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

    // Handle API response
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);

      if (message.success) {
        resolve(message.result);
      } else {
        reject(new Error(message.error || 'Unknown error'));
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
    
    // Reject all pending requests
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
    
    this.removeAllListeners();
  }
} 