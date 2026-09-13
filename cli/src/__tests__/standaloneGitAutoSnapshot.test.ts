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
 * has to be asked about. That is not just a claim -- this suite runs where
 * execFileSync('git', ...) fails with EPERM, so an implementation that
 * consulted the integration would fail here rather than pass by accident.
 */
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
