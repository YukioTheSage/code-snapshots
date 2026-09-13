import * as vscode from 'vscode';
import { AutoSnapshotRule, ConfigManager } from 'codelapse-core';
import { minimatch } from 'minimatch';
import { SnapshotManager, Snapshot } from '../snapshotManager';
import { resolveSetting } from '../configSource';
import { DiagnosticsService } from './diagnosticsService';
import { SemanticSearchService } from './semanticSearchService';
import { log } from '../logger';
import {
  TerminalApiInterface,
  TakeSnapshotOptions,
  SnapshotResponse,
  SnapshotFilter,
  RestoreOptions,
  RestoreResponse,
  NavigationResponse,
  ChangesSummary,
  ComparisonResult,
  SearchOptions,
  SearchResult,
  IndexingResult,
  IndexSnapshotsOptions,
  WorkspaceInfo,
  CurrentState,
  ValidationResult,
  ExportResult,
} from './terminalApiTypes';

/**
 * Terminal API Service Implementation
 */
export class TerminalApiService implements TerminalApiInterface {
  private snapshotManager: SnapshotManager;
  private semanticSearchService?: SemanticSearchService;

  constructor(
    snapshotManager: SnapshotManager,
    semanticSearchService?: SemanticSearchService,
  ) {
    this.snapshotManager = snapshotManager;
    this.semanticSearchService = semanticSearchService;
    log('TerminalApiService initialized');
  }

