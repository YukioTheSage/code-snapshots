import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ConfigManager,
  SnapshotManager,
  measureSnapshotStore,
} from 'codelapse-core';
import { StandaloneHandler } from '../standaloneHandler';
import { useRealFileSystem } from './realFs';

describe('shared size retention', () => {
  let root: string;
  let storeDir: string;
  // `setup.ts` mocks console.log and console.error, not console.warn, and the
  // retention report paths use warn: without this spy the suite's output is not
  // pristine and the reports cannot be asserted at all.
  let warnSpy: jest.SpyInstance;

  /** The storage seam the fault injections below replace. */
  type StorageSeam = {
    saveSnapshot: (snapshot: { id: string }) => Promise<void>;
    deleteSnapshot: (id: string) => Promise<void>;
    measureSnapshotStore: () => unknown;
  };

  function storageOf(manager: SnapshotManager): StorageSeam {
    return (manager as unknown as { storage: StorageSeam }).storage;
  }

  /** The batch materialization is outside the persist and delete guards. */
  function injectTrimThrow(manager: SnapshotManager): void {
    (manager as unknown as Record<string, unknown>).materializeDependents =
      jest.fn(() => Promise.reject(new Error('EIO: i/o error')));
  }

  function writeConfig(config: Record<string, unknown>): void {
    fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.vscode', 'codelapse.json'),
      JSON.stringify(config, null, 2),
      'utf8',
    );
  }

  beforeEach(() => {
    useRealFileSystem();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-size-'));
    storeDir = path.join(root, '.snapshots');
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'x'.repeat(4000), 'utf8');
    writeConfig({ maxSnapshots: 50, maxSnapshotStoreBytes: 0 });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('enforces the size limit when the store is opened', async () => {
    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'y'.repeat(4000), 'utf8');
    const second = await manager.takeSnapshot({ description: 'second' });

    const before = measureSnapshotStore(storeDir);
    expect(before.perSnapshotBytes[first.id]).toBeGreaterThan(0);

    // A limit the oldest snapshot's own bytes exceed: the store can only fit
    // once that one is gone.
    writeConfig({
      maxSnapshots: 50,
      maxSnapshotStoreBytes:
        before.totalBytes - before.perSnapshotBytes[first.id],
    });

    const reopened = new SnapshotManager(root);
    await reopened.initialize();

    expect((await reopened.getSnapshots()).map((s) => s.id)).toEqual([
      second.id,
    ]);
    // 'second' stored a delta against 'first', so the trim had to rebuild it
    // before deleting its base.
    expect(
      await reopened.getSnapshotFileContent(second.id, 'tracked.txt'),
    ).toBe('y'.repeat(4000));
    expect(fs.existsSync(path.join(storeDir, first.id))).toBe(false);
  });

  it('enforces the size limit after a take and never trims the active snapshot', async () => {
    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });

    const firstBytes =
      measureSnapshotStore(storeDir).perSnapshotBytes[first.id];
    // A limit the first snapshot alone exceeds. The snapshot taken next is the
    // one the store is positioned at, so the enforcement may not remove it.
    writeConfig({ maxSnapshots: 50, maxSnapshotStoreBytes: firstBytes });
    (
      manager as unknown as { config: { clearCache: () => void } }
    ).config.clearCache();

    fs.writeFileSync(path.join(root, 'tracked.txt'), 'z'.repeat(4000), 'utf8');
    const second = await manager.takeSnapshot({ description: 'second' });

    expect((await manager.getSnapshots()).map((s) => s.id)).toEqual([
      second.id,
    ]);
    expect(fs.existsSync(path.join(storeDir, first.id))).toBe(false);
    expect(await manager.getSnapshotFileContent(second.id, 'tracked.txt')).toBe(
      'z'.repeat(4000),
    );
  });

  it('is driven by the standalone handler', async () => {
    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });

    const before = measureSnapshotStore(storeDir);
    writeConfig({
      maxSnapshots: 50,
      maxSnapshotStoreBytes:
        before.totalBytes - before.perSnapshotBytes[first.id],
    });

    const handler = new StandaloneHandler();
    (handler as any).workspaceRoot = root;
    (handler as any).configManager = new ConfigManager(root);
    // The manager `initialize()` would have built, already pointed at the
    // store on disk.
    const handlerManager = new SnapshotManager(root);
    await handlerManager.initialize();
    (handler as any).snapshotManager = handlerManager;

    const second = await handler.takeSnapshot({ description: 'second' });

    expect((await handler.getSnapshots()).map((s) => s.id)).toEqual([
      second.id,
    ]);
    expect(fs.existsSync(path.join(storeDir, first.id))).toBe(false);
    // The store was over its limit with only the active snapshot left to
    // spare, so the refusal is reported rather than passed over in silence.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no snapshot is removable'),
    );
  });

  it('keeps the excess when a rebuilt survivor cannot be persisted, and the take still resolves', async () => {
    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    const firstBytes =
      measureSnapshotStore(storeDir).perSnapshotBytes[first.id];
    // A limit the first snapshot alone exceeds, so the take that follows has an
    // excess to trim and 'first' is the only candidate it can reach.
    writeConfig({ maxSnapshots: 50, maxSnapshotStoreBytes: firstBytes });
    (
      manager as unknown as { config: { clearCache: () => void } }
    ).config.clearCache();

    // Fault injection instead of real permission bits: a Windows box cannot be
    // made to fail a write on demand. The take's own save goes through; the
    // rewrite of 'second' -- the survivor whose base is the candidate -- is
    // refused.
    const storage = storageOf(manager);
    const realSave = storage.saveSnapshot.bind(storage);
    let allowNextSave = true;
    storage.saveSnapshot = jest.fn((snapshot: { id: string }) => {
      if (allowNextSave) {
        allowNextSave = false;
        return realSave(snapshot);
      }
      return Promise.reject(new Error('ENOSPC: no space left on device'));
    });

    fs.writeFileSync(path.join(root, 'tracked.txt'), 'y'.repeat(4000), 'utf8');
    const second = await manager.takeSnapshot({ description: 'second' });

    expect(second.id).toBeTruthy();
    expect((await manager.getSnapshots()).map((s) => s.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(fs.existsSync(path.join(storeDir, first.id))).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('ENOSPC: no space left on device'),
    );
    // The base the survivor references is intact, so the store still resolves.
    expect(await manager.getSnapshotFileContent(second.id, 'tracked.txt')).toBe(
      'y'.repeat(4000),
    );
  });

  it('warns and keeps deleting the rest when a candidate cannot be deleted', async () => {
    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'y'.repeat(4000), 'utf8');
    const second = await manager.takeSnapshot({ description: 'second' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'z'.repeat(4000), 'utf8');
    const third = await manager.takeSnapshot({ description: 'third' });

    const before = measureSnapshotStore(storeDir);
    // One byte below what removing both older snapshots would free, so both are
    // candidates; 'third' is the snapshot the store is positioned at and is
    // never one.
    writeConfig({
      maxSnapshots: 50,
      maxSnapshotStoreBytes:
        before.totalBytes -
        before.perSnapshotBytes[first.id] -
        before.perSnapshotBytes[second.id] +
        1,
    });

    const reopened = new SnapshotManager(root);
    const storage = storageOf(reopened);
    const realDelete = storage.deleteSnapshot.bind(storage);
    storage.deleteSnapshot = jest.fn((id: string) =>
      id === first.id
        ? Promise.reject(new Error('EPERM: operation not permitted'))
        : realDelete(id),
    );

    await reopened.initialize();

    // 'first' survived its refused delete; 'second' still went, and the
    // survivor was rebuilt and persisted before either of them.
    expect((await reopened.getSnapshots()).map((s) => s.id)).toEqual([
      first.id,
      third.id,
    ]);
    expect(fs.existsSync(path.join(storeDir, second.id))).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('EPERM: operation not permitted'),
    );
    expect(await reopened.getSnapshotFileContent(third.id, 'tracked.txt')).toBe(
      'z'.repeat(4000),
    );
  });

  it('does not fail a take when the trim throws', async () => {
    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'y'.repeat(4000), 'utf8');
    const second = await manager.takeSnapshot({ description: 'second' });

    const before = measureSnapshotStore(storeDir);
    writeConfig({
      maxSnapshots: 50,
      maxSnapshotStoreBytes: before.totalBytes - 1,
    });
    (
      manager as unknown as { config: { clearCache: () => void } }
    ).config.clearCache();
    injectTrimThrow(manager);

    fs.writeFileSync(path.join(root, 'tracked.txt'), 'w'.repeat(4000), 'utf8');
    const third = await manager.takeSnapshot({ description: 'third' });

    expect((await manager.getSnapshots()).map((s) => s.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    expect(fs.existsSync(path.join(storeDir, first.id))).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('could not be trimmed after this snapshot'),
    );
  });

  it('does not fail initialize when the trim throws', async () => {
    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'y'.repeat(4000), 'utf8');
    const second = await manager.takeSnapshot({ description: 'second' });

    writeConfig({ maxSnapshots: 50, maxSnapshotStoreBytes: 1 });

    const reopened = new SnapshotManager(root);
    injectTrimThrow(reopened);

    await expect(reopened.initialize()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('could not be trimmed when it was opened'),
    );
    expect((await reopened.getSnapshots()).map((s) => s.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('never trims the snapshot it was just asked to create, even when it is not the pointer', async () => {
    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'y'.repeat(4000), 'utf8');
    const second = await manager.takeSnapshot({ description: 'second' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'z'.repeat(4000), 'utf8');
    const third = await manager.takeSnapshot({ description: 'third' });

    // The store is positioned at 'third', so 'second' is only protected if the
    // just-created id is honoured by id rather than by its place in the array.
    expect(manager.getCurrentSnapshot()?.id).toBe(third.id);

    const before = measureSnapshotStore(storeDir);
    // One byte more than removing 'first' alone frees: a selector that still
    // saw 'second' among the removable would take it too.
    writeConfig({
      maxSnapshots: 50,
      maxSnapshotStoreBytes:
        before.totalBytes - before.perSnapshotBytes[first.id] - 1,
    });
    (
      manager as unknown as { config: { clearCache: () => void } }
    ).config.clearCache();

    const result = await (
      manager as unknown as {
        enforceSnapshotSizeLimitInternal: (
          justCreatedSnapshotId?: string,
        ) => Promise<{ trimmed: string[]; stillOverLimit: boolean }>;
      }
    ).enforceSnapshotSizeLimitInternal(second.id);

    expect(result.trimmed).toEqual([first.id]);
    expect((await manager.getSnapshots()).map((s) => s.id)).toEqual([
      second.id,
      third.id,
    ]);
    expect(fs.existsSync(path.join(storeDir, second.id))).toBe(true);
    expect(fs.existsSync(path.join(storeDir, first.id))).toBe(false);
  });

  it('does not measure or warn while the limit is disabled', async () => {
    const manager = new SnapshotManager(root);
    const measureSpy = jest.spyOn(storageOf(manager), 'measureSnapshotStore');

    // beforeEach wrote maxSnapshotStoreBytes: 0. The store is unambiguously
    // over zero bytes, so a missing early return would measure, select and trim.
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'y'.repeat(4000), 'utf8');
    const second = await manager.takeSnapshot({ description: 'second' });

    expect(measureSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect((await manager.getSnapshots()).map((s) => s.id)).toEqual([
      first.id,
      second.id,
    ]);
  });
});
