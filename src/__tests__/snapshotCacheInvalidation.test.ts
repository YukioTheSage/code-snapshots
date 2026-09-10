import { SnapshotStorage } from '../snapshotStorage';

// `enforceSnapshotLimit` reads the configured maximum through `src/config`.
jest.mock('../config', () => ({
  getMaxSnapshots: () => 1,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { SnapshotManager } from '../snapshotManager';
import * as vscode from 'vscode';

describe('SnapshotStorage.clearCacheForSnapshot', () => {
  it('removes both plain and indexing cache entries for the snapshot', () => {
    const storage = new SnapshotStorage();
    const cache: Map<string, string | null> = (storage as any).contentCache;
    cache.set('snap-a::src/a.ts', 'content');
    cache.set('snap-a::src/a.ts::indexing', 'content');
    cache.set('snap-b::src/a.ts', 'other');

    (storage as any).clearCacheForSnapshot('snap-a');

    expect(cache.has('snap-a::src/a.ts')).toBe(false);
    expect(cache.has('snap-a::src/a.ts::indexing')).toBe(false);
    expect(cache.has('snap-b::src/a.ts')).toBe(true);
  });

  it('does not remove an unrelated snapshot that shares a prefix', () => {
    const storage = new SnapshotStorage();
    const cache: Map<string, string | null> = (storage as any).contentCache;
    // 'snap-a' is a strict prefix of 'snap-ab'. A naive startsWith without the
    // '::' delimiter would wrongly evict the latter.
    cache.set('snap-ab::src/a.ts', 'other');

    (storage as any).clearCacheForSnapshot('snap-a');

    expect(cache.has('snap-ab::src/a.ts')).toBe(true);
  });
});

/**
 * The cache half of this task was already correct, so the tests above pass
 * against the old code too. These cover the half that was actually broken:
 * `enforceSnapshotLimit` never told the semantic search service, so pruned
 * snapshots kept their vectors and stayed reachable in search after their
 * content was gone.
 */
describe('purgeSnapshot on every removal path', () => {
  /**
   * `SnapshotManager`'s constructor calls `loadSnapshots()` without awaiting it,
   * and that load either assigns the loaded state or clears `snapshots` to `[]`
   * when storage returns nothing. Assigning fixtures straight after
   * `new SnapshotManager(null)` therefore races it: one microtask later the
   * fixtures are gone. Every test here settles the initial load first.
   */
  async function makeManager() {
    const manager = new SnapshotManager(null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const storage = {
      getWorkspaceRoot: () => '/ws',
      deleteSnapshotData: jest.fn().mockResolvedValue(undefined),
      saveSnapshotIndex: jest.fn().mockResolvedValue(undefined),
    };
    const semanticSearchService = {
      deleteSnapshotIndexing: jest.fn().mockResolvedValue(undefined),
    };
    (manager as any).storage = storage;
    (manager as any).semanticSearchService = semanticSearchService;
    (manager as any).snapshots = [
      {
        id: 'snap-old',
        timestamp: 1,
        description: 'old',
        files: { 'a.ts': { content: 'a' } },
      },
      {
        id: 'snap-new',
        timestamp: 2,
        description: 'new',
        files: { 'b.ts': { content: 'b' } },
      },
    ];
    (manager as any).currentSnapshotIndex = 1;
    return { manager, storage, semanticSearchService };
  }

  it('purges the search index when the limit prunes a snapshot', async () => {
    const { manager, storage, semanticSearchService } = await makeManager();

    await (manager as any).enforceSnapshotLimit();

    // getMaxSnapshots is mocked to 1, so the oldest goes.
    expect(storage.deleteSnapshotData).toHaveBeenCalledWith('snap-old');
    expect(semanticSearchService.deleteSnapshotIndexing).toHaveBeenCalledWith(
      'snap-old',
    );
    expect((manager as any).snapshots.map((s: any) => s.id)).toEqual([
      'snap-new',
    ]);
  });

  it('purges the search index when a snapshot is deleted explicitly', async () => {
    const { manager, storage, semanticSearchService } = await makeManager();
    (vscode.window.showWarningMessage as unknown as jest.Mock) = jest
      .fn()
      .mockResolvedValue('Delete');

    await manager.deleteSnapshot('snap-old');

    expect(storage.deleteSnapshotData).toHaveBeenCalledWith('snap-old');
    expect(semanticSearchService.deleteSnapshotIndexing).toHaveBeenCalledWith(
      'snap-old',
    );
  });

  it('still removes the snapshot when the search purge fails', async () => {
    // A vector-store failure must not block the removal itself, but it must
    // not be silent either -- the log line is the only trace.
    const { manager, storage, semanticSearchService } = await makeManager();
    semanticSearchService.deleteSnapshotIndexing.mockRejectedValue(
      new Error('vector store unavailable'),
    );

    await expect(
      (manager as any).enforceSnapshotLimit(),
    ).resolves.toBeUndefined();

    expect(storage.deleteSnapshotData).toHaveBeenCalledWith('snap-old');
    expect((manager as any).snapshots.map((s: any) => s.id)).toEqual([
      'snap-new',
    ]);
  });

  it('does not purge anything when the limit is not exceeded', async () => {
    const { manager, storage, semanticSearchService } = await makeManager();
    (manager as any).snapshots = [(manager as any).snapshots[0]];
    (manager as any).currentSnapshotIndex = 0;

    await (manager as any).enforceSnapshotLimit();

    expect(storage.deleteSnapshotData).not.toHaveBeenCalled();
    expect(semanticSearchService.deleteSnapshotIndexing).not.toHaveBeenCalled();
  });
});
