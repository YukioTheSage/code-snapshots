import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from '../configManager';
import { getAvailableConfigKeyPaths } from '../../validation/configValidation';

/**
 * git.autoSnapshotBeforeOperation was declared, defaulted, validated and
 * settable, and read by nothing. It is removed from the type, the defaults, the
 * validator and the CLI's config types -- but a store written while it existed
 * must keep loading, because the validator ignores unknown keys rather than
 * rejecting the file.
 */
describe('the retired git.autoSnapshotBeforeOperation key', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-legacy-key-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('is not advertised as a configuration key', () => {
    expect(getAvailableConfigKeyPaths()).not.toContain(
      'git.autoSnapshotBeforeOperation',
    );
    // The sibling key stays: takeSnapshotInternal reads it.
    expect(getAvailableConfigKeyPaths()).toContain('git.addCommitInfo');
  });

  it('still loads a store that carries it', () => {
    const configDir = path.join(root, '.vscode');
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, 'codelapse.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        maxSnapshots: 7,
        git: { addCommitInfo: true, autoSnapshotBeforeOperation: true },
      }),
      'utf8',
    );

    const manager = new ConfigManager(root);
    const config = manager.getConfig();

    // A rejected file is renamed to '<path>.quarantine-<timestamp>.json', so
    // both of these have to hold for "it loaded" to mean anything.
    expect(fs.existsSync(configPath)).toBe(true);
    expect(config.maxSnapshots).toBe(7);
    expect(config.git.addCommitInfo).toBe(true);
    expect(manager.isValidKeyPath('git.autoSnapshotBeforeOperation')).toBe(
      false,
    );
  });
});
