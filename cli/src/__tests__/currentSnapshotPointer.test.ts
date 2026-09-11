/**
 * Regression guard for the current-snapshot pointer (LOW-6).
 *
 * The snapshot index always persisted `currentIndex`, but nothing read it:
 * `status` hardcoded `currentSnapshot: null`, so straight after
 * `snapshot navigate previous` the CLI reported "Current snapshot: None", and
 * the navigate result and the status disagreed about the store's position.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SnapshotManager } from 'codelapse-core';
import { StandaloneHandler } from '../standaloneHandler';
import { useRealFileSystem } from './realFs';

describe('SnapshotManager current-snapshot pointer', () => {
  let root: string;
  let manager: SnapshotManager;

  beforeEach(async () => {
    useRealFileSystem();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-current-'));
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'one');
    manager = new SnapshotManager(root);
    await manager.initialize();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports the newest snapshot after creating one', async () => {
    const created = await manager.takeSnapshot({ description: 'first' });

    expect(manager.getCurrentSnapshot()?.id).toBe(created.id);
  });

  it('follows the pointer set by setCurrentSnapshot', async () => {
    const first = await manager.takeSnapshot({ description: 'first' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'two');
    const second = await manager.takeSnapshot({ description: 'second' });

    await manager.setCurrentSnapshot(first.id);

    expect(manager.getCurrentSnapshot()?.id).toBe(first.id);
    expect(manager.getCurrentSnapshot()?.id).not.toBe(second.id);
  });

  it('rejects an unknown id and leaves the pointer alone', async () => {
    const created = await manager.takeSnapshot({ description: 'first' });

    await expect(
      manager.setCurrentSnapshot('snapshot-missing'),
    ).rejects.toThrow(/not found/i);
    expect(manager.getCurrentSnapshot()?.id).toBe(created.id);
  });

  it('persists the pointer across a reload', async () => {
    const first = await manager.takeSnapshot({ description: 'first' });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'two');
    await manager.takeSnapshot({ description: 'second' });

    await manager.setCurrentSnapshot(first.id);

    const reloaded = new SnapshotManager(root);
    await reloaded.initialize();
    expect(reloaded.getCurrentSnapshot()?.id).toBe(first.id);
  });
});

describe('standalone navigate records its position', () => {
  function handlerWithFakeManager(): {
    handler: StandaloneHandler;
    setCalls: string[];
  } {
    const setCalls: string[] = [];
    const snapshots = [
      { id: 'snapshot-1-a' },
      { id: 'snapshot-2-b' },
      { id: 'snapshot-3-c' },
    ];

    const handler = new StandaloneHandler();
    (handler as unknown as { snapshotManager: unknown }).snapshotManager = {
      getSnapshots: async () => snapshots,
      setCurrentSnapshot: async (id: string) => {
        setCalls.push(id);
      },
    };

    return { handler, setCalls };
  }

  it('records the snapshot it navigates to', async () => {
    const { handler, setCalls } = handlerWithFakeManager();

    const target = await handler.navigateSnapshot('previous');

    expect(target.id).toBe('snapshot-2-b');
    expect(setCalls).toEqual(['snapshot-2-b']);
  });

  it('refuses "previous" with a single snapshot and records nothing', async () => {
    const handler = new StandaloneHandler();
    const setCalls: string[] = [];
    (handler as unknown as { snapshotManager: unknown }).snapshotManager = {
      getSnapshots: async () => [{ id: 'only' }],
      setCurrentSnapshot: async (id: string) => {
        setCalls.push(id);
      },
    };

    await expect(handler.navigateSnapshot('previous')).rejects.toThrow(
      /no previous snapshot/i,
    );
    expect(setCalls).toEqual([]);
  });
});
