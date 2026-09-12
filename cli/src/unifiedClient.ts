/**
 * Unified client that supports both standalone and IPC modes
 * Tries standalone first, falls back to IPC if needed
 */

import { CodeLapseClient } from './client';
import {
  getStandaloneHandler,
  isStandaloneModeAvailable,
  StandaloneHandler,
} from './standaloneHandler';
import chalk from 'chalk';
import {
  assertBufferSizeWithinLimit,
  ensureWithinDirectory,
  MAX_JSON_PAYLOAD_BYTES,
} from 'codelapse-core';
import { assertAllowedApiMethod } from './apiAllowlist';

export type ClientMode = 'standalone' | 'ipc' | 'auto';

/**
 * The methods the standalone switch below can serve.
 *
 * Declared rather than inferred from the switch so the dispatcher can decide
 * *before* dispatching: a method that is absent can still be answered by a
 * running extension, and that is the only way `filter`, `rules` and
 * `diagnostics` work at all. The capability guard test fails if this set and
 * the switch ever disagree.
 */
export const STANDALONE_METHODS: ReadonlySet<string> = new Set([
  'takeSnapshot',
  'getSnapshots',
  'getSnapshot',
  'restoreSnapshot',
  'deleteSnapshot',
  'compareSnapshots',
  'updateSnapshotMetadata',
  'filterSnapshots',
  'editSnapshotTags',
  'editSnapshotNotes',
  'editTaskReference',
  'toggleFavoriteStatus',
  'getAutoSnapshotRules',
  'addAutoSnapshotRule',
  'updateAutoSnapshotRule',
  'removeAutoSnapshotRule',
  'toggleAutoSnapshotRule',
  'testAutoSnapshotRule',
  'runDiagnostics',
  'healthCheck',
  'getSystemInfo',
  'getPerformanceMetrics',
  'getLogs',
  'clearLogs',
  'streamLogs',
  'getSnapshotFileContent',
  'getConfig',
  'setConfig',
  'resetConfig',
  'getConfigSchema',
  'validateConfig',
  'exportConfig',
  'importConfig',
  'getWorkspaceInfo',
  'getStatus',
  'getSnapshotChanges',
  'navigateSnapshot',
  'getFileHistory',
  'listSnapshotFiles',
  'getSnapshotFile',
  'compareSnapshotFile',
  'restoreSnapshotFile',
  'exportSnapshotFile',
  'createGitCommitFromSnapshot',
  'getGitBranchInfo',
  'createBranch',
  'switchBranch',
  'deleteBranch',
  'listBranches',
]);

export class UnifiedClient {
  private mode: ClientMode;
  private standaloneHandler: StandaloneHandler | null = null;
  private ipcClient: CodeLapseClient;
  private activeMode: 'standalone' | 'ipc' | null = null;
  private verbose = false;

  constructor(mode: ClientMode = 'auto', verbose = false, timeout?: number) {
    this.mode = mode;
    this.verbose = verbose;
    // `CodeLapseClient` accepts `{ timeout }` but defaults to 5000. It never
    // received one before, so the documented `--timeout` flag was inert.
    this.ipcClient = new CodeLapseClient(
      timeout === undefined ? undefined : { timeout },
    );
  }

  private isRecord(value: any): value is Record<string, any> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private async getConfigSchemaInfo(): Promise<{
    schema: Record<string, any>;
    availableKeys: string[];
  }> {
    if (this.activeMode === 'standalone' && this.standaloneHandler) {
      const schema = this.standaloneHandler.getConfigSchema();
      const availableKeys = this.standaloneHandler.getAvailableConfigKeyPaths();
      return { schema, availableKeys };
    }

    if (this.activeMode === 'ipc') {
      const result = await this.ipcClient.callApi('getConfigSchema', {});
      const schema = this.isRecord(result?.schema) ? result.schema : {};
      const availableKeys = Array.isArray(result?.availableKeys)
        ? result.availableKeys.filter(
            (key: unknown): key is string => typeof key === 'string',
          )
        : Object.keys(schema);
      return { schema, availableKeys };
    }

    throw new Error('Client not initialized');
  }

