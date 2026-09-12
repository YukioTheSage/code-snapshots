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
import {
  selectSizePruneCandidates,
  type SnapshotSizePruneResult,
} from './snapshotStoreSize';
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

    this.initPromise = (async () => {
      await this.loadSnapshots();
      // A store can already be over the configured size when a session opens,
      // and nothing else revisits it until the next take. The lock is free
      // here: initialize is the outermost call.
      //
      // Retention is best effort: the storage layer rethrows every deletion
      // failure except "not found" -- a file lock on Windows or a symlink it
      // refuses to follow is enough. `initPromise` is assigned once, so a
      // rejection here would be re-thrown by every later call and poison the
      // manager for the whole session. The load above stays fatal on purpose;
      // only the trim is guarded.
      try {
        await this.withWriteLock(() => this.enforceSnapshotSizeLimitInternal());
      } catch (error) {
        console.warn(
          'Retention: the store could not be trimmed when it was opened: ' +
            (error instanceof Error ? error.message : String(error)) +
            '. The session continues with the store as it is.',
        );
      }
    })();
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
   * The snapshot the store is currently positioned at, if any.
   *
   * The index already persisted `currentIndex`, but nothing exposed it: the
   * CLI hardcoded `currentSnapshot: null` in its status payload, so navigating
   * and then asking for status disagreed with each other.
   */
  public getCurrentSnapshot(): Snapshot | null {
    if (
      this.currentSnapshotIndex < 0 ||
      this.currentSnapshotIndex >= this.snapshots.length
    ) {
      return null;
    }
    return this.snapshots[this.currentSnapshotIndex];
  }

  /**
   * Move the current-snapshot pointer and persist it.
   */
  public async setCurrentSnapshot(snapshotId: string): Promise<void> {
    await this.ensureInitialized();

    const index = this.snapshots.findIndex(
      (snapshot) => snapshot.id === snapshotId,
    );
    if (index === -1) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    await this.withWriteLock(async () => {
      this.currentSnapshotIndex = index;
      await this.saveSnapshotIndex();
    });
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
    //
    // A selective capture with a NON-EMPTY selection photographs only the files
    // it was given: the scan above is narrowed to that list, so every other file
    // of the previous snapshot looks "gone" from here. That is a lie about the
    // workspace, and restore, `compareSnapshots` and `files diff` all act on it.
    // Only a whole-tree capture can report deletions. An empty selection is not
    // selective -- the filter does not apply, the scan is whole-tree, and its
    // markers are real -- which is why the predicate mirrors the one used by the
    // read-side restoration path instead of testing `options.isSelective` alone.
    const isSelectiveCapture =
      snapshot.isSelective === true &&
      Array.isArray(snapshot.selectedFiles) &&
      snapshot.selectedFiles.length > 0;

    if (this.snapshots.length > 0 && !isSelectiveCapture) {
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

    // Cleanup old snapshots if needed.
    //
    // Every snapshot stores unchanged files as a reference to its immediate
    // predecessor, so removing the oldest entry of a chain orphans the next
    // one. This block used to call `this.storage.deleteSnapshot` directly,
    // which deleted the directory and left those references dangling --
    // `getSnapshotFileContent` then answered null for a file the store still
    // indexes. It now runs the guard the explicit delete runs
    // (`materializeDependents`) through the lock-free entry point, and keeps
    // the excess when a survivor cannot be rebuilt.
    const maxSnapshots = this.config.get('maxSnapshots');
    const excess = this.snapshots.length - maxSnapshots;
    if (excess > 0) {
      // Selection follows the store's own order (oldest first by construction:
      // appended on take, loaded in index order) and never the wall clock. A
      // clock that steps backwards -- an NTP correction after a VM resume, a
      // WSL jump, a hand-set clock -- would otherwise sort the snapshot that
      // was just created to the front and trim it moments after its index entry
      // was written.
      const candidates = this.snapshots.slice(0, excess);
      const materialization = await this.materializeDependents(
        new Set(candidates.map((snapshot) => snapshot.id)),
      );

      if (!materialization.ok) {
        console.error(
          'Retention: keeping ' +
            this.snapshots.length +
            ' snapshots. The ' +
            excess +
            ' oldest cannot be removed without orphaning a survivor; nothing was deleted.',
        );
      } else {
        // Persist the rewrites before anything is deleted: a survivor whose
        // base is gone cannot be rebuilt afterwards.
        for (const survivor of materialization.touched) {
          await this.storage.saveSnapshot(survivor);
        }
        // Candidates reference each other down the chain, so one candidate
        // whose base is another candidate still looks like a dependent here.
        // They all leave in this batch: only a dependent outside it could be
        // orphaned, and the materialization above already rebuilt those.
        const alsoDeleting = new Set(candidates.map((snapshot) => snapshot.id));
        for (const candidate of candidates) {
          await this.deleteSnapshotInternal(candidate.id, { alsoDeleting });
        }
      }
    }

    // Then the byte limit: a store can be inside its snapshot count and still
    // hold more bytes than the user allowed. Best effort: the snapshot above is
    // already written and indexed, so a retention failure must not turn a
    // successful take into a failed one.
    try {
      await this.enforceSnapshotSizeLimitInternal(snapshot.id);
    } catch (error) {
      console.warn(
        'Retention: could not be trimmed after this snapshot: ' +
          (error instanceof Error ? error.message : String(error)) +
          '. The snapshot was taken; only the trim stopped.',
      );
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

      // A genuinely selective capture photographs the files it was given and
      // nothing else. The scan below is narrowed to that list, so the deletion
      // pass that follows it records a `{deleted:true}` tombstone for EVERY file
      // of the previous snapshot the selection did not include -- a lie about
      // the workspace, not a deletion. Restoring such a snapshot must not act on
      // those markers: the paths they name were never captured, so the workspace
      // copy is the only one left.
      //
      // The predicate mirrors the capture side and the extension's restore:
      // `isSelective` alone is not enough, because a rule-based producer emits
      // `isSelective: true` with an empty selection when its rule matched
      // nothing, and that capture ran over the whole tree -- its markers are
      // real.
      const isSelectiveCapture =
        snapshot.isSelective === true &&
        Array.isArray(snapshot.selectedFiles) &&
        snapshot.selectedFiles.length > 0;
      const capturedFiles = new Set(
        isSelectiveCapture ? snapshot.selectedFiles : [],
      );

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
          if (isSelectiveCapture && !capturedFiles.has(relativePath)) {
            // A tombstone for a file this capture never looked at: it has no
            // base dependency to repair and nothing was recorded about it, so
            // the workspace copy stays.
            return;
          }
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
   * The survivors that stored at least one delta against a removed snapshot.
   *
   * A tombstone is not a delta: it records that the file was gone at that point
   * and has no base to repair, so it is skipped exactly as in
   * `materializeDependents`.
   */
  private findDependents(removedIds: Set<string>): Snapshot[] {
    return this.snapshots.filter((snapshot) =>
      Object.values(snapshot.files).some(
        (fileData) =>
          !fileData.deleted &&
          fileData.baseSnapshotId !== undefined &&
          removedIds.has(fileData.baseSnapshotId),
      ),
    );
  }

  /**
   * Put the pre-rewrite file maps of `originals` back.
   *
   * Memory has to match disk whenever a materialization was not persisted: the
   * next enforcement pass reads the dependents out of these maps, and a
   * materialized copy still in memory would hide the base the store still needs
   * -- that pass would find no dependent, skip the save and delete the base.
   */
  private restoreOriginalFiles(
    originals: Map<string, Snapshot['files']>,
  ): void {
    for (const [id, files] of originals) {
      const target = this.snapshots.find((snapshot) => snapshot.id === id);
      if (target) {
        target.files = files;
      }
    }
  }

  /**
   * Rewrites the delta entries of survivors that point into `pruned` into full
   * content, resolving while the chain is still intact, so deleting those bases
   * loses nothing. Cancels on the first unresolvable entry: a partially
   * materialized list must not be persisted, so the originals are restored and
   * the caller persists nothing.
   *
   * `originals` maps every touched snapshot id to its pre-rewrite file map, so
   * a caller that cannot persist the rewrites can put memory back with
   * `restoreOriginalFiles`. On `ok: false` they have already been restored
   * here and there is nothing to persist.
   */
  private async materializeDependents(
    pruned: Set<string>,
  ): Promise<{
    ok: boolean;
    touched: Snapshot[];
    originals: Map<string, Snapshot['files']>;
  }> {
    const originals = new Map<string, Snapshot['files']>();
    const touched: Snapshot[] = [];

    for (const snapshot of this.snapshots) {
      if (pruned.has(snapshot.id)) {
        continue;
      }
      let dirty = false;
      for (const [relativePath, fileData] of Object.entries(snapshot.files)) {
        if (fileData.deleted) {
          continue;
        }
        if (!fileData.baseSnapshotId || !pruned.has(fileData.baseSnapshotId)) {
          continue;
        }
        const content = await this.storage.getSnapshotFileContent(
          snapshot.id,
          relativePath,
        );
        if (content === null) {
          this.restoreOriginalFiles(originals);
          console.error(
            `Delete: cannot materialize ${relativePath} of ${snapshot.id}: base ${fileData.baseSnapshotId} is unreadable or does not record it.`,
          );
          return { ok: false, touched: [], originals };
        }
        if (!originals.has(snapshot.id)) {
          // Shallow copy is enough: only the rewritten keys are replaced below.
          originals.set(snapshot.id, { ...snapshot.files });
        }
        snapshot.files[relativePath] = { content };
        dirty = true;
      }
      if (dirty) {
        touched.push(snapshot);
      }
    }
    return { ok: true, touched, originals };
  }

  /**
   * Delete a snapshot
   */
  public async deleteSnapshot(
    snapshotId: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    await this.ensureInitialized();
    await this.withWriteLock(() =>
      this.deleteSnapshotInternal(snapshotId, options),
    );
  }

  /**
   * `deleteSnapshot` without acquiring the write lock.
   *
   * The retention trim inside `takeSnapshotInternal` already holds it and
   * `withWriteLock` is not re-entrant, so the guarded body has to be
   * reachable from there. Every caller that does not already hold the lock goes
   * through `deleteSnapshot`.
   *
   * `alsoDeleting` names the snapshots the caller removes in the same batch. A
   * dependent among them is not an orphan -- it disappears too -- so it must
   * not make this delete refuse. Only a dependent outside the batch can be
   * left behind, and the batch materializes those before it gets here.
   */
  private async deleteSnapshotInternal(
    snapshotId: string,
    options: { force?: boolean; alsoDeleting?: ReadonlySet<string> } = {},
  ): Promise<void> {
    const removedIndex = this.snapshots.findIndex((s) => s.id === snapshotId);
    if (removedIndex === -1) {
      // Same message the storage layer raises, so callers that branch on it
      // keep working; raised here so an unknown id never touches disk.
      throw new Error('Snapshot ' + snapshotId + ' not found');
    }

    const removed = new Set([snapshotId]);
    const dependents = this.findDependents(removed).filter(
      (snapshot) => !options.alsoDeleting?.has(snapshot.id),
    );
    if (dependents.length > 0) {
      const materialization = await this.materializeDependents(removed);
      if (!materialization.ok) {
        if (!options.force) {
          throw new Error(
            'Snapshot ' +
              snapshotId +
              ' cannot be deleted: ' +
              dependents.length +
              ' later snapshot(s) store a delta against it and cannot be rebuilt. Nothing was deleted. Re-run with --force to delete it anyway and lose those files.',
          );
        }
        console.warn(
          'Delete: forcing removal of ' +
            snapshotId +
            '; ' +
            dependents.length +
            ' snapshot(s) keep an unresolvable base.',
        );
      } else {
        for (const survivor of materialization.touched) {
          await this.storage.saveSnapshot(survivor);
        }
      }
    }

    try {
      await this.storage.deleteSnapshot(snapshotId);
    } catch (error) {
      // The index entry is what `deleteSnapshot` treats as "this snapshot
      // exists"; a directory that is already gone is the state the delete was
      // asked for, not a reason to keep the entry forever. Real failures
      // (permissions, symlink refusals) still surface.
      if (!/not found/i.test(String(error))) {
        throw error;
      }
    }

    this.snapshots = this.snapshots.filter((s) => s.id !== snapshotId);

    // The pointer is a POSITION in `this.snapshots`, so removing an entry
    // shifts every index after it. Deleting the pointed-at snapshot detaches
    // the store instead of promoting a neighbour: the workspace reflected
    // that snapshot, and the next one is a different state, not a substitute
    // for it. Re-pointing is an explicit act -- see `setCurrentSnapshot`.
    if (removedIndex < this.currentSnapshotIndex) {
      this.currentSnapshotIndex -= 1;
    } else if (removedIndex === this.currentSnapshotIndex) {
      this.currentSnapshotIndex = -1;
    }

    await this.saveSnapshotIndex();
  }

  /**
   * Remove the oldest snapshots until the store fits maxSnapshotStoreBytes.
   *
   * Called with the write lock already held: from `takeSnapshotInternal` and
   * from `initialize`. The snapshot the store is positioned at is never a
   * candidate, and a candidate is only deleted after `materializeDependents`
   * has rewritten every surviving reference to it -- when that cannot be done
   * nothing is deleted and the excess is kept.
   *
   * `justCreatedSnapshotId` is the snapshot the caller has this moment written.
   * Its own trim must never delete it: it is dropped from the candidates by id
   * rather than by its position among them.
   *
   * Best effort, in two phases: a failure to persist the rebuilt survivors
   * aborts the trim, rolls the in-memory rewrites back and keeps the excess
   * (nothing may be deleted whose survivors were not written first); a failed
   * delete is reported and stops the batch, which is only safe because the
   * batch is removed newest-first -- a candidate's base is its predecessor, so
   * whatever survives a stop still has its base. `trimmed` lists only the
   * deletions that succeeded, in the order they were attempted. Both callers
   * guard this call as well.
   */
  private async enforceSnapshotSizeLimitInternal(
    justCreatedSnapshotId?: string,
  ): Promise<SnapshotSizePruneResult> {
    const limitBytes = this.config.get('maxSnapshotStoreBytes');
    if (!(limitBytes > 0)) {
      return {
        bytesBefore: 0,
        bytesAfter: 0,
        trimmed: [],
        stillOverLimit: false,
      };
    }

    const sizes = this.storage.measureSnapshotStore();
    if (sizes.totalBytes <= limitBytes) {
      return {
        bytesBefore: sizes.totalBytes,
        bytesAfter: sizes.totalBytes,
        trimmed: [],
        stillOverLimit: false,
      };
    }

    // The array is already in store order -- index order on load, append on
    // take, an order-preserving filter on delete -- and the selector consumes
    // the order it is handed, so it is passed straight through and never
    // re-sorted. Only the snapshot this take has just written leaves early,
    // and by id, not by position.
    const pruneable = this.snapshots.filter(
      (snapshot) => snapshot.id !== justCreatedSnapshotId,
    );

    const candidates = selectSizePruneCandidates(
      pruneable,
      sizes,
      limitBytes,
      this.getCurrentSnapshot()?.id ?? null,
    );

    if (candidates.length === 0) {
      console.warn(
        'Retention: the store holds ' +
          sizes.totalBytes +
          ' bytes against a ' +
          limitBytes +
          ' byte limit and no snapshot is removable; the snapshot the store is positioned at is never pruned.',
      );
      return {
        bytesBefore: sizes.totalBytes,
        bytesAfter: sizes.totalBytes,
        trimmed: [],
        stillOverLimit: true,
      };
    }

    const removable = new Set(candidates);
    const materialization = await this.materializeDependents(removable);
    if (!materialization.ok) {
      console.warn(
        'Retention: keeping ' +
          this.snapshots.length +
          ' snapshots. The store exceeds its ' +
          limitBytes +
          ' byte limit but a survivor of the ' +
          candidates.length +
          ' oldest cannot be rebuilt; nothing was deleted.',
      );
      return {
        bytesBefore: sizes.totalBytes,
        bytesAfter: sizes.totalBytes,
        trimmed: [],
        stillOverLimit: true,
      };
    }

    // Persist the rewrites before anything is deleted: a survivor whose base is
    // gone cannot be rebuilt afterwards. If they cannot be written the trim
    // stops here -- deleting a base whose survivors were never persisted is the
    // orphaning this guard exists to prevent -- and the excess is kept.
    try {
      for (const survivor of materialization.touched) {
        await this.storage.saveSnapshot(survivor);
      }
    } catch (error) {
      // Nothing was written, so the in-memory materialization is rolled back:
      // a later pass reads the dependents from memory, and a materialized copy
      // left behind would hide the base that is still needed -- that pass would
      // skip the save and delete it.
      this.restoreOriginalFiles(materialization.originals);
      const after = this.storage.measureSnapshotStore();
      console.warn(
        'Retention: the trim stopped. ' +
          materialization.touched.length +
          ' rebuilt survivor(s) of the ' +
          candidates.length +
          ' selected could not be persisted: ' +
          (error instanceof Error ? error.message : String(error)) +
          '. Nothing was deleted.',
      );
      return {
        bytesBefore: sizes.totalBytes,
        bytesAfter: after.totalBytes,
        trimmed: [],
        stillOverLimit: after.totalBytes > limitBytes,
      };
    }

    // Candidates reference each other down the chain, so one candidate whose
    // base is another candidate is not an orphan: it leaves in this batch too.
    // Only a dependent outside the batch could be left behind, and the
    // materialization above already rebuilt those. `alsoDeleting` is what
    // stops the batch's own members from looking like dependents here.
    //
    // Newest first, and stop at the first failure. Selection stays oldest-first;
    // only this order is reversed, because a candidate's base is its
    // predecessor in the batch. Removing the newest first means a failure leaves
    // the base of every surviving candidate in place, while deleting
    // oldest-first -- or continuing past the failure -- would remove the base of
    // a candidate that has to stay: the orphan this guard exists to prevent.
    const trimmed: string[] = [];
    for (const id of [...candidates].reverse()) {
      try {
        await this.deleteSnapshotInternal(id, { alsoDeleting: removable });
        trimmed.push(id);
      } catch (error) {
        console.warn(
          'Retention: could not delete ' +
            id +
            ' while trimming the store to ' +
            limitBytes +
            ' bytes: ' +
            (error instanceof Error ? error.message : String(error)) +
            '. The trim stops here; no older candidate is removed.',
        );
        break;
      }
    }

    const after = this.storage.measureSnapshotStore();
    console.log(
      'Retention: trimmed ' +
        trimmed.length +
        ' snapshot(s); the store now holds ' +
        after.totalBytes +
        ' bytes against a ' +
        limitBytes +
        ' byte limit.',
    );

    return {
      bytesBefore: sizes.totalBytes,
      bytesAfter: after.totalBytes,
      trimmed,
      stillOverLimit: after.totalBytes > limitBytes,
    };
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
