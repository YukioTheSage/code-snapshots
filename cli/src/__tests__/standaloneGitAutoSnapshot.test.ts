/* eslint-disable @typescript-eslint/no-var-requires */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SnapshotManager } from 'codelapse-core';
import { StandaloneHandler } from '../standaloneHandler';
import { useRealFileSystem } from './realFs';

/**
 * 'codelapse git auto-commit <operation>' in standalone mode.
 *
 * The snapshot needs no Git binary: the operation is a label, not something git
 * has to be asked about. That is not just a claim. The fixture is a temp
 * directory with no `.git`, so SnapshotManager's git metadata read is skipped
 * by its `existsSync` guard, and `handler.gitIntegration` is never wired: an
 * implementation that consulted the integration would die in `ensureGit()`
 * with 'Handler not initialized' rather than pass by accident.
 */

jest.mock('vscode', () => require('../../../src/__tests__/__mocks__/vscode'), {
  virtual: true,
});

/**
 * The real `SnapshotTreeDataProvider.isAutoSnapshot`, loaded from the
 * extension's source.
 *
 * Brought in through a computed require, under a virtual `vscode` mock,
 * because this package's tsconfig roots at `cli/src`: a static import of the
 * tree view pulls the extension's sources into the CLI's type program, where
 * every one of them fails TS6059 ('not under rootDir'). The module that loads
 * is the extension's own, so the assertion below runs the classifier the Auto
 * view partitions with instead of restating its tag list.
 */
const TREE_VIEW_MODULE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'ui',
  'treeView.ts',
);

function classifyAsAuto(snapshot: unknown): boolean {
  const { SnapshotTreeDataProvider } = require(TREE_VIEW_MODULE);
  const provider = Object.create(SnapshotTreeDataProvider.prototype) as {
    isAutoSnapshot(candidate: unknown): boolean;
  };
  return provider.isAutoSnapshot(snapshot);
}

describe('standalone autoSnapshotBeforeGitOperation', () => {
  let root: string;
  let handler: StandaloneHandler;

  beforeEach(async () => {
    useRealFileSystem();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-autosnap-'));
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'one');

    handler = new StandaloneHandler();
    // The real store, wired the way initialize() wires it, so the test asserts
    // a snapshot that is really persisted and really tagged.
    (handler as any).workspaceRoot = root;
    const manager = new SnapshotManager(root);
    await manager.initialize();
    (handler as any).snapshotManager = manager;
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('takes a snapshot the Auto view classifies, without a git binary', async () => {
    const result = await handler.autoSnapshotBeforeGitOperation({
      operation: 'pull',
    });

    // Exactly the shape the extension's handler returns.
    expect(Object.keys(result)).toEqual(['snapshot']);
    expect(Object.keys(result.snapshot).sort()).toEqual(['description', 'id']);
    expect(result.snapshot.id).toMatch(/^snapshot-/);
    expect(result.snapshot.description).toBe('Auto-snapshot before pull');

    const [stored] = await handler.getSnapshots();
    // The same tag set the IPC handler writes: 'auto' is what
    // treeView.isAutoSnapshot classifies on, and a shared value is what keeps
    // the two modes from drifting apart again.
    expect(stored.tags).toEqual(['auto', 'git']);
    // Executed, not described: the persisted snapshot is run through the real
    // predicate that partitions the Auto view, so the tag->view link is pinned
    // by the classifier itself rather than by a comment about it.
    expect(classifyAsAuto(stored)).toBe(true);
    expect(stored.notes).toContain('git operation "pull"');
    expect(stored.notes).toContain('includeUntracked: false');
  });

  it('uses the caller description when one is given', async () => {
    const result = await handler.autoSnapshotBeforeGitOperation({
      operation: 'merge',
      description: 'Before the merge',
      includeUntracked: true,
    });

    expect(result.snapshot.description).toBe('Before the merge');
    const [stored] = await handler.getSnapshots();
    expect(stored.description).toBe('Before the merge');
    expect(stored.notes).toContain('includeUntracked: true');
  });

  it('refuses a missing operation instead of taking an unlabelled snapshot', async () => {
    await expect(
      handler.autoSnapshotBeforeGitOperation({ operation: '   ' }),
    ).rejects.toThrow(/operation/);
    await expect(handler.getSnapshots()).resolves.toEqual([]);
  });
});