  private async assertValidConfigKeyPath(keyPath: string): Promise<void> {
    if (!keyPath || typeof keyPath !== 'string') {
      throw new Error('Configuration key path must be a non-empty string');
    }

    if (this.activeMode === 'standalone' && this.standaloneHandler) {
      if (!this.standaloneHandler.isValidConfigKeyPath(keyPath)) {
        throw new Error(
          `Invalid configuration key path "${keyPath}". Use "codelapse config list" to view valid keys.`,
        );
      }
      return;
    }

    const { availableKeys } = await this.getConfigSchemaInfo();
    if (!availableKeys.includes(keyPath)) {
      throw new Error(
        `Invalid configuration key path "${keyPath}". Use "codelapse config list" to view valid keys.`,
      );
    }
  }

  private flattenConfigEntries(
    value: Record<string, any>,
    prefix = '',
  ): Array<{ keyPath: string; value: any }> {
    const entries: Array<{ keyPath: string; value: any }> = [];
    for (const [key, child] of Object.entries(value)) {
      const keyPath = prefix ? `${prefix}.${key}` : key;
      if (this.isRecord(child)) {
        entries.push(...this.flattenConfigEntries(child, keyPath));
      } else {
        entries.push({ keyPath, value: child });
      }
    }
    return entries;
  }

  /**
   * Initialize the client
   */
  public async initialize(): Promise<void> {
    if (this.mode === 'standalone') {
      await this.initializeStandalone();
    } else if (this.mode === 'ipc') {
      await this.initializeIPC();
    } else {
      // Auto mode: try standalone first, then IPC
      try {
        await this.initializeStandalone();
        this.activeMode = 'standalone';
        if (this.verbose) {
          console.log(chalk.gray('Using standalone mode'));
        }
      } catch (error) {
        if (this.verbose) {
          console.log(
            chalk.gray('Standalone mode not available, trying IPC...'),
          );
        }
        await this.initializeIPC();
        this.activeMode = 'ipc';
        if (this.verbose) {
          console.log(chalk.gray('Using IPC mode'));
        }
      }
    }
  }

  private async initializeStandalone(): Promise<void> {
    if (!isStandaloneModeAvailable()) {
      throw new Error('Standalone mode not available');
    }

    this.standaloneHandler = await getStandaloneHandler();
    this.activeMode = 'standalone';
  }

  private async initializeIPC(): Promise<void> {
    // Test connection
    try {
      await this.ipcClient.getStatus();
      this.activeMode = 'ipc';
    } catch (error) {
      throw new Error('IPC mode not available - extension not running');
    }
  }

  /**
   * Get active mode
   */
  public getActiveMode(): 'standalone' | 'ipc' | null {
    return this.activeMode;
  }

  /**
   * Check if using standalone mode
   */
  public isStandalone(): boolean {
    return this.activeMode === 'standalone';
  }

  /**
   * Check if using IPC mode
   */
  public isIPC(): boolean {
    return this.activeMode === 'ipc';
  }

  /**
   * Get status
   */
  public async getStatus(): Promise<any> {
    if (this.activeMode === 'standalone' && this.standaloneHandler) {
      const stats = await this.standaloneHandler.getStorageStats();
      return {
        connected: true,
        mode: 'standalone',
        workspace: this.standaloneHandler.getWorkspaceRoot(),
        totalSnapshots: stats.snapshotCount,
        // Was hardcoded to null, so `status` reported "Current snapshot: None"
        // immediately after `snapshot navigate` positioned the store.
        currentSnapshot:
          this.standaloneHandler.getCurrentSnapshot()?.id ?? null,
      };
    } else if (this.activeMode === 'ipc') {
      const status = await this.ipcClient.getStatus();
      return {
        ...status,
        mode: 'ipc',
      };
    }

    throw new Error('Client not initialized');
  }

