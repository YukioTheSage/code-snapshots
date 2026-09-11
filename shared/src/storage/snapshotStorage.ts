import * as fs from 'fs';
import * as path from 'path';
import { Snapshot, SnapshotIndex } from '../types/snapshot';
import { applyDiff } from '../utils/diffUtils';
import { assertNoSymlinkPath, validateSnapshotId } from '../utils/pathSecurity';
import {
  assertBufferSizeWithinLimit,
  assertFileSizeWithinLimit,
  assertSufficientDiskSpace,
  MAX_JSON_PAYLOAD_BYTES,
  MAX_SNAPSHOT_RESOLUTION_DEPTH,
} from '../security/limits';
import {
  validateSnapshot,
  validateSnapshotIndex,
} from '../validation/snapshotValidation';

/**
 * Standalone snapshot storage (no VS Code dependencies)
 * Handles reading and writing snapshots to disk
 */
export class SnapshotStorage {
  private snapshotDirectory: string;
  private workspaceRoot: string;
  private contentCache: Map<string, string | null> = new Map();
  private readonly MAX_CACHE_SIZE = 100;

  constructor(workspaceRoot: string, snapshotLocation: string = '.snapshots') {
    this.workspaceRoot = workspaceRoot;
    this.snapshotDirectory = path.join(workspaceRoot, snapshotLocation);
    this.ensureDirectoryExists(this.snapshotDirectory);
  }

  /**
   * Get workspace root
   */
  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  /**
   * Get snapshot directory
   */
  public getSnapshotDirectory(): string {
    return this.snapshotDirectory;
  }

  /**
   * Ensure directory exists
   */
  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  private getQuarantineDirectory(): string {
    return path.join(this.snapshotDirectory, 'quarantine');
  }

  private quarantineFile(filePath: string, reason: string): void {
    try {
      if (!fs.existsSync(filePath)) {
        return;
      }

      this.ensureDirectoryExists(this.getQuarantineDirectory());
      const fileName = path.basename(filePath);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const quarantinePath = path.join(
        this.getQuarantineDirectory(),
        `${fileName}.quarantine-${timestamp}`,
      );
      fs.renameSync(filePath, quarantinePath);
      console.error(
        `Quarantined invalid snapshot artifact "${fileName}" due to ${reason}: ${quarantinePath}`,
      );
    } catch (error) {
      console.error(`Failed to quarantine file ${filePath}:`, error);
    }
  }

  private async readJsonFileWithValidation<T>(
    filePath: string,
    validator: (value: unknown) => void,
    context: string,
  ): Promise<T> {
    assertNoSymlinkPath(this.snapshotDirectory, filePath);
    await assertFileSizeWithinLimit(filePath, MAX_JSON_PAYLOAD_BYTES);
    const content = await fs.promises.readFile(filePath, 'utf8');
    assertBufferSizeWithinLimit(content, context, MAX_JSON_PAYLOAD_BYTES);
    const parsed = JSON.parse(content) as unknown;
    validator(parsed);
    return parsed as T;
  }

