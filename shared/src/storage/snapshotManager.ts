import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  Snapshot,
  SnapshotOptions,
  RestoreOptions,
  SnapshotFilter,
  SnapshotComparison,
} from '../types/snapshot';
import { SnapshotStorage } from './snapshotStorage';
import { GitignoreParser } from '../utils/gitignoreParser';
import { GitIntegration } from '../git/gitIntegration';
import { createDiff } from '../utils/diffUtils';
import { ConfigManager } from '../config/configManager';
import {
  assertNoSymlinkPath,
  ensureWithinDirectory,
} from '../utils/pathSecurity';
import { MAX_FILE_SIZE_BYTES } from '../security/limits';
import { runWithConcurrencyLimit } from '../utils/asyncUtils';

/**
 * Core snapshot manager (standalone, no VS Code dependencies)
 * Provides all snapshot operations: create, restore, delete, compare, etc.
 */
export class SnapshotManager {
  private storage: SnapshotStorage;
  private config: ConfigManager;
  private git: GitIntegration;
  private workspaceRoot: string;
  private snapshots: Snapshot[] = [];
  private currentSnapshotIndex = -1;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.config = new ConfigManager(workspaceRoot);
    const snapshotLocation = this.config.get('snapshotLocation');
    this.storage = new SnapshotStorage(workspaceRoot, snapshotLocation);
    this.git = new GitIntegration(workspaceRoot);
  }

  /**
   * Initialize the snapshot manager (must be called before use)
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.loadSnapshots();
    await this.initPromise;
    this.initialized = true;
  }

  /**
   * Load existing snapshots
   */
  private async loadSnapshots(): Promise<void> {
    const loadedState = await this.storage.loadSnapshotIndexAndMetadata();

    if (loadedState) {
      this.snapshots = loadedState.snapshots;
      this.currentSnapshotIndex = loadedState.currentIndex;
    } else {
      this.snapshots = [];
      this.currentSnapshotIndex = -1;
    }
  }

  /**
   * Ensure manager is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previousLock = this.writeLock;
    let releaseLock: () => void = () => undefined;
    this.writeLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    await previousLock;
    try {
      return await operation();
    } finally {
      releaseLock();
    }
  }

  /**
   * Save snapshot index
   */
  private async saveSnapshotIndex(): Promise<void> {
    await this.storage.saveSnapshotIndex(
      this.snapshots,
      this.currentSnapshotIndex,
    );
  }

  /**
   * Get all files in workspace (respecting gitignore)
   */
  private async getAllFiles(selectedFiles?: string[]): Promise<string[]> {
    const snapshotLocation = this.config.get('snapshotLocation');
    const parser = new GitignoreParser(this.workspaceRoot, snapshotLocation);

    if (selectedFiles && selectedFiles.length > 0) {
      // Return only selected files (validate paths to prevent traversal)
      const validFiles: string[] = [];
      await runWithConcurrencyLimit(selectedFiles, 50, async (file) => {
        try {
          const fullPath = ensureWithinDirectory(this.workspaceRoot, file);
          assertNoSymlinkPath(this.workspaceRoot, fullPath);
          if (!fs.existsSync(fullPath) || parser.shouldIgnore(file)) {
            return;
          }
          const stats = await fs.promises.lstat(fullPath);
          if (stats.isFile() && !stats.isSymbolicLink()) {
            validFiles.push(file);
          }
        } catch {
          // ignore
        }
      });
      return validFiles;
    }

    const files: string[] = [];

    // Note: since walk needs to recursively hit directories, we'll keep
    // a small asynchronous recursion but limit total parallelism using standard async logic.
    const walkDir = async (dir: string) => {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        await Promise.all(
          entries.map(async (entry) => {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(this.workspaceRoot, fullPath);

            if (parser.shouldIgnore(relativePath) || entry.isSymbolicLink()) {
              return;
            }

            if (entry.isDirectory()) {
              await walkDir(fullPath);
            } else if (entry.isFile()) {
              files.push(relativePath);
            }
          })
        );
      } catch (error) {
        console.error('Error walking directory:', error);
      }
    };

    await walkDir(this.workspaceRoot);
    return files;
  }

  /**
   * Check if a file is binary
   */
  private isBinaryFile(filePath: string): boolean {
    try {
      const stats = fs.lstatSync(filePath);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        return true;
      }

      const fd = fs.openSync(filePath, 'r');
      try {
        const chunkSize = 8000;
        const buffer = Buffer.alloc(chunkSize);
        const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, 0);

        for (let i = 0; i < bytesRead; i++) {
          if (buffer[i] === 0) {
            return true;
          }
        }

        return false;
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return false;
    }
  }

  /**
   * Take a snapshot
   */
  public async takeSnapshot(options: SnapshotOptions = {}): Promise<Snapshot> {
    await this.ensureInitialized();
    return await this.withWriteLock(() => this.takeSnapshotInternal(options));
  }

  private async takeSnapshotInternal(
    options: SnapshotOptions = {},
  ): Promise<Snapshot> {
    const timestamp = Date.now();
    const id = `snapshot-${timestamp}-${crypto.randomBytes(4).toString('hex')}`;

    // Get Git info if enabled
    const addGitInfo = this.config.getNested('git.addCommitInfo') ?? true;
    let gitInfo = null;
    if (addGitInfo && this.git.isGitRepository()) {
      gitInfo = this.git.getGitInfo();
    }

    // Get all files to snapshot
    const files = await this.getAllFiles(options.selectedFiles);

    // Create snapshot object
    const snapshot: Snapshot = {
      id,
      timestamp,
      description: options.description || `Snapshot at ${new Date(timestamp).toLocaleString()}`,
      gitBranch: gitInfo?.branch,
      gitCommitHash: gitInfo?.commitHash,
      tags: options.tags || [],
      notes: options.notes,
      taskReference: options.taskReference,
      isFavorite: options.isFavorite || false,
      isSelective: options.isSelective || false,
      selectedFiles: options.selectedFiles,
      files: {},
    };

    // Add files to snapshot
    await runWithConcurrencyLimit(files, 50, async (relativePath) => {
      const fullPath = ensureWithinDirectory(this.workspaceRoot, relativePath);

      try {
        assertNoSymlinkPath(this.workspaceRoot, fullPath);
        const stats = await fs.promises.lstat(fullPath);
        if (!stats.isFile() || stats.isSymbolicLink()) {
          return;
        }
        if (stats.size > MAX_FILE_SIZE_BYTES) {
          console.warn(
            `Skipping file ${relativePath}: ${stats.size} bytes exceeds ${MAX_FILE_SIZE_BYTES} byte limit`,
          );
          return;
        }

        // Check if binary
        if (this.isBinaryFile(fullPath)) {
          snapshot.files[relativePath] = {
            content: null,
            isBinary: true,
          };
          return;
        }

        // Read file content
        const content = await fs.promises.readFile(fullPath, 'utf8');

        // Find base snapshot for diff
        let baseSnapshotId: string | undefined;
        let diff: string | undefined;

        if (this.snapshots.length > 0) {
          const baseSnapshot = this.snapshots[this.snapshots.length - 1];
          const baseContent = await this.storage.getSnapshotFileContent(
            baseSnapshot.id,
            relativePath,
          );

          if (baseContent !== null) {
            baseSnapshotId = baseSnapshot.id;
            diff = createDiff(relativePath, baseContent, content);

            if (diff) {
              // Store as diff
              snapshot.files[relativePath] = {
                diff,
                baseSnapshotId,
              };
            } else {
              // No changes, store reference only
              snapshot.files[relativePath] = {
                baseSnapshotId,
              };
            }
          } else {
            // New file, store full content
            snapshot.files[relativePath] = {
              content,
            };
          }
        } else {
          // First snapshot, store full content
          snapshot.files[relativePath] = {
            content,
          };
        }
      } catch (error) {
        console.error(`Error reading file ${relativePath}:`, error);
      }
    });

    // Track deletions - files that existed in previous snapshot but not in current
    if (this.snapshots.length > 0) {
      const baseSnapshot = this.snapshots[this.snapshots.length - 1];
      const currentFiles = new Set(files);

      for (const previousFile of Object.keys(baseSnapshot.files)) {
        if (!currentFiles.has(previousFile) && !baseSnapshot.files[previousFile].deleted) {
          // File was deleted
          snapshot.files[previousFile] = {
            deleted: true,
            baseSnapshotId: baseSnapshot.id,
          };
        }
      }
    }

    // Save snapshot
    await this.storage.saveSnapshot(snapshot);
    this.snapshots.push(snapshot);
    this.currentSnapshotIndex = this.snapshots.length - 1;
    await this.saveSnapshotIndex();

    // Cleanup old snapshots if needed
    const maxSnapshots = this.config.get('maxSnapshots');
    if (this.snapshots.length > maxSnapshots) {
      const toDelete = this.snapshots.length - maxSnapshots;
      for (let i = 0; i < toDelete; i++) {
        const oldSnapshot = this.snapshots.shift()!;
        await this.storage.deleteSnapshot(oldSnapshot.id);
      }
      this.currentSnapshotIndex -= toDelete;
      await this.saveSnapshotIndex();
    }

    return snapshot;
  }

  /**
   * Restore a snapshot
   */
  public async restoreSnapshot(
    snapshotId: string,
    options: RestoreOptions = {},
  ): Promise<void> {
    await this.ensureInitialized();
    await this.withWriteLock(async () => {
      const snapshot = await this.storage.loadSnapshot(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot ${snapshotId} not found`);
      }

      // Create backup if requested
      if (options.backup !== false) {
        await this.takeSnapshotInternal({
          description: `Backup before restoring ${snapshotId}`,
          tags: ['backup'],
        });
      }

      // Get files to restore
      const filesToRestore = options.selectedFiles || Object.keys(snapshot.files);

      // Restore each file
      await runWithConcurrencyLimit(filesToRestore, 50, async (relativePath) => {
        const fileData = snapshot.files[relativePath];
        if (!fileData) {
          return;
        }

        const fullPath = ensureWithinDirectory(this.workspaceRoot, relativePath);
        assertNoSymlinkPath(this.workspaceRoot, fullPath);

        // Handle deleted files
        if (fileData.deleted) {
          try {
            const stats = await fs.promises.lstat(fullPath);
            if (stats.isSymbolicLink()) {
              throw new Error(`Refusing to delete symlink during restore: ${fullPath}`);
            }
            await fs.promises.unlink(fullPath);
          } catch {
            // ignore if file doesn't exist
          }
          return;
        }

        // Handle binary files
        if (fileData.isBinary) {
          console.warn(`Skipping binary file: ${relativePath}`);
          return;
        }

        // Get file content
        const content = await this.storage.getSnapshotFileContent(
          snapshotId,
          relativePath,
        );

        if (content !== null) {
          // Ensure directory exists
          const dir = path.dirname(fullPath);
          assertNoSymlinkPath(this.workspaceRoot, dir);
          if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
          }

          // Write file
          await fs.promises.writeFile(fullPath, content, 'utf8');
        }
      });
    });
  }

  /**
   * Delete a snapshot
   */
  public async deleteSnapshot(snapshotId: string): Promise<void> {
    await this.ensureInitialized();
    await this.withWriteLock(async () => {
      await this.storage.deleteSnapshot(snapshotId);
      this.snapshots = this.snapshots.filter((s) => s.id !== snapshotId);
      await this.saveSnapshotIndex();
    });
  }

  /**
   * Get all snapshots
   */
  public async getSnapshots(filter?: SnapshotFilter): Promise<Snapshot[]> {
    await this.ensureInitialized();

    let filtered = [...this.snapshots];

    if (filter) {
      if (filter.tag) {
        filtered = filtered.filter(
          (s) => s.tags && s.tags.includes(filter.tag!),
        );
      }

      if (filter.favorite !== undefined) {
        filtered = filtered.filter((s) => s.isFavorite === filter.favorite);
      }

      if (filter.startDate) {
        filtered = filtered.filter((s) => s.timestamp >= filter.startDate!);
      }

      if (filter.endDate) {
        filtered = filtered.filter((s) => s.timestamp <= filter.endDate!);
      }

      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        filtered = filtered.filter(
          (s) =>
            s.description.toLowerCase().includes(searchLower) ||
            (s.notes && s.notes.toLowerCase().includes(searchLower)) ||
            (s.tags && s.tags.some((t) => t.toLowerCase().includes(searchLower))),
        );
      }

      if (filter.filePath) {
        filtered = filtered.filter((s) => filter.filePath! in s.files);
      }
    }

    return filtered;
  }

  /**
   * Get a single snapshot
   */
  public async getSnapshot(snapshotId: string): Promise<Snapshot | null> {
    return await this.storage.loadSnapshot(snapshotId);
  }

  /**
   * Compare two snapshots
   */
  public async compareSnapshots(
    snapshotId1: string,
    snapshotId2: string,
  ): Promise<SnapshotComparison> {
    const snapshot1 = await this.storage.loadSnapshot(snapshotId1);
    const snapshot2 = await this.storage.loadSnapshot(snapshotId2);

    if (!snapshot1 || !snapshot2) {
      throw new Error('One or both snapshots not found');
    }

    const files1 = new Set(Object.keys(snapshot1.files));
    const files2 = new Set(Object.keys(snapshot2.files));

    const addedFiles: string[] = [];
    const deletedFiles: string[] = [];
    const modifiedFiles: string[] = [];
    const diffs: { [filePath: string]: string } = {};

    // Find added and modified files
    await runWithConcurrencyLimit(Array.from(files2), 50, async (file) => {
      if (!files1.has(file)) {
        addedFiles.push(file);
      } else {
        const content1 = await this.storage.getSnapshotFileContent(
          snapshotId1,
          file,
        );
        const content2 = await this.storage.getSnapshotFileContent(
          snapshotId2,
          file,
        );

        if (content1 !== content2) {
          modifiedFiles.push(file);
          if (content1 && content2) {
            diffs[file] = createDiff(file, content1, content2);
          }
        }
      }
    });

    // Find deleted files
    for (const file of files1) {
      if (!files2.has(file)) {
        deletedFiles.push(file);
      }
    }

    return {
      snapshot1,
      snapshot2,
      addedFiles,
      deletedFiles,
      modifiedFiles,
      diffs,
    };
  }

  /**
   * Update snapshot metadata
   */
  public async updateSnapshotMetadata(
    snapshotId: string,
    updates: Partial<
      Pick<Snapshot, 'description' | 'tags' | 'notes' | 'taskReference' | 'isFavorite'>
    >,
  ): Promise<void> {
    await this.withWriteLock(async () => {
      await this.storage.updateSnapshotMetadata(snapshotId, updates);

      // Update in-memory snapshot
      const snapshot = this.snapshots.find((s) => s.id === snapshotId);
      if (snapshot) {
        Object.assign(snapshot, updates);
      }
    });
  }

  /**
   * Get file content from a snapshot
   */
  public async getSnapshotFileContent(
    snapshotId: string,
    filePath: string,
  ): Promise<string | null> {
    return await this.storage.getSnapshotFileContent(snapshotId, filePath);
  }

  /**
   * Get storage statistics
   */
  public async getStorageStats() {
    return await this.storage.getStorageStats();
  }

  /**
   * Reload snapshots from disk
   */
  public async reload(): Promise<void> {
    await this.loadSnapshots();
  }
}