  /**
   * Take snapshot
   */
  public async takeSnapshot(options: Record<string, any>): Promise<any> {
    if (this.activeMode === 'standalone' && this.standaloneHandler) {
      const snapshot = await this.standaloneHandler.takeSnapshot(options);
      return { snapshot };
    } else if (this.activeMode === 'ipc') {
      return await this.ipcClient.callApi('takeSnapshot', options);
    }

    throw new Error('Client not initialized');
  }

  /**
   * Get snapshots
   */
  public async getSnapshots(filter?: Record<string, any>): Promise<any> {
    if (this.activeMode === 'standalone' && this.standaloneHandler) {
      return await this.standaloneHandler.getSnapshots(filter);
    } else if (this.activeMode === 'ipc') {
      return await this.ipcClient.callApi('getSnapshots', { filter });
    }

    throw new Error('Client not initialized');
  }

  /**
   * Get snapshot
   */
  public async getSnapshot(snapshotId: string): Promise<any> {
    if (this.activeMode === 'standalone' && this.standaloneHandler) {
      return await this.standaloneHandler.getSnapshot(snapshotId);
    } else if (this.activeMode === 'ipc') {
      return await this.ipcClient.callApi('getSnapshot', { id: snapshotId });
    }

    throw new Error('Client not initialized');
  }

  /**
   * Restore snapshot
   */
  public async restoreSnapshot(
    snapshotId: string,
    options?: Record<string, any>,
  ): Promise<void> {
    if (this.activeMode === 'standalone' && this.standaloneHandler) {
      // Map createBackupSnapshot to backup for standalone handler
      const standaloneOptions = options
        ? {
            backup: options.backup ?? options.createBackupSnapshot,
            selectedFiles: options.selectedFiles,
          }
        : undefined;
      await this.standaloneHandler.restoreSnapshot(
        snapshotId,
        standaloneOptions,
      );
    } else if (this.activeMode === 'ipc') {
      await this.ipcClient.callApi('restoreSnapshot', {
        id: snapshotId,
        ...options,
      });
    } else {
      throw new Error('Client not initialized');
    }
  }

  /**
   * Delete snapshot
   */
  public async deleteSnapshot(snapshotId: string): Promise<void> {
    if (this.activeMode === 'standalone' && this.standaloneHandler) {
      await this.standaloneHandler.deleteSnapshot(snapshotId);
    } else if (this.activeMode === 'ipc') {
      await this.ipcClient.callApi('deleteSnapshot', { id: snapshotId });
    } else {
      throw new Error('Client not initialized');
    }
  }

  /**
   * Compare snapshots
   */
  public async compareSnapshots(id1: string, id2: string): Promise<any> {
    if (this.activeMode === 'standalone' && this.standaloneHandler) {
      return await this.standaloneHandler.compareSnapshots(id1, id2);
    } else if (this.activeMode === 'ipc') {
      return await this.ipcClient.callApi('compareSnapshots', { id1, id2 });
    }

    throw new Error('Client not initialized');
  }

  /**
   * Update snapshot metadata
   */
  public async updateSnapshotMetadata(
    snapshotId: string,
    updates: Record<string, any>,
  ): Promise<void> {
    if (this.activeMode === 'standalone' && this.standaloneHandler) {
      await this.standaloneHandler.updateSnapshotMetadata(snapshotId, updates);
    } else if (this.activeMode === 'ipc') {
      await this.ipcClient.callApi('updateSnapshotMetadata', {
        id: snapshotId,
        updates,
      });
    } else {
      throw new Error('Client not initialized');
    }
  }

