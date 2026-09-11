/**
 * Standalone CLI handler that operates without VS Code extension
 * Uses codelapse-core for direct snapshot operations
 */

import {
  SnapshotManager,
  ConfigManager,
  Snapshot,
  SnapshotFilter,
  GitIntegration,
  GitCommitResult,
  GitBranchInfo,
  assertBufferSizeWithinLimit,
  assertNoSymlinkPath,
  assertSufficientDiskSpace,
  ensureWithinDirectory,
  MAX_FILE_SIZE_BYTES,
} from 'codelapse-core';
import * as path from 'path';
import * as fs from 'fs';

/** Directory names that mark the root of a project the CLI can snapshot. */
const WORKSPACE_INDICATORS = [
  '.git',
  'package.json',
  '.snapshots',
  'tsconfig.json',
  '.vscode',
];

/**
 * Find the nearest ancestor directory (including `startDir`) that looks like a
 * project root, or `null` when no indicator exists up the tree.
 *
 * Both the handler's root search and `isStandaloneModeAvailable` must use this
 * same walk. They used to disagree: the availability check looked only at the
 * current directory while the handler walked up ten levels, so the CLI refused
 * standalone mode in every subdirectory and fell back to a dead IPC path.
 */
export function findWorkspaceRootFrom(startDir: string): string | null {
  let currentDir = startDir;

  for (let level = 0; level < 10; level++) {
    if (
      WORKSPACE_INDICATORS.some((indicator) =>
        fs.existsSync(path.join(currentDir, indicator)),
      )
    ) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached the filesystem root.
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

/**
 * A CLI-shaped snapshot filter translated into what codelapse-core honours,
 * plus the parts core cannot express and the handler applies locally.
 */
export interface NormalizedListFilter {
  kind: 'core';
  tag?: string;
  favorite?: boolean;
  startDate?: number;
  endDate?: number;
  search?: string;
  filePath?: string;
  /** More than one tag: core matches a single tag, so these are applied locally. */
  pendingTags?: string[];
  limit?: number;
}

/**
 * Translate the filter shape the commands build into the shape core reads.
 *
 * commands/snapshot.ts sends `{ tags: [...], isFavorite, limit, dateRange }`
 * while core's `SnapshotFilter` reads `{ tag, favorite, startDate, endDate }`.
 * Passing one straight to the other silently ignores every option, which is
 * how `snapshot list --tags/--favorites/--limit/--since` returned unfiltered
 * results with exit 0.
 */
export function normalizeListFilter(
  raw: Record<string, unknown> | undefined,
): NormalizedListFilter {
  const out: NormalizedListFilter = { kind: 'core' };
  if (!raw) {
    return out;
  }

  const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : undefined;
  const singleTag = typeof raw.tag === 'string' ? raw.tag : undefined;

  if (singleTag) {
    out.tag = singleTag;
  } else if (tags && tags.length > 0) {
    out.tag = tags[0];
  }
  if (tags && tags.length > 1) {
    out.pendingTags = tags;
  }

  if (raw.favorite === true || raw.isFavorite === true) {
    out.favorite = true;
  }

  const dateRange = raw.dateRange as
    | { start?: unknown; end?: unknown; from?: unknown; to?: unknown }
    | undefined;
  if (dateRange) {
    const start = dateRange.start ?? dateRange.from;
    const end = dateRange.end ?? dateRange.to;
    if (typeof start === 'number') {
      out.startDate = start;
    }
    if (typeof end === 'number') {
      out.endDate = end;
    }
  }
  if (typeof raw.startDate === 'number') {
    out.startDate = raw.startDate;
  }
  if (typeof raw.endDate === 'number') {
    out.endDate = raw.endDate;
  }

  if (typeof raw.search === 'string') {
    out.search = raw.search;
  }
  if (typeof raw.filePath === 'string') {
    out.filePath = raw.filePath;
  }
  if (typeof raw.limit === 'number' && raw.limit > 0) {
    out.limit = raw.limit;
  }

  return out;
}

/** Strip the locally-applied fields so only core's own filter shape remains. */
function toCoreFilter(normalized: NormalizedListFilter): SnapshotFilter {
  return {
    tag: normalized.tag,
    favorite: normalized.favorite,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    search: normalized.search,
    filePath: normalized.filePath,
  };
}

/**
 * Express an export destination as a workspace-relative path.
 *
 * Core's `ensureWithinDirectory` refuses absolute input outright as a
 * traversal attempt, so an absolute destination *inside* the workspace -- what
 * a script that knows its own root naturally passes -- failed with
 * "Path traversal blocked: absolute path not allowed". Absolute paths inside
 * the root are converted; anything outside is refused here with a message that
 * names the real problem; relative input is passed through untouched so core
 * keeps rejecting `../..` sequences.
 */
export function toWorkspaceRelativeOutputPath(
  workspaceRoot: string,
  outputPath: string,
): string {
  if (!path.isAbsolute(outputPath)) {
    return outputPath;
  }

  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(outputPath);
  const relative = path.relative(root, resolved);

  const escapes =
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);

  if (escapes) {
    throw new Error(
      `Path traversal blocked: "${outputPath}" is outside the workspace root (${root})`,
    );
  }

  return relative;
}

/**
 * Resolve a possibly-abbreviated snapshot id against the known ids.
 *
 * Snapshot ids are long (`snapshot-1789120661991-fe3a3996`) and the docs
 * everywhere use short forms like `snapshot-123`, but nothing resolved a
 * prefix: the storage layer looked for a directory literally named after the
 * input. Returns the exact id, the single matching id, or `null` when the
 * input matches nothing or more than one snapshot.
 */
export function bestSnapshotIdMatch(
  partialId: string,
  candidates: string[],
): string | null {
  if (candidates.includes(partialId)) {
    return partialId;
  }
  if (!partialId) {
    return null;
  }

  const hits = candidates.filter((candidate) => candidate.includes(partialId));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Keep only the usable entries of a recorded `selectedFiles` list.
 *
 * Same rule as the extension's `normalizeSelectedFiles`
 * (`src/snapshotManager.ts`), so both surfaces agree about what a selection is:
 * a non-array is no selection, and an array keeps only its non-empty strings.
 * The list is read back from persisted JSON, so a store can hold a legacy
 * all-junk selection -- `codelapse snapshot create --selective --files ""`
 * writes `['']` -- and `['']` is truthy to anything that only counts entries.
 */
export function normalizeSelectedFiles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  );
}

