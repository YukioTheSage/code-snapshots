import { Snapshot } from './snapshotManager';
import { MAX_SNAPSHOT_RESOLUTION_DEPTH } from './security/limits';

export interface SnapshotIntegrityReport {
  /** Snapshots that contain at least one unrecoverable file. */
  brokenSnapshotIds: string[];
  /** `baseSnapshotId` values referenced but absent from the snapshot list. */
  missingBaseSnapshotIds: string[];
  /** Total number of file entries whose content cannot be reconstructed. */
  unrecoverableFileCount: number;
  /** snapshotId -> sorted list of unrecoverable relative paths. */
  perSnapshot: { [snapshotId: string]: string[] };
}

export function isBaseResolvable(
  baseSnapshotId: string,
  allSnapshots: Snapshot[],
): boolean {
  return allSnapshots.some((s) => s.id === baseSnapshotId);
}

/**
 * Walks a file's baseSnapshotId chain. Returns true when the content is
 * reconstructable: either the entry carries content, or the chain terminates
 * at an entry that carries content.
 *
 * `byId` is passed in rather than derived here: the caller already walks every
 * file of every snapshot, so rebuilding the index per file would make the scan
 * quadratic in the number of snapshots for no benefit.
 */
function isFileRecoverable(
  fileData: Snapshot['files'][string],
  byId: Map<string, Snapshot>,
  relativePath: string,
): boolean {
  const visited = new Set<string>();

  let current = fileData;
  let depth = 0;

  for (;;) {
    if (typeof current.content === 'string') {
      return true;
    }
    if (!current.baseSnapshotId) {
      // No content and no base: nothing to reconstruct from.
      return false;
    }
    if (depth >= MAX_SNAPSHOT_RESOLUTION_DEPTH) {
      return false;
    }
    const key = `${current.baseSnapshotId}:${relativePath}`;
    if (visited.has(key)) {
      // Cycle.
      return false;
    }
    visited.add(key);

    const base = byId.get(current.baseSnapshotId);
    if (!base) {
      return false;
    }
    const baseFile = base.files[relativePath];
    if (!baseFile) {
      // The base snapshot exists but carries no entry for this path, so it is
      // not a source of content for it.
      return false;
    }
    if (baseFile.deleted) {
      return false;
    }

    current = baseFile;
    depth++;
  }
}

export function getUnrecoverableFiles(
  snapshot: Snapshot,
  allSnapshots: Snapshot[],
): string[] {
  const byId = new Map(allSnapshots.map((s) => [s.id, s]));
  const broken: string[] = [];

  for (const [relativePath, fileData] of Object.entries(snapshot.files)) {
    if (fileData.deleted || fileData.isBinary) {
      continue;
    }
    if (!isFileRecoverable(fileData, byId, relativePath)) {
      broken.push(relativePath);
    }
  }

  return broken.sort();
}

export function scanSnapshotIntegrity(
  allSnapshots: Snapshot[],
): SnapshotIntegrityReport {
  const present = new Set(allSnapshots.map((s) => s.id));
  const missing = new Set<string>();
  const perSnapshot: { [snapshotId: string]: string[] } = {};
  const brokenSnapshotIds: string[] = [];
  let unrecoverableFileCount = 0;

  for (const snapshot of allSnapshots) {
    const broken = getUnrecoverableFiles(snapshot, allSnapshots);
    if (broken.length > 0) {
      perSnapshot[snapshot.id] = broken;
      brokenSnapshotIds.push(snapshot.id);
      unrecoverableFileCount += broken.length;
    }
    for (const fileData of Object.values(snapshot.files)) {
      // A deletion marker carries the base it was compared against, but nothing
      // resolves its content through that base: it records that the file was
      // gone, so the base is not a dependency of it and its absence is not
      // breakage. Counting it here reported a base as missing that pruning is
      // allowed to remove (`selectPrunableSnapshots` applies the same rule).
      if (fileData.deleted) {
        continue;
      }
      const base = fileData.baseSnapshotId;
      if (base && !present.has(base)) {
        missing.add(base);
      }
    }
  }

  return {
    brokenSnapshotIds: brokenSnapshotIds.sort(),
    missingBaseSnapshotIds: [...missing].sort(),
    unrecoverableFileCount,
    perSnapshot,
  };
}
