import * as vscode from 'vscode';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as diff from 'diff';
import { ConfigManager, MAX_JSON_PAYLOAD_BYTES } from 'codelapse-core';
import { toRatio } from './qualityScale';
import { resolveSetting } from '../configSource';
import { TerminalApiService } from './terminalApiService';
import { SemanticSearchService } from './semanticSearchService';
import { EnhancedCodeChunker } from './enhancedCodeChunker';
import { QueryProcessor } from './queryProcessor';
import { ResultManager } from './resultManager';
import {
  EnhancedSemanticSearchOptions,
  AIAgentResponse,
} from '../types/enhancedSearch';
import { EnhancedCodeChunk } from '../types/enhancedChunking';
import { log, subscribeToLogEntries } from '../logger';
import { getWorkspaceId } from './workspaceIdentity';
import type { Snapshot } from '../snapshotManager';
import type {
  API as GitAPI,
  GitExtension,
  RefType as GitRefType,
  Repository as GitRepository,
} from '../types/git';

/**
 * `RefType.Head` of the built-in Git extension API.
 *
 * `src/types/git.d.ts` is ambient, so it has no runtime module: importing the
 * const enum as a value would emit a `require()` for a file that does not exist
 * once the extension is bundled. The numeric member value is repeated here and
 * typed against the ambient enum instead.
 */
const GIT_REF_TYPE_HEAD: GitRefType = 0;

/** Result of the `getGitBranchInfo` / `listBranches` IPC methods. */
interface GitBranchInfoResult {
  currentBranch: string;
  commitHash: string;
  remoteUrl: string;
  hasChanges: boolean;
  branches: string[];
}

/** Result of the `createGitCommitFromSnapshot` IPC method. */
interface GitCommitFromSnapshotResult {
  commitHash: string;
  branch: string;
  message: string;
}

type GitFileChangeType = 'added' | 'modified' | 'deleted';

interface GitFileDifference {
  file: string;
  changeType: GitFileChangeType;
  linesAdded?: number;
  linesRemoved?: number;
}

/** Result of the `compareSnapshotWithGitCommit` IPC method. */
interface GitComparisonResult {
  differences: GitFileDifference[];
  fileChanges?: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
}

/**
 * A batch stride of 0 or a negative value never advances its loop, so an
 * unvalidated payload value could wedge the extension host. The value comes
 * straight from the CLI request, so it is checked before use and the caller
 * gets an error envelope instead of a hang.
 */
function assertValidMaxConcurrency(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return `Invalid maxConcurrency: ${String(
      value,
    )}. Expected a positive number.`;
  }
  return null;
}

/**
 * `maxRetries` bounds `retryFailedOperations` / `retryFailedQueries`
 * (`while (retryCount < maxRetries && !success)`), a loop that only leaves an
 * attempt behind by succeeding. JSON `1e999` parses to `Infinity`, which that
 * loop can never reach, so the value comes straight from the CLI request and is
 * checked before the retry helper can be entered. 0 is legitimate: it means
 * "do not retry". A large finite value is deliberately left uncapped: how many
 * attempts a caller is willing to pay for is its own choice, and the loop still
 * leaves on the first success.
 */
function assertValidMaxRetries(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return `Invalid maxRetries: ${String(
      value,
    )}. Expected a non-negative integer.`;
  }
  return null;
}

/**
 * The largest delay `setTimeout` honours: Node clamps a delay above it — or
 * below 1 — to 1ms, so a longer `timeout` is not a long wait but an immediate
 * one.
 */
const MAX_TIMER_DELAY_MS = 2147483647;

/**
 * `timeout` is handed to `withTimeout`. `setTimeout` coerces a null, NaN, zero
 * or negative delay to 0 — and overflows `Infinity` to 1ms — so an unvalidated
 * value makes the race report a timeout on operations that never timed out. The
 * same clamp catches a finite value above the timer ceiling, which is why the
 * ceiling is part of the check rather than a formality. The value comes straight
 * from the CLI request, so it is checked here and the caller gets an error
 * envelope instead of a fabricated failure.
 */
function assertValidTimeout(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return `Invalid timeout: ${String(
      value,
    )}. Expected a positive number of milliseconds.`;
  }
  if (value > MAX_TIMER_DELAY_MS) {
    return `Invalid timeout: ${String(
      value,
    )}. Expected at most ${MAX_TIMER_DELAY_MS} milliseconds: setTimeout clamps a longer delay to 1ms.`;
  }
  return null;
}

/**
 * Races `work` against a timeout that is always cleared, win or lose. The
 * previous inline form armed a timer per operation and dropped the handle, so
 * every batch left up to `maxConcurrency` timers pending and the unit suite's
 * worker never exited cleanly.
 */
async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Service that enables CLI tools to communicate with the VSCode extension
 */
export class CliConnectorService implements vscode.Disposable {
  private server?: net.Server;
  private connections: Set<net.Socket> = new Set();
  private authenticatedSockets: Set<net.Socket> = new Set();
  private socketBuffers: Map<net.Socket, string> = new Map();
  private authToken: string;
  private logUnsubscribe?: () => void;
  /** Released by `dispose()`. Re-reads the chunker settings on a config change. */
  private chunkerConfigSubscription?: vscode.Disposable;
  private logStreaming = false;
  private terminalApiService: TerminalApiService;
  private context: vscode.ExtensionContext;
  private socketPath: string;
  // Git API: injected by the extension when it already resolved one, otherwise
  // looked up lazily from the built-in `vscode.git` extension.
  private gitApi: GitAPI | null;

  // Enhanced services for AI agent optimization
  private semanticSearchService?: SemanticSearchService;
  private enhancedCodeChunker: EnhancedCodeChunker;
  private queryProcessor: QueryProcessor;
  private resultManager: ResultManager;

