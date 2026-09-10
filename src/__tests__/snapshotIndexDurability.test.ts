import { SnapshotStorage } from '../snapshotStorage';
import { SnapshotManager } from '../snapshotManager';
import { promises as fsPromises } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Snapshot } from '../snapshotManager';

function snapshot(id: string): Snapshot {
  return { id, timestamp: 1, description: id, files: {} };
}

describe('saveSnapshotIndex durability', () => {
  let dir: string;
  let storage: SnapshotStorage;

  beforeEach(async () => {
    dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'codelapse-idx-'));
    storage = new SnapshotStorage();
    (storage as any).snapshotDirectory = dir;
    (storage as any).workspaceRoot = dir;
  });

  afterEach(async () => {
    await fsPromises.rm(dir, { recursive: true, force: true });
  });

  it('writes the index and leaves no temp file behind', async () => {
    await storage.saveSnapshotIndex([snapshot('snap-a')], 0);

    const indexPath = path.join(dir, 'index.json');
    const written = JSON.parse(await fsPromises.readFile(indexPath, 'utf8'));
    expect(written.snapshots).toHaveLength(1);
    expect(written.currentIndex).toBe(0);

    const leftovers = (await fsPromises.readdir(dir)).filter((f) =>
      f.endsWith('.tmp'),
    );
    expect(leftovers).toEqual([]);
  });

  it('rejects instead of swallowing the failure when the write cannot happen', async () => {
    // Point the storage at a path whose parent is a file, so mkdir/write fail.
    const blocker = path.join(dir, 'blocker');
    await fsPromises.writeFile(blocker, 'not a directory');
    (storage as any).snapshotDirectory = path.join(blocker, 'nested');

    // The bug: this resolved, so callers reported success over a diverged index.
    await expect(
      storage.saveSnapshotIndex([snapshot('snap-a')], 0),
    ).rejects.toThrow();
  });

  it('does not corrupt an existing index when the new write fails', async () => {
    await storage.saveSnapshotIndex([snapshot('snap-a')], 0);
    const indexPath = path.join(dir, 'index.json');
    const before = await fsPromises.readFile(indexPath, 'utf8');

    // Make the payload invalid so validation throws before any write.
    const invalid = [snapshot('bad id with spaces')];
    await expect(storage.saveSnapshotIndex(invalid, 0)).rejects.toThrow();

    expect(await fsPromises.readFile(indexPath, 'utf8')).toBe(before);
  });

  it('throws rather than silently returning when storage is not initialized', async () => {
    // Returning normally here let a caller believe the index had been written.
    const uninitialized = new SnapshotStorage();
    (uninitialized as any).snapshotDirectory = undefined;
    await expect(
      uninitialized.saveSnapshotIndex([snapshot('snap-a')], 0),
    ).rejects.toThrow(/not initialized/i);
  });

  it('writes snapshot data atomically too', async () => {
    await storage.saveSnapshotData(snapshot('snap-b'));

    const snapshotPath = path.join(dir, 'snap-b', 'snapshot.json');
    expect(JSON.parse(await fsPromises.readFile(snapshotPath, 'utf8')).id).toBe(
      'snap-b',
    );

    const leftovers = (
      await fsPromises.readdir(path.join(dir, 'snap-b'))
    ).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });
});

/**
 * The plan audit's B-02c: with the old ordering (data, then push, then index) a
 * failed index write left the snapshot DIRECTORY on disk while the rollback only
 * popped the in-memory entry -- and `recoverSnapshotsFromFileSystem` resurrects
 * exactly that on the next load, so "Snapshot was not saved" was false. These
 * tests pin the reordering that fixes it: the index is written first, so a
 * failure there means nothing has reached disk.
 */
describe('takeSnapshot rollback keeps the claim and the disk in agreement', () => {
  let dir: string;
  let manager: SnapshotManager;
  let storage: any;

  beforeEach(async () => {
    dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'codelapse-roll-'));
    manager = new SnapshotManager(null);
    // The constructor's loadSnapshots() is not awaited and clears `snapshots`
    // when storage returns nothing, so settle it before supplying fixtures.
    await new Promise((resolve) => setTimeout(resolve, 0));

    storage = {
      getWorkspaceRoot: () => dir,
      loadSnapshotIndexAndMetadata: jest.fn().mockResolvedValue(null),
      saveSnapshotIndex: jest.fn().mockResolvedValue(undefined),
      saveSnapshotData: jest.fn().mockResolvedValue(undefined),
      deleteSnapshotData: jest.fn().mockResolvedValue(undefined),
      isBinaryFile: () => false,
      writeFileContent: jest.fn().mockResolvedValue(undefined),
      deleteWorkspaceFile: jest.fn().mockResolvedValue(undefined),
      getSnapshotFileContent: jest.fn().mockResolvedValue(null),
    };
    (manager as any).storage = storage;
    (manager as any).snapshots = [];
    (manager as any).currentSnapshotIndex = -1;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fsPromises.rm(dir, { recursive: true, force: true });
  });

  it('does not write snapshot data at all when the index write fails', async () => {
    storage.saveSnapshotIndex.mockRejectedValue(new Error('disk full'));

    await expect(manager.takeSnapshot('doomed')).rejects.toThrow('disk full');

    // The reorder: data is written only after the index commits.
    expect(storage.saveSnapshotData).not.toHaveBeenCalled();
    expect((manager as any).snapshots).toEqual([]);
  });

  it('leaves no snapshot on disk when the index write fails', async () => {
    storage.saveSnapshotIndex.mockRejectedValue(new Error('disk full'));

    await expect(manager.takeSnapshot('doomed')).rejects.toThrow();

    // Nothing to resurrect, which is what makes "not saved" true.
    expect(storage.deleteSnapshotData).not.toHaveBeenCalled();
  });

  it('cleans up and rewrites the index when the data write fails', async () => {
    storage.saveSnapshotData.mockRejectedValue(new Error('write failed'));

    await expect(manager.takeSnapshot('doomed')).rejects.toThrow(
      'write failed',
    );

    // The dangling index entry and any partial directory are both removed.
    expect(storage.deleteSnapshotData).toHaveBeenCalled();
    expect(storage.saveSnapshotIndex).toHaveBeenCalledTimes(2);
    expect((manager as any).snapshots).toEqual([]);
  });

  it('keeps the snapshot when both writes succeed', async () => {
    const outcome = await manager.takeSnapshot('keeper');

    expect(outcome.created).toBe(true);
    expect(outcome.created && outcome.snapshot.id).toBeTruthy();
    expect(outcome.created && outcome.snapshot.description).toBe('keeper');
    expect(storage.saveSnapshotData).toHaveBeenCalledTimes(1);
    expect((manager as any).snapshots).toHaveLength(1);
    expect((manager as any).snapshots[0].description).toBe('keeper');
  });
});
