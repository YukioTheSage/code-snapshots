import { SnapshotManager } from '../snapshotManager';
import type { Snapshot } from '../snapshotManager';
import * as vscode from 'vscode';
import { promises as fsPromises } from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return { ...actual, promises: { ...actual.promises } };
});
jest.mock('codelapse-core', () => ({
  GitignoreParser: jest.fn().mockImplementation(() => ({
    getExcludeGlobPattern: () => '**/node_modules/**',
    getNegatedGlobs: () => [],
    shouldIgnore: () => false,
  })),
  runWithConcurrencyLimit: async (
    items: unknown[],
    _n: number,
    fn: (i: unknown) => Promise<void>,
  ) => {
    for (const item of items) {
      await fn(item);
    }
  },
}));

describe('applySnapshotRestoreInternal integrity guard', () => {
  let workspaceRoot: string;
  let manager: SnapshotManager;
  let writeSpy: jest.SpyInstance;
  let deleteSpy: jest.SpyInstance;

  beforeEach(async () => {
    workspaceRoot = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'codelapse-'),
    );
    await fsPromises.writeFile(
      path.join(workspaceRoot, 'present.ts'),
      'on disk',
    );

    manager = new SnapshotManager(null);
    // The constructor calls loadSnapshots() without awaiting it, and that load
    // clears `snapshots` to [] when storage returns nothing. Without settling it
    // first, the fixtures below are overwritten one microtask later.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Inject a storage double with a resolvable workspace root.
    const storage: any = {
      getWorkspaceRoot: () => workspaceRoot,
      // The deletion loop asks where the store is before deleting anything, so
      // that it can refuse to delete the extension's own data. None of the
      // fixtures below live inside it.
      getSnapshotDirectory: () => path.join(workspaceRoot, '.snapshots'),
      getSnapshotFileContent: jest.fn(),
      isBinaryFile: () => false,
      writeFileContent: jest.fn().mockResolvedValue(undefined),
      deleteWorkspaceFile: jest.fn().mockResolvedValue(undefined),
      // Needed because applySnapshotRestoreInternal records the new index
      // after the file operations. The plan's double omitted it, which made
      // every test in this file fail on that call rather than on an assertion.
      saveSnapshotIndex: jest.fn().mockResolvedValue(undefined),
    };
    (manager as any).storage = storage;
    writeSpy = storage.writeFileContent;
    deleteSpy = storage.deleteWorkspaceFile;

    // Workspace contains present.ts and gone.ts; snapshot knows only present.ts.
    (vscode.workspace as any).findFiles = jest
      .fn()
      .mockResolvedValue([
        vscode.Uri.file(path.join(workspaceRoot, 'present.ts')),
        vscode.Uri.file(path.join(workspaceRoot, 'gone.ts')),
      ]);
    await fsPromises.writeFile(
      path.join(workspaceRoot, 'gone.ts'),
      'delete me',
    );

    // One snapshot whose file content is unrecoverable, plus one healthy file.
    (manager as any).snapshots = [
      {
        id: 'snap-a',
        timestamp: 1,
        description: 'a',
        files: {
          'present.ts': { content: 'from snapshot' },
          'broken.ts': { baseSnapshotId: 'snap-gone' },
        },
      },
    ];
    (manager as any).currentSnapshotIndex = 0;

    storage.getSnapshotFileContent.mockImplementation(
      async (_id: string, rel: string) => {
        if (rel === 'broken.ts') return null; // unrecoverable
        if (rel === 'present.ts') return 'from snapshot';
        return null;
      },
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fsPromises.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('does not write a file whose content is unrecoverable', async () => {
    const result = await manager.applySnapshotRestore('snap-a');
    const written = writeSpy.mock.calls.map((c: string[]) => c[0]);
    expect(written.some((p: string) => p.endsWith('broken.ts'))).toBe(false);
    expect(result.skipped).toContain('broken.ts');
  });

  it('does not delete workspace files that are absent from the snapshot', async () => {
    // 'gone.ts' exists on disk but not in the snapshot. Deleting it is only
    // safe when the snapshot is complete; with an unrecoverable file present
    // we must leave the workspace alone.
    const result = await manager.applySnapshotRestore('snap-a');
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(result.refusedDeletions).toContain('gone.ts');
  });

  it('restores the healthy file and reports it', async () => {
    const result = await manager.applySnapshotRestore('snap-a');
    expect(writeSpy).toHaveBeenCalledWith(
      path.join(workspaceRoot, 'present.ts'),
      'from snapshot',
    );
    expect(result.restored).toContain('present.ts');
  });

  it('returns a result object rather than a bare boolean', async () => {
    const result = await manager.applySnapshotRestore('snap-a');
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        restored: expect.any(Array),
        skipped: expect.any(Array),
        refusedDeletions: expect.any(Array),
        deleted: expect.any(Array),
      }),
    );
  });
});

