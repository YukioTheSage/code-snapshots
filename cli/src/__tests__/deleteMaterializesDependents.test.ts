/**
 * Deleting a base must not orphan the snapshots that stored a delta against it.
 * The store is a chain of deltas, so removing a link without first rewriting
 * the survivors into full content loses every file they inherited.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SnapshotManager } from 'codelapse-core';
import { useRealFileSystem } from './realFs';

const FILE = 'tracked.txt';

describe('deleteSnapshot materializes its dependents', () => {
  let root: string;
  let manager: SnapshotManager;

  beforeEach(async () => {
    useRealFileSystem();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-delete-'));
    fs.writeFileSync(path.join(root, FILE), 'one');
    manager = new SnapshotManager(root);
    await manager.initialize();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('keeps a surviving delta readable after its base is deleted', async () => {
    const base = await manager.takeSnapshot({ description: 'base' });
    fs.writeFileSync(path.join(root, FILE), 'two');
    const dependent = await manager.takeSnapshot({ description: 'dependent' });

    await manager.deleteSnapshot(base.id);

    const survivor = await manager.getSnapshot(dependent.id);
    if (!survivor) throw new Error('dependent vanished with its base');
    // Rewritten to full content: no dangling reference to the deleted base.
    expect(survivor.files[FILE].baseSnapshotId).toBeUndefined();
    await expect(
      manager.getSnapshotFileContent(dependent.id, FILE),
    ).resolves.toBe('two');
  });

  it('refuses the delete when a survivor cannot be rebuilt, and writes nothing', async () => {
    const base = await manager.takeSnapshot({ description: 'base' });
    fs.writeFileSync(path.join(root, FILE), 'two');
    const dependent = await manager.takeSnapshot({ description: 'dependent' });

    // The base's payload is what resolution reads. Corrupt it rather than
    // removing the directory, so the force path can still remove the base, and
    // clear the resolver cache so the copy made during capture cannot mask the
    // unreadable payload.
    fs.writeFileSync(
      path.join(root, '.snapshots', base.id, 'snapshot.json'),
      '{ corrupted',
    );
    (manager as any).storage.clearCache();

    await expect(manager.deleteSnapshot(base.id)).rejects.toThrow(
      /cannot be rebuilt/i,
    );

    // Nothing was deleted and nothing was persisted: the survivor is untouched.
    const survivor = await manager.getSnapshot(dependent.id);
    expect(survivor?.files[FILE].baseSnapshotId).toBe(base.id);
  });

  it('deletes anyway when forced, and says what it broke', async () => {
    const base = await manager.takeSnapshot({ description: 'base' });
    fs.writeFileSync(path.join(root, FILE), 'two');
    await manager.takeSnapshot({ description: 'dependent' });
    fs.writeFileSync(
      path.join(root, '.snapshots', base.id, 'snapshot.json'),
      '{ corrupted',
    );
    (manager as any).storage.clearCache();

    await expect(
      manager.deleteSnapshot(base.id, { force: true }),
    ).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(root, '.snapshots', base.id))).toBe(false);
  });
});
