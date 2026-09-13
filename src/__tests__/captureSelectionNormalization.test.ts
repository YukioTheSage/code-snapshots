import * as vscode from 'vscode';
import { promises as fsPromises } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SnapshotManager } from '../snapshotManager';
import type { Snapshot } from '../snapshotManager';

/** The storage calls this suite's capture path makes, and their answers. */
interface StorageDouble {
  getWorkspaceRoot: () => string;
  getSnapshotDirectory: () => string;
  isBinaryFile: () => boolean;
  checkSuspiciousFilesForBinaryContent: () => Promise<Set<string>>;
  readFileContent: (filePath: string) => Promise<string>;
  getSnapshotFileContent: () => Promise<string | null>;
  saveSnapshotData: jest.Mock;
  deleteSnapshotData: jest.Mock;
  saveSnapshotIndex: jest.Mock;
}

/** The manager's private collaborators this suite has to drive or replace. */
interface ManagerInternals {
  storage: StorageDouble;
  snapshots: Snapshot[];
  activeSnapshotId: string | null;
  saveSnapshotIndex: jest.Mock;
}

function internals(manager: SnapshotManager): ManagerInternals {
  return manager as unknown as ManagerInternals;
}

function vscodeWorkspace(): { findFiles: jest.Mock } {
  return vscode.workspace as unknown as { findFiles: jest.Mock };
}

/**
 * `selectedFiles` arrives from API payloads and editor commands, so its declared
 * type is a promise rather than a fact: a payload can carry one path as a
 * string.
 *
 * The capture filter tested it for truthiness (`snapshot.selectedFiles &&
 * snapshot.selectedFiles.length > 0`) while the deletion guard tested
 * `Array.isArray`, and the two disagree exactly for a truthy non-array. The
 * filter then runs `new Set('src/app.ts')` -- a set of characters, which matches
 * no path -- so the capture holds no files at all, and the guard reads that as a
 * whole-tree capture whose deletion pass records a `{deleted:true}` tombstone
 * for every file in the workspace: the wipe shape the capture guard exists to
 * prevent, reachable through the front door.
 *
 * The tests below drive the real capture path against a real temporary
 * workspace; only the workspace scan and the storage writes are doubled.
 */
describe('takeSnapshot selectedFiles normalization', () => {
  const APP_KEY = path.join('src', 'app.ts');
  const OTHER_KEY = 'other.ts';

  let dir: string;
  let manager: SnapshotManager;

  beforeEach(async () => {
    dir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'codelapse-capture-'),
    );
    await fsPromises.mkdir(path.join(dir, 'src'), { recursive: true });
    await fsPromises.writeFile(path.join(dir, APP_KEY), 'app contents');
    await fsPromises.writeFile(path.join(dir, OTHER_KEY), 'other contents');

    manager = new SnapshotManager(null);
    // The constructor calls loadSnapshots() without awaiting it, and that load
    // clears `snapshots` when storage returns nothing. Settle it before
    // supplying fixtures.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const storage: StorageDouble = {
      getWorkspaceRoot: () => dir,
      // The scan path resolves the store location through storage, so the
      // parser excludes the directory snapshots are written to.
      getSnapshotDirectory: () => path.join(dir, '.snapshots'),
      isBinaryFile: () => false,
      checkSuspiciousFilesForBinaryContent: async () => new Set<string>(),
      readFileContent: async (filePath: string) =>
        fsPromises.readFile(filePath, 'utf8'),
      getSnapshotFileContent: async () => null,
      saveSnapshotData: jest.fn().mockResolvedValue(undefined),
      deleteSnapshotData: jest.fn().mockResolvedValue(undefined),
      saveSnapshotIndex: jest.fn().mockResolvedValue(undefined),
    };
    internals(manager).storage = storage;
    internals(manager).saveSnapshotIndex = jest
      .fn()
      .mockResolvedValue(undefined);

    // A previous snapshot that really holds both files: "absent from the current
    // scan" can then only mean the deletion pass invented their absence.
    const base: Snapshot = {
      id: 'base',
      timestamp: 1,
      description: 'base',
      files: {
        [APP_KEY]: { content: 'app contents' },
        [OTHER_KEY]: { content: 'other contents' },
      },
    };
    internals(manager).snapshots = [base];
    internals(manager).activeSnapshotId = base.id;

    vscodeWorkspace().findFiles = jest
      .fn()
      .mockImplementation(async () => [
        vscode.Uri.file(path.join(dir, APP_KEY)),
        vscode.Uri.file(path.join(dir, OTHER_KEY)),
      ]);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fsPromises.rm(dir, { recursive: true, force: true });
  });

  async function filesCapturedWith(selectedFiles: unknown) {
    const outcome = await manager.takeSnapshot('api payload', {
      isSelective: true,
      selectedFiles: selectedFiles as string[],
    });

    return outcome.created ? outcome.snapshot : null;
  }

  it('treats a non-array selectedFiles as a whole-tree capture', async () => {
    const snapshot = await filesCapturedWith(APP_KEY);

    expect(snapshot).not.toBeNull();
    // The bug: a truthy non-array made the filter select nothing and the guard
    // call it a whole-tree capture, so both files were tombstoned.
    expect(snapshot?.files[OTHER_KEY]).toEqual({ content: 'other contents' });
    expect(snapshot?.files[APP_KEY]).toEqual({ content: 'app contents' });
    expect(
      Object.values(snapshot?.files ?? {}).some((entry) => entry.deleted),
    ).toBe(false);
    // Coerced to "no selection", which is the whole-tree shape both sides read.
    expect(snapshot?.selectedFiles).toEqual([]);
  });

  it('keeps the usable entries of an array and drops the rest', async () => {
    const snapshot = await filesCapturedWith([APP_KEY, 42, null, '']);

    // A real selection of one file: only it is captured, and because the
    // selection is non-empty the deletion pass stays off.
    expect(snapshot?.files[APP_KEY]).toEqual({ content: 'app contents' });
    expect(snapshot?.files[OTHER_KEY]).toBeUndefined();
    expect(snapshot?.selectedFiles).toEqual([APP_KEY]);
  });
});
