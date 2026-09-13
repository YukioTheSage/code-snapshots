import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_CONFIG } from '../../types/config';
import {
  getSchemaEntry,
  isValidConfigKeyPath,
  validatePartialCodelapseConfig,
} from '../configValidation';
import { ConfigManager } from '../../config/configManager';

describe('maxSnapshotStoreBytes', () => {
  it('defaults to 0, which disables the limit', () => {
    expect(DEFAULT_CONFIG.maxSnapshotStoreBytes).toBe(0);
  });

  it('is part of the settable schema', () => {
    expect(isValidConfigKeyPath('maxSnapshotStoreBytes')).toBe(true);
    expect(getSchemaEntry('maxSnapshotStoreBytes')?.default).toBe(0);
  });

  it('accepts zero and positive byte counts', () => {
    expect(() =>
      validatePartialCodelapseConfig(
        { maxSnapshotStoreBytes: 0 },
        'configFile',
      ),
    ).not.toThrow();
    expect(() =>
      validatePartialCodelapseConfig(
        { maxSnapshotStoreBytes: 1048576 },
        'configFile',
      ),
    ).not.toThrow();
  });

  it('rejects a negative limit', () => {
    expect(() =>
      validatePartialCodelapseConfig(
        { maxSnapshotStoreBytes: -1 },
        'configFile',
      ),
    ).toThrow(/maxSnapshotStoreBytes must not be negative/);
  });

  it('rejects a limit that is not a finite number', () => {
    expect(() =>
      validatePartialCodelapseConfig(
        { maxSnapshotStoreBytes: '1GB' },
        'configFile',
      ),
    ).toThrow(/maxSnapshotStoreBytes must be a finite number/);
  });

  /**
   * A store written by a version that knows a key this one does not must keep
   * loading. The validator only inspects the keys it declares and merges the
   * rest through, which is also what makes plan 09's removal of an obsolete key
   * safe for stores that still carry it.
   */
  it('keeps loading a store that carries keys the schema does not know', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-config-'));
    try {
      fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
      fs.writeFileSync(
        path.join(root, '.vscode', 'codelapse.json'),
        JSON.stringify({
          maxSnapshots: 7,
          maxSnapshotStoreBytes: 2048,
          somethingAnotherVersionWrote: true,
        }),
        'utf8',
      );

      const config = new ConfigManager(root);

      expect(config.getNested('maxSnapshots')).toBe(7);
      expect(config.getNested('maxSnapshotStoreBytes')).toBe(2048);
      expect(
        fs.existsSync(path.join(root, '.vscode', 'codelapse.json')),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
