import * as vscode from 'vscode'; // Ensure vscode is imported for QuickPick etc.
// import * as fs from 'fs'; // Removed unused import
import * as path from 'path';
import * as crypto from 'crypto';
import { promises as fsPromises } from 'fs'; // Import promises API
import { GitignoreParser, runWithConcurrencyLimit } from 'codelapse-core';
import { log, logVerbose } from './logger';
import { getMaxSnapshots, getSnapshotLocation } from './config';
import { createDiff } from './snapshotDiff'; // Removed unused applyDiff import
import { SnapshotStorage } from './snapshotStorage';
import { API as GitAPI } from './types/git'; // Import Git API type
import { assertNoSymlinkPath, ensureWithinDirectory } from './pathSecurity';
import {
  ACTIVE_NONE,
  resolveActiveIndex,
  resolveNavigationTarget,
  type NavigationDirection,
} from './snapshotSelection';
import { MAX_FILE_SIZE_BYTES } from './security/limits';
import {
  getUnrecoverableFiles,
  scanSnapshotIntegrity,
  type SnapshotIntegrityReport,
} from './snapshotVerification';

// Keep Snapshot interface definition here as it's central to the manager
export interface Snapshot {
  id: string;
  timestamp: number;
  description: string;
  gitBranch?: string;
  gitCommitHash?: string;
  // fields for Enhanced Snapshot Context
  tags?: string[];
  notes?: string;
  taskReference?: string;
  isFavorite?: boolean;
  // fields for Selective Snapshots
  isSelective?: boolean; // Indicates if this snapshot only includes specific files
  selectedFiles?: string[]; // List of explicitly selected files (when isSelective is true)
  files: {
    [relativePath: string]: {
      content?: string | null;
      diff?: string;
      baseSnapshotId?: string;
      deleted?: boolean;
      isBinary?: boolean;
    };
  };
}

/**
 * Outcome of a restore.
 *
 * `skipped` and `refusedDeletions` are the reason this is not a boolean: a
 * snapshot whose delta chain is broken does not describe the whole workspace,
 * so a restore can neither reconstruct every file nor safely delete the files
 * it does not know about. Reporting both separately is what lets a caller tell
 * "restored everything" from "restored what it could and left the rest alone".
 */
export interface RestoreResult {
  success: boolean;
  /** Relative paths written to disk. */
  restored: string[];
  /** Relative paths present in the snapshot whose content could not be reconstructed. */
  skipped: string[];
  /** Relative paths left in place because deleting them was unsafe. */
  refusedDeletions: string[];
  /** Relative paths deleted from the workspace. */
  deleted: string[];
}

/**
 * What a call to `takeSnapshot` actually did.
 *
 * A snapshot is skipped when an auto-snapshot finds nothing has changed, so
 * "a snapshot exists afterwards" is not the same as "this call created one".
 * Callers must narrow on `created` before reading `snapshot`.
 */
export type TakeSnapshotOutcome =
  | { created: true; snapshot: Snapshot }
  | { created: false; reason: 'no-changes' };

/**
 * Chooses which snapshots can be pruned without making any surviving snapshot
 * unreadable. Snapshots are deltas: an entry with only a `baseSnapshotId` is
 * reconstructable solely while that base still exists, so removing a referenced
 * snapshot silently destroys data in its dependants. This is the mechanism that
 * produced the 4,942 directly-unrecoverable files in this repository's store.
 *
 * The candidate set is the `excess` oldest snapshots. References are evaluated
 * against the *projected remainder* -- the snapshots that would still exist
 * afterwards -- so a reference held only by another snapshot that is itself
 * being pruned does not block its base. If the full set would leave a dangling
 * reference, the newest candidate is dropped and the check repeats, so the
 * result is always a prefix of the oldest-first order and the store simply
 * keeps more snapshots than the configured maximum rather than losing data.
 *
 * Note on ordering: pruning must always take from the *oldest* end. A revision
 * of this function that skipped referenced candidates and carried on down the
 * list selected the newest snapshots instead -- discarding the user's most
 * recent history while keeping ancient ones. It also fails three of this
 * function's own tests; see the commit message.
 */
export function selectPrunableSnapshots(
  allSnapshots: Snapshot[],
  maxSnapshots: number,
): string[] {
  const excess = allSnapshots.length - maxSnapshots;
  if (excess <= 0) {
    return [];
  }

  const byAge = [...allSnapshots].sort((a, b) => a.timestamp - b.timestamp);
  const selected = byAge.slice(0, excess);

  while (selected.length > 0) {
    const pruned = new Set(selected.map((s) => s.id));
    const danglingReference = byAge.some(
      (snapshot) =>
        !pruned.has(snapshot.id) &&
        Object.values(snapshot.files).some(
          (fileData) =>
            !!fileData.baseSnapshotId && pruned.has(fileData.baseSnapshotId),
        ),
    );
    if (!danglingReference) {
      break;
    }
    selected.pop();
  }

  return selected.map((s) => s.id);
}

export class SnapshotManager {
  private snapshots: Snapshot[] = [];

  /**
   * Cached integrity scan of `snapshots`, refreshed at every site that changes
   * the list. Cached rather than recomputed per read because the tree view asks
   * per snapshot row, which would otherwise rescan the whole store for each one.
   */
  private integrityReport: SnapshotIntegrityReport = {
    brokenSnapshotIds: [],
    missingBaseSnapshotIds: [],
    unrecoverableFileCount: 0,
    perSnapshot: {},
  };
  /**
   * The snapshot the workspace currently reflects, or `null` when the
   * workspace does not correspond to any snapshot.
   *
   * This is the single source of truth for "which snapshot am I on". The field
   * it replaces (`currentSnapshotIndex`) was written as "the newest snapshot"
   * on load and after every take, but read as "the snapshot the workspace
   * reflects" by the status bar, the tree highlight, the quick pick and the
   * diff base for new snapshots. The two meanings are indistinguishable when
   * they are stored as one position, which is how a fresh window came to
   * report "Viewing snapshot 54/54". Identity is stored; the index is derived.
   * See `snapshotSelection.ts`.
   */
  private activeSnapshotId: string | null = null;
  private storage: SnapshotStorage;
  private gitApi: GitAPI | null; // Store Git API instance
  private writeLock: Promise<void> = Promise.resolve();
  private _onDidChangeSnapshots = new vscode.EventEmitter<void>(); // Event emitter
  public readonly onDidChangeSnapshots: vscode.Event<void> =
    this._onDidChangeSnapshots.event; // Public event

  constructor(gitApi: GitAPI | null) {
    // Accept Git API in constructor
    log('Initializing SnapshotManager');
    this.gitApi = gitApi; // Store the Git API
    this.storage = new SnapshotStorage(); // Initialize storage handler
    this.loadSnapshots(); // Load initial state

    // Listen for storage path changes (e.g., workspace folder opened/closed)
    // This might require an event emitter in SnapshotStorage if needed beyond constructor init
    // For now, assume constructor handles initial setup and potential re-init if workspace changes.

    log('SnapshotManager initialized');
  }

  /**
   * Get workspace root - needed for semantic search
   */
  public getWorkspaceRoot(): string | null {
    return this.storage.getWorkspaceRoot();
  }

  /**
   * Load existing snapshots using the SnapshotStorage module.
   */
  private async loadSnapshots() {
    log('Loading snapshots via SnapshotStorage...');
    const loadedState = await this.storage.loadSnapshotIndexAndMetadata();

    if (loadedState) {
      this.snapshots = loadedState.snapshots;
      if (typeof loadedState.activeSnapshotId === 'string') {
        // New shape: the field is authoritative, and null means detached.
        this.activeSnapshotId = loadedState.activeSnapshotId;
      } else {
        // Legacy index.json: `currentIndex` meant "newest", never "active".
        // A legacy store has no evidence that the workspace corresponds to any
        // snapshot, so start detached and let the user navigate deliberately.
        // Mapping that position to an id instead would leave the workspace
        // claiming to be at snapshot N/N -- the bug this task exists to remove.
        log(
          'Legacy snapshot index detected (no activeSnapshotId); starting detached.',
        );
        this.activeSnapshotId = null;
      }
      log(
        `Loaded ${this.snapshots.length} snapshots, active snapshot: ${
          this.activeSnapshotId ?? 'none'
        }`,
      );
    } else {
      // Handle case where loading failed critically (should be logged by storage)
      this.snapshots = [];
      this.activeSnapshotId = null;
      log('Snapshot loading failed or returned null state.');
    }
    // No need to sort here, assuming storage returns them sorted
    this.refreshIntegrityReport();
    this._onDidChangeSnapshots.fire(); // Notify listeners about the loaded state
  }

