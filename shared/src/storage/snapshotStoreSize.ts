import * as fs from 'fs';
import * as path from 'path';

/**
 * Byte accounting for a snapshot store.
 *
 * `snapshotBytes` counts the files inside every `snapshot-*` directory,
 * `storeBytes` the store's own files (`index.json`), and `totalBytes`
 * their sum. Directories that are not snapshots are deliberately not counted:
 * `quarantine/` holds artifacts a prune can never remove, so counting them
 * would leave a store permanently "over the limit" with no remedy.
 */
export interface SnapshotStoreSizes {
  snapshotBytes: number;
  storeBytes: number;
  totalBytes: number;
  perSnapshotBytes: Record<string, number>;
}

/**
 * What a size-based retention pass did.
 *
 * Returned rather than logged so each manager reports it in its own
 * vocabulary: an Output-channel line in the extension, `console` in core.
 */
export interface SnapshotSizePruneResult {
  bytesBefore: number;
  bytesAfter: number;
  trimmed: string[];
  stillOverLimit: boolean;
}

/**
 * Sum the bytes of every file in the store.
 *
 * Best effort by design: an unreadable directory or file contributes nothing
 * rather than failing an activation. Nothing here follows a symlink -- a
 * symlinked entry is not store data, and both storage layers refuse to delete
 * one anyway.
 */
export function measureSnapshotStore(
  snapshotDirectory: string,
): SnapshotStoreSizes {
  const perSnapshotBytes: Record<string, number> = {};
  let storeBytes = 0;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(snapshotDirectory, { withFileTypes: true });
  } catch {
    return {
      snapshotBytes: 0,
      storeBytes: 0,
      totalBytes: 0,
      perSnapshotBytes,
    };
  }

  for (const entry of entries) {
    const fullPath = path.join(snapshotDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('snapshot-')) {
        continue;
      }
      perSnapshotBytes[entry.name] = sumDirectoryBytes(fullPath);
    } else if (entry.isFile()) {
      storeBytes += sizeOfRegularFile(fullPath);
    }
  }

  let snapshotBytes = 0;
  for (const bytes of Object.values(perSnapshotBytes)) {
    snapshotBytes += bytes;
  }

  return {
    snapshotBytes,
    storeBytes,
    totalBytes: snapshotBytes + storeBytes,
    perSnapshotBytes,
  };
}

function sumDirectoryBytes(directory: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      total += sumDirectoryBytes(fullPath);
    } else if (entry.isFile()) {
      total += sizeOfRegularFile(fullPath);
    }
  }
  return total;
}

/** A symlink, a socket or a vanished file contributes zero bytes. */
function sizeOfRegularFile(filePath: string): number {
  try {
    const stats = fs.lstatSync(filePath);
    return stats.isFile() ? stats.size : 0;
  } catch {
    return 0;
  }
}

/**
 * The oldest snapshots whose removal would bring the store under `limitBytes`.
 *
 * Candidates are consumed in the caller's array order and never by timestamp:
 * the store keeps its entries oldest-first by construction (appended on take,
 * loaded in index order), which is the only truthful record of age. A clock
 * that steps backwards -- an NTP correction after a VM resume, a WSL jump, a
 * hand-set clock -- would otherwise sort the snapshot that was just written to
 * the front of this list and have it deleted moments later.
 *
 * `activeSnapshotId` is never a candidate: the workspace reflects that
 * snapshot, and removing it detaches the store rather than freeing history.
 *
 * All or nothing: when the removable snapshots together hold fewer bytes than
 * the excess, nothing is selected at all. Pruning them would not bring the
 * store under the limit -- the active snapshot, a `quarantine/` artifact or an
 * unindexed `snapshot-*` directory can hold the rest -- so the history would be
 * gone with the store still over its limit. The caller reports
 * `stillOverLimit: true` instead, which is the same "keep the excess rather
 * than lose data" discipline the survivor materialization follows.
 *
 * Selection stops as soon as the bytes selected cover the excess, so a store
 * that is only slightly over the limit loses only the snapshots it must.
 *
 * A snapshot whose directory is already gone contributes zero bytes and does
 * not move the tally; it stays selectable, because an index entry with no
 * directory is all that is left of it.
 */
export function selectSizePruneCandidates(
  snapshots: ReadonlyArray<{ id: string; timestamp: number }>,
  sizes: SnapshotStoreSizes,
  limitBytes: number,
  activeSnapshotId: string | null,
): string[] {
  const excess = sizes.totalBytes - limitBytes;
  if (excess <= 0) {
    return [];
  }

  const removable = snapshots.filter(
    (snapshot) => snapshot.id !== activeSnapshotId,
  );

  // Refuse the whole trim when the removable snapshots cannot cover the excess:
  // deleting them would not bring the store under the limit and the history
  // would be gone for nothing. Nothing here can remove the rest of the bytes --
  // the active snapshot is never a candidate, and quarantine artifacts and
  // unindexed directories are not snapshots at all.
  const removableBytes = removable.reduce(
    (total, snapshot) => total + (sizes.perSnapshotBytes[snapshot.id] ?? 0),
    0,
  );
  if (removableBytes < excess) {
    return [];
  }

  const selected: string[] = [];
  let selectedBytes = 0;
  for (const snapshot of removable) {
    if (selectedBytes >= excess) {
      break;
    }
    selected.push(snapshot.id);
    selectedBytes += sizes.perSnapshotBytes[snapshot.id] ?? 0;
  }

  return selected;
}
