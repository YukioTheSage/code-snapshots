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
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-size-'));
    storeDir = path.join(root, '.snapshots');
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'x'.repeat(4000), 'utf8');
    writeConfig({ maxSnapshots: 50, maxSnapshotStoreBytes: 0 });
  });

  afterEach(() => {
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
  });
});
