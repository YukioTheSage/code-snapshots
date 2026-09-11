import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SnapshotManager } from 'codelapse-core';
import { StandaloneHandler } from '../standaloneHandler';
import { useRealFileSystem } from './realFs';

describe('standalone filterSnapshots and metadata edits', () => {
  let root: string;
  let handler: StandaloneHandler;

  beforeEach(async () => {
    useRealFileSystem();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-filter-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'one');
    handler = new StandaloneHandler();
    // `initialize()` takes no argument and discovers the workspace root from
    // the process cwd. Injecting the real manager keeps this suite on the temp
    // directory the fixture owns, matching the other real-store CLI suites.
    const manager = new SnapshotManager(root);
    await manager.initialize();
    (handler as any).snapshotManager = manager;
    (handler as any).workspaceRoot = root;
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('filters by favorites and reports both counts', async () => {
    await handler.takeSnapshot({ description: 'plain' });
    fs.writeFileSync(path.join(root, 'a.txt'), 'two');
    const fav = await handler.takeSnapshot({
      description: 'starred',
      isFavorite: true,
    });

    const result = await handler.filterSnapshots({ favorites: true });

    expect(result.snapshots.map((s) => s.id)).toEqual([fav.id]);
    expect(result.totalCount).toBe(2);
    expect(result.filteredCount).toBe(1);
  });

  it('matches searchText against description and notes', async () => {
    await handler.takeSnapshot({
      description: 'add parser',
      notes: 'handles CRLF',
    });
    fs.writeFileSync(path.join(root, 'a.txt'), 'two');
    await handler.takeSnapshot({ description: 'unrelated' });

    await expect(
      handler
        .filterSnapshots({ searchText: 'crlf' })
        .then((r) => r.filteredCount),
    ).resolves.toBe(1);
    await expect(
      handler
        .filterSnapshots({ searchText: 'parser' })
        .then((r) => r.filteredCount),
    ).resolves.toBe(1);
    await expect(
      handler
        .filterSnapshots({ searchText: 'nothing' })
        .then((r) => r.filteredCount),
    ).resolves.toBe(0);
  });

  it('edits tags, notes and the task reference, and toggles favourite', async () => {
    const created = await handler.takeSnapshot({ description: 'editable' });

    await handler.editSnapshotTags(created.id, ['release', 'v1']);
    await handler.editSnapshotNotes(created.id, 'reviewed');
    await handler.editTaskReference(created.id, 'ISSUE-42');
    await handler.toggleFavoriteStatus(created.id, true);

    const stored = await handler.getSnapshot(created.id);
    expect(stored?.tags).toEqual(['release', 'v1']);
    expect(stored?.notes).toBe('reviewed');
    expect(stored?.taskReference).toBe('ISSUE-42');
    expect(stored?.isFavorite).toBe(true);
  });

  it('toggles a favorite from its current state when no value is supplied', async () => {
    const created = await handler.takeSnapshot({ description: 'editable' });

    const first = await handler.toggleFavoriteStatus(created.id);
    const second = await handler.toggleFavoriteStatus(created.id);

    expect(first.isFavorite).toBe(true);
    expect(second.isFavorite).toBe(false);
  });
});