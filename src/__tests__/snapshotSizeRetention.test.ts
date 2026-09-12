import * as fs from 'fs';
import * as path from 'path';
import { SnapshotManager } from '../snapshotManager';
import type { Snapshot } from '../snapshotManager';
import { getMaxSnapshotStoreBytes } from '../config';
import type { SnapshotStoreSizes } from 'codelapse-core';

/* eslint-disable @typescript-eslint/no-explicit-any */

// The retention paths read the limit through src/config. 0 by default here, so
// constructing a manager in this suite never walks a real store; the retention
// tests opt in per test.
jest.mock('../config', () => ({
  getMaxSnapshots: () => 50,
  getSnapshotLocation: () => '.snapshots',
  getMaxSnapshotStoreBytes: jest.fn(() => 0),
}));

const limitMock = getMaxSnapshotStoreBytes as unknown as jest.Mock;

function storeSizes(
  perSnapshotBytes: Record<string, number>,
): SnapshotStoreSizes {
  let snapshotBytes = 0;
  for (const bytes of Object.values(perSnapshotBytes)) {
    snapshotBytes += bytes;
  }
  return {
    snapshotBytes,
    storeBytes: 100,
    totalBytes: snapshotBytes + 100,
    perSnapshotBytes,
  };
}

function snapshot(
  id: string,
  files: Snapshot['files'],
  timestamp: number,
): Snapshot {
  return { id, timestamp, description: id, files };
}

/** Base ids the listed snapshots reference but that are not among them. */
function danglingBaseIds(snapshots: Snapshot[]): string[] {
  const live = new Set(snapshots.map((snapshot) => snapshot.id));
  const dangling: string[] = [];
  for (const snapshot of snapshots) {
    for (const entry of Object.values(snapshot.files)) {
      if (entry.baseSnapshotId && !live.has(entry.baseSnapshotId)) {
        dangling.push(entry.baseSnapshotId);
      }
    }
  }
  return dangling;
}