  /**
   * Save snapshots index using the SnapshotStorage module.
   */
  private async saveSnapshotIndex() {
    // No await needed here as saveSnapshotIndex in storage is already async
    await this.storage.saveSnapshotIndex(
      this.snapshots,
      this.getCurrentSnapshotIndex(),
      this.activeSnapshotId,
    );
  }

  /**
   * Drops the active-snapshot reference when the snapshot it named no longer
   * exists. Every path that removes snapshots from the list must call this:
   * the workspace cannot still be at a snapshot that has been deleted.
   */
  private detachIfActiveSnapshotRemoved(): void {
    if (
      this.activeSnapshotId &&
      !this.snapshots.some((s) => s.id === this.activeSnapshotId)
    ) {
      log(
        `Active snapshot ${this.activeSnapshotId} was removed; the workspace no longer corresponds to a snapshot.`,
      );
      this.activeSnapshotId = null;
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
   * Take a snapshot of the current workspace
   * @param description Optional description provided by the user.
   */
  public async takeSnapshot(
    description = '',
    contextOptions: {
      tags?: string[];
      notes?: string;
      taskReference?: string;
      isFavorite?: boolean;
      isSelective?: boolean;
      selectedFiles?: string[];
    } = {},
  ): Promise<TakeSnapshotOutcome> {
    return await this.withWriteLock(() =>
      this.takeSnapshotInternal(description, contextOptions),
    );
  }

  private async takeSnapshotInternal(
    description = '',
    contextOptions: {
      tags?: string[];
      notes?: string;
      taskReference?: string;
      isFavorite?: boolean;
      isSelective?: boolean;
      selectedFiles?: string[];
    } = {},
  ): Promise<TakeSnapshotOutcome> {
    const workspaceRoot = this.storage.getWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error('No workspace folder open');
    }

    // Create a new snapshot
    const timestamp = Date.now();
    const id = `snapshot-${timestamp}-${crypto.randomBytes(4).toString('hex')}`;

    // Instantiate the gitignore parser
    // The configured location, not the parser's default: the store lives inside
    // the scanned workspace, so a parser that assumes `.snapshots` captures the
    // store's own index and payload files into every snapshot.
    const parser = new GitignoreParser(
      workspaceRoot,
      this.getStoreLocationForScan(workspaceRoot),
    );
    log(`Initialized GitignoreParser for workspace: ${workspaceRoot}`);

    // --- Get Git Info ---
    let gitBranch: string | undefined;
    let gitCommitHash: string | undefined;
    const addGitInfo =
      vscode.workspace
        .getConfiguration('vscode-snapshots.git')
        .get<boolean>('addCommitInfo', true) ?? true;

    if (this.gitApi && addGitInfo) {
      try {
        // Find the repository for the current workspace
        const repo = this.gitApi.getRepository(vscode.Uri.file(workspaceRoot));
        if (repo && repo.state.HEAD) {
          gitBranch = repo.state.HEAD.name;
          gitCommitHash = repo.state.HEAD.commit;
          logVerbose(
            `Retrieved Git info: Branch=${gitBranch}, Commit=${gitCommitHash}`,
          );
        } else {
          logVerbose(
            'Could not find Git repository or HEAD for this workspace.',
          );
        }
      } catch (err) {
        log(`Error retrieving Git info: ${err}`);
        // Proceed without Git info
      }
    } else if (!addGitInfo) {
      logVerbose('Git info collection disabled by configuration.');
    } else {
      logVerbose('Git API not available.');
    }
    // --- End Get Git Info ---

    // Build the snapshot object with new context fields
    const snapshot: Snapshot = {
      id,
      timestamp,
      description,
      gitBranch,
      gitCommitHash,
      // Add new context fields from options
      tags: contextOptions.tags || [],
      notes: contextOptions.notes || '',
      taskReference: contextOptions.taskReference || '',
      isFavorite: contextOptions.isFavorite || false,
      // Add selective snapshot fields
      isSelective: contextOptions.isSelective || false,
      selectedFiles: contextOptions.selectedFiles || [],
      files: {},
    };

    // --- Start: New File Filtering Logic ---
    const excludePattern = parser.getExcludeGlobPattern();
    const negatedGlobs = parser.getNegatedGlobs();
    log(`Using exclude pattern: ${excludePattern}`);
    log(`Using negated globs: ${negatedGlobs.join(', ')}`);

    // 1. Find files using the main exclude pattern
    const initialFiles = await vscode.workspace.findFiles(
      '**/*',
      excludePattern,
    );
    log(`Found ${initialFiles.length} files after initial exclude pattern.`);

    // 2. Find files matching negated patterns to re-include them
    const reIncludedFiles = new Set<string>(); // Use fsPath for uniqueness
    for (const negatedGlob of negatedGlobs) {
      if (negatedGlob) {
        // Pass null for exclude, as we only want to include based on the negated pattern
        const filesToReInclude = await vscode.workspace.findFiles(
          negatedGlob,
          null,
        );
        filesToReInclude.forEach((uri) => reIncludedFiles.add(uri.fsPath));
        log(
          `Found ${filesToReInclude.length} files to re-include via negated glob: ${negatedGlob}`,
        );
      }
    }

    // 3. Combine the lists
    const finalFileUrisMap = new Map<string, vscode.Uri>();
    initialFiles.forEach((uri) => finalFileUrisMap.set(uri.fsPath, uri));
    reIncludedFiles.forEach((fsPath) => {
      // If a negated file wasn't in the initial list (e.g., excluded by default node_modules),
      // we need its Uri. We assume it exists if findFiles found it.
      // This might need refinement if findFiles behaves unexpectedly with negated globs
      // that point inside broadly excluded directories. For now, assume findFiles gives valid URIs.
      if (!finalFileUrisMap.has(fsPath)) {
        // This assumes the fsPath corresponds to a valid Uri.
        // Creating a Uri from fsPath is generally safe.
        finalFileUrisMap.set(fsPath, vscode.Uri.file(fsPath));
        logVerbose(`Adding re-included file not in initial list: ${fsPath}`);
      }
    });

    // 4. Apply selective filtering if needed
    let finalFiles = Array.from(finalFileUrisMap.values()).filter((fileUri) => {
      const relativePath = path.relative(workspaceRoot, fileUri.fsPath);
      return !parser.shouldIgnore(relativePath);
    });
    log(
      `Final file count after combining negated rules and local filtering: ${finalFiles.length}`,
    );
    if (
      snapshot.isSelective &&
      snapshot.selectedFiles &&
      snapshot.selectedFiles.length > 0
    ) {
      log(
        `Applying selective filter for ${snapshot.selectedFiles.length} files`,
      );

      // Create a set of selected file paths for faster lookup
      const selectedPathsSet = new Set(snapshot.selectedFiles);

      // Filter to only include selected files
      finalFiles = finalFiles.filter((fileUri) => {
        const relativePath = path.relative(workspaceRoot, fileUri.fsPath);
        return selectedPathsSet.has(relativePath);
      });

      log(`After selective filter: ${finalFiles.length} files included`);
    } else {
      log(`Using all ${finalFiles.length} files (non-selective snapshot)`);
    }
    // --- End: New File Filtering Logic ---

    // Find the previous snapshot to base diffs on - MOVED UP BEFORE IT'S USED
    // The base is the snapshot the workspace reflects; when none is active it
    // is the newest snapshot.
    const baseSnapshot = this.getDiffBaseSnapshot();

    if (finalFiles.length > 0) {
      // Check for suspicious files - those that might be binary but weren't caught by extension check
      const suspiciousPaths = finalFiles
        .filter((file) => !this.storage.isBinaryFile(file.fsPath))
        .map((file) => file.fsPath);

      if (suspiciousPaths.length > 0) {
        logVerbose(
          `Performing secondary binary check on ${suspiciousPaths.length} suspicious files`,
        );

        // Perform async content-based check
        const additionalBinaryPaths =
          await this.storage.checkSuspiciousFilesForBinaryContent(
            suspiciousPaths,
          );

        if (additionalBinaryPaths.size > 0) {
          logVerbose(
            `Found ${additionalBinaryPaths.size} additional binary files through content analysis`,
          );

          // Filter these out from finalFiles
          finalFiles = finalFiles.filter(
            (file) => !additionalBinaryPaths.has(file.fsPath),
          );

          // Optionally mark these files as binary in the snapshot
          additionalBinaryPaths.forEach((binaryPath) => {
            const relativePath = path.relative(workspaceRoot, binaryPath);
            snapshot.files[relativePath] = {
              isBinary: true,
              baseSnapshotId: baseSnapshot?.files[relativePath]?.baseSnapshotId,
            };
          });
        }
      }
    }
    logVerbose(`Final file count after suspicious check: ${finalFiles.length}`);

    // Store a set of relative paths for files that exist in the current workspace (filtered)
    const currentWorkspaceFiles = new Set<string>();
    finalFiles.forEach((file) => {
      const relativePath = path.relative(workspaceRoot, file.fsPath);
      currentWorkspaceFiles.add(relativePath);
    });
    logVerbose(
      `Built currentWorkspaceFiles set with ${currentWorkspaceFiles.size} entries.`,
    );

    // Get files from the previous snapshot to detect deletions
    let previousSnapshotFiles: Set<string> = new Set();
    if (baseSnapshot) {
      previousSnapshotFiles = new Set(Object.keys(baseSnapshot.files));
      log(`Previous snapshot had ${previousSnapshotFiles.size} files`); // Use imported log
    }

    // Process each file identified by the new filtering logic
    await runWithConcurrencyLimit(finalFiles, 50, async (file) => {
      // File was NOT ignored by the new logic, so we process it
      logVerbose(`Including file in snapshot: ${file.fsPath}`);

      // Skip binary files and files we can't read (using storage method)
      try {
        const relativePath = path.relative(workspaceRoot, file.fsPath);
        const fullPath = ensureWithinDirectory(workspaceRoot, relativePath);
        await assertNoSymlinkPath(workspaceRoot, fullPath);
        const fileStats = await fsPromises.lstat(fullPath);
        if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
          logVerbose(`Skipping non-regular file: ${relativePath}`);
          return;
        }
        if (fileStats.size > MAX_FILE_SIZE_BYTES) {
          logVerbose(
            `Skipping oversized file ${relativePath}: ${fileStats.size} bytes exceeds ${MAX_FILE_SIZE_BYTES} byte limit`,
          );
          return;
        }

        if (this.storage.isBinaryFile(fullPath)) {
          // Record it exists, but don't store content
          snapshot.files[relativePath] = {
            isBinary: true,
            // If file was in previous snapshot, keep the reference
            baseSnapshotId: baseSnapshot?.files[relativePath]?.baseSnapshotId,
          };
          logVerbose(`Recorded binary file presence: ${relativePath}`);
          return; // Skip content reading for binary files
        }

        // Add await here
        const content = await this.storage.readFileContent(fullPath); // Use storage method
        if (content === null) {
          logVerbose(`Skipping file with null content: ${fullPath}`);
          return; // Skip binary or unreadable files
        }

        // If we have a base snapshot with this file, store just the diff
        if (baseSnapshot && baseSnapshot.files[relativePath]) {
          // Use storage method to get base content, passing the full snapshot list
          // Add await here
          const baseContent = await this.storage.getSnapshotFileContent(
            baseSnapshot.id,
            relativePath,
            this.snapshots, // Pass the current list
          );

          if (baseContent !== null && baseContent !== content) {
            // Store as a diff against the base snapshot using diff utility
            const fileDiff = createDiff(relativePath, baseContent, content); // Use diff utility
            snapshot.files[relativePath] = {
              diff: fileDiff,
              baseSnapshotId: baseSnapshot.id,
            };
            logVerbose(`Stored diff for changed file: ${relativePath}`);
          } else if (baseContent === content) {
            // File hasn't changed, just reference the base
            snapshot.files[relativePath] = {
              baseSnapshotId: baseSnapshot.id,
            };
            logVerbose(`Referenced base for unchanged file: ${relativePath}`);
          } else if (baseContent === null) {
            // Couldn't get base content, store full content as fallback
            log(
              `Warning: Could not get base content for ${relativePath}. Storing full content.`,
            );
            snapshot.files[relativePath] = { content };
          }
        } else {
          // No base snapshot or file didn't exist in base, store full content
          snapshot.files[relativePath] = { content };
          logVerbose(`Stored full content for new file: ${relativePath}`);
        }
      } catch (error) {
        // Log error but continue processing other files
        log(`Error processing file ${file.fsPath}: ${error}`); // Use imported log directly
      }
    });

    // Check for files that existed in the previous snapshot but don't exist anymore
    // These represent deleted files that need to be tracked
    //
    // Selective snapshots intentionally photograph only their selected files
    // (the filter above, whose condition this mirrors). `currentWorkspaceFiles`
    // is built from that filtered list, so every unselected file would look
    // "gone" here -- a lie about the workspace that restore then acts on by
    // deleting the user's files. Only a whole-tree capture can report deletions.
    const isSelective =
      snapshot.isSelective === true &&
      Array.isArray(snapshot.selectedFiles) &&
      snapshot.selectedFiles.length > 0;

    if (baseSnapshot && !isSelective) {
      let deletedFilesCount = 0;
      previousSnapshotFiles.forEach((relativePath) => {
        if (!currentWorkspaceFiles.has(relativePath)) {
          // This file existed in the previous snapshot but not in the current workspace
          // Mark it as deleted by adding a special deletion marker
          snapshot.files[relativePath] = {
            // content: null, // No need for null content if deleted flag is present
            deleted: true, // explicit deletion marker
          };
          deletedFilesCount++;
          log(`Tracking deleted file: ${relativePath}`);
        }
      });

      if (deletedFilesCount > 0) {
        log(`Added ${deletedFilesCount} deleted files to the snapshot`);
      }
    }

    // If this is an auto snapshot and no files have changed, skip creating it.
    const isAutoSnapshot = contextOptions.tags?.includes('auto');
    if (isAutoSnapshot) {
      const hasChange = Object.values(snapshot.files).some(
        (f) =>
          f.deleted ||
          f.diff !== undefined ||
          (f.content !== undefined && f.baseSnapshotId === undefined),
      );
      if (!hasChange) {
        log('Skipping auto snapshot: no changes detected since last snapshot');
        // An explicit outcome, not the previous snapshot: returning an
        // existing Snapshot made "created" and "skipped" indistinguishable to
        // every caller, which is how the UI came to report a snapshot that was
        // never taken -- and, with no active snapshot, to return `undefined`
        // from a method whose signature promised a Snapshot.
        return { created: false, reason: 'no-changes' };
      }
    }

    // Add to our in-memory list first, so the index write below includes it.
    // A new snapshot describes the workspace, so it also becomes the active
    // one; that is deliberate, and it is recorded as identity so the index
    // cannot drift from the list. The previous value is kept so the rollback
    // paths below can restore exactly what the workspace reflected before.
    const previousActiveSnapshotId = this.activeSnapshotId;
    this.snapshots.push(snapshot);
    this.activeSnapshotId = snapshot.id;

    // Write the index BEFORE the snapshot data, and surface failure.
    //
    // The order is what makes the rollback honest. If the index write fails,
    // nothing has reached disk yet, so dropping the in-memory entry leaves the
    // store consistent. Writing the data first would leave a snapshot directory
    // with no index entry -- exactly what `recoverSnapshotsFromFileSystem`
    // deliberately resurrects -- so the user would be told "not saved" while the
    // snapshot reappeared on the next reload.
    try {
      await this.saveSnapshotIndex();
    } catch (indexError) {
      this.snapshots.pop();
      this.activeSnapshotId = previousActiveSnapshotId;
      this.refreshIntegrityReport();
      log(
        `Failed to persist the snapshot index after taking a snapshot: ${indexError}`,
      );
      vscode.window.showErrorMessage(
        `Snapshot was not saved: ${
          indexError instanceof Error ? indexError.message : indexError
        }`,
      );
      throw indexError;
    }

    // Now persist the snapshot data. A failure here leaves an index entry with
    // no data, which the loader skips and reports, rather than orphaned data
    // that the recovery scan would bring back.
    try {
      await this.storage.saveSnapshotData(snapshot);
    } catch (error) {
      this.snapshots = this.snapshots.filter((s) => s.id !== snapshot.id);
      this.activeSnapshotId = previousActiveSnapshotId;
      this.refreshIntegrityReport();

      // Remove anything the failed write left behind, so the recovery scan
      // cannot resurrect a snapshot the user was told was not saved.
      try {
        await this.storage.deleteSnapshotData(snapshot.id);
      } catch (cleanupError) {
        log(
          `Could not remove partial snapshot data for ${snapshot.id}: ${cleanupError}`,
        );
      }
      try {
        await this.saveSnapshotIndex();
      } catch (rewriteError) {
        log(
          `Could not rewrite the index after a failed snapshot write: ${rewriteError}`,
        );
      }

      vscode.window.showErrorMessage(`Failed to save snapshot data: ${error}`);
      throw error;
    }

    this.refreshIntegrityReport();

    // Enforce max snapshots limit
    await this.enforceSnapshotLimit(); // This now uses storage for deletion

    // Log summary of what was done
    const filesProcessed = Object.keys(snapshot.files).length;
    log(`Snapshot summary: ${filesProcessed} files included in snapshot.`);
    if (snapshot.isSelective) {
      const selectedCount = snapshot.selectedFiles?.length ?? 0;
      log(`Selective snapshot with ${selectedCount} files selected.`);
    }

    // Emit event
    this._onDidChangeSnapshots.fire();
    log('Fired onDidChangeSnapshots event after takeSnapshot');

    return { created: true, snapshot };
  }