  constructor(
    terminalApiService: TerminalApiService,
    context: vscode.ExtensionContext,
    semanticSearchService?: SemanticSearchService,
    gitApi?: GitAPI | null,
  ) {
    this.terminalApiService = terminalApiService;
    this.context = context;
    this.semanticSearchService = semanticSearchService;
    this.gitApi = gitApi ?? null;

    // Generate authentication token for IPC security
    this.authToken = crypto.randomBytes(32).toString('hex');

    // `diagnostics logs --follow` asks for streamed entries; the buffer in the
    // logger is the only source, so register once and forward only while a
    // client has requested the stream.
    this.logUnsubscribe = subscribeToLogEntries((entry) => {
      if (this.logStreaming) {
        this.broadcastEvent({ type: 'log', data: entry });
      }
    });

    // Initialize enhanced services
    this.enhancedCodeChunker = new EnhancedCodeChunker();
    this.queryProcessor = new QueryProcessor();
    this.resultManager = new ResultManager();

    // The chunker captures its line-count settings at construction; re-reading
    // them when the setting changes is what removes the Reload Window step.
    this.chunkerConfigSubscription = vscode.workspace.onDidChangeConfiguration(
      (event) => {
        if (
          event.affectsConfiguration(
            'vscode-snapshots.semanticSearch.chunkSize',
          ) ||
          event.affectsConfiguration(
            'vscode-snapshots.semanticSearch.chunkOverlap',
          )
        ) {
          this.enhancedCodeChunker.refreshConfig();
        }
      },
    );

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

  private async handleSocketData(
    socket: net.Socket,
    data: Buffer,
  ): Promise<void> {
    let buffer = (this.socketBuffers.get(socket) ?? '') + data.toString();
    this.socketBuffers.set(socket, buffer);

    // The peer controls how much arrives before a newline. Without a ceiling a
    // peer that never sends one grows this process's heap until it dies.
    if (buffer.length > MAX_JSON_PAYLOAD_BYTES) {
      log(
        `CLI client message buffer exceeded ${MAX_JSON_PAYLOAD_BYTES} bytes; destroying connection.`,
      );
      this.socketBuffers.delete(socket);
      socket.destroy();
      return;
    }

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const rawLine = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      this.socketBuffers.set(socket, buffer);

      if (!rawLine) continue;

      try {
        const message = JSON.parse(rawLine);

        // Handle authentication
        if (message.method === 'authenticate') {
          if (message.data?.token === this.authToken) {
            this.authenticatedSockets.add(socket);
            socket.write(
              JSON.stringify({
                success: true,
                id: message.id,
                result: { authenticated: true },
              }) + '\n',
            );
          } else {
            socket.write(
              JSON.stringify({
                success: false,
                id: message.id,
                error: 'Authentication failed: invalid token',
              }) + '\n',
            );
            socket.destroy();
          }
          continue;
        }

        // Reject unauthenticated requests
        if (!this.authenticatedSockets.has(socket)) {
          socket.write(
            JSON.stringify({
              success: false,
              id: message.id,
              error: 'Not authenticated. Send authenticate message first.',
            }) + '\n',
          );
          socket.destroy();
          continue;
        }

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
        this.socketBuffers.set(socket, '');

        socket.on('data', (data) => {
          void this.handleSocketData(socket, data);
        });

        socket.on('close', () => {
          log(`CLI client disconnected`);
          this.connections.delete(socket);
          this.authenticatedSockets.delete(socket);
          this.socketBuffers.delete(socket);
        });

        socket.on('error', (error) => {
          log(`CLI client error: ${error.message}`);
          this.connections.delete(socket);
          this.authenticatedSockets.delete(socket);
          this.socketBuffers.delete(socket);
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
        case 'getConfig':
        case 'setConfig':
        case 'resetConfig':
        case 'getConfigSchema':
        case 'validateConfig':
        case 'exportConfig':
        case 'importConfig':
          result = await this.handleConfigRequest(method, data);
          break;
        case 'getAutoSnapshotRules':
          result = {
            rules: await this.terminalApiService.getAutoSnapshotRules(),
          };
          break;
        case 'addAutoSnapshotRule':
          result = {
            rule: await this.terminalApiService.addAutoSnapshotRule(
              data?.rule ?? data,
            ),
          };
          break;
        case 'updateAutoSnapshotRule':
          result = {
            rule: await this.terminalApiService.updateAutoSnapshotRule(
              data?.ruleId ?? data?.id,
              data?.updates ?? data,
            ),
          };
          break;
        case 'removeAutoSnapshotRule':
          await this.terminalApiService.removeAutoSnapshotRule(
            data?.ruleId ?? data?.id,
          );
          result = { success: true };
          break;
        case 'toggleAutoSnapshotRule':
          result = {
            rule: await this.terminalApiService.toggleAutoSnapshotRule(
              data?.ruleId ?? data?.id,
              typeof data?.enabled === 'boolean' ? data.enabled : undefined,
            ),
          };
          break;
        case 'testAutoSnapshotRule':
          result = await this.terminalApiService.testAutoSnapshotRule(data);
          break;
        case 'runDiagnostics':
          result = await this.terminalApiService.runDiagnostics();
          break;
        case 'healthCheck':
          result = await this.terminalApiService.healthCheck();
          break;
        case 'getSystemInfo':
          result = {
            systemInfo: await this.terminalApiService.getSystemInfo(),
          };
          break;
        case 'getPerformanceMetrics':
          result = await this.terminalApiService.getPerformanceMetrics();
          break;
        case 'getLogs':
          result = this.terminalApiService.getLogs(data);
          break;
        case 'clearLogs':
          result = this.terminalApiService.clearLogs(data);
          break;
        case 'streamLogs':
          this.logStreaming = true;
          result = { streaming: true };
          break;
        case 'takeSnapshot':
          result = await this.terminalApiService.takeSnapshot(data);
          break;
        case 'getSnapshots':
          result = await this.terminalApiService.getSnapshots(data);
          break;
        case 'filterSnapshots':
          result = await this.terminalApiService.filterSnapshots(data);
          break;
        case 'updateSnapshotMetadata':
          result = await this.terminalApiService.updateSnapshotMetadata(
            data.id ?? data.snapshotId,
            data.metadata ?? data.updates ?? {},
          );
          break;
        case 'editSnapshotTags':
          result = await this.terminalApiService.editSnapshotTags(
            data.id ?? data.snapshotId,
            Array.isArray(data.tags) ? data.tags : [],
          );
          break;
        case 'editSnapshotNotes':
          result = await this.terminalApiService.editSnapshotNotes(
            data.id ?? data.snapshotId,
            typeof data.notes === 'string' ? data.notes : '',
          );
          break;
        case 'editTaskReference':
          result = await this.terminalApiService.editTaskReference(
            data.id ?? data.snapshotId,
            typeof data.taskReference === 'string' ? data.taskReference : '',
          );
          break;
        case 'toggleFavoriteStatus':
          result = await this.terminalApiService.toggleFavoriteStatus(
            data.id ?? data.snapshotId,
            typeof data.isFavorite === 'boolean' ? data.isFavorite : undefined,
          );
          break;
        case 'getSnapshot':
          result = await this.terminalApiService.getSnapshot(data.id);
          break;
        case 'restoreSnapshot': {
          // The CLI sends `{ id, options }`, but an older CLI flattened its
          // options to the top level of `data`. Reading only `data.options`
          // silently dropped --backup/--files for those callers, so both shapes
          // are accepted.
          const options = data.options ?? data;
          // Strict boolean, mirroring `deleteSnapshot` below: this flag
          // disarms the unsaved-changes guard on a destructive IPC path, so
          // only a real `true` may do it -- "true", 1 and {} fail closed and
          // leave the guard armed.
          result = await this.terminalApiService.restoreSnapshot(data.id, {
            ...options,
            skipConfirm: options?.skipConfirm === true,
          });
          break;
        }
        case 'deleteSnapshot':
          // The last place `skipConfirm` can be lost on its way from the CLI
          // to the dialog: forwarding only `data.id` left
          // `!options?.skipConfirm` with no choice but to raise the modal.
          // Strict boolean, because this suppresses the confirmation for a
          // destructive operation arriving over IPC -- only a real `true` may
          // do that, and a malformed value ("false", 1, {}) fails closed and
          // keeps the dialog.
          result = await this.terminalApiService.deleteSnapshot(data.id, {
            skipConfirm: data.skipConfirm === true,
            // Strict boolean, like skipConfirm: this authorises destroying data
            // a later snapshot inherits, so only a real `true` may do it.
            force: data.force === true,
          });
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
          result = await this.terminalApiService.indexSnapshots({
            snapshotIds: data.snapshotIds,
            // Strict booleans: a re-index and a purge are explicit acts, so
            // only a real true performs them.
            force: data.force === true,
            purgeFirst: data.purgeFirst === true,
          });
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

        // Git integration (used by `codelapse git ...`)
        case 'getGitBranchInfo':
          result = await this.handleGetGitBranchInfo();
          break;
        case 'listBranches':
          result = await this.handleListBranches();
          break;
        case 'createBranch':
          result = await this.handleCreateBranch(data);
          break;
        case 'switchBranch':
          result = await this.handleSwitchBranch(data);
          break;
        case 'deleteBranch':
          result = await this.handleDeleteBranch(data);
          break;
        case 'createGitCommitFromSnapshot':
          result = await this.handleCreateGitCommitFromSnapshot(data);
          break;
        case 'autoSnapshotBeforeGitOperation':
          result = await this.handleAutoSnapshotBeforeGitOperation(data);
          break;
        case 'compareSnapshotWithGitCommit':
          result = await this.handleCompareSnapshotWithGitCommit(data);
          break;

        // Enhanced AI-optimized methods
        case 'enhancedSearch':
          result = await this.handleEnhancedSearch(data);
          break;
        case 'analyzeChunk':
          result = await this.handleAnalyzeChunk(data);
          break;
        case 'analyzeFile':
          result = await this.handleAnalyzeFile(data);
          break;
        case 'analyzeQuality':
          result = await this.handleAnalyzeQuality(data);
          break;
        case 'enhancedChunkFile':
          result = await this.handleEnhancedChunkFile(data);
          break;
        case 'chunkSnapshot':
          result = await this.handleChunkSnapshot(data);
          break;
        case 'listChunks':
          result = await this.handleListChunks(data);
          break;
        case 'getChunkMetadata':
          result = await this.handleGetChunkMetadata(data);
          break;
        case 'getChunkContext':
          result = await this.handleGetChunkContext(data);
          break;
        case 'getChunkDependencies':
          result = await this.handleGetChunkDependencies(data);
          break;
        case 'batchAnalyze':
          result = await this.handleBatchAnalyze(data);
          break;
        case 'batchSearch':
          result = await this.handleBatchSearch(data);
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
   * The workspace root a config request writes to.
   */
  private getConfigWorkspaceRoot(): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    if (!workspaceRoot) {
      throw new Error(
        'No workspace folder is open; configuration commands require a workspace.',
      );
    }
    return workspaceRoot;
  }

  /**
   * Resolve a caller-supplied config path while keeping it inside the
   * workspace, matching the CLI's export/import containment rule.
   */
  private resolveConfigFilePath(workspaceRoot: string, input: unknown): string {
    if (typeof input !== 'string' || input.trim().length === 0) {
      throw new Error('A config file path is required.');
    }

    const resolved = path.resolve(workspaceRoot, input);
    const relative = path.relative(workspaceRoot, resolved);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        `Path traversal blocked: "${input}" is outside the workspace root (${workspaceRoot})`,
      );
    }
    return resolved;
  }

  private flattenConfigEntries(
    value: Record<string, unknown>,
    prefix = '',
  ): Array<{ keyPath: string; value: unknown }> {
    const entries: Array<{ keyPath: string; value: unknown }> = [];
    for (const [key, child] of Object.entries(value)) {
      const keyPath = prefix ? `${prefix}.${key}` : key;
      if (
        typeof child === 'object' &&
        child !== null &&
        !Array.isArray(child)
      ) {
        entries.push(
          ...this.flattenConfigEntries(
            child as Record<string, unknown>,
            keyPath,
          ),
        );
      } else {
        entries.push({ keyPath, value: child });
      }
    }
    return entries;
  }

  /**
   * Config commands over IPC for the CLI. All seven share one ConfigManager so
   * `setConfig` cannot write a file the following `getConfig` does not read.
   */
  private async handleConfigRequest(method: string, data: any): Promise<any> {
    const workspaceRoot = this.getConfigWorkspaceRoot();
    const manager = new ConfigManager(workspaceRoot);

    switch (method) {
      case 'getConfig': {
        if (typeof data?.key === 'string' && data.key.length > 0) {
          const fallback = manager.getNested(data.key);
          const resolved = resolveSetting(data.key, fallback);
          return {
            config: resolved.value,
            value: resolved.value,
            source: resolved.source,
          };
        }
        return { config: manager.getConfig() };
      }

      case 'setConfig': {
        const key = this.requireNonEmptyString(data?.key, 'key');
        await manager.setNested(key, data?.value);
        const persisted = manager.getNested(key);
        const resolved = resolveSetting(key, persisted);
        const warning =
          resolved.source === 'settings'
            ? `Stored in .vscode/codelapse.json, but the VS Code setting "vscode-snapshots.${key}" is explicitly set to ${JSON.stringify(
                resolved.value,
              )} and overrides it.`
            : undefined;
        return warning ? { value: persisted, warning } : { value: persisted };
      }

      case 'resetConfig': {
        const key =
          typeof data?.key === 'string' && data.key.length > 0
            ? data.key
            : undefined;
        if (key) {
          await manager.resetNested(key);
          return { resetValues: manager.getNested(key) };
        }
        await manager.reset();
        return { resetValues: manager.getConfig() };
      }

      case 'getConfigSchema':
        return {
          schema: manager.getConfigSchema(),
          availableKeys: manager.getAvailableKeyPaths(),
        };

      case 'validateConfig': {
        const validation = manager.validate();
        return {
          isValid: validation.valid,
          errors: validation.errors,
          warnings: [],
        };
      }

      case 'exportConfig': {
        const filePath = this.resolveConfigFilePath(
          workspaceRoot,
          data?.filePath,
        );
        await fs.promises.writeFile(filePath, manager.exportConfig(), 'utf8');
        return { filePath };
      }

      case 'importConfig': {
        const filePath = this.resolveConfigFilePath(
          workspaceRoot,
          data?.filePath,
        );
        const serialized = await fs.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(serialized) as unknown;
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error('Imported configuration must be a JSON object');
        }

        if (data?.merge === true) {
          const entries = this.flattenConfigEntries(
            parsed as Record<string, unknown>,
          );
          if (entries.length === 0) {
            return { importedKeys: [] };
          }

          const availableKeys = new Set(manager.getAvailableKeyPaths());
          for (const entry of entries) {
            if (!availableKeys.has(entry.keyPath)) {
              throw new Error(
                `Invalid configuration key path "${entry.keyPath}" in import file`,
              );
            }
          }

          const importedKeys: string[] = [];
          for (const entry of entries) {
            await manager.setNested(entry.keyPath, entry.value);
            importedKeys.push(entry.keyPath);
          }
          return { importedKeys };
        }

        await manager.importConfig(serialized);
        return { importedKeys: Object.keys(parsed) };
      }

      default:
        throw new Error(`Unknown config method: ${method}`);
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
      // The status payload reports the snapshot's *identity*, matching
      // standalone mode (unifiedClient.getStatus sends
      // `getCurrentSnapshot()?.id`). It previously reported the description, so
      // this one field meant two different things depending on whether an
      // extension happened to be connected. Descriptions are display text and
      // may be empty or duplicated, so callers cannot branch on them.
      currentSnapshot: workspaceInfo.currentSnapshot?.id ?? null,
      extensionVersion: this.context.extension.packageJSON.version,
      apiVersion: '1.0.0',
    };
  }

  // ---------------------------------------------------------------------------
  // Git integration
  //
  // Everything below runs against the built-in VS Code Git extension API rather
  // than shelling out to git: the synchronous `execFileSync` calls of
  // `codelapse-core`'s GitIntegration would block the extension host.
  // ---------------------------------------------------------------------------

  /**
   * Resolve the built-in VS Code Git extension API.
   *
   * `getAPI` throws when git is disabled, so every failure mode is converted
   * into an actionable error. Git commands refuse to run rather than reporting
   * empty results the CLI would present as real data.
   */
  private async getGitApi(): Promise<GitAPI> {
    if (this.gitApi) {
      return this.gitApi;
    }

    const extension =
      vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
      throw new Error(
        'The built-in VS Code Git extension is not available; git commands require VS Code with the Git extension installed and enabled.',
      );
    }

    // Accessing `exports` before activation is invalid, so activate first.
    if (!extension.isActive) {
      await extension.activate();
    }

    const gitExtension = extension.exports;
    if (gitExtension?.enabled === false) {
      throw new Error(
        'The VS Code Git extension is disabled, so git commands are unavailable. Enable Git (setting "git.enabled") and try again.',
      );
    }

    try {
      const api = gitExtension.getAPI(1);
      if (!api) {
        throw new Error('Git API version 1 is unavailable');
      }
      return api;
    } catch (error) {
      throw new Error(
        `Failed to obtain the VS Code Git API: ${this.describeError(error)}`,
      );
    }
  }