export class StandaloneHandler {
  private snapshotManager: SnapshotManager | null = null;
  private configManager: ConfigManager | null = null;
  private gitIntegration: GitIntegration | null = null;
  private workspaceRoot: string | null = null;

  /**
   * Initialize the standalone handler
   */
  public async initialize(): Promise<boolean> {
    try {
      // Find workspace root
      this.workspaceRoot = this.findWorkspaceRoot();

      if (!this.workspaceRoot) {
        return false;
      }

      // Initialize managers
      this.configManager = new ConfigManager(this.workspaceRoot);
      this.snapshotManager = new SnapshotManager(this.workspaceRoot);
      this.gitIntegration = new GitIntegration(this.workspaceRoot);

      // Initialize snapshot manager
      await this.snapshotManager.initialize();

      return true;
    } catch (error) {
      console.error('Failed to initialize standalone handler:', error);
      return false;
    }
  }

  /**
   * Find workspace root by looking for project indicators
   */
  private findWorkspaceRoot(): string | null {
    // Fallback to the current directory keeps the previous contract: the
    // handler always initialized somewhere, even outside any project marker.
    return findWorkspaceRootFrom(process.cwd()) ?? process.cwd();
  }

  /**
   * Check if initialized
   */
  public isInitialized(): boolean {
    return this.snapshotManager !== null && this.configManager !== null;
  }

  /**
   * Get workspace root
   */
  public getWorkspaceRoot(): string | null {
    return this.workspaceRoot;
  }