describe('size-based retention in the extension', () => {
  afterEach(() => {
    limitMock.mockReturnValue(0);
  });

  /**
   * The constructor starts an un-awaited load that would overwrite fixtures
   * assigned too early, so settle it first and then swap in the fake storage --
   * the same shape as snapshotPruneIntegrity.test.ts.
   */
  async function managerWithStore(
    snapshots: Snapshot[],
    activeSnapshotId: string | null,
    measurements: SnapshotStoreSizes[],
  ) {
    const manager = new SnapshotManager(null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const measureSnapshotStore = jest.fn();
    for (const value of measurements) {
      measureSnapshotStore.mockReturnValueOnce(value);
    }

    const storage = {
      getWorkspaceRoot: () => '/ws',
      measureSnapshotStore,
      getSnapshotFileContent: jest.fn(),
      saveSnapshotData: jest.fn().mockResolvedValue(undefined),
      deleteSnapshotData: jest.fn().mockResolvedValue(undefined),
      saveSnapshotIndex: jest.fn().mockResolvedValue(undefined),
    };

    (manager as any).storage = storage;
    (manager as any).snapshots = snapshots;
    (manager as any).activeSnapshotId = activeSnapshotId;
    (manager as any).refreshIntegrityReport();
    return { manager, storage };
  }

  it('trims the oldest snapshot until the store fits the limit', async () => {
    const fixtures = [
      snapshot('a', { 'f.ts': { content: 'A' } }, 1),
      snapshot('b', { 'f.ts': { baseSnapshotId: 'a' } }, 2),
      snapshot('c', { 'f.ts': { content: 'C' } }, 3),
    ];
    const { manager, storage } = await managerWithStore(fixtures, 'c', [
      storeSizes({ a: 600, b: 300, c: 300 }),
      storeSizes({ b: 300, c: 300 }),
    ]);
    limitMock.mockReturnValue(700);
    storage.getSnapshotFileContent.mockResolvedValue('A');

    const result = await manager.enforceSnapshotSizeLimitOnActivation();

    expect(result.trimmed).toEqual(['a']);
    expect(result.bytesBefore).toBe(1300);
    expect(result.bytesAfter).toBe(700);
    expect(result.stillOverLimit).toBe(false);
    // The survivor was rewritten and persisted before its base went away.
    expect(storage.saveSnapshotData).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b' }),
    );
    expect(storage.saveSnapshotData.mock.invocationCallOrder[0]).toBeLessThan(
      storage.deleteSnapshotData.mock.invocationCallOrder[0],
    );
    expect(storage.deleteSnapshotData).toHaveBeenCalledWith('a');
    expect(manager.getSnapshots().map((s) => s.id)).toEqual(['b', 'c']);
  });

  it('never trims the active snapshot', async () => {
    const fixtures = [snapshot('only', { 'f.ts': { content: 'A' } }, 1)];
    const { manager, storage } = await managerWithStore(fixtures, 'only', [
      storeSizes({ only: 9000 }),
    ]);
    limitMock.mockReturnValue(1000);

    const result = await manager.enforceSnapshotSizeLimitOnActivation();

    // The workspace reflects this snapshot; removing it would detach the store
    // instead of freeing history.
    expect(result.trimmed).toEqual([]);
    expect(result.stillOverLimit).toBe(true);
    expect(storage.deleteSnapshotData).not.toHaveBeenCalled();
    expect(manager.getSnapshots().map((s) => s.id)).toEqual(['only']);
  });

  it('never trims the snapshot it was just asked to create', async () => {
    // The list the load path hands the manager is sorted by timestamp, not by
    // store order, so the snapshot a take just wrote is excluded by id rather
    // than trusted to sit at the right end of the array.
    const fixtures = [
      snapshot('old', { 'f.ts': { content: 'OLD' } }, 1),
      snapshot('fresh', { 'f.ts': { content: 'FRESH' } }, 2),
    ];
    const { manager, storage } = await managerWithStore(fixtures, null, [
      storeSizes({ old: 100, fresh: 900 }),
      storeSizes({ fresh: 900 }),
    ]);
    limitMock.mockReturnValue(500);

    const result = await (manager as any).enforceSnapshotSizeLimitInternal(
      'fresh',
    );

    expect(result.trimmed).toEqual(['old']);
    expect(result.stillOverLimit).toBe(true);
    expect(storage.deleteSnapshotData).toHaveBeenCalledWith('old');
    expect(storage.deleteSnapshotData).not.toHaveBeenCalledWith('fresh');
    expect(manager.getSnapshots().map((s) => s.id)).toEqual(['fresh']);
  });

  it('orders candidates by age, not by array position', async () => {
    // The loaded list is sorted by timestamp, and a clock that steps backwards
    // can leave a newer snapshot written before an older one, so age is read
    // from the timestamp -- the order the count prune already uses -- rather
    // than trusted to the position in the array.
    const fixtures = [
      snapshot('newer', { 'f.ts': { content: 'N' } }, 30),
      snapshot('older', { 'f.ts': { content: 'O' } }, 10),
    ];
    const { manager, storage } = await managerWithStore(fixtures, null, [
      storeSizes({ newer: 900, older: 600 }),
      storeSizes({ newer: 900 }),
    ]);
    limitMock.mockReturnValue(1000);

    const result = await manager.enforceSnapshotSizeLimitOnActivation();

    expect(result.trimmed).toEqual(['older']);
    expect(storage.deleteSnapshotData).toHaveBeenCalledWith('older');
    expect(storage.deleteSnapshotData).not.toHaveBeenCalledWith('newer');
    expect(manager.getSnapshots().map((s) => s.id)).toEqual(['newer']);
  });

  it('keeps the excess when a survivor cannot be rebuilt', async () => {
    const fixtures = [
      snapshot('a', { 'f.ts': { content: 'A' } }, 1),
      snapshot('b', { 'f.ts': { content: 'B' } }, 2),
      snapshot('c', { 'f.ts': { baseSnapshotId: 'b' } }, 3),
    ];
    const { manager, storage } = await managerWithStore(fixtures, 'c', [
      storeSizes({ a: 600, b: 600, c: 300 }),
    ]);
    limitMock.mockReturnValue(900);
    storage.getSnapshotFileContent.mockResolvedValue(null);

    const result = await manager.enforceSnapshotSizeLimitOnActivation();

    // The attempt happened at all -- otherwise "nothing was deleted" would also
    // hold for a manager that never tried.
    expect(storage.getSnapshotFileContent).toHaveBeenCalled();
    expect(result.trimmed).toEqual([]);
    expect(result.stillOverLimit).toBe(true);
    expect(storage.saveSnapshotData).not.toHaveBeenCalled();
    expect(storage.deleteSnapshotData).not.toHaveBeenCalled();
    expect(manager.getSnapshots().map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not measure the store when the limit is disabled', async () => {
    const fixtures = [snapshot('a', { 'f.ts': { content: 'A' } }, 1)];
    const { manager, storage } = await managerWithStore(fixtures, 'a', []);

    const result = await manager.enforceSnapshotSizeLimitOnActivation();

    expect(result.trimmed).toEqual([]);
    expect(storage.measureSnapshotStore).not.toHaveBeenCalled();
  });

  it('runs after a take', async () => {
    const manager = new SnapshotManager(null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    (manager as any).storage = {
      getWorkspaceRoot: () => '/ws',
      getSnapshotDirectory: () => '/ws/.snapshots',
      isBinaryFile: () => false,
      checkSuspiciousFilesForBinaryContent: async () => new Set<string>(),
      readFileContent: async () => 'changed',
      getSnapshotFileContent: async () => null,
      saveSnapshotData: async () => undefined,
    };
    (manager as any).snapshots = [];
    (manager as any).activeSnapshotId = null;
    (manager as any).saveSnapshotIndex = async () => undefined;

    const spy = jest
      .spyOn(manager as any, 'enforceSnapshotSizeLimitInternal')
      .mockResolvedValue({
        bytesBefore: 0,
        bytesAfter: 0,
        trimmed: [],
        stillOverLimit: false,
      });

    await (manager as any).takeSnapshotInternal('manual', { tags: ['manual'] });

    // The count limit has its own call; a store inside its snapshot count but
    // over its byte budget is only revisited if this call exists.
    expect(spy).toHaveBeenCalledTimes(1);
    // Ruling 1 depends on the snapshot that was just written being handed to
    // the trim, so the argument is pinned and not only the call.
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/^snapshot-\d+-[0-9a-f]{8}$/),
    );
  });

  it('waits for the store to load before enforcing at activation', async () => {
    const manager = new SnapshotManager(null);
    // A disabled limit returns before the load wait, so this waits with a
    // limit configured: the wait is what the test is about.
    limitMock.mockReturnValue(1000);
    let loaded = false;
    (manager as any).loadPromise = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      loaded = true;
    })();

    const seen: boolean[] = [];
    jest
      .spyOn(manager as any, 'enforceSnapshotSizeLimitInternal')
      .mockImplementation(async () => {
        seen.push(loaded);
        return {
          bytesBefore: 0,
          bytesAfter: 0,
          trimmed: [],
          stillOverLimit: false,
        };
      });

    await manager.enforceSnapshotSizeLimitOnActivation();

    expect(seen).toEqual([true]);
  });

  it('does not wait for the load when the limit is disabled', async () => {
    const manager = new SnapshotManager(null);
    let loadSettled = false;
    (manager as any).loadPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        loadSettled = true;
        resolve();
      }, 0);
    });
    const measureSnapshotStore = jest.fn();
    (manager as any).storage = { measureSnapshotStore };

    const result = await manager.enforceSnapshotSizeLimitOnActivation();

    // A store with no limit must cost activation exactly what it did before
    // this setting existed: no load wait, no lock, no walk.
    expect(loadSettled).toBe(false);
    expect(result.trimmed).toEqual([]);
    expect(measureSnapshotStore).not.toHaveBeenCalled();
  });

  it('is wired into activation', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'extension.ts'),
      'utf8',
    );
    // No host is available here, so the activation call site is pinned by
    // source: a hook that nothing invokes is exactly the class of defect this
    // programme removes.
    expect(source).toMatch(
      /await snapshotManager\.enforceSnapshotSizeLimitOnActivation\(\)/,
    );
  });

  it('leaves no orphan when a purge fails, stopping newest first', async () => {
    const fixtures = [
      snapshot('a', { 'f.ts': { content: 'A' } }, 1),
      snapshot('b', { 'f.ts': { baseSnapshotId: 'a' } }, 2),
      snapshot('c', { 'f.ts': { baseSnapshotId: 'b' } }, 3),
      snapshot('d', { 'f.ts': { baseSnapshotId: 'c' } }, 4),
    ];
    const { manager, storage } = await managerWithStore(fixtures, 'd', [
      storeSizes({ a: 600, b: 300, c: 300, d: 300 }),
      storeSizes({ a: 600, b: 300 }),
    ]);
    limitMock.mockReturnValue(100);
    storage.getSnapshotFileContent.mockResolvedValue('A');
    storage.deleteSnapshotData.mockImplementation((id: string) =>
      id === 'b'
        ? Promise.reject(new Error('EPERM: operation not permitted'))
        : Promise.resolve(),
    );

    const result = await manager.enforceSnapshotSizeLimitOnActivation();

    // Newest first: 'c' went, then 'b' refused and stopped the batch, so 'a' --
    // the base 'b' stores its delta against -- was never touched.
    expect(result.trimmed).toEqual(['c']);
    expect(manager.getSnapshots().map((s) => s.id)).toEqual(['a', 'b', 'd']);
    expect(
      storage.deleteSnapshotData.mock.calls.map((call) => call[0]),
    ).toEqual(['c', 'b']);

    // What a fresh manager would load: the index written after the stop. Every
    // base a survivor names is in it, and 'd' -- whose base 'c' was purged --
    // was materialized before the purge.
    const indexCalls = storage.saveSnapshotIndex.mock.calls;
    const savedIndex = indexCalls[indexCalls.length - 1]?.[0] as Snapshot[];
    expect(savedIndex.map((s) => s.id)).toEqual(['a', 'b', 'd']);
    expect(danglingBaseIds(savedIndex)).toEqual([]);
    expect(savedIndex.find((s) => s.id === 'd')?.files['f.ts']).toEqual({
      content: 'A',
    });
  });

  it('rolls the rewrite back when a survivor save fails, so a later pass does not purge the base', async () => {
    const fixtures = [
      snapshot('a', { 'f.ts': { content: 'A' } }, 1),
      snapshot('b', { 'f.ts': { baseSnapshotId: 'a' } }, 2),
      snapshot('c', { 'f.ts': { baseSnapshotId: 'b' } }, 3),
    ];
    const { manager, storage } = await managerWithStore(fixtures, 'c', [
      storeSizes({ a: 600, b: 300, c: 300 }),
      storeSizes({ a: 600, b: 300, c: 300 }),
      storeSizes({ a: 600, b: 300, c: 300 }),
      storeSizes({ a: 600, b: 300, c: 300 }),
    ]);
    limitMock.mockReturnValue(900);
    storage.getSnapshotFileContent.mockResolvedValue('A');
    storage.saveSnapshotData.mockRejectedValue(
      new Error('ENOSPC: no space left on device'),
    );

    const firstPass = await manager.enforceSnapshotSizeLimitOnActivation();
    const secondPass = await manager.enforceSnapshotSizeLimitOnActivation();

    // 'b' is the survivor of the candidate 'a'. Its rewrite never reached disk,
    // so the second pass has to see the dependency again through the rolled
    // back memory, retry the rewrite and refuse to purge 'a'.
    expect(firstPass.trimmed).toEqual([]);
    expect(secondPass.trimmed).toEqual([]);
    expect(
      storage.saveSnapshotData.mock.calls.map(
        (call) => (call[0] as Snapshot).id,
      ),
    ).toEqual(['b', 'b']);
    expect(storage.deleteSnapshotData).not.toHaveBeenCalled();
    expect(manager.getSnapshots().map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});