  /**
   * Get file content from snapshot
   */
  public async getSnapshotFileContent(
    snapshotId: string,
    filePath: string,
  ): Promise<string | null> {
    if (this.activeMode === 'standalone' && this.standaloneHandler) {
      return await this.standaloneHandler.getSnapshotFileContent(
        snapshotId,
        filePath,
      );
    } else if (this.activeMode === 'ipc') {
      return await this.ipcClient.callApi('getSnapshotFileContent', {
        snapshotId,
        filePath,
      });
    }

    throw new Error('Client not initialized');
  }

  /**
   * Get configuration
   */
  public async getConfig(key?: string): Promise<any> {
    if (this.activeMode === 'standalone' && this.standaloneHandler) {
      return this.standaloneHandler.getConfig(key);
    } else if (this.activeMode === 'ipc') {
      return await this.ipcClient.callApi('getConfig', { key });
    }

    throw new Error('Client not initialized');
  }

  /**
   * Set configuration
   */
  public async setConfig(key: string, value: any): Promise<void> {
    await this.assertValidConfigKeyPath(key);
    if (this.activeMode === 'standalone' && this.standaloneHandler) {
      await this.standaloneHandler.setConfig(key, value);
    } else if (this.activeMode === 'ipc') {
      await this.ipcClient.callApi('setConfig', { key, value });
    } else {
      throw new Error('Client not initialized');
    }
  }

  /**
   * Get workspace info
   */
  public async getWorkspaceInfo(): Promise<any> {
    if (this.activeMode === 'standalone' && this.standaloneHandler) {
      return {
        root: this.standaloneHandler.getWorkspaceRoot(),
        config: this.standaloneHandler.getFullConfig(),
      };
    } else if (this.activeMode === 'ipc') {
      return await this.ipcClient.callApi('getWorkspaceInfo', {});
    }

    throw new Error('Client not initialized');
  }

  /**
   * Methods only available in IPC mode
   */

  public async searchSnapshots(
    query: string,
    options?: Record<string, any>,
  ): Promise<any> {
    if (this.activeMode === 'ipc') {
      return await this.ipcClient.callApi('searchSnapshots', {
        query,
        ...options,
      });
    }

    throw new Error(
      'Search is only available in IPC mode (requires extension)',
    );
  }

  public async enhancedSearch(data: Record<string, any>): Promise<any> {
    if (this.activeMode === 'ipc') {
      return await this.ipcClient.callApi('enhancedSearch', data);
    }

    throw new Error(
      'Enhanced search is only available in IPC mode (requires extension)',
    );
  }

  public async analyzeChunk(data: Record<string, any>): Promise<any> {
    if (this.activeMode === 'ipc') {
      return await this.ipcClient.callApi('analyzeChunk', data);
    }

    throw new Error(
      'Chunk analysis is only available in IPC mode (requires extension)',
    );
  }

  public async analyzeFile(data: Record<string, any>): Promise<any> {
    if (this.activeMode === 'ipc') {
      return await this.ipcClient.callApi('analyzeFile', data);
    }

    throw new Error(
      'File analysis is only available in IPC mode (requires extension)',
    );
  }

  // Add other IPC-only methods as needed...

  /**
   * Get underlying client for advanced operations
   */
  public getIPCClient(): CodeLapseClient {
    return this.ipcClient;
  }

  public getStandaloneHandler(): StandaloneHandler | null {
    return this.standaloneHandler;
  }

  /**
   * Compatibility methods for command handlers that expect CodeLapseClient
   */

