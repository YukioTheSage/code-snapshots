import { SnapshotManager, selectPrunableSnapshots } from '../snapshotManager';
import type { Snapshot } from '../snapshotManager';

// `enforceSnapshotLimit` reads the configured maximum through `src/config`.
// One is the smallest limit that can prune anything, so two snapshots below
// make the oldest exactly one excess snapshot.
jest.mock('../config', () => ({
  getMaxSnapshots: () => 1,
}));

function snapshot(
  id: string,
  files: Snapshot['files'],
  timestamp: number,
): Snapshot {
  return { id, timestamp, description: id, files };
}

describe('selectPrunableSnapshots', () => {
  it('returns nothing when under the limit', () => {
    const all = [snapshot('a', {}, 1), snapshot('b', {}, 2)];
    expect(selectPrunableSnapshots(all, 5)).toEqual([]);
  });

  it('selects oldest snapshots first when nothing references them', () => {
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { content: 'b' } }, 2),
      snapshot('c', { 'x.ts': { content: 'c' } }, 3),
    ];
    expect(selectPrunableSnapshots(all, 2)).toEqual(['a']);
  });

  it('never selects a snapshot that another snapshot references', () => {
    // 'b' is the base for 'c', so deleting 'b' would break 'c'.
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { content: 'b' } }, 2),
      snapshot('c', { 'x.ts': { baseSnapshotId: 'b' } }, 3),
    ];
    expect(selectPrunableSnapshots(all, 2)).toEqual(['a']);
  });

  it('stops early rather than orphaning references', () => {
    // Under a limit of 1, the only prune candidates are 'a' and 'b', but 'b'
    // is referenced by 'c'. Pruning must stop after 'a' rather than exceed
    // safety.
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { content: 'b' } }, 2),
      snapshot('c', { 'x.ts': { baseSnapshotId: 'b' } }, 3),
    ];
    expect(selectPrunableSnapshots(all, 1)).toEqual(['a']);
  });

  it('returns nothing when every candidate is referenced', () => {
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { baseSnapshotId: 'a' } }, 2),
    ];
    expect(selectPrunableSnapshots(all, 1)).toEqual([]);
  });

  it('ignores a reference from a snapshot that is itself being pruned', () => {
    // 'b' references 'a', but 'b' is also pruned, so 'a' becomes free.
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { baseSnapshotId: 'a' } }, 2),
      snapshot('c', { 'x.ts': { content: 'c' } }, 3),
    ];
    // Limit 1 => need to remove 2. 'c' is referenced by nobody and is newest,
    // so selection must go oldest-first: 'a' then 'b'.
    expect(selectPrunableSnapshots(all, 1)).toEqual(['a', 'b']);
  });

  it('orders by timestamp, not array position', () => {
    const all = [
      snapshot('newer', { 'x.ts': { content: 'n' } }, 30),
      snapshot('older', { 'x.ts': { content: 'o' } }, 10),
    ];
    expect(selectPrunableSnapshots(all, 1)).toEqual(['older']);
  });

  // Guards on the property the tests above imply but do not state outright:
  // pruning must never take from the newest end.
  it('never selects the newest snapshot while an older one is selectable', () => {
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { content: 'b' } }, 2),
      snapshot('c', { 'x.ts': { content: 'c' } }, 3),
      snapshot('d', { 'x.ts': { content: 'd' } }, 4),
    ];
    const selected = selectPrunableSnapshots(all, 2);
    expect(selected).toEqual(['a', 'b']);
    expect(selected).not.toContain('d');
  });

  it('returns a prefix of the oldest-first order', () => {
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { content: 'b' } }, 2),
      snapshot('c', { 'x.ts': { baseSnapshotId: 'b' } }, 3),
      snapshot('d', { 'x.ts': { content: 'd' } }, 4),
    ];
    // excess 2, but 'b' is held by surviving 'c', so only 'a' is safe.
    expect(selectPrunableSnapshots(all, 2)).toEqual(['a']);
  });

  it('stops at the target rather than pruning more than required', () => {
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { content: 'b' } }, 2),
      snapshot('c', { 'x.ts': { content: 'c' } }, 3),
    ];
    expect(selectPrunableSnapshots(all, 2)).toHaveLength(1);
  });

  it('terminates when every snapshot transitively references the oldest', () => {
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { baseSnapshotId: 'a' } }, 2),
      snapshot('c', { 'x.ts': { baseSnapshotId: 'b' } }, 3),
      snapshot('d', { 'x.ts': { baseSnapshotId: 'c' } }, 4),
    ];
    // A chain: nothing below 'd' can be dropped without breaking the newest.
    expect(selectPrunableSnapshots(all, 1)).toEqual([]);
  });

  it('allows pruning a whole removable prefix of a chain', () => {
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { baseSnapshotId: 'a' } }, 2),
      snapshot('c', { 'x.ts': { content: 'c' } }, 3),
    ];
    // 'a' and 'b' can both go: nothing surviving references either.
    expect(selectPrunableSnapshots(all, 1)).toEqual(['a', 'b']);
  });
});

/**
 * The manager-side half of pruning. `selectPrunableSnapshots` above still
 * refuses to delete a snapshot a survivor references -- that guard is the
 * reason the store grew without bound, because every survivor of a delta chain
 * references the old end. `enforceSnapshotLimit` therefore has to repair the
 * survivors first: rewrite each entry that points into the pruned prefix into
 * full content, resolved while the chain is still intact, and only then delete.
 *
 * Both halves of that are asserted below: without the repair nothing is pruned
 * (the first and third cases), and when a dependency cannot be resolved the
 * refusal is complete -- no partial rewrite reaches storage and nothing is
 * deleted (the second case).
 */