describe('applySnapshotRestoreInternal on a complete snapshot', () => {
  let workspaceRoot: string;
  let manager: SnapshotManager;
  let writeSpy: jest.SpyInstance;
  let deleteSpy: jest.SpyInstance;

  beforeEach(async () => {
    workspaceRoot = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'codelapse-'),
    );
    await fsPromises.writeFile(path.join(workspaceRoot, 'keep.ts'), 'keep');

    manager = new SnapshotManager(null);
    // See the note in the first beforeEach: settle the constructor's un-awaited
    // loadSnapshots() before replacing storage and fixtures.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const storage: any = {
      getWorkspaceRoot: () => workspaceRoot,
      // See the note in the first beforeEach: the deletion loop resolves the
      // store directory before it deletes anything.
      getSnapshotDirectory: () => path.join(workspaceRoot, '.snapshots'),
      getSnapshotFileContent: jest.fn(async (_id: string, rel: string) =>
        rel === 'keep.ts' ? 'from snapshot' : null,
      ),
      isBinaryFile: () => false,
      writeFileContent: jest.fn().mockResolvedValue(undefined),
      deleteWorkspaceFile: jest.fn().mockResolvedValue(undefined),
      saveSnapshotIndex: jest.fn().mockResolvedValue(undefined),
    };
    (manager as any).storage = storage;
    writeSpy = storage.writeFileContent;
    deleteSpy = storage.deleteWorkspaceFile;

    // 'extra.ts' is on disk but absent from a COMPLETE snapshot, so it is
    // genuinely extraneous and must still be deleted.
    (vscode.workspace as any).findFiles = jest
      .fn()
      .mockResolvedValue([
        vscode.Uri.file(path.join(workspaceRoot, 'keep.ts')),
        vscode.Uri.file(path.join(workspaceRoot, 'extra.ts')),
      ]);
    await fsPromises.writeFile(path.join(workspaceRoot, 'extra.ts'), 'extra');

    (manager as any).snapshots = [
      {
        id: 'snap-good',
        timestamp: 1,
        description: 'good',
        files: { 'keep.ts': { content: 'from snapshot' } },
      },
    ];
    (manager as any).currentSnapshotIndex = 0;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fsPromises.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('still deletes extraneous files when nothing is unrecoverable', async () => {
    // The guard must not disable deletion outright -- that would turn a data
    // loss bug into a silent failure to honour the snapshot.
    const result = await manager.applySnapshotRestore('snap-good');
    expect(deleteSpy).toHaveBeenCalledWith(
      path.join(workspaceRoot, 'extra.ts'),
    );
    expect(result.deleted).toContain('extra.ts');
    expect(result.refusedDeletions).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(writeSpy).toHaveBeenCalledWith(
      path.join(workspaceRoot, 'keep.ts'),
      'from snapshot',
    );
  });

  it('records a snapshot marked-deleted file as deleted', async () => {
    (manager as any).snapshots[0].files['gone-marker.ts'] = { deleted: true };
    const result = await manager.applySnapshotRestore('snap-good');
    expect(result.restored).not.toContain('gone-marker.ts');
  });

  it('skips a file the storage cannot resolve even when not known-broken', async () => {
    // Not in the unrecoverable set, but resolution still returns null: must be
    // reported rather than silently treated as an empty file.
    (manager as any).snapshots[0].files['odd.ts'] = {
      baseSnapshotId: 'snap-good',
    };
    const result = await manager.applySnapshotRestore('snap-good');
    expect(result.skipped).toContain('odd.ts');
  });
});

