/**
 * Regression guard for silent snapshot deletion (BUG-2).
 *
 * `SnapshotStorage.deleteSnapshot` wrapped its work in `if (fs.existsSync(dir))`
 * and returned normally when the directory was absent, so `codelapse snapshot
 * delete 999` reported `{"success":true,"message":"Snapshot 999 deleted
 * successfully"}` with exit code 0 while deleting nothing -- and the snapshot
 * index was rewritten as if the delete had happened. A typo'd id therefore
 * looked like a successful delete to every script and agent that branched on
 * success or exit status.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager, SnapshotManager, SnapshotStorage } from 'codelapse-core';
import { useRealFileSystem } from './realFs';

describe('SnapshotStorage.deleteSnapshot', () => {
  let tmpRoot: string;
  let storage: SnapshotStorage;

  beforeEach(() => {
    useRealFileSystem();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-delete-'));
    storage = new SnapshotStorage(tmpRoot, '.snapshots');
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('rejects an id that does not exist instead of reporting success (BUG-2)', async () => {
    await expect(storage.deleteSnapshot('snapshot-missing')).rejects.toThrow(
      /not found/i,
    );
  });

  it('still removes an existing snapshot directory', async () => {
    const dir = path.join(tmpRoot, '.snapshots', 'snapshot-1-abc');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'snapshot.json'), '{}');

    await storage.deleteSnapshot('snapshot-1-abc');

    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe('SnapshotManager.deleteSnapshot', () => {
  let tmpRoot: string;
  let manager: SnapshotManager;

  beforeEach(async () => {
    useRealFileSystem();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-manager-'));
    fs.writeFileSync(path.join(tmpRoot, 'tracked.txt'), 'hello');
    manager = new SnapshotManager(tmpRoot);
    await manager.initialize();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('propagates a missing id instead of rewriting the index (BUG-2)', async () => {
    await expect(manager.deleteSnapshot('snapshot-missing')).rejects.toThrow(
      /not found/i,
    );
  });

  it('prunes an old snapshot whose directory is already gone without failing the new snapshot', async () => {
    // Stale index entries happen (a user removing .snapshots/<id> by hand, an
    // interrupted delete). Pruning must stay best-effort: the missing
    // directory is dropped from the index, and creating the next snapshot
    // still succeeds.
    const config = new ConfigManager(tmpRoot);
    await config.setNested('maxSnapshots', 1);

    const limited = new SnapshotManager(tmpRoot);
    await limited.initialize();

    const first = await limited.takeSnapshot({ description: 'first' });
    fs.rmSync(path.join(tmpRoot, '.snapshots', first.id), {
      recursive: true,
      force: true,
    });

    fs.writeFileSync(path.join(tmpRoot, 'tracked.txt'), 'changed');
    const second = await limited.takeSnapshot({ description: 'second' });

    expect(second.id).not.toBe(first.id);
    const remaining = await limited.getSnapshots();
    expect(remaining.map((s) => s.id)).toEqual([second.id]);
  });
});
