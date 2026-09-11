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

    return await this.snapshotManager.getSnapshots(filter);
  }

  /**
   * Get a single snapshot
   */
  public async getSnapshot(snapshotId: string): Promise<Snapshot | null> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    return await this.snapshotManager.getSnapshot(snapshotId);
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

    await this.snapshotManager.restoreSnapshot(snapshotId, options);
  }

  /**
   * Delete a snapshot
   */
  public async deleteSnapshot(snapshotId: string): Promise<void> {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    await this.snapshotManager.deleteSnapshot(snapshotId);
  }

  /**
   * Compare snapshots
   */
  public async compareSnapshots(snapshotId1: string, snapshotId2: string) {
    if (!this.snapshotManager) {
      throw new Error('Handler not initialized');
    }

    return await this.snapshotManager.compareSnapshots(
      snapshotId1,
      snapshotId2,
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
      snapshotId,
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

    const snapshot = await this.snapshotManager.getSnapshot(snapshotId);
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

    // For standalone, just return the newest (for 'next') or second-newest (for 'previous')
    if (direction === 'next') {
      return snapshots[snapshots.length - 1];
    } else {
      if (snapshots.length < 2) {
        throw new Error('No previous snapshot available');
      }
      return snapshots[snapshots.length - 2];
    }
  }

  // ── Git write operations ───────────────────────────────────────────

  private ensureGit(): GitIntegration {
    if (!this.gitIntegration) {
      throw new Error('Handler not initialized');
    }
    if (!this.gitIntegration.isGitRepository()) {
      throw new Error('Not a Git repository');
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

    // Optionally create and switch to a new branch first
    if (options.createBranch) {
      git.createBranch(options.createBranch, true);
    }

    // Write snapshot files to the working directory
    for (const [relativePath, fileData] of Object.entries(snapshot.files)) {
      if (fileData.deleted) {
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

      const fullPath = ensureWithinDirectory(this.workspaceRoot, relativePath);
      assertNoSymlinkPath(this.workspaceRoot, fullPath);

      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(fullPath, content, 'utf8');
    }

    // Stage all changes
    git.stageAll();

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

    const content = await this.snapshotManager.getSnapshotFileContent(
      options.snapshotId,
      options.filePath,
    );

    if (content === null) {
      throw new Error(`File ${options.filePath} not found in snapshot`);
    }

    const outputPath = ensureWithinDirectory(
      this.workspaceRoot,
      options.outputPath,
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
