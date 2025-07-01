import * as vscode from 'vscode';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { log, logVerbose } from './logger';
import { Snapshot } from './snapshotManager';
import { applyDiff } from './snapshotDiff';
import { SnapshotContentProvider } from './snapshotContentProvider';
import { getSnapshotLocation } from './config';

// Interface for the snapshot index file structure
interface SnapshotIndex {
  snapshots: Array<{ id: string; timestamp: number; description: string }>;
  currentIndex: number;
}

export class SnapshotStorage {
  private snapshotDirectory = '';
  private workspaceRoot = '';
  // Cache for getSnapshotFileContent results
  private contentCache: Map<string, string | null> = new Map();
  private readonly MAX_CACHE_SIZE = 100; // Example cache size limit

  constructor() {
    this.initializeStoragePath();
    // Watch for workspace folder changes to update the path
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.initializeStoragePath();
      this.contentCache.clear(); // Clear cache on workspace change
    });
  }

  private initializeStoragePath() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      this.workspaceRoot = workspaceFolder.uri.fsPath;
      const snapshotLocationRelative = getSnapshotLocation();
      this.snapshotDirectory = path.join(
        this.workspaceRoot,
        snapshotLocationRelative,
      );
      log(`Snapshot storage directory set to: ${this.snapshotDirectory}`);
      // No need for sync ensureDirectoryExists call here anymore
    } else {
      this.workspaceRoot = '';
      this.snapshotDirectory = '';
      log('No workspace folder found, snapshot storage path not set.');
    }
    // Ensure directory exists asynchronously during initialization
    this.ensureDirectoryExistsAsync(this.snapshotDirectory).catch((error) => {
      // Log error if initial creation fails, but don't block constructor
      log(
        `Initial creation of snapshot directory failed (might exist already or permission issue): ${error}`,
      );
    });
  }

  // Convert to async using fsPromises.mkdir
  private async ensureDirectoryExistsAsync(dirPath: string): Promise<void> {
    if (!dirPath) return; // No path provided

    try {
      // fsPromises.mkdir with recursive: true handles existence check implicitly
      // and creates parent directories if needed.
      await fsPromises.mkdir(dirPath, { recursive: true });
      logVerbose(`Ensured directory exists: ${dirPath}`);
    } catch (error) {
      // Handle errors except 'already exists'
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') {
        log(
          `Error ensuring directory exists ${dirPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw err;
      } else {
        logVerbose(`Directory already exists: ${dirPath}`);
      }
    }
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  public getSnapshotDirectory(): string {
    return this.snapshotDirectory;
  }

  /**
   * Loads the snapshot index and metadata asynchronously.
   * Returns the list of snapshots and the current index, or null if loading fails.
   */
  public async loadSnapshotIndexAndMetadata(): Promise<{
    snapshots: Snapshot[];
    currentIndex: number;
  } | null> {
    if (!this.snapshotDirectory) {
      log('Cannot load snapshots, storage directory not initialized.');
      return { snapshots: [] as Snapshot[], currentIndex: -1 }; // Return empty state
    }

    const indexFilePath = path.join(this.snapshotDirectory, 'index.json');
    log(`Loading snapshot index from: ${indexFilePath}`);

    let indexData: SnapshotIndex | null = null;

    // Use async readFile and handle potential ENOENT error
    try {
      const content = await fsPromises.readFile(indexFilePath, 'utf8');
      indexData = JSON.parse(content) as SnapshotIndex;
      log(`Successfully parsed index file.`);
      // If parse succeeded, proceed to load snapshots based on indexData
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        log('Snapshot index file not found. Attempting recovery if possible.');
      } else {
        log(
          `Error reading or parsing snapshot index file: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        vscode.window.showWarningMessage(
          `Snapshot index file is corrupted. Attempting recovery...`,
        );
      }
    }

    let loadedSnapshots: Snapshot[] = [];
    let currentSnapshotIndex = -1;

    // If indexData was successfully loaded and parsed
    if (indexData?.snapshots) {
      log(
        `Index contains ${indexData.snapshots.length} entries. Loading full snapshot data...`,
      );
      // Load full data based on index - use Promise.all for concurrency
      const snapshotPromises = indexData.snapshots.map((snapshotInfo) =>
        this.readSnapshotData(snapshotInfo.id).then((fullSnapshot) => {
          if (fullSnapshot) {
            // Basic validation: Check if ID matches
            if (fullSnapshot.id !== snapshotInfo.id) {
              log(
                `Warning: Snapshot ID mismatch for ${snapshotInfo.id}. Index vs snapshot.json (${fullSnapshot.id}). Using data from snapshot.json.`,
              );
            }
            return fullSnapshot;
          } else {
            log(
              `Failed to load full data for snapshot ${snapshotInfo.id} listed in index. Skipping.`,
            );
            return null; // Return null for failed loads
          }
        }),
      );

      // Wait for all snapshots to load and filter out nulls
      const loadedResults = await Promise.all(snapshotPromises);
      loadedSnapshots = loadedResults.filter((s): s is Snapshot => s !== null);

      currentSnapshotIndex = indexData.currentIndex ?? -1;
      log(
        `Loaded ${loadedSnapshots.length} snapshots based on index. Initial index: ${currentSnapshotIndex}`,
      );
    } else {
      // Attempt recovery if indexData is null (due to read error or file not found)
      try {
        await fsPromises.access(this.snapshotDirectory); // Check directory existence/accessibility
        log('Attempting snapshot recovery from file system...');
        loadedSnapshots = await this.recoverSnapshotsFromFileSystem();
        if (loadedSnapshots.length > 0) {
          currentSnapshotIndex = loadedSnapshots.length - 1; // Default to latest
          log(
            `Recovery successful. Found ${loadedSnapshots.length} snapshots. Setting index to ${currentSnapshotIndex}.`,
          );
          await this.saveSnapshotIndex(loadedSnapshots, currentSnapshotIndex);
          vscode.window.showInformationMessage(
            `Recovered ${loadedSnapshots.length} snapshots.`,
          );
        } else {
          log('Recovery attempt found no valid snapshots.');
        }
      } catch (error) {
        // Log error but don't crash, return empty array
        log(`Error during file system recovery scan: ${error}`);
        return { snapshots: [] as Snapshot[], currentIndex: -1 };
      }
    }

    // Sort snapshots by timestamp (important after recovery or if index order was wrong)
    loadedSnapshots.sort((a, b) => a.timestamp - b.timestamp);

    // Validate and adjust current index
    if (currentSnapshotIndex >= loadedSnapshots.length) {
      log(
        `Warning: Current index ${currentSnapshotIndex} is out of bounds (${loadedSnapshots.length} snapshots). Resetting.`,
      );
      currentSnapshotIndex =
        loadedSnapshots.length > 0 ? loadedSnapshots.length - 1 : -1;
    } else if (currentSnapshotIndex < -1) {
      log(
        `Warning: Current index ${currentSnapshotIndex} is invalid. Resetting to -1.`,
      );
      currentSnapshotIndex = -1;
    }

    log(
      `Final loaded snapshot count: ${loadedSnapshots.length}, Current Index: ${currentSnapshotIndex}`,
    );
    this.contentCache.clear(); // Clear cache on load/reload
    return { snapshots: loadedSnapshots, currentIndex: currentSnapshotIndex };
  }

  /**
   * Reads the full snapshot data from its snapshot.json file asynchronously.
   */
  private async readSnapshotData(snapshotId: string): Promise<Snapshot | null> {
    if (!this.snapshotDirectory) return null;
    const snapshotJsonPath = path.join(
      this.snapshotDirectory,
      snapshotId,
      'snapshot.json',
    );
    // Use async readFile and handle potential ENOENT error
    try {
      const snapshotContent = await fsPromises.readFile(
        snapshotJsonPath,
        'utf8',
      );
      const fullSnapshotData = JSON.parse(snapshotContent) as Snapshot;
      // Basic validation
      if (fullSnapshotData.id && fullSnapshotData.timestamp) {
        return fullSnapshotData;
      } else {
        log(
          `Invalid snapshot.json for ${snapshotId}: missing id or timestamp.`,
        );
        return null;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        log(`File not found: ${snapshotJsonPath}`);
      } else {
        log(`Error reading snapshot.json for ${snapshotId}: ${error}`);
      }
      return null;
    }
  }

  /**
   * Scans the snapshot directory asynchronously to recover snapshots.
   */
  private async recoverSnapshotsFromFileSystem(): Promise<Snapshot[]> {
    if (!this.snapshotDirectory) {
      return []; // Should have been checked before calling, but safeguard
    }

    try {
      // Use async readdir
      const entries = await fsPromises.readdir(this.snapshotDirectory, {
        withFileTypes: true,
      });
      const recoveryPromises = entries
        .filter(
          (entry) => entry.isDirectory() && entry.name.startsWith('snapshot-'),
        )
        .map(async (entry) => {
          const snapshotData = await this.readSnapshotData(entry.name);
          if (snapshotData) {
            logVerbose(`Recovered snapshot via file scan: ${snapshotData.id}`);
            return snapshotData;
          }
          return null;
        });

      const results = await Promise.all(recoveryPromises);
      return results.filter((s): s is Snapshot => s !== null);
    } catch (error) {
      // Log error but don't crash, return empty array
      log(`Error during file system recovery scan: ${error}`);
      return [];
    }
  }

  /**
   * Saves the snapshot index file asynchronously.
   */
  public async saveSnapshotIndex(
    snapshots: Snapshot[],
    currentIndex: number,
  ): Promise<void> {
    if (!this.snapshotDirectory) {
      log('Cannot save index, storage directory not initialized.');
      return;
    }
    const indexFilePath = path.join(this.snapshotDirectory, 'index.json');
    const indexContent: SnapshotIndex = {
      snapshots: snapshots.map((s) => ({
        id: s.id,
        timestamp: s.timestamp,
        description: s.description,
      })),
      currentIndex: currentIndex,
    };

    try {
      // Use async writeFile
      await fsPromises.writeFile(
        indexFilePath,
        JSON.stringify(indexContent, null, 2),
        'utf8',
      );
      logVerbose(`Snapshot index saved to ${indexFilePath}`);
    } catch (error) {
      log(`Error saving snapshot index: ${error}`);
      vscode.window.showErrorMessage(`Failed to save snapshot index: ${error}`);
    }
  }

  /**
   * Saves the full snapshot data (snapshot.json) asynchronously.
   */
  public async saveSnapshotData(snapshot: Snapshot): Promise<void> {
    if (!this.snapshotDirectory) {
      log(`Cannot save snapshot ${snapshot.id}, storage directory not set.`);
      throw new Error('Snapshot storage directory not initialized.');
    }
    const snapshotDir = path.join(this.snapshotDirectory, snapshot.id);
    await this.ensureDirectoryExistsAsync(snapshotDir);

    const snapshotMetaPath = path.join(snapshotDir, 'snapshot.json');
    try {
      // Use async writeFile
      await fsPromises.writeFile(
        snapshotMetaPath,
        JSON.stringify(snapshot, null, 2),
        'utf8',
      );
      logVerbose(`Saved snapshot metadata to ${snapshotMetaPath}`);
    } catch (error) {
      log(`Error saving snapshot metadata for ${snapshot.id}: ${error}`);
      vscode.window.showErrorMessage(`Failed to save snapshot data: ${error}`);
      throw error; // Re-throw to indicate failure
    }
  }

  /**
   * Deletes a snapshot's directory asynchronously.
   */
  public async deleteSnapshotData(snapshotId: string): Promise<void> {
    if (!this.snapshotDirectory) {
      log(`Cannot delete snapshot ${snapshotId}, storage directory not set.`);
      return;
    }
    const snapshotDir = path.join(this.snapshotDirectory, snapshotId);
    log(`Attempting to delete snapshot directory: ${snapshotDir}`);
    try {
      // Use async recursive delete
      await this.deleteDirectoryRecursiveAsync(snapshotDir);
      log(`Successfully deleted snapshot directory: ${snapshotDir}`);
      this.clearCacheForSnapshot(snapshotId); // Clear cache entries for deleted snapshot
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        log(`Snapshot directory not found, skipping deletion: ${snapshotDir}`);
      } else if ((error as NodeJS.ErrnoException).code === 'EISDIR') {
        log(
          `Attempted to delete a directory as a file during unlink: ${snapshotDir}`,
        );
      } else {
        log(`Failed to delete snapshot directory ${snapshotDir}: ${error}`);
        vscode.window.showErrorMessage(
          `Failed to delete snapshot files for ${snapshotId}: ${error}`,
        );
      }
    }
  }

  /**
   * Recursively deletes a directory asynchronously using fsPromises.rm.
   */
  private async deleteDirectoryRecursiveAsync(dirPath: string): Promise<void> {
    try {
      await fsPromises.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      log(`Error using fsPromises.rm on ${dirPath}: ${error}`);
      throw error;
    }
  }

  /**
   * Reads the content of a file in the workspace asynchronously, skipping known binary types.
   * Returns null if binary, read error occurs, or file doesn't exist.
   */
  public async readFileContent(absolutePath: string): Promise<string | null> {
    // Check existence and type first asynchronously
    try {
      const stats = await fsPromises.stat(absolutePath);
      if (!stats.isFile()) {
        logVerbose(`Path is not a file, skipping read: ${absolutePath}`);
        return null;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logVerbose(`File not found, skipping read: ${absolutePath}`);
      } else {
        log(`Warning: Error checking file status ${absolutePath}: ${error}`);
      }
      return null;
    }

    // Proceed with reading if stat succeeded and it's a file
    try {
      const ext = path.extname(absolutePath).toLowerCase();
      const binaryExtensions = [
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.bmp',
        '.tiff',
        '.ico',
        '.zip',
        '.tar',
        '.gz',
        '.rar',
        '.7z',
        '.exe',
        '.dll',
        '.obj',
        '.so',
        '.dylib',
        '.pdf',
        '.doc',
        '.docx',
        '.xls',
        '.xlsx',
        '.ppt',
        '.pptx',
        '.mp3',
        '.wav',
        '.ogg',
        '.mp4',
        '.avi',
        '.mov',
        '.wmv',
        '.sqlite',
        '.db',
        '.jar',
        '.class',
      ];
      if (binaryExtensions.includes(ext)) {
        logVerbose(`Skipping binary file: ${absolutePath}`);
        return null;
      }

      const content = await fsPromises.readFile(absolutePath, 'utf8');

      if (content.includes('\u0000')) {
        logVerbose(
          `Skipping file with null bytes (likely binary): ${absolutePath}`,
        );
        return null;
      }
      return content;
    } catch (error) {
      log(`Warning: Error reading file content ${absolutePath}: ${error}`);
      return null;
    }
  }

  /**
   * Checks if a file is likely a binary file based on its extension.
   * Used both during reading and to prevent accidentally deleting binary files during restoration.
   * @param filePath The absolute path to the file
   * @returns true if the file is likely binary based on extension
   */
  public isBinaryFile(filePath: string): boolean {
    // 1. Check by extension first (most efficient)
    const ext = path.extname(filePath).toLowerCase();

    // Expanded list of binary extensions
    const binaryExtensions = [
      // Images
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.bmp',
      '.tiff',
      '.ico',
      '.webp',
      '.avif',
      // Archives
      '.zip',
      '.tar',
      '.gz',
      '.rar',
      '.7z',
      '.bz2',
      '.xz',
      '.ar',
      '.iso',
      // Executables
      '.exe',
      '.dll',
      '.so',
      '.dylib',
      '.bin',
      '.pyc',
      '.pyd',
      '.obj',
      '.lib',
      '.a',
      // Documents
      '.pdf',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
      '.ppt',
      '.pptx',
      // Media
      '.mp3',
      '.wav',
      '.ogg',
      '.mp4',
      '.avi',
      '.mov',
      '.wmv',
      '.flv',
      '.mkv',
      // Databases
      '.sqlite',
      '.db',
      '.mdb',
      '.accdb',
      '.frm',
      '.dbf',
      // Java
      '.jar',
      '.class',
      // Other
      '.ttf',
      '.otf',
      '.woff',
      '.woff2',
      '.eot',
      '.bin',
      '.dat',
    ];

    if (binaryExtensions.includes(ext)) {
      return true;
    }

    // 2. For unknown extensions, check file name patterns
    const binaryFilePatterns = [
      /^\.DS_Store$/, // macOS metadata
      /^thumbs\.db$/i, // Windows thumbnail cache
      /^desktop\.ini$/i, // Windows folder settings
      /^ntuser\.dat/i, // Windows user profile
      /^NTUSER\.DAT/i, // Windows user profile (uppercase)
      /^\$RECYCLE\.BIN$/i, // Windows recycle bin
      /^\.git\/objects\/.*$/, // Git objects
    ];

    const fileName = path.basename(filePath);
    if (binaryFilePatterns.some((pattern) => pattern.test(fileName))) {
      return true;
    }

    // 3. For common development patterns, add heuristics
    // Check if the file is in a build/dist directory
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
    if (
      normalizedPath.includes('/dist/') ||
      normalizedPath.includes('/build/') ||
      normalizedPath.includes('/bin/') ||
      normalizedPath.includes('/node_modules/')
    ) {
      // Apply stricter rules for known build directories
      if (
        !ext ||
        !['.js', '.css', '.html', '.json', '.txt', '.md', '.map'].includes(ext)
      ) {
        return true;
      }
    }

    // We can't do content-based detection synchronously without blocking
    // so we have to default to false for unknown files
    return false;
  }

  /**
   * Performs async binary content check for files that might be misclassified
   * by the extension-based approach
   */
  public async checkSuspiciousFilesForBinaryContent(
    filePaths: string[],
  ): Promise<Set<string>> {
    const binaryFilePaths = new Set<string>();

    // Only check a reasonable number of files
    const filesToCheck = filePaths.slice(0, 100);

    await Promise.all(
      filesToCheck.map(async (filePath) => {
        try {
          // Check if file exists and is readable
          const stats = await fsPromises.stat(filePath);
          if (!stats.isFile() || stats.size <= 0) {
            return;
          }

          // Skip very large files (likely binary)
          if (stats.size > 1024 * 1024) {
            // > 1MB
            binaryFilePaths.add(filePath);
            return;
          }

          // Sample first few bytes
          const fd = await fsPromises.open(filePath, 'r');
          const buffer = Buffer.alloc(512);
          const { bytesRead } = await fd.read(buffer, 0, 512, 0);
          await fd.close();

          // Check for null bytes or other binary markers
          if (bytesRead > 0) {
            // Check for null bytes which indicate binary content
            if (buffer.slice(0, bytesRead).includes(0)) {
              binaryFilePaths.add(filePath);
              return;
            }

            // Additional binary detection heuristics
            let nonTextChars = 0;
            for (let i = 0; i < bytesRead; i++) {
              const byte = buffer[i];
              // Check for control characters except common ones like tab, newline
              if ((byte < 32 && ![9, 10, 13].includes(byte)) || byte > 126) {
                nonTextChars++;
              }
            }

            // If more than 10% of content is non-text, consider it binary
            if (nonTextChars > bytesRead * 0.1) {
              binaryFilePaths.add(filePath);
            }
          }
        } catch (error) {
          // Log but don't fail
          logVerbose(`Error checking binary content for ${filePath}: ${error}`);
        }
      }),
    );

    return binaryFilePaths;
  }

  /**
   * Writes content to a file in the workspace asynchronously, creating directories if needed.
   */
  public async writeFileContent(
    absolutePath: string,
    content: string,
  ): Promise<void> {
    try {
      const dirPath = path.dirname(absolutePath);
      await this.ensureDirectoryExistsAsync(dirPath);
      await fsPromises.writeFile(absolutePath, content, 'utf8');
      logVerbose(`Written content to: ${absolutePath}`);
    } catch (error) {
      log(`Error writing file ${absolutePath}: ${error}`);
      vscode.window.showErrorMessage(
        `Failed to write file ${absolutePath}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Deletes a file in the workspace asynchronously. Does not throw if file doesn't exist.
   */
  public async deleteWorkspaceFile(absolutePath: string): Promise<void> {
    try {
      await fsPromises.unlink(absolutePath);
      logVerbose(`Deleted workspace file: ${absolutePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logVerbose(`File not found during deletion, skipping: ${absolutePath}`);
      } else if ((error as NodeJS.ErrnoException).code === 'EISDIR') {
        log(
          `Attempted to delete a directory as a file during unlink: ${absolutePath}`,
        );
      } else {
        log(`Failed to delete workspace file ${absolutePath}: ${error}`);
        vscode.window.showWarningMessage(
          `Failed to delete file ${path.basename(
            absolutePath,
          )} during restore.`,
        );
      }
    }
  }

  /**
   * Retrieves the content of a specific file within a given snapshot asynchronously,
   * resolving diffs by walking back through the snapshot chain if necessary.
   * Implements caching.
   * @param snapshotId The ID of the snapshot
   * @param relativePath The relative path of the file
   * @param allSnapshots List of all snapshots for resolving diffs
   * @param forIndexing If true, indicates this content is being retrieved for indexing purposes
   */
  public async getSnapshotFileContent(
    snapshotId: string,
    relativePath: string,
    allSnapshots: Snapshot[],
    forIndexing = false,
  ): Promise<string | null> {
    // Use a special cache key if this is for indexing to avoid interfering with the regular workflow
    const cacheKey = `${snapshotId}::${relativePath}${
      forIndexing ? '::indexing' : ''
    }`;

    if (this.contentCache.has(cacheKey)) {
      logVerbose(
        `Cache hit for ${relativePath} in ${snapshotId}${
          forIndexing ? ' (indexing)' : ''
        }`,
      );
      return this.contentCache.get(cacheKey) ?? null;
    }

    logVerbose(
      `Cache miss for ${relativePath} in ${snapshotId}${
        forIndexing ? ' (indexing)' : ''
      }. Resolving...`,
    );

    const snapshot = allSnapshots.find((s) => s.id === snapshotId);
    if (!snapshot) {
      log(`Error: Snapshot ${snapshotId} not found in provided list.`);
      return null;
    }

    const fileData = snapshot.files[relativePath];
    if (!fileData) {
      logVerbose(`File ${relativePath} not found in snapshot ${snapshotId}.`);
      this.updateCache(cacheKey, null); // Cache null result
      return null;
    }

    if (fileData.deleted) {
      logVerbose(
        `File ${relativePath} marked as deleted in snapshot ${snapshotId}.`,
      );
      this.updateCache(cacheKey, null); // Cache null result
      return null;
    }

    if (typeof fileData.content === 'string') {
      logVerbose(
        `Found direct content for ${relativePath} in snapshot ${snapshotId}.`,
      );
      this.updateCache(cacheKey, fileData.content);
      return fileData.content;
    }

    if (fileData.content === null && !fileData.baseSnapshotId) {
      logVerbose(
        `File ${relativePath} has null content and no base in snapshot ${snapshotId}.`,
      );
      this.updateCache(cacheKey, null); // Cache null result (empty or unreadable file)
      return null;
    }

    if (fileData.baseSnapshotId) {
      // Pass the forIndexing flag when resolving base content
      const baseContent = await this.getSnapshotFileContent(
        fileData.baseSnapshotId,
        relativePath,
        allSnapshots,
        forIndexing, // Pass the forIndexing flag to prevent creating editor tabs
      );

      if (baseContent === null) {
        log(
          `Error: Could not resolve base content for ${relativePath} from snapshot ${fileData.baseSnapshotId}.`,
        );
        // Do not cache null here, as it indicates a resolution failure, not a definitive file state
        return null;
      }

      if (!fileData.diff) {
        logVerbose(
          `File ${relativePath} is identical to base snapshot ${fileData.baseSnapshotId}.`,
        );
        this.updateCache(cacheKey, baseContent); // Cache the resolved base content
        return baseContent;
      }

      logVerbose(
        `Applying diff for ${relativePath} from snapshot ${snapshotId}.`,
      );
      const patchedContent = applyDiff(
        baseContent,
        fileData.diff,
        relativePath,
      );

      if (patchedContent === null) {
        log(
          `Error: Failed to apply patch for ${relativePath} in snapshot ${snapshotId}.`,
        );
        // Do not cache null here, indicates patch failure
        return null;
      }

      this.updateCache(cacheKey, patchedContent); // Cache the patched content
      return patchedContent;
    }

    log(
      `Error: Unexpected state for file ${relativePath} in snapshot ${snapshotId}.`,
    );
    return null; // Should not be reached
  }

  // --- Cache Helper Methods ---

  private updateCache(key: string, value: string | null) {
    // Update the cache and trim it if needed
    this.contentCache.set(key, value);
    if (this.contentCache.size > this.MAX_CACHE_SIZE) {
      logVerbose(
        `Cache size (${this.contentCache.size}) exceeds limit. Trimming...`,
      );
      const keysToRemove = [...this.contentCache.keys()].slice(
        0,
        Math.ceil(this.contentCache.size * 0.3),
      );
      for (const k of keysToRemove) {
        this.contentCache.delete(k);
      }
      logVerbose(`Removed ${keysToRemove.length} items from cache.`);
    }
  }

  /**
   * Creates an appropriate document URI for a snapshot file.
   * @param snapshotId The snapshot ID
   * @param relativePath The file path
   * @param forIndexing When true, marks URI as for indexing purposes only
   */
  private createSnapshotUri(
    snapshotId: string,
    relativePath: string,
    forIndexing = false,
  ): vscode.Uri {
    // Use the SnapshotContentProvider's method to create the URI with the correct forIndexing flag
    return SnapshotContentProvider.getUri(
      snapshotId,
      relativePath,
      forIndexing,
    );
  }

  private clearCacheForSnapshot(snapshotId: string): void {
    let deletedCount = 0;
    for (const key of this.contentCache.keys()) {
      if (key.startsWith(`${snapshotId}::`)) {
        this.contentCache.delete(key);
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      logVerbose(
        `Cleared ${deletedCount} cache entries for deleted snapshot ${snapshotId}`,
      );
    }
  }
}
