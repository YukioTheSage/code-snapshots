import * as vscode from 'vscode'; // Ensure vscode is imported for QuickPick etc.
// import * as fs from 'fs'; // Removed unused import
import * as path from 'path';
import * as crypto from 'crypto';
import { promises as fsPromises } from 'fs'; // Import promises API
import { GitignoreParser } from './gitignoreParser';
import { log, logVerbose } from './logger';
import { getMaxSnapshots } from './config';
import { createDiff } from './snapshotDiff'; // Removed unused applyDiff import
import { SnapshotStorage } from './snapshotStorage';
import { API as GitAPI } from './types/git'; // Import Git API type

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

export class SnapshotManager {
  private snapshots: Snapshot[] = [];
  private currentSnapshotIndex = -1;
  private storage: SnapshotStorage;
  private gitApi: GitAPI | null; // Store Git API instance
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
      this.currentSnapshotIndex = loadedState.currentIndex;
      log(
        `Loaded ${this.snapshots.length} snapshots, current index: ${this.currentSnapshotIndex}`,
      );
    } else {
      // Handle case where loading failed critically (should be logged by storage)
      this.snapshots = [];
      this.currentSnapshotIndex = -1;
      log('Snapshot loading failed or returned null state.');
    }
    // No need to sort here, assuming storage returns them sorted
    this._onDidChangeSnapshots.fire(); // Notify listeners about the loaded state
  }

  /**
   * Save snapshots index using the SnapshotStorage module.
   */
  private async saveSnapshotIndex() {
    // No await needed here as saveSnapshotIndex in storage is already async
    await this.storage.saveSnapshotIndex(
      this.snapshots,
      this.currentSnapshotIndex,
    );
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
  ): Promise<Snapshot> {
    const workspaceRoot = this.storage.getWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error('No workspace folder open');
    }

    // Create a new snapshot
    const timestamp = Date.now();
    const id = `snapshot-${timestamp}-${crypto.randomBytes(4).toString('hex')}`;

    // Instantiate the gitignore parser
    const parser = new GitignoreParser(workspaceRoot);
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
    let finalFiles = Array.from(finalFileUrisMap.values());
    log(`Final file count after combining negated rules: ${finalFiles.length}`);
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
    const baseSnapshot =
      this.currentSnapshotIndex >= 0
        ? this.snapshots[this.currentSnapshotIndex]
        : undefined;

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
    for (const file of finalFiles) {
      // File was NOT ignored by the new logic, so we process it
      logVerbose(`Including file in snapshot: ${file.fsPath}`);

      // Skip binary files and files we can't read (using storage method)
      try {
        const relativePath = path.relative(workspaceRoot, file.fsPath);

        if (this.storage.isBinaryFile(file.fsPath)) {
          // Record it exists, but don't store content
          snapshot.files[relativePath] = {
            isBinary: true,
            // If file was in previous snapshot, keep the reference
            baseSnapshotId: baseSnapshot?.files[relativePath]?.baseSnapshotId,
          };
          logVerbose(`Recorded binary file presence: ${relativePath}`);
          continue; // Skip content reading for binary files
        }

        // Add await here
        const content = await this.storage.readFileContent(file.fsPath); // Use storage method
        if (content === null) {
          logVerbose(`Skipping file with null content: ${file.fsPath}`);
          continue; // Skip binary or unreadable files
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
    }

    // Check for files that existed in the previous snapshot but don't exist anymore
    // These represent deleted files that need to be tracked
    if (baseSnapshot) {
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
        return this.snapshots[this.currentSnapshotIndex];
      }
    }

    // Save the snapshot data using storage
    try {
      // Add await here
      await this.storage.saveSnapshotData(snapshot);
    } catch (error) {
      // Handle potential save error (logged by storage, but maybe show user message?)
      vscode.window.showErrorMessage(`Failed to save snapshot data: ${error}`);
      throw error; // Re-throw so the command fails
    }

    // Add to our in-memory list
    this.snapshots.push(snapshot);
    this.currentSnapshotIndex = this.snapshots.length - 1;

    // Update the index file
    await this.saveSnapshotIndex();

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

    return snapshot;
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

    // 1. Get current workspace files (using existing filtering logic)
    // TODO: Consider extracting this file filtering logic into a reusable private method
    const parser = new GitignoreParser(workspaceRoot);
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
    for (const [relativePath, fileData] of expectedSnapshotFiles.entries()) {
      if (fileData.deleted) continue; // Handle deletions separately

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
        continue; // Skip further comparison for binary files
      }

      const workspacePath = path.join(workspaceRoot, relativePath);
      let workspaceContent: string | null = null;
      let snapshotContent: string | null = null;
      let isDirty = false;

      // Check if file exists in workspace and if it's dirty
      if (currentWorkspaceFilesRelative.has(relativePath)) {
        try {
          workspaceContent = await this.storage.readFileContent(workspacePath); // Use storage method
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
    }

    // Check for deletions
    for (const relativePath of currentWorkspaceFilesRelative) {
      if (
        !expectedSnapshotFiles.has(relativePath) ||
        expectedSnapshotFiles.get(relativePath)?.deleted
      ) {
        // File exists in workspace but not in snapshot (or marked deleted): Deletion
        const workspacePath = path.join(workspaceRoot, relativePath);

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
          const fullPath = path.join(workspaceRoot, relativePath);
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
   * Applies the file changes necessary to restore a specific snapshot.
   * This method performs the core file operations (add, modify, delete)
   * but does NOT handle UI interactions like previews, confirmations, or conflict checks.
   * @param snapshotId The ID of the snapshot to restore.
   * @returns A promise resolving to true if successful, false otherwise.
   * @throws Error if workspace root is not found or snapshot is invalid.
   */
  public async applySnapshotRestore(snapshotId: string): Promise<boolean> {
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
    const parser = new GitignoreParser(workspaceRoot);
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
      expectedSnapshotFiles.set(relativePath, { deleted: fileData.deleted });
    });

    let restoredCount = 0;
    let deletedCount = 0;
    const fileOpPromises: Promise<void>[] = [];

    // 1. Handle Deletions: Files in workspace but not in snapshot (or marked deleted)
    currentWorkspaceFilesRelative.forEach((relativePath) => {
      if (
        !expectedSnapshotFiles.has(relativePath) ||
        expectedSnapshotFiles.get(relativePath)?.deleted
      ) {
        const fullPath = path.join(workspaceRoot, relativePath);

        // CRITICAL FIX: Preserve binary files even if they weren't in the snapshot
        if (this.storage.isBinaryFile(fullPath)) {
          logVerbose(
            `Restore Apply: Preserving binary file not tracked in snapshot: ${relativePath}`,
          );
          // Don't add to deletion operations
        } else {
          logVerbose(
            `Restore Apply: Deleting extraneous/marked-deleted file: ${relativePath}`,
          );
          fileOpPromises.push(
            this.storage.deleteWorkspaceFile(fullPath).then(() => {
              deletedCount++;
            }),
          );
        }
      }
    });

    // 2. Handle Restorations/Additions: Files in snapshot (and not marked deleted)
    expectedSnapshotFiles.forEach(async (fileData, relativePath) => {
      if (!fileData.deleted) {
        const fullPath = path.join(workspaceRoot, relativePath);

        if (fileData.isBinary) {
          // Don't attempt to restore content for binary files
          // They're just tracked for existence, not content
          logVerbose(
            `Restore Apply: Binary file in snapshot, no content to restore: ${relativePath}`,
          );
          return; // Skip content restoration for binary files
        }

        // Get content (this handles diff application internally via storage method)
        const contentPromise = this.storage.getSnapshotFileContent(
          snapshot.id,
          relativePath,
          this.snapshots,
        );
        fileOpPromises.push(
          contentPromise
            .then(async (content) => {
              if (content !== null) {
                logVerbose(
                  `Restore Apply: Writing content for file: ${relativePath}`,
                );
                await this.storage.writeFileContent(fullPath, content);
                restoredCount++;
              } else {
                log(
                  `Restore Apply: Skipping file with null/unresolved content: ${relativePath}`,
                );
              }
            })
            .catch((error) => {
              // Log error but allow other operations to continue
              log(
                `Restore Apply: Error processing file ${relativePath}: ${error}`,
              );
              // Optionally re-throw if one failure should stop the whole process
            }),
        );
      } else if (!currentWorkspaceFilesRelative.has(relativePath)) {
        // Also ensure files marked deleted in snapshot *and* not present in workspace are handled (idempotency)
        logVerbose(
          `Restore Apply: File marked deleted and not in workspace, no action needed: ${relativePath}`,
        );
      }
    });

    // Wait for all file operations to complete
    try {
      await Promise.all(fileOpPromises);
      log(
        `Restore Apply summary for ${snapshotId}: ${restoredCount} files restored/added, ${deletedCount} files deleted.`,
      );
    } catch (error) {
      log(
        `Restore Apply: Error during file operations for ${snapshotId}: ${error}`,
      );
      // Re-throw the error to indicate failure to the caller (command handler)
      throw new Error(`Failed to apply snapshot restore: ${error}`);
    }

    // --- UI Summary Message REMOVED ---
    // This will be handled by the command handler

    // Update current snapshot index
    this.currentSnapshotIndex = index;
    await this.saveSnapshotIndex();

    // Refresh open editors to reflect changes
    await this.refreshOpenEditors();

    // Notify listeners (e.g., tree view) about the change
    this._onDidChangeSnapshots.fire();
    log(`Successfully applied restore for snapshot ${snapshotId}`);

    return true; // Indicate success
  }

  /**
   * Navigate to previous snapshot (Uses applySnapshotRestore internally)
   */
  public async navigateToPreviousSnapshot(): Promise<boolean> {
    if (this.currentSnapshotIndex <= 0) {
      log('No previous snapshot available to navigate to.');
      return false; // No previous snapshot
    }

    const prevSnapshotId = this.snapshots[this.currentSnapshotIndex - 1].id;
    log(`Navigating to previous snapshot: ${prevSnapshotId}`);
    // Note: applySnapshotRestore doesn't handle UI/confirmation,
    // so this direct call bypasses that. The command handler for
    // 'previousSnapshot' should orchestrate the full flow if needed.
    // For now, assume direct application is intended for nav commands.
    // Consider if nav commands should also have preview/confirm.
    return await this.applySnapshotRestore(prevSnapshotId);
  }

  /**
   * Navigate to next snapshot (Uses applySnapshotRestore internally)
   */
  public async navigateToNextSnapshot(): Promise<boolean> {
    if (this.currentSnapshotIndex >= this.snapshots.length - 1) {
      log('No next snapshot available to navigate to.');
      return false; // No next snapshot
    }

    const nextSnapshotId = this.snapshots[this.currentSnapshotIndex + 1].id;
    log(`Navigating to next snapshot: ${nextSnapshotId}`);
    // See note in navigateToPreviousSnapshot regarding UI/confirmation bypass.
    return await this.applySnapshotRestore(nextSnapshotId);
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
    return this.currentSnapshotIndex;
  }

  /**
   * Delete a specific snapshot
   */
  public async deleteSnapshot(snapshotId: string): Promise<boolean> {
    log(`Attempting to delete snapshot: ${snapshotId}`);
    const index = this.snapshots.findIndex((s) => s.id === snapshotId);

    if (index === -1) {
      log(`Snapshot ${snapshotId} not found for deletion.`);
      vscode.window.showErrorMessage(`Snapshot ${snapshotId} not found.`);
      return false;
    }

    // Confirmation dialog
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

    const snapshotToDelete = this.snapshots[index];

    // Delete the snapshot data using storage
    // Add await here
    await this.storage.deleteSnapshotData(snapshotToDelete.id);
    // Note: deleteSnapshotData handles logging and errors internally

    // Remove from the snapshots array
    this.snapshots.splice(index, 1);
    log(`Removed snapshot ${snapshotId} from in-memory list.`);

    // Adjust currentSnapshotIndex if necessary
    if (this.snapshots.length === 0) {
      this.currentSnapshotIndex = -1;
      log('No snapshots left, resetting current index.');
    } else if (index <= this.currentSnapshotIndex) {
      // If deleted snapshot was at or before the current one, decrement index
      // (Handles deleting the current one, or one before it)
      // Use max to ensure index doesn't go below -1 if the first was deleted
      this.currentSnapshotIndex = Math.max(-1, this.currentSnapshotIndex - 1);
      log(
        `Adjusted current index due to deletion: ${this.currentSnapshotIndex}`,
      );
    }
    // If index > currentSnapshotIndex, no adjustment needed

    // Delete semantic search data
    const semanticSearchService = (this as any).semanticSearchService;
    if (semanticSearchService) {
      try {
        await semanticSearchService.deleteSnapshotIndexing(snapshotToDelete.id);
      } catch (error) {
        log(`Error deleting semantic search data: ${error}`);
      }
    }

    // Save the updated index
    await this.saveSnapshotIndex();
    log(`Snapshot index saved after deleting ${snapshotId}.`);

    // Emit event
    this._onDidChangeSnapshots.fire();
    log('Fired onDidChangeSnapshots event after deleteSnapshot');

    vscode.window.showInformationMessage(
      `Snapshot "${snapshotToDelete.description || snapshotId}" deleted.`,
    );
    return true;
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
    const workspaceFilePath = path.join(workspaceRoot, relativePath);

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
   * Refresh all open editors to show updated content after a restore.
   * TODO: This might be better placed in extension.ts or a dedicated UI update module.
   */
  private async refreshOpenEditors() {
    for (const editor of vscode.window.visibleTextEditors) {
      try {
        const document = editor.document;

        // Skip documents with unsaved changes
        if (document.isDirty) {
          log(
            `Skipping refresh for ${document.uri.fsPath} due to unsaved changes`,
          );
          continue;
        }

        // Save current view state
        const selection = editor.selection;
        const visibleRanges = editor.visibleRanges;

        // Read and update content
        const content = await fsPromises.readFile(document.uri.fsPath, 'utf8');
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length),
        );

        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, fullRange, content);
        await vscode.workspace.applyEdit(edit);

        // Restore view state
        editor.selection = selection;
        editor.revealRange(visibleRanges[0]);
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

    log(
      `Snapshot limit (${maxSnapshots}) exceeded. Removing oldest snapshots.`,
    );
    // Remove oldest snapshots from the beginning of the array
    const toRemoveCount = this.snapshots.length - maxSnapshots;
    const removedSnapshots = this.snapshots.splice(0, toRemoveCount);

    // Adjust current index since we removed items from the beginning
    this.currentSnapshotIndex = Math.max(
      -1,
      this.currentSnapshotIndex - toRemoveCount,
    );
    log(
      `Removed ${toRemoveCount} oldest snapshots. New current index: ${this.currentSnapshotIndex}`,
    );

    // Delete snapshot data using storage
    // Add await inside map function
    const deletePromises = removedSnapshots.map(
      async (snapshot) => await this.storage.deleteSnapshotData(snapshot.id),
    );
    await Promise.all(deletePromises); // Wait for all deletions

    // Update index since snapshots were removed
    await this.saveSnapshotIndex();

    // Emit event if snapshots were actually removed
    if (removedSnapshots.length > 0) {
      this._onDidChangeSnapshots.fire();
      log('Fired onDidChangeSnapshots event after enforceSnapshotLimit');
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
    log(`Updating context for snapshot: ${snapshotId}`);

    // Find the snapshot
    const index = this.snapshots.findIndex((s) => s.id === snapshotId);
    if (index === -1) {
      log(`Snapshot ${snapshotId} not found for context update.`);
      throw new Error(`Snapshot with ID ${snapshotId} not found.`);
    }

    const snapshot = this.snapshots[index];

    // Update each field if provided
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

    // Save the updated snapshot
    try {
      await this.storage.saveSnapshotData(snapshot);
      log(`Successfully updated context for snapshot ${snapshotId}`);

      // Notify listeners of the change
      this._onDidChangeSnapshots.fire();

      return true;
    } catch (error) {
      log(`Error updating context for snapshot ${snapshotId}: ${error}`);
      throw new Error(`Failed to update snapshot context: ${error}`);
    }
  }

  // Removed deleteDirectory - handled by SnapshotStorage
  // Removed log - handled by logger module
  // Removed temp-method
}
