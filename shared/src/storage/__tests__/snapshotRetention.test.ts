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

    const fourth = await manager.takeSnapshot({ description: 'fourth' });

    // The guard refuses the whole trim: 'third' stores a delta against
    // 'second', so deleting the two oldest would orphan it. Nothing is deleted
    // and the store keeps the excess on purpose.
    const surviving = (await manager.getSnapshots()).map((s) => s.id);
    expect(surviving).toEqual([first.id, second.id, third.id, fourth.id]);
    expect(fs.existsSync(path.join(storeDir, first.id))).toBe(true);
    expect(fs.existsSync(path.join(storeDir, second.id))).toBe(true);
  });
});
