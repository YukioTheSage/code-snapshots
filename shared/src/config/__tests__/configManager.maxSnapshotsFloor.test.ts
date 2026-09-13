import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ENV_VARS } from '../../types/config';
import { ConfigManager } from '../configManager';

/**
 * The config-file validator rejects `maxSnapshots` below 1. Three other routes
 * can set the same value, and the floor has to hold on all of them: below 1 the
 * retention trim's excess is at least the store length, so the snapshot the
 * user just took becomes a prune candidate and is deleted.
 *
 * The routes fail differently on purpose. `setNested` and `set` are direct API
 * calls and throw; `CODELAPSE_MAX_SNAPSHOTS` is ambient input, so an invalid
 * value is ignored with a log and the file/default value survives -- rejecting
 * it would throw out of `getConfig()` and discard the whole configuration.
 */
describe('maxSnapshots floor', () => {
  let root: string;
  let warn: jest.SpyInstance;
  const originalEnvValue = process.env[ENV_VARS.MAX_SNAPSHOTS];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-config-'));
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
    if (originalEnvValue === undefined) {
      delete process.env[ENV_VARS.MAX_SNAPSHOTS];
    } else {
      process.env[ENV_VARS.MAX_SNAPSHOTS] = originalEnvValue;
    }
  });

  function writeConfigFile(config: Record<string, unknown>): void {
    fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.vscode', 'codelapse.json'),
      JSON.stringify(config),
      'utf8',
    );
  }

  function configFilePath(): string {
    return path.join(root, '.vscode', 'codelapse.json');
  }

  function warnings(): string {
    return warn.mock.calls.flat().join(' ');
  }

  describe('CODELAPSE_MAX_SNAPSHOTS', () => {
    it.each(['0', '-3'])(
      'ignores the out-of-range value %p and keeps the file configuration',
      (raw) => {
        writeConfigFile({
          snapshotLocation: '.kept-snapshots',
          maxSnapshots: 9,
        });
        process.env[ENV_VARS.MAX_SNAPSHOTS] = raw;

        const config = new ConfigManager(root).getConfig();

        // The regression: rejecting the value threw out of `getConfig()`, so
        // `resolveSetting`'s catch turned every file value into the caller's
        // fallback and every CLI command failed.
        expect(config.snapshotLocation).toBe('.kept-snapshots');
        expect(config.maxSnapshots).toBe(9);
        expect(warnings()).toContain(
          `Ignoring ${ENV_VARS.MAX_SNAPSHOTS}="${raw}"`,
        );
        expect(warnings()).toContain('must be at least 1');
      },
    );

    it('ignores a non-numeric value with a log, not silently', () => {
      writeConfigFile({ snapshotLocation: '.kept-snapshots' });
      process.env[ENV_VARS.MAX_SNAPSHOTS] = 'lots';

      const config = new ConfigManager(root).getConfig();

      expect(config.snapshotLocation).toBe('.kept-snapshots');
      expect(config.maxSnapshots).toBe(50);
      expect(warnings()).toContain(
        `Ignoring ${ENV_VARS.MAX_SNAPSHOTS}="lots"`,
      );
      expect(warnings()).toContain('finite number');
    });

    it('still applies a value at the floor', () => {
      process.env[ENV_VARS.MAX_SNAPSHOTS] = '1';

      expect(new ConfigManager(root).getConfig().maxSnapshots).toBe(1);
      expect(warn).not.toHaveBeenCalled();
    });

    it('still lets a valid value win over the file and the default', () => {
      writeConfigFile({ maxSnapshots: 9 });
      process.env[ENV_VARS.MAX_SNAPSHOTS] = '4';

      expect(new ConfigManager(root).getConfig().maxSnapshots).toBe(4);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('setNested', () => {
    it('rejects a value below 1 and writes nothing', async () => {
      const manager = new ConfigManager(root);

      await expect(manager.setNested('maxSnapshots', 0)).rejects.toThrow(
        /maxSnapshots must be at least 1/,
      );

      expect(manager.getNested('maxSnapshots')).toBe(50);
      expect(fs.existsSync(configFilePath())).toBe(false);
    });

    it('still accepts a value of 1', async () => {
      const manager = new ConfigManager(root);

      await manager.setNested('maxSnapshots', 1);

      expect(manager.getNested('maxSnapshots')).toBe(1);
    });
  });

  describe('set', () => {
    it('rejects a value below 1 and writes nothing', async () => {
      const manager = new ConfigManager(root);

      await expect(manager.set('maxSnapshots', 0)).rejects.toThrow(
        /set\.maxSnapshots must be at least 1/,
      );

      expect(manager.getNested('maxSnapshots')).toBe(50);
      expect(fs.existsSync(configFilePath())).toBe(false);
    });

    it('still accepts a value of 1', async () => {
      const manager = new ConfigManager(root);

      await manager.set('maxSnapshots', 1);

      expect(manager.getNested('maxSnapshots')).toBe(1);
    });
  });
});