  /**
   * Take a snapshot with the given options
   */
  async takeSnapshot(
    options: TakeSnapshotOptions = {},
  ): Promise<SnapshotResponse> {
    try {
      log(
        `TerminalApiService: Taking snapshot with options: ${JSON.stringify(
          options,
        )}`,
      );

      const outcome = await this.snapshotManager.takeSnapshot(
        options.description || `CLI snapshot at ${new Date().toISOString()}`,
        {
          tags: options.tags,
          notes: options.notes,
          taskReference: options.taskReference,
          isFavorite: options.isFavorite,
          isSelective: options.isSelective,
          selectedFiles: options.selectedFiles,
        },
      );

      if (!outcome.created) {
        // No snapshot was recorded, so there is nothing to describe. Reporting
        // `success: true` with the previous snapshot -- which is what this
        // returned before -- told the caller a snapshot had been created when
        // the store was unchanged.
        log(
          'TerminalApiService: no snapshot created; the workspace is unchanged.',
        );
        return {
          success: false,
          noChanges: true,
          error:
            'Nothing to snapshot: the workspace is unchanged since the previous snapshot.',
        };
      }

      const { snapshot } = outcome;

      // Calculate statistics
      const changes = this.snapshotManager.getSnapshotChangeSummary(
        snapshot.id,
      );
      const statistics = {
        filesProcessed: Object.keys(snapshot.files).length,
        filesChanged: changes.modified,
        filesAdded: changes.added,
        filesDeleted: changes.deleted,
      };

      // Show notification unless silent mode
      if (!options.silent) {
        vscode.window.showInformationMessage(
          `Snapshot "${snapshot.description}" created successfully`,
        );
      }

      return {
        success: true,
        snapshot,
        statistics,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log(`TerminalApiService: Error taking snapshot: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get snapshots with optional filtering
   */
  async getSnapshots(filter?: SnapshotFilter): Promise<Snapshot[]> {
    try {
      let snapshots = this.snapshotManager.getSnapshots();

      if (filter) {
        // Apply tag filter
        if (filter.tags && filter.tags.length > 0) {
          // AND, not OR: `filterTags.every(...)` in the tree view already
          // decided this for the surface users see, and the same CLI command
          // must not mean two things depending on which mode answered it.
          const required = filter.tags;
          snapshots = snapshots.filter(
            (s) =>
              s.tags !== undefined &&
              required.every((tag) => s.tags!.includes(tag)),
          );
        }

        // Apply date range filter
        if (filter.dateRange) {
          snapshots = snapshots.filter(
            (s) =>
              s.timestamp >= filter.dateRange!.start &&
              s.timestamp <= filter.dateRange!.end,
          );
        }

        // Apply favorite filter
        if (filter.isFavorite !== undefined) {
          snapshots = snapshots.filter(
            (s) => s.isFavorite === filter.isFavorite,
          );
        }

        // Apply pagination
        if (filter.offset || filter.limit) {
          const start = filter.offset || 0;
          const end = filter.limit ? start + filter.limit : undefined;
          snapshots = snapshots.slice(start, end);
        }
      }

      return snapshots;
    } catch (error) {
      // Throw instead of returning []: an empty array is what a successful
      // search with no matches returns, so a broken snapshot store and "no
      // snapshots" were indistinguishable. The IPC dispatcher wraps a throwing
      // handler in { success: false, error }, which is how the CLI reports the
      // failure and exits non-zero.
      const message = error instanceof Error ? error.message : String(error);
      log(`TerminalApiService: Error getting snapshots: ${message}`);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  /**
   * The `codelapse filter` surface over IPC. Kept deliberately parallel to the
   * standalone handler: the same command must not mean two things depending on
   * which mode answers it.
   */
  async filterSnapshots(filter?: {
    tags?: string[];
    favorites?: boolean;
    isFavorite?: boolean;
    dateRange?: {
      from?: string | number;
      to?: string | number;
      start?: string | number;
      end?: string | number;
    };
    files?: string[];
    gitBranch?: string;
    searchText?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    snapshots: Snapshot[];
    totalCount: number;
    filteredCount: number;
  }> {
    const all = this.snapshotManager.getSnapshots();
    let filtered = [...all];

    if (filter?.favorites === true || filter?.isFavorite === true) {
      filtered = filtered.filter((snapshot) => snapshot.isFavorite === true);
    }

    if (filter?.tags && filter.tags.length > 0) {
      const required = filter.tags;
      filtered = filtered.filter((snapshot) =>
        required.every((tag) => (snapshot.tags ?? []).includes(tag)),
      );
    }

    const parseTimestamp = (value: unknown): number | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
      return undefined;
    };

    const from = parseTimestamp(
      filter?.dateRange?.from ?? filter?.dateRange?.start,
    );
    const to = parseTimestamp(filter?.dateRange?.to ?? filter?.dateRange?.end);
    if (from !== undefined) {
      filtered = filtered.filter((snapshot) => snapshot.timestamp >= from);
    }
    if (to !== undefined) {
      filtered = filtered.filter((snapshot) => snapshot.timestamp <= to);
    }

    if (filter?.files && filter.files.length > 0) {
      filtered = filtered.filter((snapshot) =>
        filter.files!.some(
          (filePath) =>
            snapshot.files[filePath] !== undefined &&
            snapshot.files[filePath].deleted !== true,
        ),
      );
    }

    if (filter?.gitBranch) {
      filtered = filtered.filter(
        (snapshot) => snapshot.gitBranch === filter.gitBranch,
      );
    }

    if (filter?.searchText) {
      const needle = filter.searchText.toLowerCase();
      filtered = filtered.filter(
        (snapshot) =>
          (snapshot.description ?? '').toLowerCase().includes(needle) ||
          (snapshot.notes ?? '').toLowerCase().includes(needle) ||
          (snapshot.tags ?? []).some((tag) =>
            tag.toLowerCase().includes(needle),
          ),
      );
    }

    const filteredCount = filtered.length;
    const offset = Math.max(0, filter?.offset ?? 0);
    const limit =
      filter?.limit === undefined ? undefined : Math.max(0, filter.limit);
    const snapshots =
      limit === undefined
        ? filtered.slice(offset)
        : filtered.slice(offset, offset + limit);

    return { snapshots, totalCount: all.length, filteredCount };
  }

  async updateSnapshotMetadata(
    id: string,
    updates: {
      description?: string;
      tags?: string[];
      notes?: string;
      taskReference?: string;
      isFavorite?: boolean;
    },
  ): Promise<{ success: true }> {
    await this.snapshotManager.updateSnapshotContext(id, updates);
    return { success: true };
  }

  async editSnapshotTags(
    id: string,
    tags: string[],
  ): Promise<{ snapshotId: string; tags: string[] }> {
    await this.snapshotManager.updateSnapshotContext(id, { tags });
    return { snapshotId: id, tags };
  }

  async editSnapshotNotes(
    id: string,
    notes: string,
  ): Promise<{ snapshotId: string; notes: string }> {
    await this.snapshotManager.updateSnapshotContext(id, { notes });
    return { snapshotId: id, notes };
  }

  async editTaskReference(
    id: string,
    taskReference: string,
  ): Promise<{ snapshotId: string; taskReference: string }> {
    await this.snapshotManager.updateSnapshotContext(id, { taskReference });
    return { snapshotId: id, taskReference };
  }

  async toggleFavoriteStatus(
    id: string,
    isFavorite?: boolean,
  ): Promise<{ snapshotId: string; isFavorite: boolean }> {
    const current = this.snapshotManager
      .getSnapshots()
      .find((snapshot) => snapshot.id === id);
    const nextValue =
      typeof isFavorite === 'boolean'
        ? isFavorite
        : !(current?.isFavorite ?? false);
    await this.snapshotManager.updateSnapshotContext(id, {
      isFavorite: nextValue,
    });
    return { snapshotId: id, isFavorite: nextValue };
  }

  /**
   * Read the shared file rules. `getAutoSnapshotRules` layers an explicitly-set
   * VS Code value over this; mutations write the file both surfaces can read.
   */
  private readSharedAutoSnapshotRules(): AutoSnapshotRule[] {
    const workspaceRoot = this.snapshotManager.getWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error(
        'No workspace folder open; auto-snapshot rules require a workspace.',
      );
    }
    const rules = new ConfigManager(workspaceRoot).getNested(
      'autoSnapshot.rules',
    );
    return Array.isArray(rules) ? rules : [];
  }

  private async writeSharedAutoSnapshotRules(
    rules: AutoSnapshotRule[],
  ): Promise<void> {
    const workspaceRoot = this.snapshotManager.getWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error(
        'No workspace folder open; auto-snapshot rules require a workspace.',
      );
    }
    await new ConfigManager(workspaceRoot).setNested(
      'autoSnapshot.rules',
      rules,
    );
  }

  async getAutoSnapshotRules(): Promise<AutoSnapshotRule[]> {
    return resolveSetting<AutoSnapshotRule[]>(
      'autoSnapshot.rules',
      this.readSharedAutoSnapshotRules(),
    ).value;
  }

  async addAutoSnapshotRule(rule: AutoSnapshotRule): Promise<AutoSnapshotRule> {
    const rules = this.readSharedAutoSnapshotRules();
    if (rules.some((existing) => existing.pattern === rule.pattern)) {
      throw new Error(`A rule for "${rule.pattern}" already exists.`);
    }

    const added: AutoSnapshotRule = {
      pattern: rule.pattern,
      intervalMinutes: rule.intervalMinutes,
      ...(rule.enabled === undefined ? {} : { enabled: rule.enabled }),
    };
    await this.writeSharedAutoSnapshotRules([...rules, added]);
    return added;
  }

  async updateAutoSnapshotRule(
    pattern: string,
    updates: Partial<AutoSnapshotRule>,
  ): Promise<AutoSnapshotRule> {
    const rules = this.readSharedAutoSnapshotRules();
    const index = rules.findIndex((existing) => existing.pattern === pattern);
    if (index === -1) {
      throw new Error(`No rule matches "${pattern}".`);
    }

    const updated = { ...rules[index], ...updates };
    rules[index] = updated;
    await this.writeSharedAutoSnapshotRules(rules);
    return updated;
  }

  async removeAutoSnapshotRule(pattern: string): Promise<void> {
    const remaining = this.readSharedAutoSnapshotRules().filter(
      (rule) => rule.pattern !== pattern,
    );
    await this.writeSharedAutoSnapshotRules(remaining);
  }

  async toggleAutoSnapshotRule(
    pattern: string,
    enabled?: boolean,
  ): Promise<AutoSnapshotRule> {
    const rules = this.readSharedAutoSnapshotRules();
    const existing = rules.find((rule) => rule.pattern === pattern);
    if (!existing) {
      throw new Error(`No rule matches "${pattern}".`);
    }
    const nextEnabled =
      typeof enabled === 'boolean' ? enabled : existing.enabled === false;
    return await this.updateAutoSnapshotRule(pattern, {
      enabled: nextEnabled,
    });
  }

  async testAutoSnapshotRule(options: {
    pattern: string;
    samplePaths?: string[];
    testPath?: string;
  }): Promise<{ matched: string[]; matches: string[] }> {
    const candidates =
      options.samplePaths ??
      (options.testPath === undefined ? [] : [options.testPath]);
    const matched = candidates.filter((candidate) =>
      minimatch(candidate, options.pattern, { dot: true }),
    );
    return { matched, matches: matched };
  }
  private createDiagnosticsService(): DiagnosticsService {
    let extensionVersion = process.env.npm_package_version || '0.0.0';
    try {
      extensionVersion =
        vscode.extensions?.getExtension('YukioTheSage.vscode-snapshots')
          ?.packageJSON?.version ?? extensionVersion;
    } catch {
      // The package version is only display metadata; diagnostics still work.
    }

    return new DiagnosticsService(
      this.snapshotManager,
      this.snapshotManager.getWorkspaceRoot() ?? '',
      extensionVersion,
    );
  }

  async runDiagnostics(): Promise<
    ReturnType<DiagnosticsService['runDiagnostics']>
  > {
    return await this.createDiagnosticsService().runDiagnostics();
  }

  async healthCheck(): Promise<ReturnType<DiagnosticsService['healthCheck']>> {
    return await this.createDiagnosticsService().healthCheck();
  }

  async getSystemInfo(): Promise<
    ReturnType<DiagnosticsService['getSystemInfo']>
  > {
    return this.createDiagnosticsService().getSystemInfo();
  }

  async getPerformanceMetrics(): Promise<
    ReturnType<DiagnosticsService['getPerformanceMetrics']>
  > {
    return await this.createDiagnosticsService().getPerformanceMetrics();
  }

  getLogs(options?: {
    lines?: number;
    level?: string;
    since?: string;
  }): ReturnType<DiagnosticsService['getLogs']> {
    return this.createDiagnosticsService().getLogs(options);
  }

  clearLogs(options?: {
    olderThan?: string;
    level?: string;
  }): ReturnType<DiagnosticsService['clearLogs']> {
    return this.createDiagnosticsService().clearLogs(options);
  }
  /**
   * Get a specific snapshot by ID
   */
  async getSnapshot(id: string): Promise<Snapshot | null> {
    try {
      return this.snapshotManager.getSnapshotById(id) || null;
    } catch (error) {
      log(`TerminalApiService: Error getting snapshot ${id}: ${error}`);
      return null;
    }
  }

  /**
   * Restore a snapshot with options
   */
  async restoreSnapshot(
    id: string,
    options: RestoreOptions = {},
  ): Promise<RestoreResponse> {
    try {
      log(
        `TerminalApiService: Restoring snapshot ${id} with options: ${JSON.stringify(
          options,
        )}`,
      );

      const snapshot = this.snapshotManager.getSnapshotById(id);
      if (!snapshot) {
        return {
          success: false,
          filesRestored: 0,
          filesSkipped: 0,
          error: `Snapshot ${id} not found`,
        };
      }

      // Create backup snapshot if requested
      let backupSnapshotId: string | undefined;
      if (options.createBackupSnapshot) {
        const backupResponse = await this.takeSnapshot({
          description: `Backup before restoring ${snapshot.description}`,
          tags: ['backup', 'auto'],
          silent: true,
        });
        if (backupResponse.success && backupResponse.snapshot) {
          backupSnapshotId = backupResponse.snapshot.id;
        }
      }

      // Check for unsaved changes
      const conflicts: string[] = [];
      if (vscode.window.activeTextEditor?.document.isDirty) {
        conflicts.push(vscode.window.activeTextEditor.document.fileName);
      }

      // Perform the restore
      const restore = await this.snapshotManager.applySnapshotRestore(id);
      const success = restore.success;

      if (!success) {
        return {
          success: false,
          filesRestored: 0,
          filesSkipped: 0,
          error: 'Failed to restore snapshot',
          conflicts,
        };
      }

      // Report files the snapshot could not reconstruct, rather than claiming a
      // clean restore. This keeps `success` honest: the operation did run.
      const incomplete =
        restore.skipped.length > 0 || restore.refusedDeletions.length > 0;

      if (incomplete) {
        return {
          success: true,
          filesRestored: restore.restored.length,
          filesSkipped: restore.skipped.length,
          incomplete: true,
          refusedDeletions: restore.refusedDeletions.length,
          conflicts,
        };
      }

      // Show notification unless silent
      if (!options.silent) {
        vscode.window.showInformationMessage(
          `Snapshot "${snapshot.description}" restored successfully`,
        );
      }

      return {
        success: true,
        backupSnapshotId,
        filesRestored: Object.keys(snapshot.files).length,
        filesSkipped: 0,
        conflicts,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log(`TerminalApiService: Error restoring snapshot: ${errorMessage}`);
      return {
        success: false,
        filesRestored: 0,
        filesSkipped: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Delete a snapshot
   */
  async deleteSnapshot(
    id: string,
    options?: { skipConfirm?: boolean; force?: boolean },
  ): Promise<boolean> {
    try {
      return await this.snapshotManager.deleteSnapshot(id, options);
    } catch (error) {
      log(`TerminalApiService: Error deleting snapshot ${id}: ${error}`);
      return false;
    }
  }

  /**
   * Navigate to previous or next snapshot
   */
  async navigateSnapshot(
    direction: 'previous' | 'next',
  ): Promise<NavigationResponse> {
    try {
      const previousIndex = this.snapshotManager.getCurrentSnapshotIndex();

      let success: boolean;
      if (direction === 'previous') {
        success = await this.snapshotManager.navigateToPreviousSnapshot();
      } else {
        success = await this.snapshotManager.navigateToNextSnapshot();
      }

      const newIndex = this.snapshotManager.getCurrentSnapshotIndex();
      const currentSnapshot =
        newIndex >= 0
          ? this.snapshotManager.getSnapshots()[newIndex]
          : undefined;

      return {
        success,
        currentSnapshot,
        previousIndex,
        newIndex,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        previousIndex: this.snapshotManager.getCurrentSnapshotIndex(),
        newIndex: this.snapshotManager.getCurrentSnapshotIndex(),
        error: errorMessage,
      };
    }
  }

  /**
   * Get file content from a specific snapshot
   */
  async getSnapshotFileContent(
    snapshotId: string,
    filePath: string,
  ): Promise<string | null> {
    try {
      return await this.snapshotManager.getSnapshotFileContentPublic(
        snapshotId,
        filePath,
      );
    } catch (error) {
      log(`TerminalApiService: Error getting file content: ${error}`);
      return null;
    }
  }

  /**
   * Get changes summary for a snapshot
   */
  async getSnapshotChanges(snapshotId: string): Promise<ChangesSummary> {
    try {
      const snapshot = this.snapshotManager.getSnapshotById(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot ${snapshotId} not found`);
      }

      const added: string[] = [];
      const modified: string[] = [];
      const deleted: string[] = [];
      const binary: string[] = [];

      Object.entries(snapshot.files).forEach(([filePath, fileData]) => {
        if (fileData.deleted) {
          deleted.push(filePath);
        } else if (fileData.isBinary) {
          binary.push(filePath);
        } else if (fileData.diff) {
          modified.push(filePath);
        } else if (fileData.content && !fileData.baseSnapshotId) {
          added.push(filePath);
        }
      });

      return {
        snapshotId,
        added,
        modified,
        deleted,
        binary,
        totalChanges: added.length + modified.length + deleted.length,
      };
    } catch (error) {
      log(`TerminalApiService: Error getting snapshot changes: ${error}`);
      return {
        snapshotId,
        added: [],
        modified: [],
        deleted: [],
        binary: [],
        totalChanges: 0,
      };
    }
  }

