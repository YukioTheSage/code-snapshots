import {
  ACTIVE_NONE,
  resolveActiveIndex,
  resolveNavigationTarget,
} from '../snapshotSelection';
import { SnapshotManager } from '../snapshotManager';
import type { Snapshot } from '../snapshotManager';

function snapshot(id: string, timestamp: number): Snapshot {
  return { id, timestamp, description: id, files: {} };
}

/**
 * The constructor kicks off `loadSnapshots()` without awaiting it, and that
 * continuation replaces `snapshots` with whatever storage returned. Letting it
 * settle before installing fixtures is what makes these tests assert what they
 * claim to: otherwise the async load can overwrite the fixture afterwards.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('resolveActiveIndex', () => {
  it('returns the index of the active snapshot', () => {
    const all = [snapshot('a', 1), snapshot('b', 2), snapshot('c', 3)];
    expect(resolveActiveIndex(all, 'b')).toBe(1);
  });

  it('returns ACTIVE_NONE when nothing is active', () => {
    const all = [snapshot('a', 1), snapshot('b', 2)];
    expect(resolveActiveIndex(all, null)).toBe(ACTIVE_NONE);
  });

  it('returns ACTIVE_NONE when the active id is no longer present', () => {
    const all = [snapshot('a', 1)];
    expect(resolveActiveIndex(all, 'gone')).toBe(ACTIVE_NONE);
  });

  it('is independent of array order', () => {
    const all = [snapshot('c', 3), snapshot('a', 1), snapshot('b', 2)];
    expect(resolveActiveIndex(all, 'a')).toBe(1);
  });
});

describe('resolveNavigationTarget', () => {
  const all = [snapshot('a', 1), snapshot('b', 2), snapshot('c', 3)];

  it('steps back one snapshot', () => {
    expect(resolveNavigationTarget(all, 2, 'previous')).toBe(1);
  });

  it('steps forward one snapshot', () => {
    expect(resolveNavigationTarget(all, 0, 'next')).toBe(1);
  });

  it('starts from the newest snapshot when detached, in both directions', () => {
    // The bug this guards: with no active snapshot the old guards compared
    // `currentIndex <= 0`, so "previous" reported having no history while five
    // snapshots existed, and "next" resolved to `snapshots[0]` -- the oldest.
    expect(resolveNavigationTarget(all, ACTIVE_NONE, 'previous')).toBe(2);
    expect(resolveNavigationTarget(all, ACTIVE_NONE, 'next')).toBe(2);
  });

  it('reports nothing to navigate to at each end', () => {
    expect(resolveNavigationTarget(all, 0, 'previous')).toBe(ACTIVE_NONE);
    expect(resolveNavigationTarget(all, 2, 'next')).toBe(ACTIVE_NONE);
  });

  it('reports nothing to navigate to in an empty store', () => {
    expect(resolveNavigationTarget([], ACTIVE_NONE, 'previous')).toBe(
      ACTIVE_NONE,
    );
    expect(resolveNavigationTarget([], ACTIVE_NONE, 'next')).toBe(ACTIVE_NONE);
  });
});

describe('SnapshotManager active-snapshot state', () => {
  it('reports no active snapshot on a freshly loaded store', async () => {
    const manager = new SnapshotManager(null);
    await settle();
    (manager as any).snapshots = [snapshot('a', 1), snapshot('b', 2)];
    // Nothing has been restored, so no snapshot describes the workspace.
    (manager as any).activeSnapshotId = null;

    expect(manager.getCurrentSnapshotIndex()).toBe(ACTIVE_NONE);
    expect(manager.getActiveSnapshot()).toBeUndefined();
    expect(manager.isSnapshotActive('b')).toBe(false);
  });

  it('reports the active snapshot after a restore', async () => {
    const manager = new SnapshotManager(null);
    await settle();
    (manager as any).snapshots = [snapshot('a', 1), snapshot('b', 2)];
    (manager as any).activeSnapshotId = 'a';

    expect(manager.getCurrentSnapshotIndex()).toBe(0);
    expect(manager.getActiveSnapshot()?.id).toBe('a');
    expect(manager.isSnapshotActive('a')).toBe(true);
    expect(manager.isSnapshotActive('b')).toBe(false);
  });

  it('detaches after clearActiveSnapshot', async () => {
    const manager = new SnapshotManager(null);
    await settle();
    (manager as any).snapshots = [snapshot('a', 1)];
    (manager as any).activeSnapshotId = 'a';
    (manager as any).currentSnapshotIndex = 0;
    (manager as any).saveSnapshotIndex = jest.fn().mockResolvedValue(undefined);

    await manager.clearActiveSnapshot();

    expect(manager.getActiveSnapshot()).toBeUndefined();
    expect(manager.getCurrentSnapshotIndex()).toBe(ACTIVE_NONE);
  });

  it('does not treat the newest snapshot as active just because it is newest', async () => {
    const manager = new SnapshotManager(null);
    await settle();
    (manager as any).snapshots = [snapshot('a', 1), snapshot('b', 2)];
    (manager as any).activeSnapshotId = null;
    expect(manager.isSnapshotActive('b')).toBe(false);
  });
});

describe('SnapshotManager legacy index migration', () => {
  it('starts detached when the persisted index predates activeSnapshotId', async () => {
    const manager = new SnapshotManager(null);
    await settle();
    // A legacy index.json: `currentIndex` meant "newest", so it is not
    // evidence that the workspace corresponds to that snapshot.
    (manager as any).storage = {
      loadSnapshotIndexAndMetadata: jest.fn().mockResolvedValue({
        snapshots: [snapshot('a', 1), snapshot('b', 2)],
        currentIndex: 1,
      }),
    };

    await (manager as any).loadSnapshots();

    expect(manager.getSnapshots()).toHaveLength(2);
    expect(manager.getCurrentSnapshotIndex()).toBe(ACTIVE_NONE);
    expect(manager.getActiveSnapshot()).toBeUndefined();
  });

  it('honours a persisted activeSnapshotId', async () => {
    const manager = new SnapshotManager(null);
    await settle();
    (manager as any).storage = {
      loadSnapshotIndexAndMetadata: jest.fn().mockResolvedValue({
        snapshots: [snapshot('a', 1), snapshot('b', 2)],
        currentIndex: 1,
        activeSnapshotId: 'a',
      }),
    };

    await (manager as any).loadSnapshots();

    expect(manager.getCurrentSnapshotIndex()).toBe(0);
    expect(manager.getActiveSnapshot()?.id).toBe('a');
  });
});
