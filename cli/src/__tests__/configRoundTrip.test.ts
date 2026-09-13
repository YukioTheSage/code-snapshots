import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from 'codelapse-core';
import { StandaloneHandler } from '../standaloneHandler';
import { useRealFileSystem } from './realFs';

describe('codelapse.json round trip', () => {
  let root: string;
  let handler: StandaloneHandler;

  beforeEach(() => {
    useRealFileSystem();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-config-'));
    handler = new StandaloneHandler();
    // `initialize()` discovers the workspace root from process.cwd; inject the
    // real config manager so the fixture stays inside this temp directory.
    (handler as any).configManager = new ConfigManager(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes a schema-valid key and reads it back', async () => {
    await handler.setConfig('maxSnapshots', 7);

    expect(await handler.getConfig('maxSnapshots')).toBe(7);
    const raw = fs.readFileSync(
      path.join(root, '.vscode', 'codelapse.json'),
      'utf8',
    );
    // `setNested` persists the merged effective config, not just the one key;
    // what matters for the shared store is that the written key round-trips.
    expect(JSON.parse(raw).maxSnapshots).toBe(7);
  });

  it('round-trips the size limit through the shared store', async () => {
    await handler.setConfig('maxSnapshotStoreBytes', 1048576);

    expect(await handler.getConfig('maxSnapshotStoreBytes')).toBe(1048576);
    const raw = fs.readFileSync(
      path.join(root, '.vscode', 'codelapse.json'),
      'utf8',
    );
    expect(JSON.parse(raw).maxSnapshotStoreBytes).toBe(1048576);
  });

  it('rejects a key the schema does not declare', async () => {
    await expect(handler.setConfig('not.a.key', 1)).rejects.toThrow(
      /invalid configuration key path/i,
    );
  });

  it('rejects a value of the wrong type', async () => {
    await expect(handler.setConfig('maxSnapshots', 'seven')).rejects.toThrow(
      /maxSnapshots/,
    );
  });
});