  /**
   * Compare two snapshots
   */
  async compareSnapshots(
    snapshotId1: string,
    snapshotId2: string,
  ): Promise<ComparisonResult> {
    try {
      const snapshot1 = this.snapshotManager.getSnapshotById(snapshotId1);
      const snapshot2 = this.snapshotManager.getSnapshotById(snapshotId2);

      if (!snapshot1 || !snapshot2) {
        throw new Error('One or both snapshots not found');
      }

      const files1 = new Set(Object.keys(snapshot1.files));
      const files2 = new Set(Object.keys(snapshot2.files));

      const addedFiles = Array.from(files2).filter((f) => !files1.has(f));
      const removedFiles = Array.from(files1).filter((f) => !files2.has(f));
      const commonFiles = Array.from(files1).filter((f) => files2.has(f));

      const modifiedFiles: string[] = [];
      const identicalFiles: string[] = [];
      const filesDiff: ComparisonResult['filesDiff'] = {};

      for (const filePath of commonFiles) {
        const content1 = await this.getSnapshotFileContent(
          snapshotId1,
          filePath,
        );
        const content2 = await this.getSnapshotFileContent(
          snapshotId2,
          filePath,
        );

        if (content1 !== content2) {
          modifiedFiles.push(filePath);
          filesDiff[filePath] = {
            changeType: 'modified',
            // Could add line count diff here
          };
        } else {
          identicalFiles.push(filePath);
        }
      }

      // Add removed files to diff
      removedFiles.forEach((filePath) => {
        filesDiff[filePath] = { changeType: 'removed' };
      });

      // Add added files to diff
      addedFiles.forEach((filePath) => {
        filesDiff[filePath] = { changeType: 'added' };
      });

      return {
        snapshotId1,
        snapshotId2,
        addedFiles,
        removedFiles,
        modifiedFiles,
        identicalFiles,
        filesDiff,
      };
    } catch (error) {
      log(`TerminalApiService: Error comparing snapshots: ${error}`);
      return {
        snapshotId1,
        snapshotId2,
        addedFiles: [],
        removedFiles: [],
        modifiedFiles: [],
        identicalFiles: [],
        filesDiff: {},
      };
    }
  }