  /**
   * Load snapshot index and metadata
   */
  public async loadSnapshotIndexAndMetadata(): Promise<{
    snapshots: Snapshot[];
    currentIndex: number;
  } | null> {
    if (!this.snapshotDirectory) {
      console.log('Cannot load snapshots, storage directory not initialized.');
      return { snapshots: [], currentIndex: -1 };
    }

    const indexFilePath = path.join(this.snapshotDirectory, 'index.json');

    let indexData: SnapshotIndex | null = null;

    try {
      if (fs.existsSync(indexFilePath)) {
        indexData = await this.readJsonFileWithValidation<SnapshotIndex>(
          indexFilePath,
          validateSnapshotIndex,
          'snapshot index',
        );
      } else {
        console.log('Snapshot index file not found. Starting with empty state.');
        return { snapshots: [], currentIndex: -1 };
      }
    } catch (error) {
      console.error('Error reading or validating snapshot index:', error);
      this.quarantineFile(
        indexFilePath,
        error instanceof Error ? error.message : String(error),
      );
      return { snapshots: [], currentIndex: -1 };
    }

    // Load each snapshot's metadata
    const snapshots: Snapshot[] = [];
    for (const item of indexData.snapshots) {
      validateSnapshotId(item.id);
      const snapshotPath = path.join(
        this.snapshotDirectory,
        item.id,
        'snapshot.json',
      );

      try {
        if (fs.existsSync(snapshotPath)) {
          const snapshot = await this.readJsonFileWithValidation<Snapshot>(
            snapshotPath,
            validateSnapshot,
            `snapshot ${item.id}`,
          );
          if (snapshot.id !== item.id) {
            throw new Error(
              `Snapshot ID mismatch for ${item.id}: file contains ${snapshot.id}`,
            );
          }
          snapshots.push(snapshot);
        } else {
          console.warn(`Snapshot file not found: ${snapshotPath}`);
        }
      } catch (error) {
        console.error(`Error loading snapshot ${item.id}:`, error);
        this.quarantineFile(
          snapshotPath,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return {
      snapshots,
      currentIndex: indexData.currentIndex,
    };
  }

  /**
   * Save snapshot index
   */
  public async saveSnapshotIndex(
    snapshots: Snapshot[],
    currentIndex: number,
  ): Promise<void> {
    const indexFilePath = path.join(this.snapshotDirectory, 'index.json');

    const indexData: SnapshotIndex = {
      snapshots: snapshots.map((s) => ({
        id: s.id,
        timestamp: s.timestamp,
        description: s.description,
      })),
      currentIndex,
    };

    try {
      this.ensureDirectoryExists(this.snapshotDirectory);
      assertNoSymlinkPath(this.snapshotDirectory, indexFilePath);
      const serialized = JSON.stringify(indexData, null, 2);
      assertBufferSizeWithinLimit(
        serialized,
        indexFilePath,
        MAX_JSON_PAYLOAD_BYTES,
      );
      await assertSufficientDiskSpace(indexFilePath);
      await fs.promises.writeFile(indexFilePath, serialized, 'utf8');
    } catch (error) {
      throw new Error(`Failed to save snapshot index: ${error}`);
    }
  }

  /**
   * Save a single snapshot to disk
   */
  public async saveSnapshot(snapshot: Snapshot): Promise<void> {
    validateSnapshotId(snapshot.id);
    const snapshotDir = path.join(this.snapshotDirectory, snapshot.id);
    const snapshotPath = path.join(snapshotDir, 'snapshot.json');

    try {
      this.ensureDirectoryExists(snapshotDir);
      assertNoSymlinkPath(this.snapshotDirectory, snapshotDir);
      assertNoSymlinkPath(this.snapshotDirectory, snapshotPath);
      const serialized = JSON.stringify(snapshot, null, 2);
      assertBufferSizeWithinLimit(
        serialized,
        snapshotPath,
        MAX_JSON_PAYLOAD_BYTES,
      );
      await assertSufficientDiskSpace(snapshotPath);
      await fs.promises.writeFile(snapshotPath, serialized, 'utf8');
    } catch (error) {
      throw new Error(`Failed to save snapshot ${snapshot.id}: ${error}`);
    }
  }

  /**
   * Load a single snapshot from disk
   */
  public async loadSnapshot(snapshotId: string): Promise<Snapshot | null> {
    validateSnapshotId(snapshotId);
    const snapshotPath = path.join(
      this.snapshotDirectory,
      snapshotId,
      'snapshot.json',
    );

    try {
      if (fs.existsSync(snapshotPath)) {
        const snapshot = await this.readJsonFileWithValidation<Snapshot>(
          snapshotPath,
          validateSnapshot,
          `snapshot ${snapshotId}`,
        );
        if (snapshot.id !== snapshotId) {
          throw new Error(
            `Snapshot ID mismatch for ${snapshotId}: file contains ${snapshot.id}`,
          );
        }
        return snapshot;
      } else {
        console.warn(`Snapshot file not found: ${snapshotPath}`);
        return null;
      }
    } catch (error) {
      console.error(`Error loading snapshot ${snapshotId}:`, error);
      this.quarantineFile(
        snapshotPath,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  /**
   * Delete a snapshot from disk
   */
  public async deleteSnapshot(snapshotId: string): Promise<void> {
    validateSnapshotId(snapshotId);
    const snapshotDir = path.join(this.snapshotDirectory, snapshotId);

    // Absence is an error, not a no-op. Returning quietly here is what let the
    // CLI answer "Snapshot 999 deleted successfully" for an id that never
    // existed, and rewrite its index as if the delete had happened.
    if (!fs.existsSync(snapshotDir)) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    try {
      assertNoSymlinkPath(this.snapshotDirectory, snapshotDir);
      const stats = fs.lstatSync(snapshotDir);
      if (stats.isSymbolicLink()) {
        throw new Error(`Refusing to delete symlink snapshot directory: ${snapshotDir}`);
      }
      fs.rmSync(snapshotDir, { recursive: true, force: true });
    } catch (error) {
      throw new Error(`Failed to delete snapshot ${snapshotId}: ${error}`);
    }
  }

  /**
   * Get file content from a snapshot
   */
  public async getSnapshotFileContent(
    snapshotId: string,
    relativePath: string,
    visited: Set<string> = new Set<string>(),
    depth = 0,
  ): Promise<string | null> {
    if (depth > MAX_SNAPSHOT_RESOLUTION_DEPTH) {
      console.error(
        `Snapshot content resolution depth exceeded (${MAX_SNAPSHOT_RESOLUTION_DEPTH}) for ${snapshotId}:${relativePath}`,
      );
      return null;
    }

    const resolutionKey = `${snapshotId}:${relativePath}`;
    if (visited.has(resolutionKey)) {
      console.error(
        `Cycle detected while resolving snapshot content for ${resolutionKey}`,
      );
      return null;
    }
    visited.add(resolutionKey);

    const cacheKey = `${snapshotId}:${relativePath}`;

    // Check cache
    if (this.contentCache.has(cacheKey)) {
      visited.delete(resolutionKey);
      return this.contentCache.get(cacheKey)!;
    }

    const snapshot = await this.loadSnapshot(snapshotId);
    if (!snapshot) {
      visited.delete(resolutionKey);
      return null;
    }

    const fileData = snapshot.files[relativePath];
    if (!fileData) {
      visited.delete(resolutionKey);
      return null;
    }

    let content: string | null = null;

    // If we have full content, use it
    if (fileData.content !== undefined) {
      content = fileData.content;
    }
    // If we have a diff, reconstruct from base snapshot
    else if (fileData.diff && fileData.baseSnapshotId) {
      const baseContent = await this.getSnapshotFileContent(
        fileData.baseSnapshotId,
        relativePath,
        visited,
        depth + 1,
      );
      if (baseContent !== null) {
        content = applyDiff(baseContent, fileData.diff, relativePath);
      }
    }
    // If only baseSnapshotId (unchanged file), get content from base
    else if (fileData.baseSnapshotId) {
      content = await this.getSnapshotFileContent(
        fileData.baseSnapshotId,
        relativePath,
        visited,
        depth + 1,
      );
    }

    // Cache the result
    this.addToCache(cacheKey, content);
    visited.delete(resolutionKey);

    return content;
  }

  /**
   * Add content to cache with size limit
   */
  private addToCache(key: string, content: string | null): void {
    if (this.contentCache.size >= this.MAX_CACHE_SIZE) {
      // Remove oldest entry (first entry)
      const firstKey = this.contentCache.keys().next().value;
      if (firstKey !== undefined) {
        this.contentCache.delete(firstKey);
      }
    }
    this.contentCache.set(key, content);
  }

  /**
   * Clear content cache
   */
  public clearCache(): void {
    this.contentCache.clear();
  }

  /**
   * Get all snapshot IDs
   */
  public async getSnapshotIds(): Promise<string[]> {
    try {
      const entries = fs.readdirSync(this.snapshotDirectory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('snapshot-'))
        .map((entry) => entry.name);
    } catch (error) {
      console.error('Error reading snapshot directory:', error);
      return [];
    }
  }

  /**
   * Check if a snapshot exists
   */
  public async snapshotExists(snapshotId: string): Promise<boolean> {
    validateSnapshotId(snapshotId);
    const snapshotPath = path.join(
      this.snapshotDirectory,
      snapshotId,
      'snapshot.json',
    );
    if (!fs.existsSync(snapshotPath)) {
      return false;
    }
    assertNoSymlinkPath(this.snapshotDirectory, path.join(this.snapshotDirectory, snapshotId));
    assertNoSymlinkPath(this.snapshotDirectory, snapshotPath);
    const stats = fs.lstatSync(snapshotPath);
    return stats.isFile() && !stats.isSymbolicLink();
  }

  /**
   * Get snapshot metadata without loading full content
   */
  public async getSnapshotMetadata(
    snapshotId: string,
  ): Promise<Omit<Snapshot, 'files'> | null> {
    const snapshot = await this.loadSnapshot(snapshotId);
    if (!snapshot) {
      return null;
    }

    // Return snapshot without files
    const { files, ...metadata } = snapshot;
    return metadata;
  }

  /**
   * Update snapshot metadata
   */
  public async updateSnapshotMetadata(
    snapshotId: string,
    updates: Partial<
      Omit<Snapshot, 'id' | 'timestamp' | 'files' | 'gitBranch' | 'gitCommitHash'>
    >,
  ): Promise<void> {
    const snapshot = await this.loadSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    // Apply updates
    Object.assign(snapshot, updates);

    // Save updated snapshot
    await this.saveSnapshot(snapshot);
  }

  /**
   * Get storage statistics
   */
  public async getStorageStats(): Promise<{
    snapshotCount: number;
    totalSize: number;
    oldestSnapshot?: { id: string; timestamp: number };
    newestSnapshot?: { id: string; timestamp: number };
  }> {
    const state = await this.loadSnapshotIndexAndMetadata();
    if (!state || state.snapshots.length === 0) {
      return { snapshotCount: 0, totalSize: 0 };
    }

    let totalSize = 0;
    try {
      const entries = fs.readdirSync(this.snapshotDirectory, { withFileTypes: true });
      for (const entry of entries) {
        const filePath = path.join(this.snapshotDirectory, entry.name);
        const stats = fs.lstatSync(filePath);
        if (stats.isSymbolicLink()) {
          continue;
        }

        if (entry.isDirectory() && entry.name.startsWith('snapshot-')) {
          const snapJsonPath = path.join(filePath, 'snapshot.json');
          if (fs.existsSync(snapJsonPath)) {
            totalSize += fs.statSync(snapJsonPath).size;
          }
        } else if (entry.isFile()) {
          totalSize += stats.size;
        }
      }
    } catch (error) {
      console.error('Error calculating storage size:', error);
    }

    const sorted = [...state.snapshots].sort(
      (a, b) => a.timestamp - b.timestamp,
    );

    return {
      snapshotCount: state.snapshots.length,
      totalSize,
      oldestSnapshot: sorted[0]
        ? { id: sorted[0].id, timestamp: sorted[0].timestamp }
        : undefined,
      newestSnapshot: sorted[sorted.length - 1]
        ? {
          id: sorted[sorted.length - 1].id,
          timestamp: sorted[sorted.length - 1].timestamp,
        }
        : undefined,
    };
  }
}
