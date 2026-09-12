import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SnapshotManager } from '../snapshotManager';

function writeConfig(root: string, config: Record<string, unknown>): void {
  fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.vscode', 'codelapse.json'),
    JSON.stringify(config, null, 2),
    'utf8',
  );
}

describe('shared retention', () => {
  let root: string;
  let storeDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-retention-'));
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'v1', 'utf8');
    storeDir = path.join(root, '.snapshots');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('materializes the survivor before trimming the base it references', async () => {
    writeConfig(root, { maxSnapshots: 1 });

    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    const second = await manager.takeSnapshot({ description: 'second' });

    // The second take exceeds the limit of one and trims 'first'. The file did
    // not change, so 'second' stored it as { baseSnapshotId: 'first' }: deleting
    // first's directory without rewriting that entry is the data loss this test
    // pins.
    const stored = JSON.parse(
      fs.readFileSync(path.join(storeDir, second.id, 'snapshot.json'), 'utf8'),
    ) as { files: Record<string, unknown> };
    expect(stored.files['tracked.txt']).toEqual({ content: 'v1' });
    expect(fs.existsSync(path.join(storeDir, first.id))).toBe(false);

    // Read it back through a fresh manager. The storage content cache answered
    // the capture from the still-present base, so the same instance would hide
    // the dangling reference.
    const reopened = new SnapshotManager(root);
    await reopened.initialize();
    expect((await reopened.getSnapshots()).map((s) => s.id)).toEqual([second.id]);
    // The trim removed an earlier entry, so the persisted pointer has to follow
    // the survivor rather than keep the old number.
    expect(reopened.getCurrentSnapshot()?.id).toBe(second.id);
    expect(
      await reopened.getSnapshotFileContent(second.id, 'tracked.txt'),
    ).toBe('v1');
  });

  it('keeps the excess when a survivor cannot be rebuilt', async () => {
    writeConfig(root, { maxSnapshots: 50 });

    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    const second = await manager.takeSnapshot({ description: 'second' });
    const third = await manager.takeSnapshot({ description: 'third' });

    // 'third' references 'second', which references 'first'. Removing second's
    // snapshot.json makes the third snapshot unresolvable, and no trim can
    // repair that.
    fs.rmSync(path.join(storeDir, second.id, 'snapshot.json'));

    // Drop the limit to two so the next take has an excess of two to trim. The
    // manager caches the merged config, so the cache has to be dropped too.
    writeConfig(root, { maxSnapshots: 2 });
    (
      manager as unknown as { config: { clearCache: () => void } }
    ).config.clearCache();

    // The resolver answered 'third' from 'second' while that base was still
    // readable, so it has to be dropped as well: a cached copy would mask the
    // missing payload and let the trim rebuild the survivor from memory,
    // which is precisely the failure this test needs to present.
    (
      manager as unknown as { storage: { clearCache: () => void } }
    ).storage.clearCache();

    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const fourth = await manager.takeSnapshot({ description: 'fourth' });

      // The guard refuses the whole trim: 'third' stores a delta against
      // 'second', so deleting the two oldest would orphan it. Nothing is deleted
      // and the store keeps the excess on purpose.
      const surviving = (await manager.getSnapshots()).map((s) => s.id);
      expect(surviving).toEqual([first.id, second.id, third.id, fourth.id]);
      expect(fs.existsSync(path.join(storeDir, first.id))).toBe(true);
      expect(fs.existsSync(path.join(storeDir, second.id))).toBe(true);

      // Keeping the excess silently would leave the store over its limit with
      // no explanation of why nothing was trimmed.
      expect(errorSpy).toHaveBeenCalledWith(
        'Retention: keeping 4 snapshots. The 2 oldest cannot be removed without orphaning a survivor; nothing was deleted.',
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('trims past a candidate whose base directory is already gone', async () => {
    writeConfig(root, { maxSnapshots: 50 });

    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    const second = await manager.takeSnapshot({ description: 'second' });

    // The stale-index shape snapshotDeleteMissing.test.ts already sets up: this
    // manager still indexes 'first' while its directory is gone, and 'second'
    // -- a candidate of the next trim -- still stores a reference to it. A
    // reopened manager would drop the stale entry at load time and hide the
    // case, so the same instance has to keep going.
    fs.rmSync(path.join(storeDir, first.id), { recursive: true, force: true });

    // One slot for three snapshots, so the next take trims two candidates. The
    // resolver cache has to go with the limit: it still holds the copy of
    // 'second' that was made while 'first' was readable, and that copy would
    // let the guard rebuild the survivor instead of failing.
    writeConfig(root, { maxSnapshots: 1 });
    (
      manager as unknown as { config: { clearCache: () => void } }
    ).config.clearCache();
    (
      manager as unknown as { storage: { clearCache: () => void } }
    ).storage.clearCache();

    const third = await manager.takeSnapshot({ description: 'third' });

    // 'second' disappears in the same batch as 'first', so its dangling
    // reference must not refuse the trim: the take resolves and the store keeps
    // only the snapshot that was just taken.
    const reopened = new SnapshotManager(root);
    await reopened.initialize();
    expect((await reopened.getSnapshots()).map((s) => s.id)).toEqual([third.id]);
    expect(fs.existsSync(path.join(storeDir, first.id))).toBe(false);
    expect(fs.existsSync(path.join(storeDir, second.id))).toBe(false);
    expect(
      await reopened.getSnapshotFileContent(third.id, 'tracked.txt'),
    ).toBe('v1');
  });

  it('trims by store order when the clock steps backwards', async () => {
    writeConfig(root, { maxSnapshots: 3 });

    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    const second = await manager.takeSnapshot({ description: 'second' });
    const third = await manager.takeSnapshot({ description: 'third' });

    // An NTP correction after a VM resume, a WSL clock jump or a hand-set clock
    // can move Date.now() backwards between takes. The snapshot about to be
    // created is still the newest in the store; only the clock disagrees.
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(first.timestamp - 60_000);

    try {
      const fourth = await manager.takeSnapshot({ description: 'fourth' });

      // One slot over the limit: the store's oldest entry goes, never the one
      // the clock just claimed predates everything else.
      expect((await manager.getSnapshots()).map((s) => s.id)).toEqual([
        second.id,
        third.id,
        fourth.id,
      ]);
      expect(fs.existsSync(path.join(storeDir, first.id))).toBe(false);

      const reopened = new SnapshotManager(root);
      await reopened.initialize();
      expect(reopened.getCurrentSnapshot()?.id).toBe(fourth.id);
      expect(
        await reopened.getSnapshotFileContent(fourth.id, 'tracked.txt'),
      ).toBe('v1');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('drops an index entry whose directory is already gone when deleted explicitly', async () => {
    writeConfig(root, { maxSnapshots: 50 });

    const manager = new SnapshotManager(root);
    await manager.initialize();
    const only = await manager.takeSnapshot({ description: 'only' });

    // The index still lists it; only the directory is gone. Storage calls that
    // an error, the manager treats it as the state the delete was asked for --
    // the same shape the retention trim relies on.
    fs.rmSync(path.join(storeDir, only.id), { recursive: true, force: true });

    await expect(manager.deleteSnapshot(only.id)).resolves.toBeUndefined();

    const reopened = new SnapshotManager(root);
    await reopened.initialize();
    expect(await reopened.getSnapshots()).toEqual([]);
  });

  it('stops the count trim at the first failed delete, newest first, leaving no orphan', async () => {
    writeConfig(root, { maxSnapshots: 50 });

    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'v2', 'utf8');
    const second = await manager.takeSnapshot({ description: 'second' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'v3', 'utf8');
    const third = await manager.takeSnapshot({ description: 'third' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'v4', 'utf8');
    const fourth = await manager.takeSnapshot({ description: 'fourth' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'v5', 'utf8');
    const fifth = await manager.takeSnapshot({ description: 'fifth' });

    // Three slots for six snapshots: the next take has the oldest three as its
    // candidates, and 'second' is the one whose delete fails.
    writeConfig(root, { maxSnapshots: 3 });
    (
      manager as unknown as { config: { clearCache: () => void } }
    ).config.clearCache();

    const storage = (
      manager as unknown as {
        storage: { deleteSnapshot: (id: string) => Promise<void> };
      }
    ).storage;
    const realDelete = storage.deleteSnapshot.bind(storage);
    storage.deleteSnapshot = jest.fn((id: string) =>
      id === second.id
        ? Promise.reject(new Error('EPERM: operation not permitted'))
        : realDelete(id),
    );

    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      fs.writeFileSync(path.join(root, 'tracked.txt'), 'v6', 'utf8');
      const sixth = await manager.takeSnapshot({ description: 'sixth' });

      // Newest first: 'third' went, then 'second' refused and stopped the
      // batch, so 'first' -- the base 'second' stores its delta against -- is
      // still there.
      expect((await manager.getSnapshots()).map((s) => s.id)).toEqual([
        first.id,
        second.id,
        fourth.id,
        fifth.id,
        sixth.id,
      ]);
      expect(fs.existsSync(path.join(storeDir, third.id))).toBe(false);
      expect(fs.existsSync(path.join(storeDir, first.id))).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('EPERM: operation not permitted'),
      );

      // Disk agrees: everything that survived still resolves, the failed
      // candidate included.
      writeConfig(root, { maxSnapshots: 50 });
      const reopened = new SnapshotManager(root);
      await reopened.initialize();
      expect((await reopened.getSnapshots()).map((s) => s.id)).toEqual([
        first.id,
        second.id,
        fourth.id,
        fifth.id,
        sixth.id,
      ]);
      expect(
        await reopened.getSnapshotFileContent(first.id, 'tracked.txt'),
      ).toBe('v1');
      expect(
        await reopened.getSnapshotFileContent(second.id, 'tracked.txt'),
      ).toBe('v2');
      expect(
        await reopened.getSnapshotFileContent(fourth.id, 'tracked.txt'),
      ).toBe('v4');
      expect(
        await reopened.getSnapshotFileContent(fifth.id, 'tracked.txt'),
      ).toBe('v5');
      expect(
        await reopened.getSnapshotFileContent(sixth.id, 'tracked.txt'),
      ).toBe('v6');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('rolls the count trim back when a survivor cannot be persisted, so a later pass retries', async () => {
    writeConfig(root, { maxSnapshots: 50 });

    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'v2', 'utf8');
    const second = await manager.takeSnapshot({ description: 'second' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'v3', 'utf8');
    const third = await manager.takeSnapshot({ description: 'third' });

    // One slot for four snapshots: the next take has three candidates, and the
    // snapshot it writes is the survivor that has to be rebuilt first.
    writeConfig(root, { maxSnapshots: 1 });
    (
      manager as unknown as { config: { clearCache: () => void } }
    ).config.clearCache();

    const storage = (
      manager as unknown as {
        storage: { saveSnapshot: (snapshot: { id: string }) => Promise<void> };
      }
    ).storage;
    const realSave = storage.saveSnapshot.bind(storage);
    let allowOneSave = true;
    let refusedSaves = 0;
    const saveSpy = jest.fn((snapshot: { id: string }) => {
      if (allowOneSave) {
        allowOneSave = false;
        return realSave(snapshot);
      }
      refusedSaves += 1;
      return Promise.reject(new Error('ENOSPC: no space left on device'));
    });
    storage.saveSnapshot = saveSpy;

    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      const fourth = await manager.takeSnapshot({ description: 'fourth' });

      // The take resolved and nothing was deleted: the survivor's rewrite could
      // not be written, so its base has to stay.
      expect(fourth.id).toBeTruthy();
      expect((await manager.getSnapshots()).map((s) => s.id)).toEqual([
        first.id,
        second.id,
        third.id,
        fourth.id,
      ]);
      expect(fs.existsSync(path.join(storeDir, first.id))).toBe(true);

      // The same excess again with a different limit, so a second pass has the
      // same candidates. It must still see 'fourth' as a dependent of the batch
      // -- memory was rolled back to what disk holds -- retry the rewrite and
      // refuse to remove the base it was never able to write.
      writeConfig(root, { maxSnapshots: 2 });
      (
        manager as unknown as { config: { clearCache: () => void } }
      ).config.clearCache();
      allowOneSave = true;

      const fifth = await manager.takeSnapshot({ description: 'fifth' });

      expect(fifth.id).toBeTruthy();
      expect((await manager.getSnapshots()).map((s) => s.id)).toEqual([
        first.id,
        second.id,
        third.id,
        fourth.id,
        fifth.id,
      ]);
      expect(fs.existsSync(path.join(storeDir, first.id))).toBe(true);
      // One refused rewrite per pass: the second pass saw the dependency again
      // and retried instead of skipping straight to the delete loop.
      expect(refusedSaves).toBe(2);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
