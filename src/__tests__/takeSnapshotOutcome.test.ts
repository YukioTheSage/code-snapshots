import { SnapshotManager } from '../snapshotManager';

describe('takeSnapshot outcome', () => {
  function managerWithNoChanges(): SnapshotManager {
    const manager = new SnapshotManager(null);
    (manager as any).storage = {
      getWorkspaceRoot: () => '/tmp/does-not-matter',
      // The scan path resolves the store location through the storage layer so
      // the parser excludes the directory snapshots are actually written to.
      getSnapshotDirectory: () => '/tmp/does-not-matter/.snapshots',
      isBinaryFile: () => false,
      checkSuspiciousFilesForBinaryContent: async () => new Set<string>(),
      readFileContent: async () => 'same',
      getSnapshotFileContent: async () => 'same',
      saveSnapshotData: async () => undefined,
    };
    (manager as any).snapshots = [
      {
        id: 'snap-a',
        timestamp: 1,
        description: 'a',
        files: { 'x.ts': { content: 'same' } },
      },
    ];
    (manager as any).activeSnapshotId = 'snap-a';
    (manager as any).saveSnapshotIndex = async () => undefined;
    return manager;
  }

  it('reports created:false rather than returning the previous snapshot', async () => {
    const manager = managerWithNoChanges();
    const outcome = await (manager as any).takeSnapshotInternal('auto', {
      tags: ['auto'],
    });

    // The bug: this returned the existing snapshot object, so callers could
    // not tell that nothing had been recorded.
    expect(outcome.created).toBe(false);
    expect(outcome.reason).toBe('no-changes');
    expect(outcome.snapshot).toBeUndefined();
  });

  it('never returns undefined for a discarded snapshot', async () => {
    const manager = managerWithNoChanges();
    (manager as any).snapshots = [];
    (manager as any).activeSnapshotId = null;

    const outcome = await (manager as any).takeSnapshotInternal('auto', {
      tags: ['auto'],
    });

    expect(outcome.created).toBe(false);
    expect(outcome.snapshot).toBeUndefined();
  });

  it('reports created:true with the created snapshot', async () => {
    const manager = managerWithNoChanges();
    (manager as any).storage.readFileContent = async () => 'changed';

    const outcome = await (manager as any).takeSnapshotInternal('manual', {
      tags: ['manual'],
    });

    // A non-auto snapshot is always recorded; the caller still needs the
    // identity of what was created rather than the last item in the list.
    expect(outcome.created).toBe(true);
    expect(outcome.snapshot.id).toBeTruthy();
    expect(outcome.snapshot.description).toBe('manual');
    expect(manager.isSnapshotActive(outcome.snapshot.id)).toBe(true);
  });
});