  /**
   * Ask a running extension to serve a method standalone cannot.
   *
   * The error is kept rather than discarded: "no extension answered" and "the
   * extension refused" are different problems with different fixes, and the
   * caller's message says which one happened.
   */
  private async tryIpcCall(
    method: string,
    payload: Record<string, any>,
  ): Promise<{ ok: true; value: any } | { ok: false; error: string }> {
    try {
      const value = await this.ipcClient.callApi(method, payload);
      if (this.verbose) {
        console.log(
          chalk.gray(`Standalone cannot serve ${method}; answered over IPC`),
        );
      }
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async callApi(
    method: string,
    data: Record<string, any>,
  ): Promise<any> {
    assertAllowedApiMethod(method);
    const payload = data ?? {};

    if (method === 'setConfig' && this.isRecord(payload)) {
      await this.assertValidConfigKeyPath(String(payload.key || ''));
    }
    if (
      method === 'resetConfig' &&
      this.isRecord(payload) &&
      typeof payload.key === 'string'
    ) {
      await this.assertValidConfigKeyPath(payload.key);
    }

    // Delegate to specific methods if standalone
    if (this.activeMode === 'standalone') {
      if (!STANDALONE_METHODS.has(method)) {
        // Standalone is the default mode in any project directory, so without
        // this a running extension was never consulted for the methods only it
        // implements -- the user saw "not supported in standalone mode" with
        // VS Code open in front of them.
        const fallback = await this.tryIpcCall(method, payload);
        if (fallback.ok) {
          return fallback.value;
        }
        throw new Error(
          `Method ${method} is not available in standalone mode and no CodeLapse extension answered over IPC (${fallback.error}). Start VS Code with the CodeLapse extension enabled, or use one of: ${[
            ...STANDALONE_METHODS,
          ]
            .sort()
            .join(', ')}`,
        );
      }

      switch (method) {
        case 'takeSnapshot':
          return await this.takeSnapshot(payload);

        case 'getSnapshots': {
          // Handle both filter directly or wrapped in data.filter
          const filter =
            payload.filter !== undefined ? payload.filter : payload;
          return await this.getSnapshots(filter);
        }

        case 'getSnapshot':
          return await this.getSnapshot(payload.id || payload);

        case 'restoreSnapshot': {
          // Handle { id, options: {...} } or { id, ...options }
          const restoreId = payload.id;
          const restoreOpts = payload.options || payload;
          return await this.restoreSnapshot(restoreId, restoreOpts);
        }

        case 'deleteSnapshot':
          return await this.deleteSnapshot(payload.id || payload);

        case 'compareSnapshots': {
          // Handle { snapshotId1, snapshotId2 } or { id1, id2 }
          const id1 = payload.snapshotId1 || payload.id1;
          const id2 = payload.snapshotId2 || payload.id2;
          return await this.compareSnapshots(id1, id2);
        }

        case 'updateSnapshotMetadata':
          await this.updateSnapshotMetadata(
            payload.id || payload.snapshotId,
            payload.updates || payload.metadata || payload,
          );
          return { success: true };

        case 'filterSnapshots':
          if (this.standaloneHandler) {
            return await this.standaloneHandler.filterSnapshots(payload as any);
          }
          throw new Error('Handler not initialized');

        case 'editSnapshotTags': {
          if (!this.standaloneHandler) {
            throw new Error('Handler not initialized');
          }
          const id = String(payload.id ?? payload.snapshotId);
          const tags = Array.isArray(payload.tags) ? payload.tags : [];
          return await this.standaloneHandler.editSnapshotTags(id, tags);
        }

        case 'editSnapshotNotes': {
          if (!this.standaloneHandler) {
            throw new Error('Handler not initialized');
          }
          const id = String(payload.id ?? payload.snapshotId);
          return await this.standaloneHandler.editSnapshotNotes(
            id,
            typeof payload.notes === 'string' ? payload.notes : '',
          );
        }

        case 'editTaskReference': {
          if (!this.standaloneHandler) {
            throw new Error('Handler not initialized');
          }
          const id = String(payload.id ?? payload.snapshotId);
          return await this.standaloneHandler.editTaskReference(
            id,
            typeof payload.taskReference === 'string'
              ? payload.taskReference
              : '',
          );
        }

        case 'getAutoSnapshotRules': {
          if (!this.standaloneHandler) {
            throw new Error('Handler not initialized');
          }
          return { rules: await this.standaloneHandler.getAutoSnapshotRules() };
        }

        case 'addAutoSnapshotRule': {
          if (!this.standaloneHandler) {
            throw new Error('Handler not initialized');
          }
          const rule = (payload.rule ?? payload) as any;
          return {
            rule: await this.standaloneHandler.addAutoSnapshotRule(rule),
          };
        }

        case 'updateAutoSnapshotRule': {
          if (!this.standaloneHandler) {
            throw new Error('Handler not initialized');
          }
          const rulePattern = String(
            payload.ruleId ?? payload.id ?? payload.pattern,
          );
          return {
            rule: await this.standaloneHandler.updateAutoSnapshotRule(
              rulePattern,
              (payload.updates ?? payload) as any,
            ),
          };
        }

        case 'removeAutoSnapshotRule': {
          if (!this.standaloneHandler) {
            throw new Error('Handler not initialized');
          }
          await this.standaloneHandler.removeAutoSnapshotRule(
            String(payload.ruleId ?? payload.id ?? payload.pattern),
          );
          return { success: true };
        }

        case 'toggleAutoSnapshotRule': {
          if (!this.standaloneHandler) {
            throw new Error('Handler not initialized');
          }
          const requestedEnabled =
            typeof payload.enabled === 'boolean' ? payload.enabled : undefined;
          return {
            rule: await this.standaloneHandler.toggleAutoSnapshotRule(
              String(payload.ruleId ?? payload.id ?? payload.pattern),
              requestedEnabled,
            ),
          };
        }

        case 'testAutoSnapshotRule':
          if (this.standaloneHandler) {
            return await this.standaloneHandler.testAutoSnapshotRule(
              payload as any,
            );
          }
          throw new Error('Handler not initialized');

        case 'runDiagnostics':
          if (this.standaloneHandler) {
            return await this.standaloneHandler.runDiagnostics();
          }
          throw new Error('Handler not initialized');

        case 'healthCheck':
          if (this.standaloneHandler) {
            return await this.standaloneHandler.healthCheck();
          }
          throw new Error('Handler not initialized');

        case 'getSystemInfo':
          if (this.standaloneHandler) {
            return { systemInfo: await this.standaloneHandler.getSystemInfo() };
          }
          throw new Error('Handler not initialized');

        case 'getPerformanceMetrics':
          if (this.standaloneHandler) {
            return await this.standaloneHandler.getPerformanceMetrics();
          }
          throw new Error('Handler not initialized');

        case 'getLogs':
          if (this.standaloneHandler) {
            return await this.standaloneHandler.getLogs(payload as any);
          }
          throw new Error('Handler not initialized');

        case 'clearLogs':
          if (this.standaloneHandler) {
            return await this.standaloneHandler.clearLogs(payload as any);
          }
          throw new Error('Handler not initialized');

        case 'streamLogs':
          if (this.standaloneHandler) {
            await this.standaloneHandler.streamLogs();
            return { streaming: true };
          }
          throw new Error('Handler not initialized');

        case 'getSnapshotFileContent':
          return await this.getSnapshotFileContent(
            payload.snapshotId,
            payload.filePath,
          );

        case 'getConfig': {
          // Handle both { key: "some.path" } and { key: undefined } for full config
          const configValue = await this.getConfig(payload.key);
          return { config: configValue };
        }

        case 'setConfig':
          await this.setConfig(payload.key, payload.value);
          return { value: payload.value };

        case 'resetConfig':
          if (this.standaloneHandler) {
            if (payload.key) {
              await this.assertValidConfigKeyPath(payload.key);
              // Reset specific key to default
              await this.standaloneHandler.resetConfig(payload.key);
              const resetValue = this.standaloneHandler.getConfig(payload.key);
              return { resetValues: resetValue };
            } else {
              // Reset all config to defaults
              await this.standaloneHandler.resetConfig();
              return { resetValues: this.standaloneHandler.getFullConfig() };
            }
          }
          throw new Error('Handler not initialized');

        case 'getConfigSchema':
          if (this.standaloneHandler) {
            const schema = this.standaloneHandler.getConfigSchema();
            const availableKeys =
              this.standaloneHandler.getAvailableConfigKeyPaths();
            return { schema, availableKeys };
          }
          throw new Error('Handler not initialized');

        case 'validateConfig':
          if (this.standaloneHandler) {
            const validation = this.standaloneHandler.validateConfig();
            return {
              isValid: validation.valid,
              errors: validation.errors || [],
              warnings: [],
            };
          }
          throw new Error('Handler not initialized');

        case 'exportConfig':
          if (this.standaloneHandler) {
            const configJson = this.standaloneHandler.exportConfig();
            assertBufferSizeWithinLimit(
              configJson,
              'exportConfig payload',
              MAX_JSON_PAYLOAD_BYTES,
            );
            const fs = await import('fs');
            const wsRoot = this.standaloneHandler.getWorkspaceRoot();
            if (!wsRoot) throw new Error('No workspace root available');
            const filePath = ensureWithinDirectory(wsRoot, payload.filePath);
            await fs.promises.writeFile(filePath, configJson, 'utf8');
            return { filePath };
          }
          throw new Error('Handler not initialized');

        case 'importConfig':
          if (this.standaloneHandler) {
            const fs = await import('fs');
            const wsRoot2 = this.standaloneHandler.getWorkspaceRoot();
            if (!wsRoot2) throw new Error('No workspace root available');
            const filePath = ensureWithinDirectory(wsRoot2, payload.filePath);
            const configJson = await fs.promises.readFile(filePath, 'utf8');
            assertBufferSizeWithinLimit(
              configJson,
              'importConfig payload',
              MAX_JSON_PAYLOAD_BYTES,
            );

            const imported = JSON.parse(configJson) as unknown;
            if (!this.isRecord(imported)) {
              throw new Error('Imported configuration must be a JSON object');
            }

            if (payload.merge) {
              const importedEntries = this.flattenConfigEntries(imported);
              if (importedEntries.length === 0) {
                return { importedKeys: [] };
              }

              const availableKeys = new Set(
                this.standaloneHandler.getAvailableConfigKeyPaths(),
              );
              const importedKeys: string[] = [];
              for (const entry of importedEntries) {
                if (!availableKeys.has(entry.keyPath)) {
                  throw new Error(
                    `Invalid configuration key path "${entry.keyPath}" in import file`,
                  );
                }
                await this.standaloneHandler.setConfig(
                  entry.keyPath,
                  entry.value,
                );
                importedKeys.push(entry.keyPath);
              }
              return { importedKeys };
            } else {
              await this.standaloneHandler.importConfig(configJson);
              return { importedKeys: Object.keys(imported) };
            }
          }
          throw new Error('Handler not initialized');

        case 'getWorkspaceInfo':
          return await this.getWorkspaceInfo();

        case 'getStatus':
          return await this.getStatus();

        case 'getSnapshotChanges': {
          if (this.standaloneHandler) {
            // `snapshot show --files` sends { snapshotId }, api callers send
            // { id }. Reading only `payload.id` passed the whole payload object
            // down as the id whenever the command layer called it.
            const changesId: string =
              typeof payload.id === 'string'
                ? payload.id
                : typeof payload.snapshotId === 'string'
                ? payload.snapshotId
                : (payload as unknown as string);
            return await this.standaloneHandler.getSnapshotChanges(changesId);
          }
          throw new Error('Handler not initialized');
        }

        case 'navigateSnapshot':
          if (this.standaloneHandler) {
            return await this.standaloneHandler.navigateSnapshot(
              payload.direction || payload,
            );
          }
          throw new Error('Handler not initialized');

        case 'getFileHistory':
          if (this.standaloneHandler) {
            // Pass data as-is, handler can handle both string and options
            return await this.standaloneHandler.getFileHistory(
              typeof payload === 'string' ? payload : (payload as any),
            );
          }
          throw new Error('Handler not initialized');

        case 'listSnapshotFiles':
          if (this.standaloneHandler) {
            return await this.standaloneHandler.listSnapshotFiles(
              payload as any,
            );
          }
          throw new Error('Handler not initialized');

        case 'getSnapshotFile':
          if (this.standaloneHandler) {
            return await this.standaloneHandler.getSnapshotFile(payload as any);
          }
          throw new Error('Handler not initialized');

        case 'compareSnapshotFile':
          if (this.standaloneHandler) {
            return await this.standaloneHandler.compareSnapshotFile(
              payload as any,
            );
          }
          throw new Error('Handler not initialized');

        case 'restoreSnapshotFile':
          if (this.standaloneHandler) {
            return await this.standaloneHandler.restoreSnapshotFile(
              payload as any,
            );
          }
          throw new Error('Handler not initialized');

        case 'exportSnapshotFile':
          if (this.standaloneHandler) {
            return await this.standaloneHandler.exportSnapshotFile(
              payload as any,
            );
          }
          throw new Error('Handler not initialized');

        case 'createGitCommitFromSnapshot':
          if (this.standaloneHandler) {
            return await this.standaloneHandler.createGitCommitFromSnapshot(
              payload as any,
            );
          }
          throw new Error('Handler not initialized');

        case 'getGitBranchInfo':
          if (this.standaloneHandler) {
            return this.standaloneHandler.getGitBranchInfo();
          }
          throw new Error('Handler not initialized');

        case 'createBranch':
          if (this.standaloneHandler) {
            this.standaloneHandler.createBranch(
              payload.name as string,
              payload.checkout as boolean | undefined,
            );
            return { success: true };
          }
          throw new Error('Handler not initialized');

        case 'switchBranch':
          if (this.standaloneHandler) {
            this.standaloneHandler.switchBranch(payload.name as string);
            return { success: true };
          }
          throw new Error('Handler not initialized');

        case 'deleteBranch':
          if (this.standaloneHandler) {
            this.standaloneHandler.deleteBranch(
              payload.name as string,
              payload.force as boolean | undefined,
            );
            return { success: true };
          }
          throw new Error('Handler not initialized');

        case 'listBranches':
          if (this.standaloneHandler) {
            return { branches: this.standaloneHandler.listBranches() };
          }
          throw new Error('Handler not initialized');

        default:
          // Unreachable: `STANDALONE_METHODS` is checked above and the
          // capability guard pins the two to each other. Reaching this means
          // the set and the switch drifted.
          throw new Error(
            `Internal error: ${method} is declared standalone-capable but has no handler.`,
          );
      }
    } else if (this.activeMode === 'ipc') {
      return await this.ipcClient.callApi(method, payload);
    }
    throw new Error('Client not initialized');
  }

  public async executeCommand(command: Record<string, any>): Promise<any> {
    if (this.activeMode === 'ipc') {
      return await this.ipcClient.executeCommand(command);
    }
    throw new Error('executeCommand is only available in IPC mode');
  }

  public async watchEvents(
    eventTypes: string[],
    callback: (event: any) => void,
  ): Promise<void> {
    if (this.activeMode === 'ipc') {
      await this.ipcClient.watchEvents(eventTypes, callback);
      return;
    }
    if (this.activeMode === 'standalone') {
      // Standalone has no event source, and the previous body resolved
      // silently: the command printed its banner, registered nothing and
      // exited 0.
      throw new Error(
        'Watching events requires the CodeLapse extension over IPC; standalone mode has no event source.',
      );
    }
    throw new Error('Client not initialized');
  }

  public disconnect(): void {
    // Cleanup if needed
  }
}
