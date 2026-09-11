import * as path from 'path';
import { SnapshotManager } from '../snapshotManager';

/**
 * The scan that decides what goes into a snapshot must exclude the directory
 * snapshots are actually written to.
 *
 * `snapshotStorage` resolves `snapshotLocation` **once**, at activation, while
 * the scan used to re-read the setting per snapshot. When those two reads
 * disagreed -- observed in the integration suite as 2 of 49 scans naming
 * `.snapshots` while the store was `.snapshots-test` -- the store was captured
 * into the very snapshot being written, and the phantom `deleted` entries that
 * followed defeated the auto-snapshot no-changes skip. This pins the single
 * source of truth: the storage layer's resolved directory.
 */
jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  getSnapshotLocation: jest.fn(() => '.snapshots'),
}));

describe('scan store location', () => {
  const workspaceRoot = path.join(path.sep, 'ws');

  function managerWithStorage(
    storage: Record<string, unknown>,
  ): SnapshotManager {
    const manager = new SnapshotManager(null);
    (manager as any).storage = storage;
    return manager;
  }

  it('uses the directory storage writes to, not a divergent config read', () => {
    const manager = managerWithStorage({
      getWorkspaceRoot: () => workspaceRoot,
      getSnapshotDirectory: () => path.join(workspaceRoot, '.snapshots-test'),
    });

    // The mocked config says `.snapshots`; the store is `.snapshots-test`.
    expect((manager as any).getStoreLocationForScan(workspaceRoot)).toBe(
      '.snapshots-test',
    );
  });

  it('falls back to the configured location when the store is outside the workspace', () => {
    const manager = managerWithStorage({
      getWorkspaceRoot: () => workspaceRoot,
      getSnapshotDirectory: () =>
        path.join(path.sep, 'elsewhere', '.snapshots'),
    });

    // A store outside the workspace is unreachable by a workspace scan, so the
    // configured value is the best available answer rather than a `..` path.
    expect((manager as any).getStoreLocationForScan(workspaceRoot)).toBe(
      '.snapshots',
    );
  });

  it('falls back to the configured location when storage has no directory', () => {
    const manager = managerWithStorage({
      getWorkspaceRoot: () => workspaceRoot,
      getSnapshotDirectory: () => '',
    });

    expect((manager as any).getStoreLocationForScan(workspaceRoot)).toBe(
      '.snapshots',
    );
  });
});
