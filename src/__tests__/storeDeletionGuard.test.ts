import { SnapshotManager } from '../snapshotManager';
import { GitignoreParser } from 'codelapse-core';
import * as vscode from 'vscode';
import { promises as fsPromises } from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return { ...actual, promises: { ...actual.promises } };
});

/**
 * The parser is mocked, but the constructor call is what tells the snapshot
 * engine where the store is: a parser built without the configured location
 * assumes `.snapshots` and leaves a custom store inside the scanned tree.
 */
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

const GitignoreParserMock = GitignoreParser as unknown as jest.Mock;

/** The fixture workspace's configured `snapshotLocation`. */
const STORE_REL = '.snapshots-test';

/**
 * Defence in depth for the data-loss path.
 *
 * The store lives inside the scanned workspace, so a restore that enumerates
 * workspace files and deletes everything the target snapshot does not contain
 * would delete the store itself -- including the payload of the snapshot being
 * restored to and of every newer one, which are written after their own
 * snapshot's file scan. The parser fix keeps the store out of that enumeration;
 * these tests pin the second line of defence, which must hold on its own: even
 * if store paths reach the deletion loop, none of them may be deleted, while
 * ordinary extraneous files still must be.
 */
describe('applySnapshotRestore store-deletion guard', () => {
  let workspaceRoot: string;
  let storeDirectory: string;
  let manager: SnapshotManager;
  let deleteSpy: jest.SpyInstance;
  let storeIndexRel: string;
  let storePayloadRel: string;

  beforeEach(async () => {
    workspaceRoot = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'codelapse-store-'),
    );
    storeDirectory = path.join(workspaceRoot, STORE_REL);
    await fsPromises.mkdir(path.join(storeDirectory, 'snapshot-a'), {
      recursive: true,
    });
    await fsPromises.writeFile(
      path.join(storeDirectory, 'index.json'),
      '{"snapshots":[]}',
    );
    await fsPromises.writeFile(
      path.join(storeDirectory, 'snapshot-a', 'snapshot.json'),
      '{"id":"snapshot-a"}',
    );

    // The configured location reaches the parser through this setting.
    (vscode.workspace as any).getConfiguration = jest.fn(() => ({
      get: (key: string, fallback?: unknown) =>
        key === 'snapshotLocation' ? STORE_REL : fallback,
      has: jest.fn(() => false),
      update: jest.fn(),
      inspect: jest.fn(),
    }));

    manager = new SnapshotManager(null);
    // The constructor calls loadSnapshots() without awaiting it; let it settle
    // before the fixtures below replace what it loaded.
    await new Promise((resolve) => setTimeout(resolve, 0));

    storeIndexRel = path.join(STORE_REL, 'index.json');
    storePayloadRel = path.join(STORE_REL, 'snapshot-a', 'snapshot.json');

    const storage: any = {
      getWorkspaceRoot: () => workspaceRoot,
      getSnapshotDirectory: () => storeDirectory,
      getSnapshotFileContent: jest.fn(async (_id: string, rel: string) =>
        rel === path.join('src', 'app.ts') ? 'from snapshot' : null,
      ),
      isBinaryFile: () => false,
      writeFileContent: jest.fn().mockResolvedValue(undefined),
      // Deletes for real, like the production storage module: a double that
      // only records the call would make "the file is still there" true no
      // matter what the guard did.
      deleteWorkspaceFile: jest.fn(async (absolutePath: string) => {
        await fsPromises.rm(absolutePath, { force: true });
      }),
      saveSnapshotIndex: jest.fn().mockResolvedValue(undefined),
    };
    (manager as any).storage = storage;
    deleteSpy = storage.deleteWorkspaceFile;

    (vscode.workspace as any).findFiles = jest
      .fn()
      .mockResolvedValue([
        vscode.Uri.file(path.join(workspaceRoot, 'src', 'app.ts')),
        vscode.Uri.file(path.join(workspaceRoot, 'extra.ts')),
        vscode.Uri.file(path.join(storeDirectory, 'index.json')),
        vscode.Uri.file(
          path.join(storeDirectory, 'snapshot-a', 'snapshot.json'),
        ),
      ]);

    (manager as any).snapshots = [
      {
        id: 'snapshot-a',
        timestamp: 1,
        description: 'a',
        files: { [path.join('src', 'app.ts')]: { content: 'from snapshot' } },
      },
    ];
    (manager as any).activeSnapshotId = 'snapshot-a';
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fsPromises.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('refuses to delete anything inside the configured store', async () => {
    const result = await manager.applySnapshotRestore('snapshot-a');

    expect(result.refusedDeletions).toEqual([storeIndexRel, storePayloadRel]);
    expect(result.deleted).toEqual(['extra.ts']);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(
      path.join(workspaceRoot, 'extra.ts'),
    );
  });

  it('leaves the store files on disk', async () => {
    await manager.applySnapshotRestore('snapshot-a');

    // The unit-level counterpart of the integration assertion: the store's
    // index and the payload it advertised are still there after the restore,
    // while the genuinely extraneous workspace file is gone.
    await expect(
      fsPromises.readFile(path.join(storeDirectory, 'index.json'), 'utf8'),
    ).resolves.toBe('{"snapshots":[]}');
    await expect(
      fsPromises.readFile(
        path.join(storeDirectory, 'snapshot-a', 'snapshot.json'),
        'utf8',
      ),
    ).resolves.toBe('{"id":"snapshot-a"}');
    await expect(
      fsPromises.stat(path.join(workspaceRoot, 'extra.ts')),
    ).rejects.toThrow();
  });

  it('builds the parser with the configured location, not the default', async () => {
    await manager.applySnapshotRestore('snapshot-a');

    // Without the second argument the parser assumes `.snapshots` and the
    // configured store is never excluded from the scan.
    expect(GitignoreParserMock).toHaveBeenCalledWith(workspaceRoot, STORE_REL);
  });

  it('does not refuse deletions when the store is outside the workspace', async () => {
    const outsideStore = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'codelapse-outside-'),
    );
    (manager as any).storage.getSnapshotDirectory = () => outsideStore;

    try {
      const result = await manager.applySnapshotRestore('snapshot-a');

      // A workspace file that merely resembles a store path is ordinary
      // content: the guard must not turn into a blanket refusal to delete.
      expect(result.refusedDeletions).toEqual([]);
      expect(result.deleted).toEqual([
        'extra.ts',
        storeIndexRel,
        storePayloadRel,
      ]);
    } finally {
      await fsPromises.rm(outsideStore, { recursive: true, force: true });
    }
  });

  it('treats a differently-cased store path as the store on Windows only', async () => {
    const caseVariantRel = path.join('.Snapshots-Test', 'index.json');
    (vscode.workspace as any).findFiles = jest
      .fn()
      .mockResolvedValue([
        vscode.Uri.file(path.join(workspaceRoot, 'extra.ts')),
        vscode.Uri.file(path.join(workspaceRoot, caseVariantRel)),
      ]);

    const result = await manager.applySnapshotRestore('snapshot-a');

    if (process.platform === 'win32') {
      expect(result.refusedDeletions).toEqual([caseVariantRel]);
      expect(result.deleted).toEqual(['extra.ts']);
    } else {
      // A case-sensitive filesystem: this is a different directory, not the
      // store, so it stays ordinary workspace content and is deleted like any
      // other file, in the order the workspace listed it.
      expect(result.deleted).toEqual(['extra.ts', caseVariantRel]);
    }
  });
});
