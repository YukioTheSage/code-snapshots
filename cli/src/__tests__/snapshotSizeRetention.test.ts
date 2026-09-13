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

    const before = measureSnapshotStore(storeDir);
    // One byte under the store, so the excess stays inside 'first's own bytes
    // and the trim can cover it. The snapshot taken next is the one the store
    // is positioned at, so the enforcement may not remove it.
    writeConfig({
      maxSnapshots: 50,
      maxSnapshotStoreBytes: before.totalBytes - 1,
    });
    (
      manager as unknown as { config: { clearCache: () => void } }
    ).config.clearCache();

    // The file does not change, so 'second' stores a reference to 'first' and
    // the bytes the take adds stay far below what 'first' holds.
    const second = await manager.takeSnapshot({ description: 'second' });

    expect((await manager.getSnapshots()).map((s) => s.id)).toEqual([
      second.id,
    ]);
    expect(fs.existsSync(path.join(storeDir, first.id))).toBe(false);
    expect(await manager.getSnapshotFileContent(second.id, 'tracked.txt')).toBe(
      'x'.repeat(4000),
    );
  });

  it('is driven by the standalone handler', async () => {
    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });

    const before = measureSnapshotStore(storeDir);
    // One byte under the store: at the load below the excess has no removable
    // snapshot to cover it, and the take that follows adds little enough for
    // 'first' to cover it.
    writeConfig({
      maxSnapshots: 50,
      maxSnapshotStoreBytes: before.totalBytes - 1,
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
    const before = measureSnapshotStore(storeDir);
    // One byte under the store, so the excess stays inside 'first's own bytes
    // and the trim reaches it; the bytes the take adds stay below that.
    writeConfig({
      maxSnapshots: 50,
      maxSnapshotStoreBytes: before.totalBytes - 1,
    });
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

    // The file does not change: 'second' stores a reference, so the survivor's
    // rewrite is the only save the trim needs.
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
      'x'.repeat(4000),
    );
  });

  it('warns and stops the batch when a candidate cannot be deleted', async () => {
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

    // Newest first: 'second' went, then the refused delete of 'first' stopped
    // the batch. The survivor was rebuilt and persisted before either delete,
    // so the store this leaves behind is readable.
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

    const before = measureSnapshotStore(storeDir);
    // One byte under the store: 'first' is the only removable snapshot and it
    // covers the excess, so the trim proceeds and reaches the injected failure.
    writeConfig({
      maxSnapshots: 50,
      maxSnapshotStoreBytes: before.totalBytes - 1,
    });

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
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'w'.repeat(4000), 'utf8');
    const fourth = await manager.takeSnapshot({ description: 'fourth' });

    // The store is positioned at 'fourth', so 'third' is only protected if the
    // just-created id is honoured by id rather than by its place in the array.
    expect(manager.getCurrentSnapshot()?.id).toBe(fourth.id);

    const before = measureSnapshotStore(storeDir);
    // An excess the genuinely removable 'first' and 'second' cannot cover, but
    // which the just-created 'third' would: a selector that still saw it among
    // the removable would delete it.
    writeConfig({
      maxSnapshots: 50,
      maxSnapshotStoreBytes:
        before.totalBytes -
        before.perSnapshotBytes[first.id] -
        before.perSnapshotBytes[second.id] -
        1,
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
    ).enforceSnapshotSizeLimitInternal(third.id);

    // Refused rather than pruned: including 'third' would be the only way to
    // cover the excess, and the snapshot this trim belongs to may not go.
    expect(result.trimmed).toEqual([]);
    expect(result.stillOverLimit).toBe(true);
    expect((await manager.getSnapshots()).map((s) => s.id)).toEqual([
      first.id,
      second.id,
      third.id,
      fourth.id,
    ]);
    expect(fs.existsSync(path.join(storeDir, third.id))).toBe(true);
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

  it('deletes the batch newest first and stops at the failed candidate, orphaning no survivor', async () => {
    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'y'.repeat(4000), 'utf8');
    const second = await manager.takeSnapshot({ description: 'second' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'z'.repeat(4000), 'utf8');
    const third = await manager.takeSnapshot({ description: 'third' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'w'.repeat(4000), 'utf8');
    const fourth = await manager.takeSnapshot({ description: 'fourth' });

    // Loaded before the limit is lowered: the pass under test is the explicit
    // one below, not the one initialize() would otherwise run.
    const reopened = new SnapshotManager(root);
    await reopened.initialize();

    const before = measureSnapshotStore(storeDir);
    // A limit that needs all three older snapshots gone, so the whole chain is
    // one candidate batch; 'fourth' is the snapshot the store is positioned at
    // and is never a candidate.
    writeConfig({
      maxSnapshots: 50,
      maxSnapshotStoreBytes:
        before.totalBytes -
        before.perSnapshotBytes[first.id] -
        before.perSnapshotBytes[second.id] -
        before.perSnapshotBytes[third.id] +
        1,
    });
    (
      reopened as unknown as { config: { clearCache: () => void } }
    ).config.clearCache();

    const storage = storageOf(reopened);
    const realDelete = storage.deleteSnapshot.bind(storage);
    storage.deleteSnapshot = jest.fn((id: string) =>
      id === second.id
        ? Promise.reject(new Error('EPERM: operation not permitted'))
        : realDelete(id),
    );

    const result = await (
      reopened as unknown as {
        enforceSnapshotSizeLimitInternal: () => Promise<{ trimmed: string[] }>;
      }
    ).enforceSnapshotSizeLimitInternal();

    // The newest candidate went first, so stopping at the failure leaves every
    // surviving candidate's base in place; the failed one keeps its own base.
    expect(result.trimmed).toEqual([third.id]);
    expect((await reopened.getSnapshots()).map((s) => s.id)).toEqual([
      first.id,
      second.id,
      fourth.id,
    ]);
    expect(fs.existsSync(path.join(storeDir, third.id))).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('EPERM: operation not permitted'),
    );

    // Disk agrees: a fresh manager resolves every survivor, including the one
    // whose delete failed and the base it stores its delta against.
    writeConfig({ maxSnapshots: 50, maxSnapshotStoreBytes: 0 });
    const fresh = new SnapshotManager(root);
    await fresh.initialize();
    expect((await fresh.getSnapshots()).map((s) => s.id)).toEqual([
      first.id,
      second.id,
      fourth.id,
    ]);
    expect(await fresh.getSnapshotFileContent(first.id, 'tracked.txt')).toBe(
      'x'.repeat(4000),
    );
    expect(await fresh.getSnapshotFileContent(second.id, 'tracked.txt')).toBe(
      'y'.repeat(4000),
    );
    expect(await fresh.getSnapshotFileContent(fourth.id, 'tracked.txt')).toBe(
      'w'.repeat(4000),
    );
  });

  it('rolls the unpersisted rewrites back so the next pass still sees the base', async () => {
    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'y'.repeat(4000), 'utf8');
    const second = await manager.takeSnapshot({ description: 'second' });

    const before = measureSnapshotStore(storeDir);
    writeConfig({
      maxSnapshots: 50,
      maxSnapshotStoreBytes:
        before.totalBytes - before.perSnapshotBytes[first.id],
    });
    (
      manager as unknown as { config: { clearCache: () => void } }
    ).config.clearCache();

    // The rewrite of 'second' can never be written, so the delta on disk and
    // the base it references are all the store has left to fall back on.
    const storage = storageOf(manager);
    const realSave = storage.saveSnapshot.bind(storage);
    const saveSpy = jest.fn((snapshot: { id: string }) =>
      snapshot.id === second.id
        ? Promise.reject(new Error('ENOSPC: no space left on device'))
        : realSave(snapshot),
    );
    storage.saveSnapshot = saveSpy;
    const enforce = () =>
      (
        manager as unknown as {
          enforceSnapshotSizeLimitInternal: () => Promise<{
            trimmed: string[];
          }>;
        }
      ).enforceSnapshotSizeLimitInternal();

    const firstPass = await enforce();
    expect(firstPass.trimmed).toEqual([]);
    expect(fs.existsSync(path.join(storeDir, first.id))).toBe(true);

    // A second pass reads the dependency from memory. Had the failed pass left
    // its rewrite there, this pass would find no dependent, skip the save and
    // delete the base of a survivor whose content was never written.
    const secondPass = await enforce();

    expect(secondPass.trimmed).toEqual([]);
    expect(fs.existsSync(path.join(storeDir, first.id))).toBe(true);
    expect(
      saveSpy.mock.calls.filter(
        (call) => (call[0] as { id: string }).id === second.id,
      ),
    ).toHaveLength(2);

    // Disk and memory agree again: a fresh manager resolves the survivor
    // through the base the failed passes left in place.
    writeConfig({ maxSnapshots: 50, maxSnapshotStoreBytes: 0 });
    const reopened = new SnapshotManager(root);
    await reopened.initialize();
    expect((await reopened.getSnapshots()).map((s) => s.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(
      await reopened.getSnapshotFileContent(second.id, 'tracked.txt'),
    ).toBe('y'.repeat(4000));
    expect(fs.existsSync(path.join(storeDir, first.id))).toBe(true);
  });

  it('reports how many rebuilt survivors were persisted when a save fails part-way', async () => {
    const manager = new SnapshotManager(root);
    await manager.initialize();
    const first = await manager.takeSnapshot({ description: 'first' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'y'.repeat(4000), 'utf8');
    const second = await manager.takeSnapshot({ description: 'second' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'z'.repeat(4000), 'utf8');
    const third = await manager.takeSnapshot({ description: 'third' });

    // Two survivors of one candidate: 'second' references 'first' naturally,
    // and 'third' is made to reference it too -- a base shared by two snapshots
    // is a store shape a foreign or legacy index can hold, and it is the only
    // way the save loop can fail after an earlier survivor was written.
    const thirdPath = path.join(storeDir, third.id, 'snapshot.json');
    const stored = JSON.parse(fs.readFileSync(thirdPath, 'utf8')) as {
      files: Record<string, unknown>;
    };
    stored.files['tracked.txt'] = { baseSnapshotId: first.id };
    fs.writeFileSync(thirdPath, JSON.stringify(stored, null, 2), 'utf8');

    const reopened = new SnapshotManager(root);
    await reopened.initialize();

    const before = measureSnapshotStore(storeDir);
    writeConfig({
      maxSnapshots: 50,
      maxSnapshotStoreBytes: before.totalBytes - 1,
    });
    (
      reopened as unknown as { config: { clearCache: () => void } }
    ).config.clearCache();

    // 'second' is persisted, then 'third' is refused: the partial-save shape.
    const storage = storageOf(reopened);
    const realSave = storage.saveSnapshot.bind(storage);
    storage.saveSnapshot = jest.fn((snapshot: { id: string }) =>
      snapshot.id === third.id
        ? Promise.reject(new Error('ENOSPC: no space left on device'))
        : realSave(snapshot),
    );

    const result = await (
      reopened as unknown as {
        enforceSnapshotSizeLimitInternal: () => Promise<{ trimmed: string[] }>;
      }
    ).enforceSnapshotSizeLimitInternal();

    expect(result.trimmed).toEqual([]);
    expect((await reopened.getSnapshots()).map((s) => s.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    expect(fs.existsSync(path.join(storeDir, first.id))).toBe(true);
    // One of the two rewrites reached disk before the failure, and the report
    // says exactly that instead of counting both as failed.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 of 2 rebuilt survivor(s) were persisted'),
    );
  });
});
