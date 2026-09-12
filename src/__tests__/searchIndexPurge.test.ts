import { SnapshotManager } from '../snapshotManager';

describe('search index purge wiring', () => {
  it('calls the injected service when a snapshot is purged', async () => {
    const manager = new SnapshotManager(null);
    (manager as any).storage = {
      deleteSnapshotData: jest.fn().mockResolvedValue(undefined),
    };
    const deleteSnapshotIndexing = jest.fn().mockResolvedValue(undefined);
    manager.setSemanticSearchService({ deleteSnapshotIndexing });

    await (manager as any).purgeSnapshot('snapshot-1');

    expect(deleteSnapshotIndexing).toHaveBeenCalledWith('snapshot-1');
  });

  it('exposes the wiring as a typed call, not an any-cast', () => {
    // The property used to exist only because `extension.ts` assigned it
    // through `as any`; a rename would have been a silent no-op on the one path
    // that keeps deleted snapshots out of search results.
    expect(typeof new SnapshotManager(null).setSemanticSearchService).toBe(
      'function',
    );
  });
});