describe('enforceSnapshotLimit materialization', () => {
  /**
   * `SnapshotManager`'s constructor calls `loadSnapshots()` without awaiting it,
   * and that load clears `snapshots` to [] when storage returns nothing.
   * Fixtures assigned straight after construction are overwritten one microtask
   * later, so settle the initial load first and only then swap in the mock
   * storage. `getMaxSnapshots` is mocked to 1 above, so at two snapshots the
   * oldest is exactly one excess snapshot: prunable only once nothing surviving
   * references it.
   */
  async function managerUnderLimitOfOne(snapshots: Snapshot[]) {
    const manager = new SnapshotManager(null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const storage = {
      getWorkspaceRoot: () => '/ws',
      getSnapshotFileContent: jest.fn(),
      saveSnapshotData: jest.fn().mockResolvedValue(undefined),
      deleteSnapshotData: jest.fn().mockResolvedValue(undefined),
      saveSnapshotIndex: jest.fn().mockResolvedValue(undefined),
    };
    (manager as any).storage = storage;
    (manager as any).snapshots = snapshots;
    // The report is cached and refreshed at every mutation site; assigning the
    // array directly bypasses those, so refresh explicitly.
    (manager as any).refreshIntegrityReport();
    return { manager, storage };
  }

  it('rewrites dangling entries to full content and prunes to the limit', async () => {
    const { manager, storage } = await managerUnderLimitOfOne([
      snapshot('a', { 'f.ts': { content: 'content of A' } }, 1),
      snapshot('b', { 'f.ts': { baseSnapshotId: 'a' } }, 2),
    ]);
    storage.getSnapshotFileContent.mockResolvedValue('content of A');

    await (manager as any).enforceSnapshotLimit();

    // The survivor's delta was resolved through the still-intact chain, with
    // the snapshot list needed to walk it...
    expect(storage.getSnapshotFileContent).toHaveBeenCalledWith(
      'b',
      'f.ts',
      expect.any(Array),
    );
    // ...and persisted, so a reload sees a self-contained entry rather than a
    // reference to a snapshot that no longer exists...
    expect(storage.saveSnapshotData).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b' }),
    );
    // ...before the base it referenced was deleted.
    expect(storage.deleteSnapshotData).toHaveBeenCalledWith('a');

    const survivors = manager.getSnapshots();
    expect(survivors.map((s) => s.id)).toEqual(['b']);
    expect(survivors[0].files['f.ts']).toEqual({ content: 'content of A' });
  });

  it('refuses to prune and reverts every rewrite when a dependency cannot be resolved', async () => {
    const { manager, storage } = await managerUnderLimitOfOne([
      snapshot(
        'a',
        { 'ok.ts': { content: 'A ok' }, 'f.ts': { content: 'A f' } },
        1,
      ),
      snapshot(
        'b',
        {
          'ok.ts': { baseSnapshotId: 'a' },
          'f.ts': { baseSnapshotId: 'a' },
        },
        2,
      ),
    ]);
    // The first entry resolves and the second does not. Materialization must be
    // all-or-nothing: the entry that already succeeded is as unpublishable as
    // the one that failed.
    storage.getSnapshotFileContent
      .mockResolvedValueOnce('content of A ok')
      .mockResolvedValue(null);

    await (manager as any).enforceSnapshotLimit();

    // The attempt happened at all -- otherwise "nothing was persisted" would
    // also hold for a manager that never tried.
    expect(storage.getSnapshotFileContent).toHaveBeenCalled();

    const survivors = manager.getSnapshots();
    expect(survivors.map((s) => s.id)).toEqual(['a', 'b']);
    expect(survivors[1].files['ok.ts']).toEqual({ baseSnapshotId: 'a' });
    expect(survivors[1].files['f.ts']).toEqual({ baseSnapshotId: 'a' });
    expect(storage.saveSnapshotData).not.toHaveBeenCalled();
    expect(storage.deleteSnapshotData).not.toHaveBeenCalled();
  });

  it('leaves { deleted: true } markers untouched while materializing', async () => {
    const { manager, storage } = await managerUnderLimitOfOne([
      snapshot(
        'a',
        {
          'f.ts': { content: 'content of A' },
          'gone.ts': { content: 'A gone' },
        },
        1,
      ),
      snapshot(
        'b',
        { 'f.ts': { baseSnapshotId: 'a' }, 'gone.ts': { deleted: true } },
        2,
      ),
    ]);
    storage.getSnapshotFileContent.mockResolvedValue('content of A');

    await (manager as any).enforceSnapshotLimit();

    const survivors = manager.getSnapshots();
    expect(survivors.map((s) => s.id)).toEqual(['b']);
    expect(survivors[0].files['f.ts']).toEqual({ content: 'content of A' });
    // A deletion marker is not a delta: it has no base to repair, and resolving
    // it would either fail the whole prune or replace the marker with content
    // for a file the snapshot records as gone.
    expect(survivors[0].files['gone.ts']).toEqual({ deleted: true });
    expect(storage.getSnapshotFileContent).not.toHaveBeenCalledWith(
      'b',
      'gone.ts',
      expect.any(Array),
    );
  });
});
