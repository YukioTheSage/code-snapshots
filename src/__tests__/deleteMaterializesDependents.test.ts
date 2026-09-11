import { SnapshotManager } from '../snapshotManager';

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

const FILE = 'src/app.ts';

describe('extension deleteSnapshot materializes dependents', () => {
  let manager: SnapshotManager;
  let storage: any;

  beforeEach(async () => {
    manager = new SnapshotManager(null);
    // The constructor starts loading the real store without awaiting; let that
    // settle before replacing the storage and snapshot list with the fixture.
    await new Promise((resolve) => setTimeout(resolve, 0));

    storage = {
      // Resolving the survivor's delta walks through its base and yields v1.
      getSnapshotFileContent: jest.fn().mockResolvedValue('v1'),
      saveSnapshotData: jest.fn().mockResolvedValue(undefined),
      deleteSnapshotData: jest.fn().mockResolvedValue(undefined),
      saveSnapshotIndex: jest.fn().mockResolvedValue(undefined),
    };
    (manager as any).storage = storage;
    (manager as any).snapshots = [
      {
        id: 'snapshot-a',
        timestamp: 1,
        description: 'a',
        files: { [FILE]: { content: 'v1' } },
      },
      {
        id: 'snapshot-b',
        timestamp: 2,
        description: 'b',
        files: { [FILE]: { diff: 'x', baseSnapshotId: 'snapshot-a' } },
      },
    ];
    (manager as any).activeSnapshotId = null;
  });

  it('rewrites the survivor to full content before purging the base', async () => {
    await manager.deleteSnapshot('snapshot-a', { skipConfirm: true });

    expect(storage.saveSnapshotData).toHaveBeenCalledTimes(1);
    const saved = storage.saveSnapshotData.mock.calls[0][0];
    expect(saved.id).toBe('snapshot-b');
    expect(saved.files[FILE]).toEqual({ content: 'v1' });
    expect(storage.deleteSnapshotData).toHaveBeenCalledWith('snapshot-a');
  });

  it('refuses the delete when the survivor cannot be rebuilt', async () => {
    storage.getSnapshotFileContent.mockResolvedValue(null);

    const result = await manager.deleteSnapshot('snapshot-a', {
      skipConfirm: true,
    });

    expect(result).toBe(false);
    expect(storage.deleteSnapshotData).not.toHaveBeenCalled();
    expect(storage.saveSnapshotData).not.toHaveBeenCalled();
    expect((manager as any).snapshots.map((s: any) => s.id)).toEqual([
      'snapshot-a',
      'snapshot-b',
    ]);
  });
});