  /**
   * Finds a snapshot by its ID.
   * @param snapshotId The ID of the snapshot to find.
   * @returns The snapshot object or undefined if not found.
   */
  public getSnapshotById(snapshotId: string): Snapshot | undefined {
    return this.snapshots.find((s) => s.id === snapshotId);
  }

  /**
   * Calculates the changes (added, modified, deleted files) required to restore a snapshot.
   * @param snapshot The snapshot to calculate changes for.
   * @param workspaceRoot The root path of the workspace.
   * @returns A promise resolving to an array of change objects.
   */
  public async calculateRestoreChanges(
    snapshot: Snapshot,
    workspaceRoot: string,
  ): Promise<
    {
      label: string;
      description: string;
      relativePath: string;
      status: 'A' | 'M' | 'D';
      isDirty?: boolean;
    }[]
  > {
    logVerbose(`Calculating changes for snapshot ${snapshot.id}`);

    // Restoring a selective snapshot touches only the files it captured
    // (applySnapshotRestoreInternal), so the preview must not advertise
    // deletions of files the snapshot never looked at. The predicate is the
    // same one the capture guard uses: a rule-based snapshot with an empty
    // selection is a whole-tree capture and keeps the old preview behavior.
    const isSelectiveCapture =
      snapshot.isSelective === true &&
      Array.isArray(snapshot.selectedFiles) &&
      snapshot.selectedFiles.length > 0;

    // 1. Get current workspace files (using existing filtering logic)
    // TODO: Consider extracting this file filtering logic into a reusable private method
    // Configured store location, as in takeSnapshotInternal: the store is not
    // workspace content and must not appear in a change calculation either.
    const parser = new GitignoreParser(
      workspaceRoot,
      this.getStoreLocationForScan(workspaceRoot),
    );
    const excludePattern = parser.getExcludeGlobPattern();
    const negatedGlobs = parser.getNegatedGlobs();
    const initialCurrentFiles = await vscode.workspace.findFiles(
      '**/*',
      excludePattern,
    );
    const reIncludedCurrentFiles = new Set<string>();
    for (const negatedGlob of negatedGlobs) {
      if (negatedGlob) {
        const filesToReInclude = await vscode.workspace.findFiles(
          negatedGlob,
          null,
        );
        filesToReInclude.forEach((uri) =>
          reIncludedCurrentFiles.add(uri.fsPath),
        );
      }
    }
    const currentWorkspaceFilesRelative = new Set<string>();
    initialCurrentFiles.forEach((uri) => {
      const relativePath = path.relative(workspaceRoot, uri.fsPath);
      if (!parser.shouldIgnore(relativePath)) {
        currentWorkspaceFilesRelative.add(relativePath);
      }
    });
    reIncludedCurrentFiles.forEach((fsPath) => {
      const relativePath = path.relative(workspaceRoot, fsPath);
      if (
        !currentWorkspaceFilesRelative.has(relativePath) &&
        !parser.shouldIgnore(relativePath)
      ) {
        currentWorkspaceFilesRelative.add(relativePath);
      }
    });
    logVerbose(
      `Found ${currentWorkspaceFilesRelative.size} non-ignored files in workspace for change calculation.`,
    );

    // 2. Get files expected in the snapshot
    const expectedSnapshotFiles = new Map<
      string,
      { deleted?: boolean; isBinary?: boolean }
    >(); // Store relativePath -> {deleted: true/false}
    Object.entries(snapshot.files).forEach(([relativePath, fileData]) => {
      expectedSnapshotFiles.set(relativePath, { deleted: fileData.deleted });
    });
    logVerbose(
      `Snapshot expects ${expectedSnapshotFiles.size} file entries (incl. deletions).`,
    );

    // 3. Calculate changes (Added, Modified, Deleted)
    const changes: {
      label: string;
      description: string;
      relativePath: string;
      status: 'A' | 'M' | 'D';
      isDirty?: boolean; // For conflict resolution later
    }[] = [];

    // Check for modifications and additions
    await runWithConcurrencyLimit(
      Array.from(expectedSnapshotFiles.entries()),
      50,
      async ([relativePath, fileData]) => {
        if (fileData.deleted) return; // Handle deletions separately

        if (fileData.isBinary) {
          if (!currentWorkspaceFilesRelative.has(relativePath)) {
            // Only show addition if binary file doesn't exist in workspace
            changes.push({
              label: `+ ${relativePath} (Binary)`,
              description: 'Added (Binary File)',
              relativePath,
              status: 'A',
            });
          }
          return; // Skip further comparison for binary files
        }

        const workspacePath = ensureWithinDirectory(
          workspaceRoot,
          relativePath,
        );
        let workspaceContent: string | null = null;
        let snapshotContent: string | null = null;
        let isDirty = false;

        // Check if file exists in workspace and if it's dirty
        if (currentWorkspaceFilesRelative.has(relativePath)) {
          try {
            workspaceContent = await this.storage.readFileContent(
              workspacePath,
            ); // Use storage method
            // Check if the file is open and dirty
            const openEditor = vscode.window.visibleTextEditors.find(
              (editor) => editor.document.uri.fsPath === workspacePath,
            );
            if (openEditor?.document.isDirty) {
              isDirty = true;
            }
          } catch (e) {
            logVerbose(
              `Could not read workspace file ${relativePath} for change calculation: ${e}`,
            );
            // Treat as if it doesn't exist for comparison purposes
          }
        }

        // Get snapshot content (only if needed for comparison or addition)
        snapshotContent = await this.getSnapshotFileContentPublic(
          snapshot.id,
          relativePath,
        );

        if (currentWorkspaceFilesRelative.has(relativePath)) {
          // File exists in both: Check for modification
          if (workspaceContent !== snapshotContent) {
            changes.push({
              label: `~ ${relativePath}${isDirty ? ' *' : ''}`, // Mark dirty files
              description: 'Modified',
              relativePath,
              status: 'M',
              isDirty,
            });
          }
        } else {
          // File exists in snapshot but not workspace: Added
          changes.push({
            label: `+ ${relativePath}`,
            description: 'Added',
            relativePath,
            status: 'A',
          });
        }
      },
    );

    // Check for deletions
    for (const relativePath of currentWorkspaceFilesRelative) {
      if (
        !expectedSnapshotFiles.has(relativePath) ||
        expectedSnapshotFiles.get(relativePath)?.deleted
      ) {
        // File exists in workspace but not in snapshot (or marked deleted): Deletion
        if (isSelectiveCapture && !expectedSnapshotFiles.has(relativePath)) {
          // Not captured, therefore not deleted by apply: omit it from the
          // preview. A path the snapshot explicitly marks `{deleted: true}` is
          // present in `expectedSnapshotFiles`, so this guard does not fire for
          // it and it is still reported.
          continue;
        }
        const workspacePath = ensureWithinDirectory(
          workspaceRoot,
          relativePath,
        );

        // NEW: Preserve binary files during restore preview
        if (this.storage.isBinaryFile(workspacePath)) {
          logVerbose(
            `Binary file excluded from deletion in preview: ${relativePath}`,
          );
          continue; // Skip showing binary files as deleted in the UI
        }

        let isDirty = false;
        const openEditor = vscode.window.visibleTextEditors.find(
          (editor) => editor.document.uri.fsPath === workspacePath,
        );
        if (openEditor?.document.isDirty) {
          isDirty = true;
        }
        changes.push({
          label: `- ${relativePath}${isDirty ? ' *' : ''}`, // Mark dirty files
          description: 'Deleted',
          relativePath,
          status: 'D',
          isDirty,
        });
      }
    }

    // Also explicitly add files marked as deleted in the snapshot metadata,
    // even if they don't currently exist in the workspace (idempotency)
    for (const [relativePath, fileData] of expectedSnapshotFiles.entries()) {
      if (
        fileData.deleted &&
        !changes.some(
          (c) => c.relativePath === relativePath && c.status === 'D',
        )
      ) {
        // BUGFIX: Check if this file was actually deleted in THIS snapshot
        // Find the previous snapshot to compare against
        const snapshots = this.snapshots;
        const currentIndex = snapshots.findIndex((s) => s.id === snapshot.id);
        const previousSnapshot =
          currentIndex > 0 ? snapshots[currentIndex - 1] : null;

        // Only show if it was deleted in this snapshot, not in a previous one
        if (
          !previousSnapshot ||
          !previousSnapshot.files[relativePath] ||
          !previousSnapshot.files[relativePath].deleted
        ) {
          // NEW: Skip binary files marked as deleted
          const fullPath = ensureWithinDirectory(workspaceRoot, relativePath);
          if (this.storage.isBinaryFile(fullPath)) {
            logVerbose(
              `Binary file excluded from deletion in snapshot metadata preview: ${relativePath}`,
            );
            continue; // Skip binary files
          }

          changes.push({
            label: `- ${relativePath}`,
            description: 'Deleted (Marked in Snapshot)',
            relativePath,
            status: 'D',
          });
        } else {
          logVerbose(
            `Filtering out previously deleted file from changes: ${relativePath}`,
          );
        }
      }
    }

    // Sort changes for consistent display
    changes.sort((a, b) => {
      const statusOrder = { A: 1, M: 2, D: 3 };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return a.relativePath.localeCompare(b.relativePath);
    });

    logVerbose(
      `Calculated ${changes.length} changes for snapshot ${snapshot.id}`,
    );
    return changes;
  }