  /**
   * Take a snapshot
   */
  public async takeSnapshot(options: {
    description?: string;
    tags?: string[];
    notes?: string;
    taskReference?: string;
    isFavorite?: boolean;
    isSelective?: boolean;
    selectedFiles?: string[];
  }): Promise<Snapshot> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    return await this.snapshotManager.takeSnapshot(options);
  }

  /**
   * Get all snapshots
   */
  public async getSnapshots(filter?: SnapshotFilter): Promise<Snapshot[]> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    // Commands send a CLI-shaped filter; translate before core sees it or the
    // options are silently ignored (BUG-6).
    const normalized = normalizeListFilter(filter as Record<string, unknown>);
    let snapshots = await this.snapshotManager.getSnapshots(
      toCoreFilter(normalized),
    );

    if (normalized.pendingTags && normalized.pendingTags.length > 0) {
      const required = normalized.pendingTags;
      snapshots = snapshots.filter((snapshot) =>
        required.every((tag) => (snapshot.tags ?? []).includes(tag)),
      );
    }

    if (normalized.limit !== undefined) {
      snapshots = snapshots.slice(0, normalized.limit);
    }

    return snapshots;
  }

  /**
   * The `codelapse filter` surface. Served by neither mode before this: the
   * method is allowlisted and documented, but no switch implemented it.
   */
  public async filterSnapshots(filter: {
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
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    const all = await this.snapshotManager.getSnapshots();
    let filtered = [...all];

    if (filter.favorites === true || filter.isFavorite === true) {
      filtered = filtered.filter((snapshot) => snapshot.isFavorite === true);
    }

    if (filter.tags && filter.tags.length > 0) {
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
      filter.dateRange?.from ?? filter.dateRange?.start,
    );
    const to = parseTimestamp(filter.dateRange?.to ?? filter.dateRange?.end);
    if (from !== undefined) {
      filtered = filtered.filter((snapshot) => snapshot.timestamp >= from);
    }
    if (to !== undefined) {
      filtered = filtered.filter((snapshot) => snapshot.timestamp <= to);
    }

    if (filter.files && filter.files.length > 0) {
      filtered = filtered.filter((snapshot) =>
        filter.files!.some(
          (filePath) =>
            snapshot.files[filePath] !== undefined &&
            snapshot.files[filePath].deleted !== true,
        ),
      );
    }

    if (filter.gitBranch) {
      filtered = filtered.filter(
        (snapshot) => snapshot.gitBranch === filter.gitBranch,
      );
    }

    if (filter.searchText) {
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
    const offset = Math.max(0, filter.offset ?? 0);
    const limit =
      filter.limit === undefined ? undefined : Math.max(0, filter.limit);
    const snapshots =
      limit === undefined
        ? filtered.slice(offset)
        : filtered.slice(offset, offset + limit);

    return { snapshots, totalCount: all.length, filteredCount };
  }

  public async editSnapshotTags(
    snapshotId: string,
    tags: string[],
  ): Promise<{ snapshotId: string; tags: string[] }> {
    await this.updateSnapshotMetadata(snapshotId, { tags });
    return { snapshotId, tags };
  }

  public async editSnapshotNotes(
    snapshotId: string,
    notes: string,
  ): Promise<{ snapshotId: string; notes: string }> {
    await this.updateSnapshotMetadata(snapshotId, { notes });
    return { snapshotId, notes };
  }

  public async editTaskReference(
    snapshotId: string,
    taskReference: string,
  ): Promise<{ snapshotId: string; taskReference: string }> {
    await this.updateSnapshotMetadata(snapshotId, { taskReference });
    return { snapshotId, taskReference };
  }

  /**
   * Set or flip the favourite flag. The command sends no value (its job is a
   * toggle), while API callers can name the target state explicitly.
   */
  public async toggleFavoriteStatus(
    snapshotId: string,
    isFavorite?: boolean,
  ): Promise<{ snapshotId: string; isFavorite: boolean }> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    const current = (await this.snapshotManager.getSnapshots()).find(
      (snapshot) => snapshot.id === snapshotId,
    );
    const nextValue =
      typeof isFavorite === 'boolean' ? isFavorite : !(current?.isFavorite ?? false);
    await this.updateSnapshotMetadata(snapshotId, { isFavorite: nextValue });
    return { snapshotId, isFavorite: nextValue };
  }

  /**
   * Expand a short snapshot id to the full id, or throw when it is ambiguous.
   *
   * Unknown ids are returned unchanged so the storage layer's own
   * "<id> not found" error keeps naming what the caller actually typed.
   */
  private async resolveSnapshotId(partialId: string): Promise<string> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    let ids: string[];
    try {
      const snapshots = await this.snapshotManager.getSnapshots();
      ids = snapshots.map((snapshot) => snapshot.id);
    } catch {
      // Resolution is a convenience; if the index cannot be read, let the
      // caller's own lookup produce the authoritative error.
      return partialId;
    }

    if (ids.includes(partialId)) {
      return partialId;
    }

    const match = bestSnapshotIdMatch(partialId, ids);
    if (match) {
      return match;
    }

    const ambiguous = ids.filter((id) => partialId && id.includes(partialId));
    if (ambiguous.length > 1) {
      throw new Error(
        `Ambiguous snapshot id "${partialId}": matches ${
          ambiguous.length
        } snapshots (${ambiguous.join(', ')}). Use a longer prefix.`,
      );
    }

    return partialId;
  }

  /**
   * Get a single snapshot
   */
  public async getSnapshot(snapshotId: string): Promise<Snapshot | null> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    return await this.snapshotManager.getSnapshot(
      await this.resolveSnapshotId(snapshotId),
    );
  }

  /**
   * A snapshot whose capture really was narrowed to a file list.
   *
   * `isSelective` alone is not enough: a rule-based producer emits
   * `isSelective: true` with an EMPTY selection when its rule matched nothing,
   * and that capture ran over the whole tree, so its `{deleted:true}` markers
   * are real. The citation is the extension's capture side, not its restore:
   * `takeSnapshotInternal` normalises the selection and then asks for a
   * non-empty one, which is this predicate plus `normalizeSelectedFiles`. The
   * restore/apply predicates test the RAW stored array's length instead, so an
   * all-junk legacy record (`['']`) would pass there -- and it is not a
   * selection either.
   */
  private capturedFileList(snapshot: Snapshot | null): string[] | null {
    if (snapshot?.isSelective !== true) {
      return null;
    }

    // Core's restore reads `options.selectedFiles || Object.keys(files)`, so an
    // all-junk list is truthy, every lookup in it misses, and the restore writes
    // nothing while reporting success: the restriction must be dropped, not
    // passed through.
    const selectedFiles = normalizeSelectedFiles(snapshot.selectedFiles);
    return selectedFiles.length > 0 ? selectedFiles : null;
  }

  /**
   * Restore a snapshot
   */
  public async restoreSnapshot(
    snapshotId: string,
    options?: {
      backup?: boolean;
      selectedFiles?: string[];
    },
  ): Promise<void> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    const resolvedId = await this.resolveSnapshotId(snapshotId);
    const capturedFiles = this.capturedFileList(
      await this.snapshotManager.getSnapshot(resolvedId),
    );

    // Legacy selective snapshots record a `{deleted:true}` tombstone for every
    // file the selection did not include (the pre-guard deletion pass compared
    // the previous snapshot against a scan the selective filter had already
    // narrowed). Core's restore walks the whole `files` map when it is given no
    // list and unlinks every tombstoned path, so without this a standalone
    // restore deleted exactly the files the snapshot never captured.
    // Restricting the restore to the captured list is what keeps those files
    // alive.
    //
    // Only when the caller named no files of their own: an explicit selection is
    // a deliberate narrowing and is passed through untouched.
    const restoreOptions =
      capturedFiles && !Array.isArray(options?.selectedFiles)
        ? { ...options, selectedFiles: capturedFiles }
        : options;

    await this.snapshotManager.restoreSnapshot(resolvedId, restoreOptions);
  }

  /**
   * Delete a snapshot
   */
  public async deleteSnapshot(snapshotId: string): Promise<void> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    await this.snapshotManager.deleteSnapshot(
      await this.resolveSnapshotId(snapshotId),
    );
  }

  /**
   * Compare snapshots
   */
  public async compareSnapshots(snapshotId1: string, snapshotId2: string) {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    return await this.snapshotManager.compareSnapshots(
      await this.resolveSnapshotId(snapshotId1),
      await this.resolveSnapshotId(snapshotId2),
    );
  }

  /**
   * Update snapshot metadata
   */
  public async updateSnapshotMetadata(
    snapshotId: string,
    updates: {
      description?: string;
      tags?: string[];
      notes?: string;
      taskReference?: string;
      isFavorite?: boolean;
    },
  ): Promise<void> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    await this.snapshotManager.updateSnapshotMetadata(snapshotId, updates);
  }

  /**
   * Get file content from snapshot
   */
  public async getSnapshotFileContent(
    snapshotId: string,
    filePath: string,
  ): Promise<string | null> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    return await this.snapshotManager.getSnapshotFileContent(
      await this.resolveSnapshotId(snapshotId),
      filePath,
    );
  }

  /**
   * Get storage statistics
   */
  public async getStorageStats() {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    return await this.snapshotManager.getStorageStats();
  }

  /**
   * Get configuration value
   * @param key - Dot-separated key path, or undefined to get full config
   */
  public getConfig(key?: string): unknown {
    if (!this.configManager) {
      throw new Error('Handler not initialized');
    }

    // Return full config if no key provided
    if (!key) {
      return this.configManager.getConfig();
    }

    return this.configManager.getNested(key);
  }

  /**
   * Set configuration value
   */
  public async setConfig(key: string, value: unknown): Promise<void> {
    if (!this.configManager) {
      throw new Error('Handler not initialized');
    }

    await this.configManager.setNested(key, value);
  }

  /**
   * Get full configuration
   */
  public getFullConfig() {
    if (!this.configManager) {
      throw new Error('Handler not initialized');
    }

    return this.configManager.getConfig();
  }

  public getConfigSchema() {
    if (!this.configManager) {
      throw new Error('Handler not initialized');
    }
    return this.configManager.getConfigSchema();
  }

  public getAvailableConfigKeyPaths(): string[] {
    if (!this.configManager) {
      throw new Error('Handler not initialized');
    }
    return this.configManager.getAvailableKeyPaths();
  }

  public isValidConfigKeyPath(keyPath: string): boolean {
    if (!this.configManager) {
      throw new Error('Handler not initialized');
    }
    return this.configManager.isValidKeyPath(keyPath);
  }

  /**
   * Export configuration
   */
  public exportConfig(): string {
    if (!this.configManager) {
      throw new Error('Handler not initialized');
    }

    return this.configManager.exportConfig();
  }

  /**
   * Import configuration
   */
  public async importConfig(json: string): Promise<void> {
    if (!this.configManager) {
      throw new Error('Handler not initialized');
    }

    await this.configManager.importConfig(json);
  }

  /**
   * Validate configuration
   */
  public validateConfig() {
    if (!this.configManager) {
      throw new Error('Handler not initialized');
    }

    return this.configManager.validate();
  }

  /**
   * Reset configuration to defaults
   * @param key - Optional specific key to reset, or undefined to reset all
   */
  public async resetConfig(key?: string): Promise<void> {
    if (!this.configManager) {
      throw new Error('Handler not initialized');
    }

    if (key) {
      await this.configManager.resetNested(key);
    } else {
      await this.configManager.reset();
    }
  }

  /**
   * Reload snapshots from disk
   */
  public async reload(): Promise<void> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    await this.snapshotManager.reload();
  }

  /**
   * Get snapshot changes (files that changed)
   */
  public async getSnapshotChanges(
    snapshotId: string,
  ): Promise<Record<string, unknown>> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    const resolvedId = await this.resolveSnapshotId(snapshotId);
    const snapshot = await this.snapshotManager.getSnapshot(resolvedId);
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    const changes = {
      added: [] as string[],
      modified: [] as string[],
      deleted: [] as string[],
    };

    for (const [filePath, fileData] of Object.entries(snapshot.files)) {
      if (fileData.deleted) {
        changes.deleted.push(filePath);
      } else if (fileData.diff) {
        changes.modified.push(filePath);
      } else if (!fileData.baseSnapshotId) {
        changes.added.push(filePath);
      }
    }

    return changes;
  }

  /**
   * Navigate snapshots (get next/previous)
   */
  public async navigateSnapshot(
    direction: 'next' | 'previous',
  ): Promise<Snapshot> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    const snapshots = await this.snapshotManager.getSnapshots();
    if (snapshots.length === 0) {
      throw new Error('No snapshots available');
    }

    let target: Snapshot;
    // For standalone, just return the newest (for 'next') or second-newest (for 'previous')
    if (direction === 'next') {
      target = snapshots[snapshots.length - 1];
    } else {
      if (snapshots.length < 2) {
        throw new Error('No previous snapshot available');
      }
      target = snapshots[snapshots.length - 2];
    }

    // Record the position. Navigation that returns a snapshot while leaving
    // `status` reporting "Current snapshot: None" made the two commands
    // disagree about where the store is positioned.
    await this.snapshotManager.setCurrentSnapshot(target.id);

    return target;
  }

  /**
   * The snapshot the store is currently positioned at, if any.
   */
  public getCurrentSnapshot(): Snapshot | null {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    return this.snapshotManager.getCurrentSnapshot();
  }

  // ── Git write operations ───────────────────────────────────────────

  private ensureGit(): GitIntegration {
    if (!this.gitIntegration) {
      throw new Error('Handler not initialized');
    }
    if (!this.gitIntegration.isGitRepository()) {
      throw new Error('Not a Git repository');
    }
    // Every GitIntegration getter returns undefined on a failed invocation, so
    // without this check the CLI printed `Commit hash: undefined` and exited 0
    // when git could not be run at all (BUG-9).
    if (!this.gitIntegration.isGitAvailable()) {
      throw new Error(
        'git is not available: the git executable could not be run. Is Git installed and on PATH?',
      );
    }
    return this.gitIntegration;
  }

  /**
   * Get comprehensive git branch info
   */
  public getGitBranchInfo(): GitBranchInfo {
    return this.ensureGit().getBranchInfo();
  }

  /**
   * Create a git commit from a snapshot
   */
  public async createGitCommitFromSnapshot(options: {
    snapshotId: string;
    commitMessage?: string;
    createBranch?: string;
    /**
     * Stage files git currently reports as untracked as well. Defaults to
     * false, matching the extension.
     */
    includeUntracked?: boolean;
  }): Promise<GitCommitResult> {
    if (!this.snapshotManager || !this.workspaceRoot) {
      throw new Error('Handler not initialized');
    }
    const git = this.ensureGit();

    const snapshot = await this.snapshotManager.getSnapshot(options.snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${options.snapshotId} not found`);
    }

    // Refuse to write over uncommitted work. The write below is unconditional,
    // so a dirty tree means the user's own edits are the thing being destroyed.
    if (git.hasUncommittedChanges()) {
      throw new Error(
        'Refusing to write the snapshot over a dirty working tree: commit or stash your changes first (`git status` lists them).',
      );
    }

    // Optionally create and switch to a new branch first
    if (options.createBranch) {
      git.createBranch(options.createBranch, true);
    }

    const written: string[] = [];
    const removed: string[] = [];

    // Write snapshot files to the working directory
    for (const [relativePath, fileData] of Object.entries(snapshot.files)) {
      const fullPath = ensureWithinDirectory(this.workspaceRoot, relativePath);
      assertNoSymlinkPath(this.workspaceRoot, fullPath);

      if (fileData.deleted) {
        // The snapshot records the file as gone at that point, so the commit
        // must record the removal too. Leaving it on disk is what made "commit
        // this snapshot" disagree with the snapshot it names.
        if (fs.existsSync(fullPath)) {
          fs.rmSync(fullPath, { force: true });
          removed.push(relativePath);
        }
        continue;
      }

      const content =
        fileData.content ??
        (await this.snapshotManager.getSnapshotFileContent(
          options.snapshotId,
          relativePath,
        ));

      if (content === null || content === undefined) {
        continue;
      }

      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(fullPath, content, 'utf8');
      written.push(relativePath);
    }

    // Stage exactly what the snapshot contains. `git add -A` also staged the
    // untracked clutter the working tree happened to carry, so the commit was
    // never a representation of the snapshot. Untracked paths are excluded
    // unless the caller asked for them, matching the extension's
    // `resolveSnapshotPaths`.
    const untracked =
      options.includeUntracked === true ? null : new Set(git.getUntrackedFiles());
    const pathsToStage = [...written, ...removed].filter(
      (relativePath) => untracked === null || !untracked.has(relativePath),
    );
    if (pathsToStage.length > 0) {
      git.stageFiles(pathsToStage);
    }

    // Create commit
    const message =
      options.commitMessage ||
      `Snapshot ${options.snapshotId}: ${
        snapshot.description || 'No description'
      }`;

    return git.createCommit(message);
  }

  /**
   * List branches
   */
  public listBranches(): string[] {
    return this.ensureGit().listBranches();
  }

  /**
   * Create a branch
   */
  public createBranch(name: string, checkout?: boolean): void {
    this.ensureGit().createBranch(name, checkout);
  }

  /**
   * Switch to a branch
   */
  public switchBranch(name: string): void {
    this.ensureGit().switchBranch(name);
  }

  /**
   * Delete a branch
   */
  public deleteBranch(name: string, force?: boolean): void {
    this.ensureGit().deleteBranch(name, force);
  }

  /**
   * Get file history across snapshots
   */
  public async getFileHistory(
    filePathOrOptions:
      | string
      | {
          filePath: string;
          limit?: number;
          since?: string;
          includeContent?: boolean;
          sortOrder?: string;
        },
  ): Promise<Record<string, unknown>> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    // Handle both string and options parameter
    const options =
      typeof filePathOrOptions === 'string'
        ? { filePath: filePathOrOptions }
        : filePathOrOptions;

    const snapshots = await this.snapshotManager.getSnapshots();
    const history: any[] = [];

    // Filter by date if since is provided
    let filteredSnapshots = snapshots;
    if (options.since) {
      const sinceDate = new Date(options.since);
      filteredSnapshots = snapshots.filter(
        (s) => new Date(s.timestamp) >= sinceDate,
      );
    }

    for (const snapshot of filteredSnapshots) {
      if (snapshot.files[options.filePath]) {
        const fileData = snapshot.files[options.filePath];

        const status = fileData.deleted
          ? 'deleted'
          : fileData.diff
          ? 'modified'
          : !fileData.baseSnapshotId
          ? 'added'
          : 'unchanged';

        const entry: any = {
          snapshot: {
            id: snapshot.id,
            timestamp: snapshot.timestamp,
            description: snapshot.description,
            tags: snapshot.tags,
          },
          file: {
            status,
            deleted: fileData.deleted || false,
            modified: !!fileData.diff,
            hasContent:
              fileData.content !== undefined ||
              fileData.baseSnapshotId !== undefined,
          },
        };

        // Add line counts if available
        if (fileData.diff) {
          const addedLines = (fileData.diff.match(/^\+/gm) || []).length;
          const removedLines = (fileData.diff.match(/^-/gm) || []).length;
          entry.file.linesAdded = addedLines;
          entry.file.linesRemoved = removedLines;
        }

        // Include content if requested
        if (options.includeContent && !fileData.deleted) {
          const content = await this.snapshotManager.getSnapshotFileContent(
            snapshot.id,
            options.filePath,
          );
          entry.content = content;
        }

        history.push(entry);
      }
    }

    // Sort by timestamp
    const sortOrder = options.sortOrder || 'desc';
    history.sort((a, b) => {
      const comparison =
        new Date(a.snapshot.timestamp).getTime() -
        new Date(b.snapshot.timestamp).getTime();
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    // Apply limit
    const limit = options.limit || history.length;
    const limitedHistory = history.slice(0, limit);

    return {
      history: limitedHistory,
      totalVersions: history.length,
    };
  }

  /**
   * List files in a snapshot
   */
  public async listSnapshotFiles(options: {
    snapshotId: string;
    changedOnly?: boolean;
    includeContent?: boolean;
    pattern?: string;
    sortBy?: string;
    sortOrder?: string;
  }): Promise<Record<string, unknown>> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    // Short ids (`snapshot-1789120661991` instead of the full id) resolve here
    // too, so every entry point accepts them consistently.
    options.snapshotId = await this.resolveSnapshotId(options.snapshotId);

    const snapshot = await this.snapshotManager.getSnapshot(options.snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${options.snapshotId} not found`);
    }

    const files: Record<string, unknown>[] = [];
    let changedCount = 0;

    for (const [filePath, fileData] of Object.entries(snapshot.files)) {
      // Apply pattern filter if provided
      if (options.pattern && !filePath.includes(options.pattern)) {
        continue;
      }

      const isChanged = fileData.deleted || !!fileData.diff;
      if (options.changedOnly && !isChanged) {
        continue;
      }

      if (isChanged) {
        changedCount++;
      }

      const status = fileData.deleted
        ? 'deleted'
        : fileData.diff
        ? 'modified'
        : !fileData.baseSnapshotId
        ? 'added'
        : 'unchanged';

      // Calculate size from content if available
      let size = 0;
      if (fileData.content) {
        size = Buffer.byteLength(fileData.content, 'utf8');
      }

      const fileInfo: Record<string, unknown> = {
        path: filePath,
        size,
        modified: snapshot.timestamp,
        status,
      };

      // Add line counts if available
      if (fileData.diff) {
        const addedLines = (fileData.diff.match(/^\+/gm) || []).length;
        const removedLines = (fileData.diff.match(/^-/gm) || []).length;
        fileInfo.linesAdded = addedLines;
        fileInfo.linesRemoved = removedLines;
      }

      if (options.includeContent && !fileData.deleted) {
        const content = await this.snapshotManager.getSnapshotFileContent(
          options.snapshotId,
          filePath,
        );
        fileInfo.content = content;
      }

      files.push(fileInfo);
    }

    // Sort files
    const sortBy = options.sortBy || 'path';
    const sortOrder = options.sortOrder || 'asc';
    files.sort((a: any, b: any) => {
      let comparison = 0;
      if (sortBy === 'size') {
        comparison = a.size - b.size;
      } else if (sortBy === 'modified') {
        comparison =
          new Date(a.modified).getTime() - new Date(b.modified).getTime();
      } else {
        comparison = a.path.localeCompare(b.path);
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    return {
      files,
      totalFiles: Object.keys(snapshot.files).length,
      changedFiles: changedCount,
    };
  }

  /**
   * Get a single file from a snapshot
   */
  public async getSnapshotFile(options: {
    snapshotId: string;
    filePath: string;
    includeContent?: boolean;
    includeMetadata?: boolean;
  }): Promise<Record<string, unknown>> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    options.snapshotId = await this.resolveSnapshotId(options.snapshotId);

    const snapshot = await this.snapshotManager.getSnapshot(options.snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${options.snapshotId} not found`);
    }

    const fileData = snapshot.files[options.filePath];
    if (!fileData) {
      throw new Error(`File ${options.filePath} not found in snapshot`);
    }

    const status = fileData.deleted
      ? 'deleted'
      : fileData.diff
      ? 'modified'
      : !fileData.baseSnapshotId
      ? 'added'
      : 'unchanged';

    // Calculate size from content if available
    let size = 0;
    if (fileData.content) {
      size = Buffer.byteLength(fileData.content, 'utf8');
    } else if (!fileData.deleted) {
      // Get content to calculate size
      const content = await this.snapshotManager.getSnapshotFileContent(
        options.snapshotId,
        options.filePath,
      );
      if (content) {
        size = Buffer.byteLength(content, 'utf8');
      }
    }

    const file = {
      path: options.filePath,
      size,
      modified: snapshot.timestamp,
      status,
    };

    let content = '';
    if (options.includeContent !== false && !fileData.deleted) {
      content =
        (await this.snapshotManager.getSnapshotFileContent(
          options.snapshotId,
          options.filePath,
        )) || '';
    }

    return {
      file,
      content,
    };
  }

  /**
   * Compare a file between two snapshots
   */
  public async compareSnapshotFile(options: {
    snapshotId1: string;
    snapshotId2: string;
    filePath: string;
    contextLines?: number;
    ignoreWhitespace?: boolean;
  }): Promise<Record<string, unknown>> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    options.snapshotId1 = await this.resolveSnapshotId(options.snapshotId1);
    options.snapshotId2 = await this.resolveSnapshotId(options.snapshotId2);

    const content1 = await this.snapshotManager.getSnapshotFileContent(
      options.snapshotId1,
      options.filePath,
    );
    const content2 = await this.snapshotManager.getSnapshotFileContent(
      options.snapshotId2,
      options.filePath,
    );

    if (content1 === content2) {
      return {
        differences: [],
        summary: {
          linesAdded: 0,
          linesRemoved: 0,
          linesUnchanged: content1?.split('\n').length || 0,
        },
      };
    }

    // Simple line-by-line diff
    const lines1 = (content1 || '').split('\n');
    const lines2 = (content2 || '').split('\n');
    const differences: Record<string, unknown>[] = [];
    let linesAdded = 0;
    let linesRemoved = 0;
    let linesUnchanged = 0;

    let i = 0;
    let j = 0;

    while (i < lines1.length || j < lines2.length) {
      if (i >= lines1.length) {
        // Rest are additions
        differences.push({ type: 'insert', content: lines2[j] });
        linesAdded++;
        j++;
      } else if (j >= lines2.length) {
        // Rest are deletions
        differences.push({ type: 'delete', content: lines1[i] });
        linesRemoved++;
        i++;
      } else if (lines1[i] === lines2[j]) {
        // Same line
        differences.push({ type: 'context', content: lines1[i] });
        linesUnchanged++;
        i++;
        j++;
      } else {
        // Different lines - simple approach: treat as delete+insert
        differences.push({ type: 'delete', content: lines1[i] });
        differences.push({ type: 'insert', content: lines2[j] });
        linesRemoved++;
        linesAdded++;
        i++;
        j++;
      }
    }

    return {
      differences,
      summary: {
        linesAdded,
        linesRemoved,
        linesUnchanged,
      },
    };
  }

  /**
   * Restore a single file from a snapshot
   */
  public async restoreSnapshotFile(options: {
    snapshotId: string;
    filePath: string;
    targetPath?: string;
    createBackup?: boolean;
  }): Promise<Record<string, unknown>> {
    if (!this.snapshotManager || !this.workspaceRoot) {
      throw new Error('Handler not initialized');
    }

    const fs = await import('fs');
    const path = await import('path');

    options.snapshotId = await this.resolveSnapshotId(options.snapshotId);

    const content = await this.snapshotManager.getSnapshotFileContent(
      options.snapshotId,
      options.filePath,
    );

    if (content === null) {
      throw new Error(`File ${options.filePath} not found in snapshot`);
    }

    assertBufferSizeWithinLimit(
      content,
      `restoreSnapshotFile:${options.filePath}`,
      MAX_FILE_SIZE_BYTES,
    );
    const targetPath = options.targetPath || options.filePath;
    const fullTargetPath = ensureWithinDirectory(
      this.workspaceRoot,
      targetPath,
    );
    assertNoSymlinkPath(this.workspaceRoot, fullTargetPath);

    let backupPath: string | undefined;

    // Create backup if requested and file exists
    if (options.createBackup && fs.existsSync(fullTargetPath)) {
      const targetStats = await fs.promises.lstat(fullTargetPath);
      if (targetStats.isSymbolicLink()) {
        throw new Error(`Refusing to backup symlink target: ${fullTargetPath}`);
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupPath = `${fullTargetPath}.backup-${timestamp}`;
      await fs.promises.copyFile(fullTargetPath, backupPath);
    }

    // Ensure directory exists
    const dir = path.dirname(fullTargetPath);
    assertNoSymlinkPath(this.workspaceRoot, dir);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    // Write the file
    await assertSufficientDiskSpace(fullTargetPath);
    await fs.promises.writeFile(fullTargetPath, content, 'utf8');

    return {
      backupPath,
    };
  }

  /**
   * Export a file from a snapshot
   */
  public async exportSnapshotFile(options: {
    snapshotId: string;
    filePath: string;
    outputPath: string;
    format?: string;
    includeMetadata?: boolean;
  }): Promise<Record<string, unknown>> {
    if (!this.snapshotManager || !this.workspaceRoot) {
      throw new Error('Handler not initialized');
    }

    const fs = await import('fs');
    const path = await import('path');

    options.snapshotId = await this.resolveSnapshotId(options.snapshotId);

    const content = await this.snapshotManager.getSnapshotFileContent(
      options.snapshotId,
      options.filePath,
    );

    if (content === null) {
      throw new Error(`File ${options.filePath} not found in snapshot`);
    }

    const outputPath = ensureWithinDirectory(
      this.workspaceRoot,
      toWorkspaceRelativeOutputPath(this.workspaceRoot, options.outputPath),
    );
    assertNoSymlinkPath(this.workspaceRoot, outputPath);
    assertBufferSizeWithinLimit(
      content,
      `exportSnapshotFile:${options.filePath}`,
      MAX_FILE_SIZE_BYTES,
    );

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    assertNoSymlinkPath(this.workspaceRoot, dir);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    if (options.format === 'json' && options.includeMetadata) {
      const snapshot = await this.snapshotManager.getSnapshot(
        options.snapshotId,
      );
      const fileData = snapshot?.files[options.filePath];

      // Calculate size from content
      const size = Buffer.byteLength(content, 'utf8');

      const exportData = {
        snapshotId: options.snapshotId,
        filePath: options.filePath,
        content,
        metadata: {
          size,
          timestamp: snapshot?.timestamp,
          status: fileData?.deleted
            ? 'deleted'
            : fileData?.diff
            ? 'modified'
            : 'unchanged',
        },
      };

      const serialized = JSON.stringify(exportData, null, 2);
      assertBufferSizeWithinLimit(
        serialized,
        `exportSnapshotFile:${options.outputPath}`,
        MAX_FILE_SIZE_BYTES,
      );
      await assertSufficientDiskSpace(outputPath);
      await fs.promises.writeFile(outputPath, serialized, 'utf8');
    } else {
      // Export as original format
      await assertSufficientDiskSpace(outputPath);
      await fs.promises.writeFile(outputPath, content, 'utf8');
    }

    return {
      outputPath,
    };
  }
}

// Global instance
let standaloneHandlerInstance: StandaloneHandler | null = null;

/**
 * Get or create standalone handler instance
 */
export async function getStandaloneHandler(): Promise<StandaloneHandler> {
  if (!standaloneHandlerInstance) {
    standaloneHandlerInstance = new StandaloneHandler();
    const initialized = await standaloneHandlerInstance.initialize();

    if (!initialized) {
      throw new Error(
        'Failed to initialize standalone handler. Make sure you are in a valid workspace.',
      );
    }
  }

  return standaloneHandlerInstance;
}

/**
 * Check if standalone mode is available
 */
export function isStandaloneModeAvailable(): boolean {
  try {
    // Same walk as the handler's root search: a project marker anywhere up the
    // tree means standalone mode can serve this invocation.
    return findWorkspaceRootFrom(process.cwd()) !== null;
  } catch {
    return false;
  }
}
