import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ENV_VARS } from '../../types/config';
import { ConfigManager } from '../configManager';

/**
 * The config-file validator rejects `maxSnapshots` below 1. Two other routes can
 * set the same value, and both used to bypass that floor.
 *
 * With `maxSnapshots` below 1 the retention trim's excess is at least the store
 * length, so the snapshot the user just took becomes a prune candidate and is
 * deleted. These pin the floor on the environment and on `setNested`, the path
 * `codelapse config set maxSnapshots 0` takes.
 */
describe('maxSnapshots floor', () => {
  let root: string;
  const originalEnvValue = process.env[ENV_VARS.MAX_SNAPSHOTS];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-config-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (originalEnvValue === undefined) {
      delete process.env[ENV_VARS.MAX_SNAPSHOTS];
    } else {
      process.env[ENV_VARS.MAX_SNAPSHOTS] = originalEnvValue;
    }
  });

  it('rejects a non-positive value from the environment', () => {
    process.env[ENV_VARS.MAX_SNAPSHOTS] = '0';

    expect(() => new ConfigManager(root).getConfig()).toThrow(
      /CODELAPSE_MAX_SNAPSHOTS.*maxSnapshots must be at least 1/,
    );

    process.env[ENV_VARS.MAX_SNAPSHOTS] = '-3';

    expect(() => new ConfigManager(root).getConfig()).toThrow(
      /maxSnapshots must be at least 1/,
    );
  });

  it('still applies an environment value of 1', () => {
    process.env[ENV_VARS.MAX_SNAPSHOTS] = '1';

    expect(new ConfigManager(root).getConfig().maxSnapshots).toBe(1);
  });

  it('rejects a setNested value below 1 and writes nothing', async () => {
    const manager = new ConfigManager(root);

    await expect(manager.setNested('maxSnapshots', 0)).rejects.toThrow(
      /maxSnapshots must be at least 1/,
    );

    expect(manager.getNested('maxSnapshots')).toBe(50);
    expect(
      fs.existsSync(path.join(root, '.vscode', 'codelapse.json')),
    ).toBe(false);
  });

  it('still accepts a setNested value of 1', async () => {
    const manager = new ConfigManager(root);

    await manager.setNested('maxSnapshots', 1);

    expect(manager.getNested('maxSnapshots')).toBe(1);
  });
});