  // --- Start: Preview Helper Method (REMOVED) ---
  /**
   * Shows a preview of changes and asks for confirmation before restoring. (REMOVED - Logic moved to calculateRestoreChanges and command handler)
   */
  // --- End: Preview Helper Method (REMOVED) ---

  /**
   * The snapshot store path, relative to the workspace root, as the storage
   * layer actually resolved it.
   *
   * The scan must exclude the same directory the snapshots are written to, and
   * `snapshotStorage` resolves `snapshotLocation` **once** at activation while
   * this used to re-read the setting on every snapshot. Those two reads can
   * disagree: a configuration read taken while the workspace settings are being
   * rewritten (a restore writes `.vscode/settings.json`) can come back with the
   * defaults, naming `.snapshots` while the store really is `.snapshots-test`.
   * The store was then captured into the very snapshot being written -- the
   * self-referential capture this exclusion exists to prevent, and the phantom
   * `deleted` entries it leaves behind also defeat the auto-snapshot
   * no-changes skip. Resolving through the storage layer removes the second
   * source of truth; the deletion guard already resolves the store this way.
   *
   * Falls back to the configured value when the store is unknown or lives
   * outside the workspace, where a workspace scan cannot reach it anyway.
   */
  private getStoreLocationForScan(workspaceRoot: string): string {
    const storeDirectory = this.storage.getSnapshotDirectory();
    if (workspaceRoot && storeDirectory) {
      const relative = path.relative(workspaceRoot, storeDirectory);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        return relative;
      }
    }
    return getSnapshotLocation();
  }

  /**
   * Whether a workspace-relative path names something inside the snapshot
   * store.
   *
   * The store is application data the extension writes while it works, so it is
   * never workspace content and never extraneous: a restore that deletes it is
   * destroying the snapshots themselves.
   *
   * Resolved through `path.relative` rather than by string prefix, so a store
   * reached through a different spelling (`./.snapshots-test`, `.snapshots/`)
   * is still recognised. The comparison ignores case on Windows only, where the
   * filesystem does: elsewhere `.Snapshots` and `.snapshots` are two different
   * directories and refusing to delete the wrong one would be a real change in
   * behaviour.
   */
  private isInsideSnapshotStore(
    relativePath: string,
    workspaceRoot: string,
  ): boolean {
    const storeDirectory = this.storage.getSnapshotDirectory();
    if (!workspaceRoot || !storeDirectory) {
      return false;
    }

    const storeRelative = path.relative(workspaceRoot, storeDirectory);
    // A store outside the workspace cannot be reached by a workspace scan; the
    // guard would otherwise refuse deletions it has no business judging.
    if (
      !storeRelative ||
      storeRelative.startsWith('..') ||
      path.isAbsolute(storeRelative)
    ) {
      return false;
    }

    const normalize = (value: string): string => {
      const withSlashes = value.replace(/\\/g, '/').replace(/\/+$/, '');
      return process.platform === 'win32'
        ? withSlashes.toLowerCase()
        : withSlashes;
    };

    const store = normalize(storeRelative);
    const target = normalize(relativePath);
    return target === store || target.startsWith(`${store}/`);
  }

  /**
   * Applies the file changes necessary to restore a specific snapshot.
   * This method performs the core file operations (add, modify, delete)
   * but does NOT handle UI interactions like previews, confirmations, or conflict checks.
   * @param snapshotId The ID of the snapshot to restore.
   * @returns A promise resolving to true if successful, false otherwise.
   * @throws Error if workspace root is not found or snapshot is invalid.
   */
  public async applySnapshotRestore(
    snapshotId: string,
  ): Promise<RestoreResult> {
    return await this.withWriteLock(() =>
      this.applySnapshotRestoreInternal(snapshotId),
    );
  }

  private async applySnapshotRestoreInternal(
    snapshotId: string,
  ): Promise<RestoreResult> {
    // Find the snapshot
    const index = this.snapshots.findIndex((s) => s.id === snapshotId);
    if (index === -1) {
      // Throw error instead of showing UI message
      throw new Error(`Snapshot with ID ${snapshotId} not found.`);
    }

    const snapshot = this.snapshots[index];
    const workspaceRoot = this.storage.getWorkspaceRoot();
    if (!workspaceRoot) {
      // Throw error instead of showing UI message
      throw new Error('Cannot restore snapshot: No workspace folder open.');
    }

    // --- Preview, Confirmation, and Conflict Resolution REMOVED ---
    // This logic will now live in the command handler in commands.ts

    // --- Start: Apply Snapshot Logic (File Operations) ---
    log(`Applying snapshot restore operations for ${snapshotId}...`);
    // Re-fetch current workspace files and expected snapshot files
    // TODO: Consider extracting file filtering logic to a reusable private method
    // Configured store location, as in takeSnapshotInternal: enumerating the
    // store here is what made a restore delete the snapshot payloads it was
    // restoring around (they are written after their own snapshot's scan, so
    // the snapshot never lists them).
    const parser = new GitignoreParser(
      workspaceRoot,
      this.getStoreLocationForScan(workspaceRoot),
    );
    const excludePattern = parser.getExcludeGlobPattern();
    const negatedGlobs = parser.getNegatedGlobs();
    const initialCurrentFiles = await vscode.workspace.findFiles(
      '**/*',
      excludePattern,
    );
    const reIncludedCurrentFiles = new Set<string>();
    for (const negatedGlob of negatedGlobs) {
      if (negatedGlob) {
        const filesToReInclude = await vscode.workspace.findFiles(
          negatedGlob,
          null,
        );
        filesToReInclude.forEach((uri) =>
          reIncludedCurrentFiles.add(uri.fsPath),
        );
      }
    }
    const currentWorkspaceFilesRelative = new Set<string>();
    initialCurrentFiles.forEach((uri) =>
      currentWorkspaceFilesRelative.add(
        path.relative(workspaceRoot, uri.fsPath),
      ),
    );
    reIncludedCurrentFiles.forEach((fsPath) => {
      const relativePath = path.relative(workspaceRoot, fsPath);
      if (!currentWorkspaceFilesRelative.has(relativePath)) {
        currentWorkspaceFilesRelative.add(relativePath);
      }
    });

    const expectedSnapshotFiles = new Map<
      string,
      { deleted?: boolean; isBinary?: boolean }
    >();
    Object.entries(snapshot.files).forEach(([relativePath, fileData]) => {
      expectedSnapshotFiles.set(relativePath, {
        deleted: fileData.deleted,
        isBinary: fileData.isBinary,
      });
    });

    // Files whose baseSnapshotId chain cannot be resolved. Their content is
    // gone from the store, which makes this snapshot an incomplete description
    // of the workspace -- so it is also what forbids deleting anything below.
    const unrecoverable = new Set(
      getUnrecoverableFiles(snapshot, this.snapshots),
    );
    if (unrecoverable.size > 0) {
      log(
        `Restore: ${unrecoverable.size} file(s) in snapshot ${snapshotId} have unresolvable base references and will not be restored.`,
      );
    }

    const restored: string[] = [];
    const deleted: string[] = [];
    const skipped: string[] = [];
    const refusedDeletions: string[] = [];

    // A selective snapshot is an explicit claim about SOME files, never a
    // statement about the whole workspace: its capture holds no entry for the
    // files it never looked at, so "absent from the snapshot" is no evidence
    // that a file is extraneous. Restoring one therefore writes back the files
    // it captured and deletes nothing.
    //
    // The predicate must match the capture side exactly (takeSnapshotInternal),
    // because a rule-based producer passes `isSelective: true` with the files a
    // rule matched, and an empty selection means the capture ran over the whole
    // tree: its `{deleted:true}` markers are real, and skipping its deletion
    // phase would leave files the user actually deleted in the workspace.
    const isSelectiveCapture =
      snapshot.isSelective === true &&
      Array.isArray(snapshot.selectedFiles) &&
      snapshot.selectedFiles.length > 0;
    if (isSelectiveCapture) {
      const capturedCount = snapshot.selectedFiles?.length ?? 0;
      log(
        `Restore Apply: selective snapshot — skipping deletion phase (${capturedCount} captured file(s) are its whole scope).`,
      );
    }

    // 1. Handle Deletions: Files in workspace but not in snapshot (or marked deleted)
    //
    // Sequential rather than a forEach that pushes promises: the callback could
    // not be awaited, so a rejection had nowhere to go, and every deletion was
    // started at once with no back-pressure.
    //
    // Empty by construction for a selective capture; the guards inside the loop
    // (the snapshot store, unrecoverable content) therefore keep judging every
    // deletion of a whole-tree capture, exactly as before.
    const deletionCandidates: Iterable<string> = isSelectiveCapture
      ? []
      : currentWorkspaceFilesRelative;
    for (const relativePath of deletionCandidates) {
      const inSnapshot = expectedSnapshotFiles.has(relativePath);
      const markedDeleted = expectedSnapshotFiles.get(relativePath)?.deleted;
      // Delete only when the file is not in the snapshot at all, or the
      // snapshot explicitly records it as deleted. This is the negation of the
      // original `!inSnapshot || markedDeleted`, kept as an early-continue so
      // the rest of the loop body has no nesting.
      if (inSnapshot && !markedDeleted) {
        continue;
      }

      // The store is application data that happens to live inside the
      // workspace, not workspace content: it is written by this extension while
      // the snapshot is being taken, so no snapshot's own scan can describe it,
      // and "absent from the snapshot" is never evidence that it is extraneous.
      // Enumerating it is what deleted the payloads of the snapshot being
      // restored to and of every newer snapshot; the parser now excludes it, and
      // this guard is what keeps a future filtering regression from deleting it
      // again.
      if (this.isInsideSnapshotStore(relativePath, workspaceRoot)) {
        refusedDeletions.push(relativePath);
        log(
          `Restore Apply: Refusing to delete ${relativePath}: it is inside the snapshot store.`,
        );
        continue;
      }

      const fullPath = ensureWithinDirectory(workspaceRoot, relativePath);

      // Preserve binary files even if they weren't in the snapshot
      if (this.storage.isBinaryFile(fullPath)) {
        logVerbose(
          `Restore Apply: Preserving binary file not tracked in snapshot: ${relativePath}`,
        );
        continue;
      }

      if (unrecoverable.size > 0) {
        // The snapshot is incomplete: it does not describe the whole
        // workspace, so "absent from the snapshot" is not evidence that the
        // file is extraneous. Deleting live work on the strength of a broken
        // record is exactly the failure this guard exists to prevent.
        refusedDeletions.push(relativePath);
        logVerbose(
          `Restore Apply: Refusing to delete ${relativePath} because the snapshot has ${unrecoverable.size} unreadable file(s).`,
        );
        continue;
      }

      logVerbose(
        `Restore Apply: Deleting extraneous/marked-deleted file: ${relativePath}`,
      );
      try {
        await this.storage.deleteWorkspaceFile(fullPath);
        deleted.push(relativePath);
      } catch (error) {
        // A failed deletion is reported rather than swallowed: the caller
        // needs to know the workspace no longer matches the snapshot.
        skipped.push(relativePath);
        log(`Restore Apply: Error deleting ${relativePath}: ${error}`);
      }
    }

    // 2. Handle Restorations/Additions: Files in snapshot (and not marked deleted)
    for (const [relativePath, fileData] of expectedSnapshotFiles) {
      if (fileData.deleted) {
        if (!currentWorkspaceFilesRelative.has(relativePath)) {
          logVerbose(
            `Restore Apply: File marked deleted and not in workspace, no action needed: ${relativePath}`,
          );
        }
        continue;
      }
      if (fileData.isBinary) {
        // Don't attempt to restore content for binary files.
        // They're just tracked for existence, not content.
        logVerbose(
          `Restore Apply: Binary file in snapshot, no content to restore: ${relativePath}`,
        );
        continue;
      }
      if (unrecoverable.has(relativePath)) {
        skipped.push(relativePath);
        continue;
      }

      const fullPath = ensureWithinDirectory(workspaceRoot, relativePath);
      try {
        const content = await this.storage.getSnapshotFileContent(
          snapshot.id,
          relativePath,
          this.snapshots,
        );
        if (content === null) {
          // Not in the known-broken set but still unresolvable: a resolution
          // failure deeper in the chain, or an I/O error reading a base.
          skipped.push(relativePath);
          log(
            `Restore Apply: Skipping unresolvable content for ${relativePath}`,
          );
          continue;
        }
        await this.storage.writeFileContent(fullPath, content);
        restored.push(relativePath);
      } catch (error) {
        skipped.push(relativePath);
        log(`Restore Apply: Error restoring ${relativePath}: ${error}`);
      }
    }

    log(
      `Restore Apply summary for ${snapshotId}: ${restored.length} restored, ${deleted.length} deleted, ${skipped.length} skipped, ${refusedDeletions.length} deletions refused.`,
    );

    if (skipped.length > 0 || refusedDeletions.length > 0) {
      log(
        `Restore Apply: snapshot ${snapshotId} is partially unreadable. Skipped: ${skipped.length}, refused deletions: ${refusedDeletions.length}.`,
      );
    }

    // --- UI Summary Message REMOVED ---
    // This will be handled by the command handler

    // Update which snapshot the workspace now reflects
    this.activeSnapshotId = snapshot.id;
    await this.saveSnapshotIndex();

    // Refresh open editors to reflect changes
    await this.refreshOpenEditors();

    // Notify listeners (e.g., tree view) about the change
    this._onDidChangeSnapshots.fire();
    log(`Successfully applied restore for snapshot ${snapshotId}`);

    return { success: true, restored, skipped, refusedDeletions, deleted };
  }

  /**
   * Navigate to previous snapshot (Uses applySnapshotRestore internally)
   *
   * Detach-tolerant: with no active snapshot this moves to the newest one
   * rather than reporting that no history exists. See `resolveNavigationTarget`.
   */
  public async navigateToPreviousSnapshot(): Promise<boolean> {
    return await this.navigateByDirection('previous');
  }

  /**
   * Navigate to next snapshot (Uses applySnapshotRestore internally)
   */
  public async navigateToNextSnapshot(): Promise<boolean> {
    return await this.navigateByDirection('next');
  }

  private async navigateByDirection(
    direction: NavigationDirection,
  ): Promise<boolean> {
    const targetIndex = this.getNavigationTargetIndex(direction);
    if (targetIndex === ACTIVE_NONE) {
      log(`No ${direction} snapshot available to navigate to.`);
      return false; // Nothing to navigate to
    }

    const targetSnapshotId = this.snapshots[targetIndex].id;
    log(`Navigating to ${direction} snapshot: ${targetSnapshotId}`);
    // Note: applySnapshotRestore doesn't handle UI/confirmation,
    // so this direct call bypasses that. The command handler for
    // 'previousSnapshot' should orchestrate the full flow if needed.
    // For now, assume direct application is intended for nav commands.
    // Consider if nav commands should also have preview/confirm.
    // `applySnapshotRestore` returns a RestoreResult; navigation only reports
    // whether the restore succeeded.
    return (await this.applySnapshotRestore(targetSnapshotId)).success;
  }

  /**
   * Where a previous/next navigation would land, or `ACTIVE_NONE`.
   *
   * Public so the commands that report which snapshot they are moving to use
   * the same answer the navigation itself will use; computing it twice is how
   * a progress title ends up naming a snapshot the command never restores.
   */
  public getNavigationTargetIndex(direction: NavigationDirection): number {
    return resolveNavigationTarget(
      this.snapshots,
      this.getCurrentSnapshotIndex(),
      direction,
    );
  }

  /**
   * Get all snapshots
   */
  public getSnapshots(): Snapshot[] {
    return [...this.snapshots];
  }

  /**
   * Get current snapshot index
   */
  public getCurrentSnapshotIndex(): number {
    return resolveActiveIndex(this.snapshots, this.activeSnapshotId);
  }

  /**
   * The snapshot the workspace currently reflects, or undefined when the
   * workspace is not at a snapshot.
   *
   * Previously `currentSnapshotIndex` was initialised to the newest snapshot
   * on load and after every takeSnapshot, so the status bar reported
   * "Viewing snapshot 54/54" on a fresh window and the tree marked the newest
   * snapshot as current even though nothing had been restored.
   */
  public getActiveSnapshot(): Snapshot | undefined {
    const index = this.getCurrentSnapshotIndex();
    return index === ACTIVE_NONE ? undefined : this.snapshots[index];
  }

  /**
   * Whether the workspace currently reflects the given snapshot.
   *
   * Callers that highlight or mark a snapshot must use this rather than
   * comparing array positions: the list is pruned and re-sorted, so a position
   * captured earlier can name a different snapshot later.
   */
  public isSnapshotActive(snapshotId: string): boolean {
    return this.activeSnapshotId === snapshotId;
  }

  /**
   * Forgets which snapshot the workspace reflects, without touching the
   * workspace itself. The store keeps every snapshot; only the claim that the
   * workspace corresponds to one is dropped.
   */
  public async clearActiveSnapshot(): Promise<void> {
    this.activeSnapshotId = null;
    await this.saveSnapshotIndex();
    this._onDidChangeSnapshots.fire();
  }

  /**
   * The snapshot a new snapshot should diff against.
   *
   * That is the snapshot the workspace reflects. When nothing is active the
   * base is the newest snapshot, which is the right default: a fresh window
   * holds the newest state. The two cases were previously indistinguishable
   * because both were read from the same stored position.
   */
  private getDiffBaseSnapshot(): Snapshot | undefined {
    const active = this.getActiveSnapshot();
    if (active) {
      return active;
    }
    return this.snapshots.length > 0
      ? this.snapshots[this.snapshots.length - 1]
      : undefined;
  }

  /**
   * Rescan integrity. Must be called after anything that changes `snapshots`.
   */
  private refreshIntegrityReport(): void {
    this.integrityReport = scanSnapshotIntegrity(this.snapshots);
    if (this.integrityReport.unrecoverableFileCount > 0) {
      log(
        `Integrity: ${
          this.integrityReport.unrecoverableFileCount
        } file(s) across ${
          this.integrityReport.brokenSnapshotIds.length
        } snapshot(s) cannot be reconstructed. Missing base snapshot(s): ${
          this.integrityReport.missingBaseSnapshotIds.join(', ') || 'none'
        }.`,
      );
    }
  }

  /**
   * The most recent integrity scan. Detection is worthless if it stays in the
   * log, so the tree and the restore preview read this.
   */
  public getIntegrityReport(): SnapshotIntegrityReport {
    return this.integrityReport;
  }

  /**
   * Relative paths in one snapshot whose content cannot be reconstructed.
   */
  public getUnrecoverableFilesFor(snapshotId: string): string[] {
    return this.integrityReport.perSnapshot[snapshotId] ?? [];
  }

  /**
   * Delete a specific snapshot
   */
  public async deleteSnapshot(
    snapshotId: string,
    options?: { skipConfirm?: boolean },
  ): Promise<boolean> {
    log(`Attempting to delete snapshot: ${snapshotId}`);
    const index = this.snapshots.findIndex((s) => s.id === snapshotId);

    if (index === -1) {
      log(`Snapshot ${snapshotId} not found for deletion.`);
      vscode.window.showErrorMessage(`Snapshot ${snapshotId} not found.`);
      return false;
    }

    // Confirmation dialog. `skipConfirm` exists for non-interactive callers
    // (the integration suite), which cannot answer a modal dialog.
    if (!options?.skipConfirm) {
      const confirmation = await vscode.window.showWarningMessage(
        `Are you sure you want to delete snapshot "${
          this.snapshots[index].description || snapshotId
        }"? This cannot be undone.`,
        { modal: true }, // Make it modal to force a choice
        'Delete',
      );

      if (confirmation !== 'Delete') {
        log(`Deletion cancelled for snapshot ${snapshotId}.`);
        return false;
      }
    }

    return await this.withWriteLock(async () => {
      const lockedIndex = this.snapshots.findIndex((s) => s.id === snapshotId);
      if (lockedIndex === -1) {
        log(`Snapshot ${snapshotId} no longer exists.`);
        return false;
      }

      const snapshotToDelete = this.snapshots[lockedIndex];
      await this.purgeSnapshot(snapshotToDelete.id);

      this.snapshots.splice(lockedIndex, 1);
      log(`Removed snapshot ${snapshotId} from in-memory list.`);

      this.detachIfActiveSnapshotRemoved();

      await this.saveSnapshotIndex();
      log(`Snapshot index saved after deleting ${snapshotId}.`);

      // Deleting a snapshot can break every snapshot that used it as a base, so
      // the report must be rebuilt before listeners render the tree.
      this.refreshIntegrityReport();

      this._onDidChangeSnapshots.fire();
      log('Fired onDidChangeSnapshots event after deleteSnapshot');

      vscode.window.showInformationMessage(
        `Snapshot "${snapshotToDelete.description || snapshotId}" deleted.`,
      );
      return true;
    });
  }

  /**
   * Removes a snapshot from storage, the content cache and the semantic search
   * index. Every path that discards a snapshot must go through here, so that no
   * derived store keeps referencing it.
   *
   * `enforceSnapshotLimit` previously called `storage.deleteSnapshotData`
   * directly and never told the search service, so pruned snapshots kept their
   * vectors and stayed reachable in search results after their content was
   * gone. The content cache was fine -- `deleteSnapshotData` already clears it
   * by exact `"<snapshotId>::"` prefix, which is why the cache assertions for
   * this task already passed.
   */
  private async purgeSnapshot(snapshotId: string): Promise<void> {
    await this.storage.deleteSnapshotData(snapshotId);

    const semanticSearchService = (this as any).semanticSearchService as
      | { deleteSnapshotIndexing?: (id: string) => Promise<void> }
      | undefined;

    if (typeof semanticSearchService?.deleteSnapshotIndexing === 'function') {
      try {
        await semanticSearchService.deleteSnapshotIndexing(snapshotId);
      } catch (error) {
        // Purge is best-effort on the derived store: a failure to clear vectors
        // must not stop the snapshot itself from being removed, but it must be
        // visible rather than swallowed.
        log(
          `Purge: failed to remove search index entries for ${snapshotId}: ${error}`,
        );
      }
    }
  }

  /**
   * Public wrapper to get the content of a file from a snapshot using storage.
   * @param snapshotId The ID of the snapshot
   * @param relativePath The relative path of the file
   * @param forIndexing If true, indicates this content is being retrieved for indexing purposes
   * and shouldn't be displayed in the editor
   */
  public async getSnapshotFileContentPublic(
    snapshotId: string,
    relativePath: string,
    forIndexing = false,
  ): Promise<string | null> {
    // Use the storage method, passing the current list of all snapshots
    // for diff resolution if needed.
    // Add await here
    return await this.storage.getSnapshotFileContent(
      snapshotId,
      relativePath,
      this.snapshots,
      forIndexing,
    );
  }

  /**
   * Calculate a summary of changes (added, modified, deleted) for a given snapshot.
   * This compares the snapshot's file list against its base snapshot if available.
   */
  public getSnapshotChangeSummary(snapshotId: string): {
    added: number;
    modified: number;
    deleted: number;
  } {
    const snapshot = this.snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) {
      log(`Snapshot ${snapshotId} not found for change summary.`);
      return { added: 0, modified: 0, deleted: 0 };
    }

    let added = 0;
    let modified = 0;
    let deleted = 0;

    for (const fileData of Object.values(snapshot.files)) {
      if (fileData.deleted) {
        deleted++;
      } else if (fileData.diff) {
        modified++;
      } else if (fileData.content && !fileData.baseSnapshotId) {
        // File has full content and no base reference, likely new in this snapshot
        added++;
      } else if (
        !fileData.baseSnapshotId &&
        !fileData.diff &&
        !fileData.content
      ) {
        // This case might indicate an empty file added, treat as added? Or ignore?
        // For now, let's count it as added if it's not marked deleted and has no diff/base.
        // This might need refinement based on how empty files are stored.
        // Let's assume files always have *some* marker if they exist.
        // Revisit if empty files cause issues. If a file exists but is unchanged
        // from base, it should have `baseSnapshotId` but no `diff` or `content`.
      } else if (
        fileData.baseSnapshotId &&
        !fileData.diff &&
        !fileData.content
      ) {
        // File exists but is unchanged from base - not counted here.
      }
      // Add other potential edge cases if necessary
    }

    logVerbose(
      `Change summary for ${snapshotId}: +${added} ~${modified} -${deleted}`,
    );
    return { added, modified, deleted };
  }

  // Removed readFileContent - handled by SnapshotStorage
  // Removed getSnapshotFileContent - handled by SnapshotStorage

  /**
   * Restores a single file from a specific snapshot to the workspace.
   * @param snapshotId The ID of the snapshot to restore from.
   * @param relativePath The relative path of the file to restore.
   * @returns Promise<void>
   * @throws Error if workspace root is not found, content cannot be fetched, or write fails.
   */
  public async restoreSingleFile(
    snapshotId: string,
    relativePath: string,
  ): Promise<void> {
    log(
      `Attempting to restore single file: ${relativePath} from snapshot ${snapshotId}`,
    );

    const workspaceRoot = this.storage.getWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error('No workspace folder open to restore file into.');
    }

    // Fetch content from snapshot using the public method
    const content = await this.getSnapshotFileContentPublic(
      snapshotId,
      relativePath,
    );

    if (content === null) {
      log(
        `Cannot restore file ${relativePath} as content is null in snapshot ${snapshotId}.`,
      );
      throw new Error(
        `Cannot restore file '${relativePath}' as it might have been deleted or content is unavailable in the snapshot.`,
      );
    }

    // Get workspace file path
    const workspaceFilePath = ensureWithinDirectory(
      workspaceRoot,
      relativePath,
    );
    await assertNoSymlinkPath(workspaceRoot, workspaceFilePath);

    // Use storage method to write (handles directory creation)
    // Add await here
    await this.storage.writeFileContent(workspaceFilePath, content);

    log(
      `Successfully restored ${relativePath} from snapshot ${snapshotId} to ${workspaceFilePath}`,
    );

    // Optional: Refresh the specific editor if open?
    // For simplicity, let's rely on VS Code's file watcher for now.
    // Or potentially call refreshOpenEditors() if needed, but that refreshes all.
  }

  /**
   * Reloads open editors from disk after a restore, preserving the cursor and
   * scroll position.
   *
   * The edit is applied per document rather than as one workspace-wide edit, so
   * a single unreadable file cannot abort the refresh for the others.
   */
  private async refreshOpenEditors() {
    for (const editor of vscode.window.visibleTextEditors) {
      const document = editor.document;

      try {
        // Only real files on disk have content to re-read. A diff view, an
        // output channel or an untitled buffer has no fsPath to read.
        if (document.uri.scheme !== 'file') {
          continue;
        }

        // Never touch a buffer with unsaved changes: the replacement below is a
        // full-document overwrite, so the user's edits would vanish.
        if (document.isDirty) {
          log(
            `Skipping refresh for ${document.uri.fsPath} due to unsaved changes`,
          );
          continue;
        }

        let content: string;
        try {
          content = await fsPromises.readFile(document.uri.fsPath, 'utf8');
        } catch (error) {
          // A restore can delete the file that is still open, which is an
          // expected outcome rather than a failure to report.
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            logVerbose(
              `Skipping refresh for ${document.uri.fsPath}: the file no longer exists`,
            );
          } else {
            log(`Failed to read ${document.uri.fsPath} for refresh: ${error}`);
          }
          continue;
        }

        // Nothing changed on disk, so there is no reason to replace the buffer
        // and disturb the user's selection.
        if (content === document.getText()) {
          continue;
        }

        // Save current view state
        const selection = editor.selection;
        const visibleRanges = editor.visibleRanges;

        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length),
        );
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, fullRange, content);
        await vscode.workspace.applyEdit(edit);

        // Restore view state. `visibleRanges` is empty for a document that is
        // not laid out, and `visibleRanges[0]` would then be undefined.
        editor.selection = selection;
        if (visibleRanges.length > 0) {
          editor.revealRange(visibleRanges[0]);
        }
      } catch (error) {
        log(
          `Failed to refresh editor for ${editor.document.uri.fsPath}: ${error}`,
        );
      }
    }
  }

  /**
   * Enforce maximum snapshot limit using config and storage.
   */
  private async enforceSnapshotLimit() {
    const maxSnapshots = getMaxSnapshots(); // Use config function

    if (this.snapshots.length <= maxSnapshots) {
      return; // Limit not exceeded
    }

    const removableIds = selectPrunableSnapshots(this.snapshots, maxSnapshots);

    if (removableIds.length === 0) {
      log(
        `Snapshot limit (${maxSnapshots}) exceeded but no snapshot is safe to prune: every candidate is referenced by a snapshot that would survive. Keeping ${this.snapshots.length} snapshots.`,
      );
      return;
    }
    const requested = this.snapshots.length - maxSnapshots;
    if (removableIds.length < requested) {
      log(
        `Snapshot limit (${maxSnapshots}) exceeded by ${requested} but only ${removableIds.length} snapshot(s) are safe to prune. Keeping the rest to preserve referential integrity.`,
      );
    }

    const removable = new Set(removableIds);
    const removedSnapshots = this.snapshots.filter((s) => removable.has(s.id));

    this.snapshots = this.snapshots.filter((s) => !removable.has(s.id));

    // Pruning takes from the oldest end, so it can remove the snapshot the
    // workspace reflects. Identity survives reordering, which is why the
    // reference is stored as an id: the old arithmetic adjustment of a stored
    // position was only correct while the removed set was a prefix.
    this.detachIfActiveSnapshotRemoved();

    // Delete snapshot data using storage
    for (const snapshot of removedSnapshots) {
      await this.purgeSnapshot(snapshot.id);
    }

    // Update index since snapshots were removed
    await this.saveSnapshotIndex();

    // Emit event if snapshots were actually removed
    if (removedSnapshots.length > 0) {
      // Pruning removes deltas other snapshots may depend on, so rebuild the
      // report before listeners render. (The early returns above do not change
      // the list, so they need no refresh.)
      this.refreshIntegrityReport();
      this._onDidChangeSnapshots.fire();
      log(
        `Pruned ${removedSnapshots.length} snapshot(s); ${this.snapshots.length} remain. Fired onDidChangeSnapshots event after enforceSnapshotLimit`,
      );
    }
  }

  /**
   * Updates the context fields of an existing snapshot
   * @param snapshotId The ID of the snapshot to update
   * @param contextUpdate The fields to update
   * @returns Promise resolving to true if successful
   */
  public async updateSnapshotContext(
    snapshotId: string,
    contextUpdate: {
      tags?: string[];
      notes?: string;
      taskReference?: string;
      isFavorite?: boolean;
      description?: string;
    },
  ): Promise<boolean> {
    return await this.withWriteLock(async () => {
      log(`Updating context for snapshot: ${snapshotId}`);

      const index = this.snapshots.findIndex((s) => s.id === snapshotId);
      if (index === -1) {
        log(`Snapshot ${snapshotId} not found for context update.`);
        throw new Error(`Snapshot with ID ${snapshotId} not found.`);
      }

      const snapshot = this.snapshots[index];

      if (contextUpdate.tags !== undefined) {
        snapshot.tags = contextUpdate.tags;
      }
      if (contextUpdate.notes !== undefined) {
        snapshot.notes = contextUpdate.notes;
      }
      if (contextUpdate.taskReference !== undefined) {
        snapshot.taskReference = contextUpdate.taskReference;
      }
      if (contextUpdate.isFavorite !== undefined) {
        snapshot.isFavorite = contextUpdate.isFavorite;
      }
      if (contextUpdate.description !== undefined) {
        snapshot.description = contextUpdate.description;
      }

      try {
        await this.storage.saveSnapshotData(snapshot);
        log(`Successfully updated context for snapshot ${snapshotId}`);
        this._onDidChangeSnapshots.fire();
        return true;
      } catch (error) {
        log(`Error updating context for snapshot ${snapshotId}: ${error}`);
        throw new Error(`Failed to update snapshot context: ${error}`);
      }
    });
  }

  // Removed deleteDirectory - handled by SnapshotStorage
  // Removed log - handled by logger module
  // Removed temp-method
}