  /**
   * Search snapshots using semantic search
   */
  async searchSnapshots(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    try {
      if (!this.semanticSearchService) {
        throw new Error('Semantic search service not available');
      }

      const results = await this.semanticSearchService.searchCode({
        query,
        snapshotIds: options.snapshotIds,
        languages: options.languages,
        limit: options.limit || 20,
        scoreThreshold: options.scoreThreshold || 0.65,
      });

      return results.map((result) => ({
        snapshotId: result.snapshotId,
        filePath: result.filePath,
        content: result.content,
        score: result.score,
        location: {
          startLine: result.startLine,
          endLine: result.endLine,
        },
        context: {
          snapshotDescription: result.snapshot.description || '',
          snapshotTimestamp: result.timestamp,
          tags: result.snapshot.tags || [],
        },
      }));
    } catch (error) {
      // Same rule as getSnapshots, and it covers the two failures that used to
      // look like "no matches": an unreachable vector store and an unavailable
      // semantic search service.
      const message = error instanceof Error ? error.message : String(error);
      log(`TerminalApiService: Error searching snapshots: ${message}`);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  /**
   * Index snapshots for semantic search.
   *
   * Absent or empty snapshotIds means every snapshot; explicit ids index exactly
   * those. The previous shape treated an empty array as a request for individual
   * snapshots -- and [] is truthy -- so 'codelapse search index' without --all
   * could never succeed.
   */
  async indexSnapshots(
    options: IndexSnapshotsOptions = {},
  ): Promise<IndexingResult> {
    const startTime = Date.now();

    try {
      if (!this.semanticSearchService) {
        throw new Error('Semantic search service not available');
      }

      // The CLI connector hands this method whatever JSON the caller sent, so
      // validate the one field whose wrong type would otherwise throw deep in
      // the service (`options.snapshotIds.filter is not a function`) or, worse,
      // be filtered away there and silently index the whole workspace. Only an
      // absent key means 'every snapshot': JSON null is a value that failed to
      // carry ids, not an omission, and is rejected like any other non-array.
      // A blank or whitespace-only element is refused as well: it survives the
      // shape check, is filtered away inside the service, and would then mean
      // 'every snapshot' -- the same silent degradation the null rejection
      // exists to prevent.
      const snapshotIds = options.snapshotIds;
      if (
        snapshotIds !== undefined &&
        (!Array.isArray(snapshotIds) ||
          snapshotIds.some(
            (id) => typeof id !== 'string' || id.trim().length === 0,
          ))
      ) {
        throw new Error('snapshotIds must be an array of strings');
      }

      const outcome = await this.semanticSearchService.indexAllSnapshots({
        snapshotIds,
        force: options.force === true,
        purgeFirst: options.purgeFirst === true,
      });

      // Report what happened, not what was attempted. This used to return
      // success with the *total* snapshot count no matter how many failed,
      // which is the same false claim the progress notification made.
      if (outcome.failed.length > 0) {
        return {
          success: false,
          snapshotsIndexed: outcome.succeeded,
          filesIndexed: 0, // Would need to track this
          error:
            'Failed to index ' +
            outcome.failed.length +
            ' of ' +
            outcome.attempted +
            ' snapshot(s): ' +
            outcome.failed
              .map((failure) => failure.snapshotId + ' (' + failure.error + ')')
              .join('; '),
          timeElapsed: Date.now() - startTime,
        };
      }

      return {
        success: true,
        snapshotsIndexed: outcome.succeeded,
        filesIndexed: 0, // Would need to track this
        timeElapsed: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        snapshotsIndexed: 0,
        filesIndexed: 0,
        error: errorMessage,
        timeElapsed: Date.now() - startTime,
      };
    }
  }

  /**
   * Get workspace information
   */
  async getWorkspaceInfo(): Promise<WorkspaceInfo> {
    try {
      const snapshots = this.snapshotManager.getSnapshots();
      const currentIndex = this.snapshotManager.getCurrentSnapshotIndex();
      const currentSnapshot =
        currentIndex >= 0 ? snapshots[currentIndex] : undefined;

      return {
        workspaceRoot: this.snapshotManager.getWorkspaceRoot(),
        totalSnapshots: snapshots.length,
        currentSnapshotIndex: currentIndex,
        currentSnapshot,
        lastSnapshotTime:
          snapshots.length > 0
            ? snapshots[snapshots.length - 1].timestamp
            : undefined,
      };
    } catch (error) {
      log(`TerminalApiService: Error getting workspace info: ${error}`);
      return {
        workspaceRoot: null,
        totalSnapshots: 0,
        currentSnapshotIndex: -1,
      };
    }
  }

  /**
   * Get current workspace state
   */
  async getCurrentState(): Promise<CurrentState> {
    try {
      const changedFiles: string[] = [];
      const openFiles: string[] = [];
      let activeFile: string | undefined;

      // Get open and active files
      vscode.window.visibleTextEditors.forEach((editor) => {
        const filePath = editor.document.fileName;
        openFiles.push(filePath);

        if (editor.document.isDirty) {
          changedFiles.push(filePath);
        }
      });

      if (vscode.window.activeTextEditor) {
        activeFile = vscode.window.activeTextEditor.document.fileName;
      }

      // Basic workspace stats (simplified)
      const workspaceStats = {
        totalFiles: 0,
        totalLines: 0,
        filesByLanguage: {} as { [language: string]: number },
      };

      return {
        hasUnsavedChanges: changedFiles.length > 0,
        changedFiles,
        openFiles,
        activeFile,
        workspaceStats,
      };
    } catch (error) {
      log(`TerminalApiService: Error getting current state: ${error}`);
      return {
        hasUnsavedChanges: false,
        changedFiles: [],
        openFiles: [],
        workspaceStats: {
          totalFiles: 0,
          totalLines: 0,
          filesByLanguage: {},
        },
      };
    }
  }

  /**
   * Validate a snapshot
   */
  async validateSnapshot(id: string): Promise<ValidationResult> {
    try {
      const snapshot = this.snapshotManager.getSnapshotById(id);

      if (!snapshot) {
        return {
          isValid: false,
          exists: false,
          hasIntegrityIssues: false,
          missingFiles: [],
          corruptedFiles: [],
          errors: [`Snapshot ${id} not found`],
        };
      }

      // Basic validation - could be enhanced
      return {
        isValid: true,
        exists: true,
        hasIntegrityIssues: false,
        missingFiles: [],
        corruptedFiles: [],
        errors: [],
      };
    } catch (error) {
      return {
        isValid: false,
        exists: false,
        hasIntegrityIssues: true,
        missingFiles: [],
        corruptedFiles: [],
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Export a snapshot
   */
  async exportSnapshot(
    id: string,
    format: 'json' | 'zip',
  ): Promise<ExportResult> {
    try {
      const snapshot = this.snapshotManager.getSnapshotById(id);

      if (!snapshot) {
        return {
          success: false,
          format,
          size: 0,
          error: `Snapshot ${id} not found`,
        };
      }

      // This would need proper implementation based on storage service
      const exportData = JSON.stringify(snapshot, null, 2);
      const size = Buffer.byteLength(exportData, 'utf8');

      return {
        success: true,
        exportPath: `/tmp/snapshot-${id}.${format}`,
        format,
        size,
      };
    } catch (error) {
      return {
        success: false,
        format,
        size: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Subscribe to snapshot changes
   */
  onSnapshotsChanged(
    callback: (snapshots: Snapshot[]) => void,
  ): vscode.Disposable {
    return this.snapshotManager.onDidChangeSnapshots(() => {
      callback(this.snapshotManager.getSnapshots());
    });
  }

  /**
   * Subscribe to current snapshot changes
   */
  onCurrentSnapshotChanged(
    callback: (snapshot: Snapshot | null) => void,
  ): vscode.Disposable {
    return this.snapshotManager.onDidChangeSnapshots(() => {
      const index = this.snapshotManager.getCurrentSnapshotIndex();
      const snapshot =
        index >= 0 ? this.snapshotManager.getSnapshots()[index] : null;
      callback(snapshot);
    });
  }
}