  /**
   * Find the Git repository that contains the workspace folder.
   */
  private async getGitRepository(): Promise<GitRepository> {
    const workspaceFolder = this.getWorkspaceFolder();
    const api = await this.getGitApi();
    const repository = api.getRepository(workspaceFolder.uri);

    if (!repository) {
      throw new Error(
        'No Git repository found for this workspace; git commands require the workspace to be inside a Git repository.',
      );
    }

    return repository;
  }

  /**
   * The workspace folder every relative snapshot path is resolved against.
   */
  private getWorkspaceFolder(): vscode.WorkspaceFolder {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error(
        'No workspace folder is open; git commands require the workspace to be inside a Git repository.',
      );
    }
    return workspaceFolder;
  }

  /**
   * Local branch names, in the order the Git extension reports them.
   *
   * `Ref.name` is optional and remote heads are not branches of this
   * repository, so both are filtered out: the CLI compares the entries of this
   * array directly against the current branch name.
   */
  private async collectBranchNames(
    repository: GitRepository,
  ): Promise<string[]> {
    const refs = await repository.getBranches({});

    return refs
      .filter((ref) => ref.type === GIT_REF_TYPE_HEAD)
      .map((ref) => ref.name)
      .filter(
        (name): name is string => typeof name === 'string' && name.length > 0,
      );
  }

  /**
   * The URL the workspace pushes to, preferring `origin` like
   * `git remote get-url origin` does. Empty when the repository has no remote.
   */
  private getRemoteUrl(repository: GitRepository): string {
    const remotes = repository.state.remotes;
    const remote =
      remotes.find((candidate) => candidate.name === 'origin') ?? remotes[0];

    return remote?.fetchUrl ?? remote?.pushUrl ?? '';
  }

  /**
   * Whether the working tree has anything to commit. Untracked files count, as
   * they do for `git status --porcelain`.
   */
  private hasWorkingTreeChanges(repository: GitRepository): boolean {
    const state = repository.state;

    return (
      state.workingTreeChanges.length +
        state.indexChanges.length +
        state.mergeChanges.length +
        state.untrackedChanges.length >
      0
    );
  }

  /**
   * Handle `getGitBranchInfo`: the repository's branch, commit and remote, plus
   * the comparison state the CLI reports.
   */
  private async handleGetGitBranchInfo(): Promise<GitBranchInfoResult> {
    const repository = await this.getGitRepository();
    const head = repository.state.HEAD;

    if (!head?.commit) {
      throw new Error(
        `Git repository at "${repository.rootUri.fsPath}" has no commits yet, so there is no current branch or commit hash to report. Create an initial commit first.`,
      );
    }

    return {
      // `head.name` is undefined while HEAD is detached; `git rev-parse
      // --abbrev-ref HEAD` reports `HEAD` in that case, so match that.
      currentBranch: head.name ?? 'HEAD',
      commitHash: head.commit,
      remoteUrl: this.getRemoteUrl(repository),
      hasChanges: this.hasWorkingTreeChanges(repository),
      branches: await this.collectBranchNames(repository),
    };
  }

  /**
   * Handle `listBranches`.
   */
  private async handleListBranches(): Promise<{ branches: string[] }> {
    const repository = await this.getGitRepository();

    return { branches: await this.collectBranchNames(repository) };
  }

  /**
   * Handle `createBranch`.
   */
  private async handleCreateBranch(data: any): Promise<{
    branch: string;
    created: boolean;
    checkout: boolean;
  }> {
    const name = this.requireNonEmptyString(data?.name, 'name');
    const checkout = data?.checkout === true;
    const repository = await this.getGitRepository();

    try {
      await repository.createBranch(name, checkout);
    } catch (error) {
      throw new Error(
        `Failed to create branch "${name}": ${this.describeError(error)}`,
      );
    }

    return { branch: name, created: true, checkout };
  }

  /**
   * Handle `switchBranch`.
   */
  private async handleSwitchBranch(data: any): Promise<{
    branch: string;
    switched: boolean;
  }> {
    const name = this.requireNonEmptyString(data?.name, 'name');
    const repository = await this.getGitRepository();

    try {
      await repository.checkout(name);
    } catch (error) {
      throw new Error(
        `Failed to switch to branch "${name}": ${this.describeError(error)}`,
      );
    }

    return { branch: name, switched: true };
  }

  /**
   * Handle `deleteBranch`.
   */
  private async handleDeleteBranch(data: any): Promise<{
    branch: string;
    deleted: boolean;
    force: boolean;
  }> {
    const name = this.requireNonEmptyString(data?.name, 'name');
    const force = data?.force === true;
    const repository = await this.getGitRepository();

    try {
      await repository.deleteBranch(name, force);
    } catch (error) {
      throw new Error(
        `Failed to delete branch "${name}": ${this.describeError(error)}`,
      );
    }

    return { branch: name, deleted: true, force };
  }

  /**
   * Handle `createGitCommitFromSnapshot`: put a snapshot's files into the
   * working tree, commit them, and report the commit git actually created.
   */
  private async handleCreateGitCommitFromSnapshot(
    data: any,
  ): Promise<GitCommitFromSnapshotResult> {
    const snapshotId = this.requireNonEmptyString(
      data?.snapshotId,
      'snapshotId',
    );
    const includeUntracked = data?.includeUntracked === true;
    const push = data?.push === true;
    const branchToCreate =
      data?.createBranch === undefined ||
      data?.createBranch === null ||
      data?.createBranch === ''
        ? undefined
        : this.requireNonEmptyString(data.createBranch, 'createBranch');

    const repository = await this.getGitRepository();
    const workspaceRoot = this.getWorkspaceFolder().uri.fsPath;

    const snapshot = await this.terminalApiService.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(
        `Snapshot ${snapshotId} not found; there is nothing to commit.`,
      );
    }

    // Create (and check out) the branch before touching the working tree, so a
    // dirty tree cannot make the checkout fail halfway through the operation.
    if (branchToCreate) {
      try {
        await repository.createBranch(branchToCreate, true);
      } catch (error) {
        throw new Error(
          `Failed to create branch "${branchToCreate}": ${this.describeError(
            error,
          )}`,
        );
      }
    }

    // Put the snapshot's files into the working tree. Restoring via the same
    // snapshot service the rest of this class uses also removes the files the
    // snapshot records as deleted, so the commit represents the snapshot rather
    // than whatever the workspace happened to contain.
    const restore = await this.terminalApiService.restoreSnapshot(snapshotId, {
      silent: true,
    });
    if (!restore.success) {
      throw new Error(
        `Failed to restore snapshot ${snapshotId} into the working tree: ${
          restore.error ?? 'unknown error'
        }`,
      );
    }

    // Stage exactly the files the snapshot contains. `add([])` runs
    // `git add --` and stages nothing, so pass explicit paths and skip the call
    // entirely when the snapshot has no committable files.
    const pathsToStage = this.resolveSnapshotPaths(
      repository,
      workspaceRoot,
      snapshot.files,
      includeUntracked,
    );
    if (pathsToStage.length > 0) {
      await repository.add(pathsToStage);
    }

    const message = this.buildCommitMessage(snapshot, data?.commitMessage);

    try {
      await repository.commit(message);
    } catch (error) {
      throw new Error(
        `Failed to commit snapshot ${snapshotId}: ${this.describeError(error)}`,
      );
    }

    if (push) {
      const branchToPush = branchToCreate ?? repository.state.HEAD?.name;
      try {
        await repository.push(undefined, branchToPush, true);
      } catch (error) {
        throw new Error(
          `Committed ${snapshotId} but failed to push${
            branchToPush ? ` branch "${branchToPush}"` : ''
          }: ${this.describeError(error)}`,
        );
      }
    }

    // Read the result back from git: `repository.state` can lag behind the
    // commit that was just created, and the CLI prints these values verbatim.
    // The branch we checked out is known exactly, so it wins over cached state.
    const commit = await repository.getCommit('HEAD');
    const branch = branchToCreate ?? repository.state.HEAD?.name ?? 'HEAD';

    if (!commit.hash) {
      throw new Error(
        `Git did not report a commit hash after committing snapshot ${snapshotId}.`,
      );
    }

    return { commitHash: commit.hash, branch, message };
  }

  /**
   * Handle `autoSnapshotBeforeGitOperation`: snapshot the workspace before a
   * git operation and report the snapshot that was created.
   */
  private async handleAutoSnapshotBeforeGitOperation(
    data: any,
  ): Promise<{ snapshot: { id: string; description: string } }> {
    const operation = this.requireNonEmptyString(data?.operation, 'operation');
    const includeUntracked = data?.includeUntracked === true;
    const description =
      typeof data?.description === 'string' &&
      data.description.trim().length > 0
        ? data.description
        : `Auto-snapshot before ${operation}`;

    const response = await this.terminalApiService.takeSnapshot({
      description,
      // 'auto-snapshot' is not in treeView.isAutoSnapshot's list, so every
      // snapshot this path created was filed under Manual. 'auto' is the tag
      // the classifier reads, and both modes use the same set so they cannot
      // drift apart again.
      tags: ['auto', 'git'],
      notes: `Created automatically before the git operation "${operation}" (includeUntracked: ${includeUntracked}).`,
      silent: true,
    });

    if (!response.success || !response.snapshot) {
      throw new Error(
        `Failed to take a snapshot before "${operation}": ${
          response.error ?? 'unknown error'
        }`,
      );
    }

    // The CLI prints both fields, so an incomplete snapshot is an error rather
    // than something to paper over.
    const { id, description: createdDescription } = response.snapshot;
    if (!id || !createdDescription) {
      throw new Error(
        `The snapshot service returned a snapshot without an id or description after "${operation}"; refusing to report an incomplete snapshot.`,
      );
    }

    return { snapshot: { id, description: createdDescription } };
  }

  /**
   * Handle `compareSnapshotWithGitCommit`: compare the snapshot's file contents
   * with the tree of a commit.
   *
   * The Git API exposes no tree listing, so the comparison walks the paths the
   * snapshot records. Files that exist in the commit but are absent from the
   * snapshot entirely cannot be seen; files that were deleted at snapshot time
   * are recorded explicitly by the snapshot service (as `deleted`), so those
   * are still reported.
   */
  private async handleCompareSnapshotWithGitCommit(
    data: any,
  ): Promise<GitComparisonResult> {
    const snapshotId = this.requireNonEmptyString(
      data?.snapshotId,
      'snapshotId',
    );
    const commitHash = this.requireCommitHash(data?.commitHash);
    const includeFileList = data?.includeFileList === true;

    const repository = await this.getGitRepository();
    const workspaceRoot = this.getWorkspaceFolder().uri.fsPath;
    const snapshot = await this.terminalApiService.getSnapshot(snapshotId);

    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found.`);
    }

    const differences: GitFileDifference[] = [];
    const fileChanges = {
      added: [] as string[],
      modified: [] as string[],
      deleted: [] as string[],
    };

    const record = (
      file: string,
      changeType: GitFileChangeType,
      counts?: { linesAdded: number; linesRemoved: number },
    ): void => {
      differences.push(
        includeFileList && counts
          ? { file, changeType, ...counts }
          : { file, changeType },
      );
      fileChanges[changeType].push(file);
    };

    for (const [snapshotPath, fileData] of Object.entries(snapshot.files)) {
      const repositoryPath = this.toRepositoryPath(
        repository,
        workspaceRoot,
        snapshotPath,
      );
      if (!repositoryPath) {
        continue;
      }

      // `show` rejects when the path is not in that commit's tree, which is how
      // a file is recognised as added or deleted. A ref that matches the hash
      // format but does not resolve in the repository fails the same way, so
      // such a ref reads as "every snapshot file was added" — the CLI's
      // standalone mode, which shells out to `git show`, behaves identically.
      const committed = await this.readCommittedFile(
        repository,
        commitHash,
        repositoryPath,
      );

      if (fileData.deleted) {
        if (committed !== null) {
          record(repositoryPath, 'deleted', {
            linesAdded: 0,
            linesRemoved: this.countLines(committed),
          });
        }
        continue;
      }

      if (fileData.isBinary) {
        // Binary content is not comparable through the text-based Git API, so
        // only the file's presence can be compared.
        if (committed === null) {
          record(repositoryPath, 'added');
        }
        continue;
      }

      const content = await this.terminalApiService.getSnapshotFileContent(
        snapshotId,
        snapshotPath,
      );
      if (content === null) {
        // The file cannot be reconstructed from the snapshot (for example an
        // unresolved diff), so there is nothing to compare it against.
        continue;
      }

      if (committed === null) {
        record(repositoryPath, 'added', {
          linesAdded: this.countLines(content),
          linesRemoved: 0,
        });
      } else if (content !== committed) {
        record(
          repositoryPath,
          'modified',
          this.countChangedLines(committed, content),
        );
      }
    }

    differences.sort((a, b) => a.file.localeCompare(b.file));

    return includeFileList ? { differences, fileChanges } : { differences };
  }

  /**
   * Map the files a snapshot records to repository-relative paths git can
   * stage.
   *
   * Files recorded as deleted are skipped (the snapshot stores their removal,
   * not their content) and untracked files are only staged when the caller
   * asked for untracked files to be included.
   */
  private resolveSnapshotPaths(
    repository: GitRepository,
    workspaceRoot: string,
    files: Snapshot['files'],
    includeUntracked: boolean,
  ): string[] {
    const untracked = includeUntracked
      ? undefined
      : this.collectUntrackedPaths(repository);
    const stageable = new Set<string>();

    for (const [snapshotPath, fileData] of Object.entries(files)) {
      if (fileData.deleted) {
        continue;
      }

      const repositoryPath = this.toRepositoryPath(
        repository,
        workspaceRoot,
        snapshotPath,
      );
      if (!repositoryPath || untracked?.has(repositoryPath)) {
        continue;
      }

      stageable.add(repositoryPath);
    }

    return Array.from(stageable).sort();
  }

  /**
   * The paths git currently reports as untracked, repository-relative.
   */
  private collectUntrackedPaths(repository: GitRepository): Set<string> {
    const repositoryRoot = repository.rootUri.fsPath;

    return new Set(
      repository.state.untrackedChanges
        .map((change) =>
          this.toRepositoryPath(repository, repositoryRoot, change.uri.fsPath),
        )
        .filter((filePath): filePath is string => typeof filePath === 'string'),
    );
  }

  /**
   * Translate a snapshot path (workspace-relative, native separators) into a
   * repository-relative path with POSIX separators.
   *
   * Returns undefined for anything outside the repository root, which git
   * cannot stage — the workspace can be a subdirectory of the repository, or
   * contain files the repository does not track at all.
   */
  private toRepositoryPath(
    repository: GitRepository,
    workspaceRoot: string,
    filePath: string,
  ): string | undefined {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(workspaceRoot, filePath);
    const relativePath = path.relative(repository.rootUri.fsPath, absolutePath);

    if (
      !relativePath ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      return undefined;
    }

    return relativePath.split(path.sep).join('/');
  }

  /**
   * The commit message for a snapshot: the caller's when given, otherwise one
   * derived from the snapshot's description and id.
   */
  private buildCommitMessage(snapshot: Snapshot, requested?: unknown): string {
    if (typeof requested === 'string' && requested.trim().length > 0) {
      return requested;
    }

    const description = snapshot.description?.trim();

    return description
      ? `Snapshot: ${description} [${snapshot.id}]`
      : `Snapshot ${snapshot.id}`;
  }

  /**
   * Read a file from a commit's tree, or null when that commit does not contain
   * the path (`git show <commit>:<path>` fails).
   */
  private async readCommittedFile(
    repository: GitRepository,
    commitHash: string,
    repositoryPath: string,
  ): Promise<string | null> {
    try {
      return await repository.show(commitHash, repositoryPath);
    } catch {
      return null;
    }
  }

  /**
   * Count the lines of a file, ignoring a trailing newline.
   */
  private countLines(content: string): number {
    if (content.length === 0) {
      return 0;
    }

    const lines = content.split(/\r\n|\r|\n/);
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }

    return lines.length;
  }

  /**
   * Count the lines a change adds and removes.
   */
  private countChangedLines(
    previous: string,
    current: string,
  ): { linesAdded: number; linesRemoved: number } {
    let linesAdded = 0;
    let linesRemoved = 0;

    for (const change of diff.diffLines(previous, current)) {
      const count = change.count ?? this.countLines(change.value);
      if (change.added) {
        linesAdded += count;
      } else if (change.removed) {
        linesRemoved += count;
      }
    }

    return { linesAdded, linesRemoved };
  }

  /**
   * Validate a required string field of an IPC payload.
   */
  private requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(
        `Missing or invalid "${field}": expected a non-empty string.`,
      );
    }
    return value;
  }

  /**
   * Validate a commit hash before it reaches git. Mirrors the validation
   * `codelapse-core`'s GitIntegration applies to the same input.
   */
  private requireCommitHash(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-fA-F0-9]{4,40}$/.test(value)) {
      throw new Error(`Invalid commit hash: "${String(value)}"`);
    }
    return value;
  }

  /**
   * Best-effort message for anything that was thrown.
   */
  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
        authToken: this.authToken,
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

      // The file carries a live credential. `writeFileSync`'s default mode
      // follows the umask, which is typically world-readable on Unix; an
      // existing file keeps whatever mode it already had, so tighten it too.
      if (process.platform !== 'win32' && fs.existsSync(connectionFile)) {
        fs.chmodSync(connectionFile, 0o600);
      }
      fs.writeFileSync(
        connectionFile,
        JSON.stringify(connectionInfo, null, 2),
        {
          encoding: 'utf8',
          mode: 0o600,
        },
      );
      log(`Created connection file: ${connectionFile}`);
    } catch (error) {
      log(`Failed to create connection file: ${error}`);
    }
  }

  /**
   * Get unique workspace identifier
   */
  private getWorkspaceId(): string {
    return getWorkspaceId(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
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
   * Handle enhanced semantic search with AI-optimized features
   */
  private async handleEnhancedSearch(data: any): Promise<AIAgentResponse> {
    const startTime = Date.now();

    try {
      if (!this.semanticSearchService) {
        throw new Error('Semantic search service not available');
      }

      const options: EnhancedSemanticSearchOptions = {
        query: data.query,
        snapshotIds: data.snapshotIds,
        limit: data.limit || 20,
        languages: data.languages,
        scoreThreshold: data.scoreThreshold || 0.65,
        searchMode: data.searchMode || 'semantic',
        includeExplanations: data.includeExplanations !== false,
        includeRelationships: data.includeRelationships !== false,
        includeQualityMetrics: data.includeQualityMetrics !== false,
        contextRadius: data.contextRadius || 5,
        rankingStrategy: data.rankingStrategy || 'relevance',
        filterCriteria: data.filterCriteria || {},
        maxResultsPerFile: data.maxResultsPerFile,
        enableDiversification: data.enableDiversification !== false,
      };

      const results = await this.semanticSearchService.searchCodeEnhanced(
        options,
      );
      const executionTime = Date.now() - startTime;

      const response: AIAgentResponse = {
        success: true,
        timestamp: new Date().toISOString(),
        executionTime,
        query: {
          original: data.query,
          processed: data.query, // Would be enhanced by QueryProcessor
          intent: {
            primary: 'find_implementation',
            secondary: [],
            confidence: 0.8,
            context: [],
            suggestedParameters: {},
          },
        },
        results,
        metadata: {
          totalResults: results.length,
          searchStrategy: {
            mode: options.searchMode,
            ranking: options.rankingStrategy,
            diversification: options.enableDiversification || false,
            contextRadius: options.contextRadius,
            boostFactors: [],
            penaltyFactors: [],
          },
          rankingApplied: options.rankingStrategy,
          filtersApplied: options.filterCriteria,
          performanceMetrics: {
            queryProcessingTime: 0,
            searchTime: executionTime,
            resultProcessingTime: 0,
            totalTime: executionTime,
            memoryUsage: process.memoryUsage().heapUsed,
            cacheHitRate: 0,
            chunksSearched: results.length,
            vectorOperations: results.length,
          },
          searchQualityMetrics: {
            averageRelevanceScore:
              results.reduce((sum, r) => sum + r.score, 0) / results.length ||
              0,
            diversityScore: 0.8,
            typeCoverage: 0.7,
            qualityConfidence: 0.8,
          },
        },
        suggestions: [],
        relatedQueries: [],
      };

      return response;
    } catch (error) {
      return {
        success: false,
        timestamp: new Date().toISOString(),
        executionTime: Date.now() - startTime,
        query: {
          original: data.query || '',
          processed: data.query || '',
          intent: {
            primary: 'find_implementation',
            secondary: [],
            confidence: 0,
            context: [],
            suggestedParameters: {},
          },
        },
        results: [],
        metadata: {
          totalResults: 0,
          searchStrategy: {
            mode: 'semantic',
            ranking: 'relevance',
            diversification: false,
            contextRadius: 5,
            boostFactors: [],
            penaltyFactors: [],
          },
          rankingApplied: 'relevance',
          filtersApplied: {},
          performanceMetrics: {
            queryProcessingTime: 0,
            searchTime: 0,
            resultProcessingTime: 0,
            totalTime: 0,
            memoryUsage: 0,
            cacheHitRate: 0,
            chunksSearched: 0,
            vectorOperations: 0,
          },
          searchQualityMetrics: {
            averageRelevanceScore: 0,
            diversityScore: 0,
            typeCoverage: 0,
            qualityConfidence: 0,
          },
        },
        suggestions: [],
        relatedQueries: [],
        error: {
          code: 'ENHANCED_SEARCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
          category: 'search_execution',
          severity: 'high',
          suggestions: [
            'Check semantic search service availability',
            'Verify query parameters',
          ],
          retryable: true,
          fallbackOptions: ['Use basic search', 'Simplify query'],
        },
      };
    }
  }

  /**
   * Resolve one chunk of a snapshot file, or throw.
   *
   * Every handler below used to return a well-formed payload with fabricated
   * values regardless of what was asked for, so a caller could not tell a real
   * answer from a placeholder.
   */
  private async resolveChunk(
    snapshotId: string,
    filePath: string,
    chunkId: string,
  ): Promise<EnhancedCodeChunk> {
    const content = await this.terminalApiService.getSnapshotFileContent(
      snapshotId,
      filePath,
    );
    if (content === null) {
      throw new Error(`File not found in snapshot ${snapshotId}: ${filePath}`);
    }

    const chunks = await this.enhancedCodeChunker.chunkFileEnhanced(
      filePath,
      content,
      snapshotId,
    );
    const chunk = chunks.find((candidate) => candidate.id === chunkId);
    if (!chunk) {
      throw new Error(`Chunk not found: ${chunkId}`);
    }
    return chunk;
  }

  /**
   * Snapshot ids are the prefix before the first `_` in a strategy chunk id.
   */
  private extractSnapshotIdFromChunkId(chunkId: string): string | undefined {
    const separator = chunkId.indexOf('_');
    return separator > 0 ? chunkId.slice(0, separator) : undefined;
  }

  /**
   * Resolve a chunk either against the payload's file path or, when the caller
   * only has a chunk id, by walking the snapshot's files until one produces it.
   */
  private async resolveChunkInSnapshot(
    snapshotId: string,
    chunkId: string,
    filePath?: string,
  ): Promise<{ filePath: string; chunk: EnhancedCodeChunk }> {
    if (filePath) {
      return {
        filePath,
        chunk: await this.resolveChunk(snapshotId, filePath, chunkId),
      };
    }

    const snapshot = await this.terminalApiService.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    for (const candidate of Object.keys(snapshot.files)) {
      const file = snapshot.files[candidate];
      if (file.deleted || file.isBinary) {
        continue;
      }
      try {
        return {
          filePath: candidate,
          chunk: await this.resolveChunk(snapshotId, candidate, chunkId),
        };
      } catch {
        // This file does not contain the requested chunk; try the next one.
      }
    }

    throw new Error(`Chunk not found: ${chunkId}`);
  }

  /**
   * Handle chunk analysis request
   */
  private async handleAnalyzeChunk(data: any): Promise<any> {
    try {
      const { chunkId, analysisType = 'full' } = data;
      const snapshotId =
        data.snapshotId || this.extractSnapshotIdFromChunkId(chunkId);

      if (!chunkId || !snapshotId) {
        throw new Error('chunkId and snapshotId are required');
      }

      const { filePath, chunk } = await this.resolveChunkInSnapshot(
        snapshotId,
        chunkId,
        data.filePath,
      );

      return {
        success: true,
        chunkId,
        snapshotId,
        filePath,
        analysisType,
        analysis: {
          qualityMetrics: {
            ...chunk.qualityMetrics,
            complexityScore: chunk.enhancedMetadata.complexityScore,
          },
          relationships: chunk.relationships,
          securityConcerns:
            (chunk.enhancedMetadata as any).securityConcerns ?? [],
        },
        metadata: {
          analysisTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify chunk ID exists', 'Check snapshot availability'],
      };
    }
  }
  /**
   * Handle file analysis request
   */
  private async handleAnalyzeFile(data: any): Promise<any> {
    try {
      const { filePath, snapshotId, analysisType = 'full' } = data;

      if (!filePath || !snapshotId) {
        throw new Error('filePath and snapshotId are required');
      }

      // Get file content
      const content = await this.terminalApiService.getSnapshotFileContent(
        snapshotId,
        filePath,
      );
      if (!content) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Perform enhanced chunking and analysis
      const chunks = await this.enhancedCodeChunker.chunkFileEnhanced(
        filePath,
        content,
        snapshotId,
      );

      // Calculate overall file metrics
      const fileMetrics = {
        totalChunks: chunks.length,
        totalLines: content.split('\n').length,
        averageQuality:
          chunks.reduce(
            (sum, chunk) => sum + chunk.qualityMetrics.overallScore,
            0,
          ) / chunks.length,
        complexityDistribution: this.calculateComplexityDistribution(chunks),
        securityConcerns: this.aggregateSecurityConcerns(chunks),
        designPatterns: this.aggregateDesignPatterns(chunks),
      };

      return {
        success: true,
        filePath,
        snapshotId,
        analysisType,
        fileMetrics,
        chunks: chunks.map((chunk) => ({
          id: chunk.id,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          semanticType: chunk.enhancedMetadata.semanticType,
          qualityScore: chunk.qualityMetrics.overallScore,
          complexityScore: chunk.enhancedMetadata.complexityScore,
          relationships: chunk.relationships.length,
          securityConcerns: chunk.enhancedMetadata.securityConcerns,
        })),
        suggestions: this.generateFileLevelSuggestions(chunks),
        metadata: {
          analysisTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify file path exists', 'Check snapshot availability'],
      };
    }
  }

  /**
   * Handle quality analysis request
   */
  private async handleAnalyzeQuality(data: any): Promise<any> {
    try {
      const { target, snapshotId } = data;

      if (!target || !snapshotId) {
        throw new Error('target and snapshotId are required');
      }

      let chunks: EnhancedCodeChunk[] = [];
      const content = await this.terminalApiService.getSnapshotFileContent(
        snapshotId,
        target,
      );
      if (content !== null) {
        chunks = await this.enhancedCodeChunker.chunkFileEnhanced(
          target,
          content,
          snapshotId,
        );
      } else {
        const resolved = await this.resolveChunkInSnapshot(
          snapshotId,
          target,
          data.filePath,
        );
        chunks = [resolved.chunk];
      }

      if (chunks.length === 0) {
        throw new Error(`No chunks found for target: ${target}`);
      }

      const average = (
        read: (chunk: EnhancedCodeChunk) => number | undefined,
      ): number | undefined => {
        const values = chunks
          .map(read)
          .filter((value): value is number => typeof value === 'number');
        return values.length === 0
          ? undefined
          : values.reduce((sum, value) => sum + value, 0) / values.length;
      };

      const metricReaders: Record<
        string,
        (chunk: EnhancedCodeChunk) => number | undefined
      > = {
        readability: (chunk) => chunk.qualityMetrics.readabilityScore,
        maintainability: (chunk) => chunk.qualityMetrics.maintainabilityScore,
        testCoverage: (chunk) => chunk.qualityMetrics.testCoverage,
        documentation: (chunk) => chunk.qualityMetrics.documentationRatio,
        complexity: (chunk) => (chunk.enhancedMetadata as any).complexityScore,
        duplication: (chunk) => chunk.qualityMetrics.duplicationRisk,
      };

      const requested =
        Array.isArray(data.metrics) &&
        data.metrics.length > 0 &&
        !data.metrics.includes('all')
          ? data.metrics
          : Object.keys(metricReaders);
      const metrics: Record<string, number> = {};
      for (const metric of requested) {
        const reader = metricReaders[metric];
        if (!reader) {
          continue;
        }
        const value = average(reader);
        if (value !== undefined) {
          metrics[metric] = value;
        }
      }

      const overallScore =
        average((chunk) => chunk.qualityMetrics.overallScore) ?? 0;
      const recommendations: Array<Record<string, unknown>> = [];
      if (metrics.documentation !== undefined && metrics.documentation < 0.3) {
        recommendations.push({
          category: 'documentation',
          priority: 'high',
          description: 'Increase documentation coverage',
        });
      }
      if (
        metrics.maintainability !== undefined &&
        metrics.maintainability < 70
      ) {
        recommendations.push({
          category: 'maintainability',
          priority: 'medium',
          description: 'Simplify complex sections reported by the chunker',
        });
      }

      return {
        success: true,
        target,
        snapshotId,
        qualityAnalysis: {
          overallScore,
          metrics,
          trends: {
            improving: [],
            declining: [],
            stable: Object.keys(metrics),
          },
          recommendations,
        },
        metadata: {
          analysisTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: [
          'Verify target specification',
          'Check snapshot availability',
        ],
      };
    }
  }
  /**
   * Handle enhanced file chunking request
   */
  private async handleEnhancedChunkFile(data: any): Promise<any> {
    try {
      const { filePath, snapshotId, strategy = 'semantic' } = data;

      if (!filePath || !snapshotId) {
        throw new Error('filePath and snapshotId are required');
      }

      // Get file content
      const content = await this.terminalApiService.getSnapshotFileContent(
        snapshotId,
        filePath,
      );
      if (!content) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Perform enhanced chunking
      const chunks = await this.enhancedCodeChunker.chunkFileEnhanced(
        filePath,
        content,
        snapshotId,
        strategy,
      );

      return {
        success: true,
        filePath,
        snapshotId,
        strategy,
        chunks: chunks.map((chunk) => ({
          id: chunk.id,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          enhancedMetadata: chunk.enhancedMetadata,
          qualityMetrics: chunk.qualityMetrics,
          relationships: chunk.relationships,
          contextInfo: chunk.contextInfo,
        })),
        summary: {
          totalChunks: chunks.length,
          averageSize:
            chunks.reduce(
              (sum, chunk) => sum + (chunk.endLine - chunk.startLine),
              0,
            ) / chunks.length,
          semanticTypes: this.getSemanticTypeDistribution(chunks),
          qualityDistribution: this.getQualityDistribution(chunks),
        },
        metadata: {
          chunkingTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: [
          'Verify file path exists',
          'Check chunking strategy',
          'Validate options',
        ],
      };
    }
  }

  /**
   * Handle snapshot chunking request
   */
  private async handleChunkSnapshot(data: any): Promise<any> {
    try {
      const { snapshotId, strategy = 'semantic', filePatterns } = data;

      if (!snapshotId) {
        throw new Error('snapshotId is required');
      }

      const snapshot = await this.terminalApiService.getSnapshot(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
      }

      // Get files to process
      const filesToProcess = Object.keys(snapshot.files).filter((filePath) => {
        if (filePatterns && filePatterns.length > 0) {
          return filePatterns.some((pattern: string) =>
            filePath.includes(pattern),
          );
        }
        return (
          !snapshot.files[filePath].deleted &&
          !snapshot.files[filePath].isBinary
        );
      });

      const results = [];
      for (const filePath of filesToProcess) {
        try {
          const content = await this.terminalApiService.getSnapshotFileContent(
            snapshotId,
            filePath,
          );
          if (content) {
            const chunks = await this.enhancedCodeChunker.chunkFileEnhanced(
              filePath,
              content,
              snapshotId,
              strategy,
            );
            results.push({
              filePath,
              chunks: chunks.length,
              success: true,
            });
          }
        } catch (error) {
          results.push({
            filePath,
            chunks: 0,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return {
        success: true,
        snapshotId,
        strategy,
        results,
        summary: {
          totalFiles: filesToProcess.length,
          successfulFiles: results.filter((r) => r.success).length,
          totalChunks: results.reduce((sum, r) => sum + r.chunks, 0),
        },
        metadata: {
          chunkingTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: [
          'Verify snapshot exists',
          'Check file patterns',
          'Validate chunking strategy',
        ],
      };
    }
  }

  /**
   * Handle list chunks request
   */
  private async handleListChunks(data: any): Promise<any> {
    try {
      const { snapshotId, filePath } = data;

      if (!snapshotId) {
        throw new Error('snapshotId is required');
      }

      const filePaths: string[] = [];
      let snapshot: Snapshot | null = null;
      if (filePath) {
        filePaths.push(filePath);
      } else {
        snapshot = await this.terminalApiService.getSnapshot(snapshotId);
        if (!snapshot) {
          throw new Error(`Snapshot not found: ${snapshotId}`);
        }
        filePaths.push(
          ...Object.keys(snapshot.files).filter((candidate) => {
            const file = snapshot!.files[candidate];
            return !file.deleted && !file.isBinary;
          }),
        );
      }

      const collected: EnhancedCodeChunk[] = [];
      for (const candidate of filePaths) {
        const content = await this.terminalApiService.getSnapshotFileContent(
          snapshotId,
          candidate,
        );
        if (content === null) {
          continue;
        }
        collected.push(
          ...(await this.enhancedCodeChunker.chunkFileEnhanced(
            candidate,
            content,
            snapshotId,
          )),
        );
      }

      const filters = data.filters ?? {};
      let filtered = collected;
      if (
        Array.isArray(filters.semanticTypes) &&
        filters.semanticTypes.length > 0
      ) {
        filtered = filtered.filter((chunk) =>
          filters.semanticTypes.includes(chunk.enhancedMetadata.semanticType),
        );
      }
      if (typeof filters.qualityThreshold === 'number') {
        filtered = filtered.filter(
          (chunk) =>
            toRatio(chunk.qualityMetrics.overallScore) >=
            filters.qualityThreshold,
        );
      }
      if (Array.isArray(filters.complexityRange)) {
        const [min, max] = filters.complexityRange;
        filtered = filtered.filter((chunk) => {
          const complexity = (chunk.enhancedMetadata as any).complexityScore;
          return complexity >= min && complexity <= max;
        });
      }
      if (
        Array.isArray(filters.hasPatterns) &&
        filters.hasPatterns.length > 0
      ) {
        filtered = filtered.filter((chunk) =>
          filters.hasPatterns.some((pattern: string) =>
            (chunk.enhancedMetadata.designPatterns ?? []).includes(pattern),
          ),
        );
      }
      if (
        Array.isArray(filters.excludeSmells) &&
        filters.excludeSmells.length > 0
      ) {
        filtered = filtered.filter(
          (chunk) =>
            !filters.excludeSmells.some((smell: string) =>
              (chunk.enhancedMetadata.codeSmells ?? []).includes(smell),
            ),
        );
      }

      const sortBy = data.sortBy || 'startLine';
      const sortOrder = data.sortOrder === 'desc' ? -1 : 1;
      filtered = [...filtered].sort((a, b) => {
        const read = (chunk: EnhancedCodeChunk): number => {
          switch (sortBy) {
            case 'qualityScore':
              return toRatio(chunk.qualityMetrics.overallScore);
            case 'complexityScore':
              return (chunk.enhancedMetadata as any).complexityScore ?? 0;
            case 'endLine':
              return chunk.endLine;
            default:
              return chunk.startLine;
          }
        };
        return (read(a) - read(b)) * sortOrder;
      });

      const page = Math.max(1, data.pagination?.page ?? 1);
      const limit = Math.max(1, data.pagination?.limit ?? 50);
      const total = filtered.length;
      const chunks = filtered
        .slice((page - 1) * limit, page * limit)
        .map((chunk) => ({
          id: chunk.id,
          filePath: chunk.filePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          semanticType: chunk.enhancedMetadata.semanticType,
          qualityScore: chunk.qualityMetrics.overallScore,
          complexityScore: (chunk.enhancedMetadata as any).complexityScore,
          lastModified: snapshot?.timestamp ?? 0,
        }));

      return {
        success: true,
        snapshotId,
        ...(filePath ? { filePath } : {}),
        chunks,
        pagination: { total, page, limit },
        metadata: {
          queryTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify snapshot exists', 'Check filter parameters'],
      };
    }
  }
  /**
   * Handle get chunk metadata request
   */
  private async handleGetChunkMetadata(data: any): Promise<any> {
    try {
      const {
        chunkId,
        includeRelationships = true,
        includeQuality = true,
      } = data;
      const snapshotId =
        data.snapshotId || this.extractSnapshotIdFromChunkId(chunkId);

      if (!chunkId || !snapshotId) {
        throw new Error('chunkId and snapshotId are required');
      }

      const { chunk } = await this.resolveChunkInSnapshot(
        snapshotId,
        chunkId,
        data.filePath,
      );
      const lines = chunk.content.split('\n');
      const blank = lines.filter((line) => line.trim().length === 0).length;
      const comments = lines.filter((line) =>
        /^\s*(\/\/|\/\*|\*|#)/.test(line),
      ).length;

      return {
        success: true,
        chunkId,
        snapshotId,
        metadata: {
          semanticType: chunk.enhancedMetadata.semanticType,
          complexityScore: (chunk.enhancedMetadata as any).complexityScore,
          maintainabilityIndex: (chunk.enhancedMetadata as any)
            .maintainabilityIndex,
          dependencies: chunk.enhancedMetadata.dependencies ?? [],
          designPatterns: chunk.enhancedMetadata.designPatterns ?? [],
          codeSmells: chunk.enhancedMetadata.codeSmells ?? [],
          securityConcerns:
            (chunk.enhancedMetadata as any).securityConcerns ?? [],
          linesOfCode: {
            total: lines.length,
            code: lines.length - blank - comments,
            comments,
            blank,
          },
        },
        relationships: includeRelationships ? chunk.relationships : undefined,
        qualityMetrics: includeQuality ? chunk.qualityMetrics : undefined,
        responseMetadata: {
          retrievalTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify chunk ID exists'],
      };
    }
  }
  /**
   * Handle get chunk context request
   */
  private async handleGetChunkContext(data: any): Promise<any> {
    try {
      const { chunkId, contextRadius = data.radius ?? 5 } = data;
      const snapshotId =
        data.snapshotId || this.extractSnapshotIdFromChunkId(chunkId);

      if (!chunkId || !snapshotId) {
        throw new Error('chunkId and snapshotId are required');
      }

      const { filePath, chunk } = await this.resolveChunkInSnapshot(
        snapshotId,
        chunkId,
        data.filePath,
      );
      const content =
        (await this.terminalApiService.getSnapshotFileContent(
          snapshotId,
          filePath,
        )) ?? chunk.content;
      const lines = content.split('\n');
      const radius = Math.max(0, Number(contextRadius) || 0);
      const surroundingContext = lines
        .slice(
          Math.max(0, chunk.startLine - radius),
          Math.min(lines.length, chunk.endLine + radius + 1),
        )
        .join('\n');
      const contextInfo = chunk.contextInfo;
      const fileContext = contextInfo?.fileContext ?? {
        totalLines: lines.length,
        fileSize: content.length,
      };

      return {
        success: true,
        chunkId,
        snapshotId,
        filePath,
        context: {
          surroundingContext,
          architecturalLayer: contextInfo?.architecturalLayer,
          frameworkContext: contextInfo?.frameworkContext ?? [],
          fileContext,
        },
        metadata: {
          contextRadius: radius,
          retrievalTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: [
          'Verify chunk ID exists',
          'Check context radius parameter',
        ],
      };
    }
  }
  /**
   * Handle get chunk dependencies request
   */
  private async handleGetChunkDependencies(data: any): Promise<any> {
    try {
      const { chunkId, includeTransitive = false, maxDepth = 3 } = data;
      const snapshotId =
        data.snapshotId || this.extractSnapshotIdFromChunkId(chunkId);

      if (!chunkId || !snapshotId) {
        throw new Error('chunkId and snapshotId are required');
      }

      const { chunk } = await this.resolveChunkInSnapshot(
        snapshotId,
        chunkId,
        data.filePath,
      );
      const relationships = chunk.relationships ?? [];
      const direct = relationships
        .filter((relationship) => relationship.direction !== 'incoming')
        .map((relationship) => ({
          chunkId: relationship.targetChunkId,
          type: relationship.type,
          strength: relationship.strength,
          description: relationship.description,
          direction: relationship.direction,
        }));
      const dependents = relationships
        .filter((relationship) => relationship.direction === 'incoming')
        .map((relationship) => ({
          chunkId: relationship.targetChunkId,
          type: relationship.type,
          strength: relationship.strength,
          description: relationship.description,
          direction: relationship.direction,
        }));

      return {
        success: true,
        chunkId,
        snapshotId,
        dependencies: {
          direct,
          ...(includeTransitive ? { transitive: [] } : {}),
        },
        dependents,
        metadata: {
          includeTransitive,
          maxDepth,
          retrievalTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify chunk ID exists', 'Check dependency parameters'],
      };
    }
  }
  /**
   * Handle batch analyze request with enhanced error handling and progress tracking
   */
  private async handleBatchAnalyze(data: any): Promise<any> {
    const startTime = Date.now();
    const progressCallback = data.progressCallback;

    try {
      const {
        operations,
        parallel = true,
        maxConcurrency = 5,
        continueOnError = true,
        timeout = 300000, // 5 minutes default timeout
        retryFailedOperations = false,
        maxRetries = 2,
      } = data;

      // Rejected before chunking: a stride of 0 or less never advances the loop.
      const maxConcurrencyError = assertValidMaxConcurrency(maxConcurrency);
      if (maxConcurrencyError) {
        throw new Error(maxConcurrencyError);
      }

      // Rejected before the retry helper: `Infinity` runs its loop forever.
      const maxRetriesError = assertValidMaxRetries(maxRetries);
      if (maxRetriesError) {
        throw new Error(maxRetriesError);
      }

      // Rejected before any timer is armed: `setTimeout` turns the invalid
      // delays into an immediate, fabricated timeout.
      const timeoutError = assertValidTimeout(timeout);
      if (timeoutError) {
        throw new Error(timeoutError);
      }

      if (!operations || !Array.isArray(operations)) {
        throw new Error('operations array is required');
      }

      if (operations.length === 0) {
        return {
          success: true,
          totalOperations: 0,
          successfulOperations: 0,
          failedOperations: 0,
          results: [],
          metadata: {
            parallel,
            maxConcurrency,
            processingTime: Date.now() - startTime,
            version: '1.0.0',
          },
        };
      }

      // Validate operations
      const validationErrors = this.validateBatchOperations(operations);
      if (validationErrors.length > 0) {
        throw new Error(`Invalid operations: ${validationErrors.join(', ')}`);
      }

      const results: any[] = [];
      const failedOperations: any[] = [];
      let processedCount = 0;

      // Progress tracking helper
      const updateProgress = (increment = 1) => {
        processedCount += increment;
        if (progressCallback) {
          progressCallback({
            processed: processedCount,
            total: operations.length,
            percentage: Math.round((processedCount / operations.length) * 100),
            timestamp: Date.now(),
          });
        }
      };

      if (parallel) {
        // Enhanced parallel processing with better concurrency control
        const chunks = [];

        for (let i = 0; i < operations.length; i += maxConcurrency) {
          chunks.push(operations.slice(i, i + maxConcurrency));
        }

        for (const chunk of chunks) {
          const chunkPromises = chunk.map(async (op: any, index: number) => {
            const operationId = op.id || `op-${results.length + index}`;

            try {
              // Add timeout wrapper
              const result = await withTimeout(
                this.executeAnalysisOperation(op),
                timeout,
                `Operation timeout after ${timeout}ms`,
              );

              // Check if the operation result indicates failure
              if (
                result &&
                typeof result === 'object' &&
                'success' in result &&
                result.success === false
              ) {
                const errorInfo = {
                  operationId,
                  operationType: op.type,
                  success: false,
                  result,
                  executionTime: Date.now() - startTime,
                  retryCount: 0,
                };

                if (retryFailedOperations) {
                  failedOperations.push({ ...op, errorInfo });
                }

                return errorInfo;
              }

              return {
                operationId,
                operationType: op.type,
                success: true,
                result,
                executionTime: Date.now() - startTime,
                retryCount: 0,
              };
            } catch (error) {
              const errorInfo = {
                operationId,
                operationType: op.type,
                success: false,
                error: {
                  message:
                    error instanceof Error ? error.message : String(error),
                  code: this.getErrorCode(error),
                  category: 'batch_operation_error',
                  severity: 'medium',
                  retryable: this.isRetryableError(error),
                },
                executionTime: Date.now() - startTime,
                retryCount: 0,
              };

              if (retryFailedOperations && errorInfo.error.retryable) {
                failedOperations.push({ ...op, errorInfo });
              }

              return errorInfo;
            }
          });

          const chunkResults = await Promise.allSettled(chunkPromises);

          chunkResults.forEach((result, index) => {
            if (result.status === 'fulfilled') {
              results.push(result.value);
            } else {
              results.push({
                operationId: chunk[index].id || `op-${results.length}`,
                operationType: chunk[index].type,
                success: false,
                error: {
                  message: result.reason.message,
                  code: 'BATCH_OPERATION_FAILED',
                  category: 'batch_operation_error',
                  severity: 'high',
                  retryable: false,
                },
                executionTime: Date.now() - startTime,
                retryCount: 0,
              });
            }
            updateProgress();
          });

          // Stop processing if continueOnError is false and we have failures.
          // The predicate reads the results that were recorded rather than the
          // settlements: `allSettled` reports a rejected promise, but a handler
          // that answers `{ success: false }` fulfils its promise, so a
          // settlement-only check missed every handler-level failure and the
          // flag was inert in this path. The sequential branch treats that
          // answer as the failure it is; so does the search handler's parallel
          // branch, which uses this same predicate.
          if (!continueOnError && results.some((r) => !r.success)) {
            break;
          }
        }
      } else {
        // Enhanced sequential processing
        for (const operation of operations) {
          const operationId = operation.id || `op-${results.length}`;

          try {
            const result = await withTimeout(
              this.executeAnalysisOperation(operation),
              timeout,
              `Operation timeout after ${timeout}ms`,
            );

            // Check if the operation result indicates failure
            if (
              result &&
              typeof result === 'object' &&
              'success' in result &&
              result.success === false
            ) {
              const errorInfo = {
                operationId,
                operationType: operation.type,
                success: false,
                result,
                executionTime: Date.now() - startTime,
                retryCount: 0,
              };

              results.push(errorInfo);

              if (retryFailedOperations) {
                failedOperations.push({ ...operation, errorInfo });
              }

              // Stop processing if continueOnError is false
              if (!continueOnError) {
                break;
              }
            } else {
              results.push({
                operationId,
                operationType: operation.type,
                success: true,
                result,
                executionTime: Date.now() - startTime,
                retryCount: 0,
              });
            }
          } catch (error) {
            const errorInfo = {
              operationId,
              operationType: operation.type,
              success: false,
              error: {
                message: error instanceof Error ? error.message : String(error),
                code: this.getErrorCode(error),
                category: 'batch_operation_error',
                severity: 'medium',
                retryable: this.isRetryableError(error),
              },
              executionTime: Date.now() - startTime,
              retryCount: 0,
            };

            results.push(errorInfo);

            if (retryFailedOperations && errorInfo.error.retryable) {
              failedOperations.push({ ...operation, errorInfo });
            }

            // Stop processing if continueOnError is false
            if (!continueOnError) {
              break;
            }
          }

          updateProgress();
        }
      }

      // Retry failed operations if requested
      if (retryFailedOperations && failedOperations.length > 0) {
        await this.retryFailedOperations(
          failedOperations,
          maxRetries,
          results,
          updateProgress,
        );
      }

      const successfulOperations = results.filter((r) => r.success).length;
      const failedOperationsCount = results.filter((r) => !r.success).length;

      return {
        // A batch in which every item failed is a failure. The counts already
        // disclose a partial failure, so a partial batch stays true -- and an
        // empty batch never reaches here (it returns above).
        success: !(
          results.length > 0 && failedOperationsCount === results.length
        ),
        totalOperations: operations.length,
        successfulOperations,
        failedOperations: failedOperationsCount,
        results,
        performance: {
          totalTime: Math.max(1, Date.now() - startTime), // Ensure at least 1ms
          averageTimePerOperation:
            Math.max(1, Date.now() - startTime) / operations.length,
          throughput:
            operations.length / (Math.max(1, Date.now() - startTime) / 1000),
          memoryUsage: process.memoryUsage(),
        },
        metadata: {
          parallel,
          maxConcurrency,
          continueOnError,
          timeout,
          retryFailedOperations,
          maxRetries,
          processingTime: Date.now() - startTime,
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: 'BATCH_ANALYZE_ERROR',
          category: 'batch_operation_error',
          severity: 'high',
          retryable: false,
        },
        totalOperations: data.operations?.length || 0,
        successfulOperations: 0,
        failedOperations: data.operations?.length || 0,
        results: [],
        performance: {
          totalTime: Date.now() - startTime,
          averageTimePerOperation: 0,
          throughput: 0,
          memoryUsage: process.memoryUsage(),
        },
        suggestions: [
          'Verify operations array format and content',
          'Check operation types are supported',
          'Validate concurrency and timeout settings',
          'Ensure sufficient system resources',
        ],
      };
    }
  }

  /**
   * Handle batch search request with enhanced error handling and progress tracking
   */
  private async handleBatchSearch(data: any): Promise<any> {
    const startTime = Date.now();
    const progressCallback = data.progressCallback;

    try {
      const {
        queries,
        parallel = true,
        maxConcurrency = 3,
        continueOnError = true,
        timeout = 300000, // 5 minutes default timeout
        retryFailedQueries = false,
        maxRetries = 2,
        deduplicateQueries = true,
      } = data;

      // Rejected before chunking: a stride of 0 or less never advances the loop.
      const maxConcurrencyError = assertValidMaxConcurrency(maxConcurrency);
      if (maxConcurrencyError) {
        throw new Error(maxConcurrencyError);
      }

      // Rejected before the retry helper: `Infinity` runs its loop forever.
      const maxRetriesError = assertValidMaxRetries(maxRetries);
      if (maxRetriesError) {
        throw new Error(maxRetriesError);
      }

      // Rejected before any timer is armed: `setTimeout` turns the invalid
      // delays into an immediate, fabricated timeout.
      const timeoutError = assertValidTimeout(timeout);
      if (timeoutError) {
        throw new Error(timeoutError);
      }

      if (!queries || !Array.isArray(queries)) {
        throw new Error('queries array is required');
      }

      if (queries.length === 0) {
        return {
          success: true,
          totalQueries: 0,
          successfulQueries: 0,
          failedQueries: 0,
          results: [],
          metadata: {
            parallel,
            maxConcurrency,
            processingTime: Date.now() - startTime,
            version: '1.0.0',
          },
        };
      }

      // Validate and optionally deduplicate queries
      let processedQueries = queries;
      if (deduplicateQueries) {
        processedQueries = this.deduplicateQueries(queries);
      }

      const validationErrors = this.validateBatchQueries(processedQueries);
      if (validationErrors.length > 0) {
        throw new Error(`Invalid queries: ${validationErrors.join(', ')}`);
      }

      const results: any[] = [];
      const failedQueries: any[] = [];
      let processedCount = 0;

      // Progress tracking helper
      const updateProgress = (increment = 1) => {
        processedCount += increment;
        if (progressCallback) {
          progressCallback({
            processed: processedCount,
            total: processedQueries.length,
            percentage: Math.round(
              (processedCount / processedQueries.length) * 100,
            ),
            timestamp: Date.now(),
          });
        }
      };

      if (parallel) {
        // Enhanced parallel processing with better concurrency control
        const chunks = [];
        for (let i = 0; i < processedQueries.length; i += maxConcurrency) {
          chunks.push(processedQueries.slice(i, i + maxConcurrency));
        }

        for (const chunk of chunks) {
          const chunkPromises = chunk.map(async (query: any, index: number) => {
            const queryId = query.id || `query-${results.length + index}`;

            try {
              // Add timeout wrapper
              const result = await withTimeout(
                this.handleEnhancedSearch(query),
                timeout,
                `Query timeout after ${timeout}ms`,
              );

              // Check if the search result indicates failure
              if (
                result &&
                typeof result === 'object' &&
                'success' in result &&
                result.success === false
              ) {
                const errorInfo = {
                  queryId,
                  query: query.query,
                  success: false,
                  result,
                  executionTime: Date.now() - startTime,
                  retryCount: 0,
                };

                if (retryFailedQueries) {
                  failedQueries.push({ ...query, errorInfo });
                }

                return errorInfo;
              }

              return {
                queryId,
                query: query.query,
                success: true,
                result,
                executionTime: Date.now() - startTime,
                retryCount: 0,
              };
            } catch (error) {
              const errorInfo = {
                queryId,
                query: query.query,
                success: false,
                error: {
                  message:
                    error instanceof Error ? error.message : String(error),
                  code: this.getErrorCode(error),
                  category: 'batch_search_error',
                  severity: 'medium',
                  retryable: this.isRetryableError(error),
                },
                executionTime: Date.now() - startTime,
                retryCount: 0,
              };

              if (retryFailedQueries && errorInfo.error.retryable) {
                failedQueries.push({ ...query, errorInfo });
              }

              return errorInfo;
            }
          });

          const chunkResults = await Promise.allSettled(chunkPromises);

          chunkResults.forEach((result, index) => {
            if (result.status === 'fulfilled') {
              results.push(result.value);
            } else {
              results.push({
                queryId: chunk[index].id || `query-${results.length}`,
                query: chunk[index].query,
                success: false,
                error: {
                  message: result.reason.message,
                  code: 'BATCH_SEARCH_FAILED',
                  category: 'batch_search_error',
                  severity: 'high',
                  retryable: false,
                },
                executionTime: Date.now() - startTime,
                retryCount: 0,
              });
            }
            updateProgress();
          });

          // Stop processing if continueOnError is false and we have failures
          if (!continueOnError && results.some((r) => !r.success)) {
            break;
          }
        }
      } else {
        // Enhanced sequential processing
        for (const query of processedQueries) {
          const queryId = query.id || `query-${results.length}`;

          try {
            const result = await withTimeout(
              this.handleEnhancedSearch(query),
              timeout,
              `Query timeout after ${timeout}ms`,
            );

            // Check if the search result indicates failure
            if (
              result &&
              typeof result === 'object' &&
              'success' in result &&
              result.success === false
            ) {
              const errorInfo = {
                queryId,
                query: query.query,
                success: false,
                result,
                executionTime: Date.now() - startTime,
                retryCount: 0,
              };

              results.push(errorInfo);

              if (retryFailedQueries) {
                failedQueries.push({ ...query, errorInfo });
              }

              // Stop processing if continueOnError is false
              if (!continueOnError) {
                break;
              }
            } else {
              results.push({
                queryId,
                query: query.query,
                success: true,
                result,
                executionTime: Date.now() - startTime,
                retryCount: 0,
              });
            }
          } catch (error) {
            const errorInfo = {
              queryId,
              query: query.query,
              success: false,
              error: {
                message: error instanceof Error ? error.message : String(error),
                code: this.getErrorCode(error),
                category: 'batch_search_error',
                severity: 'medium',
                retryable: this.isRetryableError(error),
              },
              executionTime: Date.now() - startTime,
              retryCount: 0,
            };

            results.push(errorInfo);

            if (retryFailedQueries && errorInfo.error.retryable) {
              failedQueries.push({ ...query, errorInfo });
            }

            // Stop processing if continueOnError is false
            if (!continueOnError) {
              break;
            }
          }

          updateProgress();
        }
      }

      // Retry failed queries if requested
      if (retryFailedQueries && failedQueries.length > 0) {
        await this.retryFailedQueries(
          failedQueries,
          maxRetries,
          results,
          updateProgress,
        );
      }

      const successfulQueries = results.filter((r) => r.success).length;
      const failedQueriesCount = results.filter((r) => !r.success).length;

      return {
        // Same contract as handleBatchAnalyze. The verdict comes from the
        // results that were actually recorded, not from the requested count:
        // with continueOnError false the loop stops early, and "1 of 1 failed"
        // must not read as success just because 3 were requested.
        success: !(results.length > 0 && failedQueriesCount === results.length),
        totalQueries: processedQueries.length,
        originalQueryCount: queries.length,
        deduplicatedCount: queries.length - processedQueries.length,
        successfulQueries,
        failedQueries: failedQueriesCount,
        results,
        performance: {
          totalTime: Math.max(1, Date.now() - startTime), // Ensure at least 1ms
          averageTimePerQuery:
            Math.max(1, Date.now() - startTime) / processedQueries.length,
          throughput:
            processedQueries.length /
            (Math.max(1, Date.now() - startTime) / 1000),
          memoryUsage: process.memoryUsage(),
        },
        metadata: {
          parallel,
          maxConcurrency,
          continueOnError,
          timeout,
          retryFailedQueries,
          maxRetries,
          deduplicateQueries,
          processingTime: Date.now() - startTime,
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: 'BATCH_SEARCH_ERROR',
          category: 'batch_search_error',
          severity: 'high',
          retryable: false,
        },
        totalQueries: data.queries?.length || 0,
        successfulQueries: 0,
        failedQueries: data.queries?.length || 0,
        results: [],
        performance: {
          totalTime: Date.now() - startTime,
          averageTimePerQuery: 0,
          throughput: 0,
          memoryUsage: process.memoryUsage(),
        },
        suggestions: [
          'Verify queries array format and content',
          'Check query parameters are valid',
          'Validate concurrency and timeout settings',
          'Ensure sufficient system resources',
        ],
      };
    }
  }

  // Helper methods for batch operations

  /**
   * Execute a single analysis operation
   */
  private async executeAnalysisOperation(operation: any): Promise<any> {
    switch (operation.type) {
      case 'analyzeChunk':
        return await this.handleAnalyzeChunk(operation.data);
      case 'analyzeFile':
        return await this.handleAnalyzeFile(operation.data);
      case 'analyzeQuality':
        return await this.handleAnalyzeQuality(operation.data);
      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }

  /**
   * Validate batch operations
   */
  private validateBatchOperations(operations: any[]): string[] {
    const errors: string[] = [];
    const validOperationTypes = [
      'analyzeChunk',
      'analyzeFile',
      'analyzeQuality',
    ];

    operations.forEach((op, index) => {
      if (!op.type) {
        errors.push(`Operation ${index}: missing type`);
      } else if (!validOperationTypes.includes(op.type)) {
        errors.push(`Operation ${index}: invalid type '${op.type}'`);
      }

      if (!op.data) {
        errors.push(`Operation ${index}: missing data`);
      } else {
        // Validate specific operation data requirements
        switch (op.type) {
          case 'analyzeChunk':
            if (!op.data.chunkId || !op.data.snapshotId) {
              errors.push(
                `Operation ${index}: analyzeChunk requires chunkId and snapshotId`,
              );
            }
            break;
          case 'analyzeFile':
            if (!op.data.filePath || !op.data.snapshotId) {
              errors.push(
                `Operation ${index}: analyzeFile requires filePath and snapshotId`,
              );
            }
            break;
          case 'analyzeQuality':
            if (!op.data.target || !op.data.snapshotId) {
              errors.push(
                `Operation ${index}: analyzeQuality requires target and snapshotId`,
              );
            }
            break;
        }
      }
    });

    return errors;
  }

  /**
   * Validate batch queries
   */
  private validateBatchQueries(queries: any[]): string[] {
    const errors: string[] = [];

    queries.forEach((query, index) => {
      if (!query.query || typeof query.query !== 'string') {
        errors.push(`Query ${index}: missing or invalid query string`);
      }

      if (
        query.query &&
        typeof query.query === 'string' &&
        query.query.trim().length === 0
      ) {
        errors.push(`Query ${index}: empty query string`);
      }

      if (
        query.limit &&
        (typeof query.limit !== 'number' || query.limit <= 0)
      ) {
        errors.push(`Query ${index}: invalid limit value`);
      }

      if (
        query.scoreThreshold &&
        (typeof query.scoreThreshold !== 'number' ||
          query.scoreThreshold < 0 ||
          query.scoreThreshold > 1)
      ) {
        errors.push(
          `Query ${index}: invalid scoreThreshold value (must be between 0 and 1)`,
        );
      }
    });

    return errors;
  }

  /**
   * Deduplicate queries based on query string and key parameters
   */
  private deduplicateQueries(queries: any[]): any[] {
    const seen = new Set<string>();
    const deduplicated: any[] = [];

    queries.forEach((query) => {
      // Create a key based on query string and important parameters
      const key = JSON.stringify({
        query: query.query,
        snapshotIds: query.snapshotIds,
        languages: query.languages,
        searchMode: query.searchMode,
      });

      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(query);
      }
    });

    return deduplicated;
  }

  /**
   * Retry failed operations with exponential backoff
   */
  private async retryFailedOperations(
    failedOperations: any[],
    maxRetries: number,
    results: any[],
    updateProgress: (increment?: number) => void,
  ): Promise<void> {
    for (const failedOp of failedOperations) {
      let retryCount = 0;
      let success = false;

      while (retryCount < maxRetries && !success) {
        try {
          // Exponential backoff: wait 2^retryCount seconds
          const delay = Math.pow(2, retryCount) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));

          const result = await this.executeAnalysisOperation(failedOp);

          // Update the original failed result
          const originalIndex = results.findIndex(
            (r) => r.operationId === failedOp.errorInfo.operationId,
          );
          if (originalIndex !== -1) {
            results[originalIndex] = {
              ...failedOp.errorInfo,
              success: true,
              result,
              retryCount: retryCount + 1,
              error: undefined,
            };
          }

          success = true;
          updateProgress(0); // Don't increment total, just trigger progress update
        } catch (error) {
          retryCount++;

          if (retryCount >= maxRetries) {
            // Update with final retry failure
            const originalIndex = results.findIndex(
              (r) => r.operationId === failedOp.errorInfo.operationId,
            );
            if (originalIndex !== -1) {
              results[originalIndex].retryCount = retryCount;
              results[
                originalIndex
              ].error.message += ` (failed after ${retryCount} retries)`;
            }
          }
        }
      }
    }
  }

  /**
   * Retry failed queries with exponential backoff
   */
  private async retryFailedQueries(
    failedQueries: any[],
    maxRetries: number,
    results: any[],
    updateProgress: (increment?: number) => void,
  ): Promise<void> {
    for (const failedQuery of failedQueries) {
      let retryCount = 0;
      let success = false;

      while (retryCount < maxRetries && !success) {
        try {
          // Exponential backoff: wait 2^retryCount seconds
          const delay = Math.pow(2, retryCount) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));

          const result = await this.handleEnhancedSearch(failedQuery);

          // Update the original failed result
          const originalIndex = results.findIndex(
            (r) => r.queryId === failedQuery.errorInfo.queryId,
          );
          if (originalIndex !== -1) {
            results[originalIndex] = {
              ...failedQuery.errorInfo,
              success: true,
              result,
              retryCount: retryCount + 1,
              error: undefined,
            };
          }

          success = true;
          updateProgress(0); // Don't increment total, just trigger progress update
        } catch (error) {
          retryCount++;

          if (retryCount >= maxRetries) {
            // Update with final retry failure
            const originalIndex = results.findIndex(
              (r) => r.queryId === failedQuery.errorInfo.queryId,
            );
            if (originalIndex !== -1) {
              results[originalIndex].retryCount = retryCount;
              results[
                originalIndex
              ].error.message += ` (failed after ${retryCount} retries)`;
            }
          }
        }
      }
    }
  }

  /**
   * Get error code for different types of errors
   */
  private getErrorCode(error: any): string {
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        return 'OPERATION_TIMEOUT';
      } else if (error.message.includes('not found')) {
        return 'RESOURCE_NOT_FOUND';
      } else if (error.message.includes('permission')) {
        return 'PERMISSION_DENIED';
      } else if (error.message.includes('network')) {
        return 'NETWORK_ERROR';
      } else if (error.message.includes('memory')) {
        return 'MEMORY_ERROR';
      }
    }
    return 'UNKNOWN_ERROR';
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Retryable errors
      if (
        message.includes('timeout') ||
        message.includes('network') ||
        message.includes('temporary') ||
        message.includes('rate limit') ||
        message.includes('service unavailable')
      ) {
        return true;
      }
      // Non-retryable errors
      if (
        message.includes('not found') ||
        message.includes('permission') ||
        message.includes('invalid') ||
        message.includes('malformed')
      ) {
        return false;
      }
    }
    // Default to retryable for unknown errors
    return true;
  }

  // Helper methods for analysis

  private calculateComplexityDistribution(chunks: EnhancedCodeChunk[]): any {
    const distribution = { low: 0, medium: 0, high: 0 };
    chunks.forEach((chunk) => {
      const complexity = chunk.enhancedMetadata.complexityScore;
      if (complexity < 10) distribution.low++;
      else if (complexity < 20) distribution.medium++;
      else distribution.high++;
    });
    return distribution;
  }

  private aggregateSecurityConcerns(chunks: EnhancedCodeChunk[]): string[] {
    const concerns = new Set<string>();
    chunks.forEach((chunk) => {
      chunk.enhancedMetadata.securityConcerns.forEach((concern) =>
        concerns.add(concern),
      );
    });
    return Array.from(concerns);
  }

  private aggregateDesignPatterns(chunks: EnhancedCodeChunk[]): string[] {
    const patterns = new Set<string>();
    chunks.forEach((chunk) => {
      chunk.enhancedMetadata.designPatterns.forEach((pattern) =>
        patterns.add(pattern),
      );
    });
    return Array.from(patterns);
  }

  private generateFileLevelSuggestions(chunks: EnhancedCodeChunk[]): any[] {
    const suggestions = [];

    const avgQuality =
      chunks.reduce(
        (sum, chunk) => sum + chunk.qualityMetrics.overallScore,
        0,
      ) / chunks.length;
    if (avgQuality < 70) {
      suggestions.push({
        type: 'quality',
        description: 'File has below-average quality metrics',
        priority: 'medium',
        action: 'Review and refactor low-quality chunks',
      });
    }

    const highComplexityChunks = chunks.filter(
      (chunk) => chunk.enhancedMetadata.complexityScore > 20,
    );
    if (highComplexityChunks.length > 0) {
      suggestions.push({
        type: 'complexity',
        description: `${highComplexityChunks.length} chunks have high complexity`,
        priority: 'high',
        action: 'Consider breaking down complex functions',
      });
    }

    return suggestions;
  }

  private getSemanticTypeDistribution(chunks: EnhancedCodeChunk[]): any {
    const distribution: any = {};
    chunks.forEach((chunk) => {
      const type = chunk.enhancedMetadata.semanticType;
      distribution[type] = (distribution[type] || 0) + 1;
    });
    return distribution;
  }

  private getQualityDistribution(chunks: EnhancedCodeChunk[]): any {
    const distribution = { excellent: 0, good: 0, fair: 0, poor: 0 };
    chunks.forEach((chunk) => {
      const quality = chunk.qualityMetrics.overallScore;
      if (quality >= 90) distribution.excellent++;
      else if (quality >= 75) distribution.good++;
      else if (quality >= 60) distribution.fair++;
      else distribution.poor++;
    });
    return distribution;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    log('Disposing CLI connector service...');

    this.logUnsubscribe?.();
    this.logUnsubscribe = undefined;
    this.chunkerConfigSubscription?.dispose();
    this.chunkerConfigSubscription = undefined;
    this.logStreaming = false;

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
