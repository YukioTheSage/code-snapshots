import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from '../configManager';

/**
 * The config-file validator rejects a negative `maxSnapshotStoreBytes`. The two
 * direct API routes can set the same key, and without the same floor they wrote
 * the value successfully -- and the next load quarantined the whole
 * `codelapse.json`, reverting every setting to its default.
 */
describe('maxSnapshotStoreBytes floor', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-config-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function configFilePath(): string {
    return path.join(root, '.vscode', 'codelapse.json');
  }

  describe('setNested', () => {
    it('rejects a negative value and writes nothing', async () => {
      const manager = new ConfigManager(root);

      await expect(
        manager.setNested('maxSnapshotStoreBytes', -1),
      ).rejects.toThrow(/maxSnapshotStoreBytes must not be negative/);

      expect(manager.getNested('maxSnapshotStoreBytes')).toBe(0);
      expect(fs.existsSync(configFilePath())).toBe(false);
    });

    it('still accepts zero, which disables the limit', async () => {
      const manager = new ConfigManager(root);

      await manager.setNested('maxSnapshotStoreBytes', 0);

      expect(manager.getNested('maxSnapshotStoreBytes')).toBe(0);
    });

    it('still accepts a positive limit', async () => {
      const manager = new ConfigManager(root);

      await manager.setNested('maxSnapshotStoreBytes', 1048576);

      expect(manager.getNested('maxSnapshotStoreBytes')).toBe(1048576);
    });
  });

  describe('set', () => {
    it('rejects a negative value and writes nothing', async () => {
      const manager = new ConfigManager(root);

      await expect(manager.set('maxSnapshotStoreBytes', -1)).rejects.toThrow(
        /set\.maxSnapshotStoreBytes must not be negative/,
      );

      expect(manager.getNested('maxSnapshotStoreBytes')).toBe(0);
      expect(fs.existsSync(configFilePath())).toBe(false);
    });
  });
});
