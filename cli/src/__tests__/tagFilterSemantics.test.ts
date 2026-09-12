import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SnapshotManager } from 'codelapse-core';
import { StandaloneHandler } from '../standaloneHandler';
import { useRealFileSystem } from './realFs';

describe('standalone tag filter semantics', () => {
  it('requires every requested tag', async () => {
    useRealFileSystem();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-tags-'));
    try {
      fs.writeFileSync(path.join(root, 'a.txt'), 'one');
      const handler = new StandaloneHandler();
      const manager = new SnapshotManager(root);
      await manager.initialize();
      (handler as any).snapshotManager = manager;
      await handler.takeSnapshot({
        description: 'both',
        tags: ['auth', 'feature'],
      });
      fs.writeFileSync(path.join(root, 'a.txt'), 'two');
      await handler.takeSnapshot({ description: 'one', tags: ['auth'] });

      // The documented example is `codelapse filter tags "auth,feature"`, which
      // reads as "tagged auth and feature".
      const result = await handler.filterSnapshots({
        tags: ['auth', 'feature'],
      });

      expect(result.snapshots.map((s) => s.description)).toEqual(['both']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
