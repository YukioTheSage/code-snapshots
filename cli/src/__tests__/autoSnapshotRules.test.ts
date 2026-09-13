import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from 'codelapse-core';
import { StandaloneHandler } from '../standaloneHandler';
import { useRealFileSystem } from './realFs';

describe('standalone auto-snapshot rules', () => {
  let root: string;
  let handler: StandaloneHandler;

  beforeEach(() => {
    useRealFileSystem();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-rules-'));
    handler = new StandaloneHandler();
    (handler as any).configManager = new ConfigManager(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('adds, lists, toggles and removes a rule', async () => {
    await handler.addAutoSnapshotRule({
      pattern: 'src/**/*.ts',
      intervalMinutes: 30,
    });
    expect(await handler.getAutoSnapshotRules()).toEqual([
      { pattern: 'src/**/*.ts', intervalMinutes: 30 },
    ]);

    await handler.toggleAutoSnapshotRule('src/**/*.ts', false);
    expect((await handler.getAutoSnapshotRules())[0].enabled).toBe(false);

    await handler.removeAutoSnapshotRule('src/**/*.ts');
    expect(await handler.getAutoSnapshotRules()).toEqual([]);
  });

  it('reports which sample paths a rule matches', async () => {
    const result = await handler.testAutoSnapshotRule({
      pattern: 'src/**/*.ts',
      samplePaths: ['src/a.ts', 'src/nested/b.ts', 'docs/readme.md'],
    });

    expect(result.matched).toEqual(['src/a.ts', 'src/nested/b.ts']);
  });

  it('rejects a duplicate pattern instead of silently replacing it', async () => {
    await handler.addAutoSnapshotRule({
      pattern: 'src/**/*.ts',
      intervalMinutes: 30,
    });

    await expect(
      handler.addAutoSnapshotRule({
        pattern: 'src/**/*.ts',
        intervalMinutes: 60,
      }),
    ).rejects.toThrow(/already exists/i);
  });
});
