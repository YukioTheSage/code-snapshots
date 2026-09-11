import { SnapshotManager } from '../snapshotManager';
import type { Snapshot } from '../snapshotManager';
import * as vscode from 'vscode';

// `enforceSnapshotLimit` reads the configured maximum through `src/config`.
jest.mock('../config', () => ({
  getMaxSnapshots: () => 1,
}));

function snapshot(id: string, files: Snapshot['files']): Snapshot {
  return { id, timestamp: 1, description: id, files };
}

/**
 * `SnapshotManager`'s constructor calls `loadSnapshots()` without awaiting it,
 * and that load clears `snapshots` to [] when storage returns nothing. Fixtures
 * assigned immediately after construction are overwritten one microtask later,
 * so every test settles the initial load first.
 */
async function managerWith(snapshots: Snapshot[]): Promise<SnapshotManager> {
  const manager = new SnapshotManager(null);
  await new Promise((resolve) => setTimeout(resolve, 0));
  (manager as any).snapshots = snapshots;
  // The report is cached and refreshed at each mutation site; assigning the
  // array directly bypasses those, so refresh explicitly, exactly as a
  // mutation would.
  (manager as any).refreshIntegrityReport();
  return manager;
}

describe('SnapshotManager.getIntegrityReport', () => {
  it('reports no breakage for a healthy store', async () => {
    const manager = await managerWith([
      snapshot('a', { 'x.ts': { content: 'x' } }),
      snapshot('b', { 'x.ts': { baseSnapshotId: 'a' } }),
    ]);
    expect(manager.getIntegrityReport().unrecoverableFileCount).toBe(0);
  });

  it('reports breakage and marks the affected snapshot', async () => {
    const manager = await managerWith([
      snapshot('a', { 'x.ts': { baseSnapshotId: 'gone' } }),
    ]);
    const report = manager.getIntegrityReport();
    expect(report.unrecoverableFileCount).toBe(1);
    expect(report.brokenSnapshotIds).toEqual(['a']);
  });

  it('exposes per-snapshot lookup for the tree view', async () => {
    const manager = await managerWith([
      snapshot('a', { 'x.ts': { baseSnapshotId: 'gone' } }),
      snapshot('b', { 'y.ts': { content: 'y' } }),
    ]);
    expect(manager.getUnrecoverableFilesFor('a')).toEqual(['x.ts']);
    expect(manager.getUnrecoverableFilesFor('b')).toEqual([]);
    expect(manager.getUnrecoverableFilesFor('missing')).toEqual([]);
  });
});

describe('the report is refreshed by real mutation paths', () => {
  it('reflects breakage created by deleting a snapshot other snapshots depend on', async () => {
    // The point of the cache is that it is refreshed wherever the snapshot list
    // changes. Deleting a base is the ordinary way breakage appears, so this
    // fails if deleteSnapshot forgets to refresh.
    const manager = await managerWith([
      snapshot('base', { 'x.ts': { content: 'x' } }),
      snapshot('child', { 'x.ts': { baseSnapshotId: 'base' } }),
    ]);
    expect(manager.getIntegrityReport().unrecoverableFileCount).toBe(0);

    (manager as any).storage = {
      getWorkspaceRoot: () => '/ws',
      // The survivor's delta cannot be resolved through the base, so the
      // delete is only allowed through the explicit force path.
      getSnapshotFileContent: jest.fn().mockResolvedValue(null),
      deleteSnapshotData: jest.fn().mockResolvedValue(undefined),
      saveSnapshotIndex: jest.fn().mockResolvedValue(undefined),
    };

    await manager.deleteSnapshot('base', { skipConfirm: true, force: true });

    const report = manager.getIntegrityReport();
    expect(report.unrecoverableFileCount).toBe(1);
    expect(report.brokenSnapshotIds).toEqual(['child']);
    expect(report.missingBaseSnapshotIds).toEqual(['base']);
  });

  it('keeps the report empty when nothing is broken', async () => {
    const manager = await managerWith([
      snapshot('base', { 'x.ts': { content: 'x' } }),
      snapshot('child', { 'x.ts': { baseSnapshotId: 'base' } }),
    ]);
    expect(manager.getIntegrityReport()).toEqual(
      expect.objectContaining({
        unrecoverableFileCount: 0,
        brokenSnapshotIds: [],
        missingBaseSnapshotIds: [],
        perSnapshot: {},
      }),
    );
  });

  it('returns a report that does not alias internal state across refreshes', async () => {
    const manager = await managerWith([
      snapshot('a', { 'x.ts': { baseSnapshotId: 'gone' } }),
    ]);
    const first = manager.getIntegrityReport();
    expect(first.unrecoverableFileCount).toBe(1);

    (manager as any).snapshots = [snapshot('b', { 'y.ts': { content: 'y' } })];
    (manager as any).refreshIntegrityReport();

    expect(manager.getIntegrityReport().unrecoverableFileCount).toBe(0);
    // The earlier reference is a snapshot of the earlier state, not a live view.
    expect(first.unrecoverableFileCount).toBe(1);
  });
});