/**
 * Whether the workspace still "corresponds to" the snapshot afterwards.
 *
 * A selective snapshot photographs only the files it was given: restoring it
 * writes those back and leaves everything else in the workspace alone, so the
 * workspace does not become the snapshot's state. Reporting it as the active
 * snapshot is what makes the status bar render "workspace is at snapshot N of M"
 * for a workspace that was mostly untouched -- and it is not hypothetical: a
 * selective capture is the newest snapshot, so it IS the active one when the
 * restore starts.
 *
 * A whole-tree restore really does make the workspace match the snapshot, so it
 * must keep claiming correspondence.
 */
describe('applySnapshotRestore correspondence claim', () => {
  let workspaceRoot: string;
  let manager: SnapshotManager;
  let writeSpy: jest.SpyInstance;

  /**
   * The manager's private collaborators this suite drives.
   *
   * Typed rather than `any`, so a rename in the class fails the compile here
   * instead of leaving the fixtures inert and the assertions vacuous.
   */
  interface ManagerInternals {
    storage: unknown;
    snapshots: Snapshot[];
    activeSnapshotId: string | null;
  }

  function internals(): ManagerInternals {
    return manager as unknown as ManagerInternals;
  }

  beforeEach(async () => {
    workspaceRoot = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'codelapse-'),
    );

    manager = new SnapshotManager(null);
    // See the note in the first beforeEach of this file: settle the
    // constructor's un-awaited loadSnapshots() before replacing storage.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const storage = {
      getWorkspaceRoot: () => workspaceRoot,
      getSnapshotDirectory: () => path.join(workspaceRoot, '.snapshots'),
      getSnapshotFileContent: jest.fn(async (_id: string, rel: string) =>
        rel === 'captured.ts' ? 'captured content' : null,
      ),
      isBinaryFile: () => false,
      writeFileContent: jest.fn().mockResolvedValue(undefined),
      deleteWorkspaceFile: jest.fn().mockResolvedValue(undefined),
      saveSnapshotIndex: jest.fn().mockResolvedValue(undefined),
    };
    internals().storage = storage;
    writeSpy = storage.writeFileContent;

    (vscode.workspace as unknown as { findFiles: jest.Mock }).findFiles = jest
      .fn()
      .mockResolvedValue([
        vscode.Uri.file(path.join(workspaceRoot, 'captured.ts')),
        vscode.Uri.file(path.join(workspaceRoot, 'untouched.ts')),
      ]);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fsPromises.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('does not claim a selective restore leaves the workspace at the snapshot', async () => {
    internals().snapshots = [
      {
        id: 'snap-selective',
        timestamp: 1,
        description: 'selective',
        isSelective: true,
        selectedFiles: ['captured.ts'],
        files: { 'captured.ts': { content: 'captured content' } },
      },
    ];
    // The state a selective restore starts from: taking the snapshot made it the
    // active one, so leaving `activeSnapshotId` untouched would still claim it.
    internals().activeSnapshotId = 'snap-selective';

    const result = await manager.applySnapshotRestore('snap-selective');

    expect(writeSpy).toHaveBeenCalledWith(
      path.join(workspaceRoot, 'captured.ts'),
      'captured content',
    );
    expect(result.restored).toContain('captured.ts');
    // Fails with the claimed snapshot in the message: it renders "workspace is
    // at snapshot N of M" for a capture that covered only part of the tree.
    expect(manager.getActiveSnapshot()).toBeUndefined();
  });

  it('still claims correspondence for a whole-tree restore', async () => {
    internals().snapshots = [
      {
        id: 'snap-whole-tree',
        timestamp: 1,
        description: 'whole tree',
        files: { 'captured.ts': { content: 'captured content' } },
      },
    ];
    internals().activeSnapshotId = null;

    const result = await manager.applySnapshotRestore('snap-whole-tree');

    expect(result.restored).toContain('captured.ts');
    expect(manager.getActiveSnapshot()?.id).toBe('snap-whole-tree');
  });
});
