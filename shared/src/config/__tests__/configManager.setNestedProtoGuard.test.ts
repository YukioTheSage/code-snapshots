import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager, assignNestedValue } from '../configManager';

describe('nested configuration assignment', () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>).polluted;
  });

  it.each(['__proto__.polluted', 'constructor.prototype.polluted'])(
    'refuses to assign through %s',
    (keyPath) => {
      const target: Record<string, any> = {};

      expect(() => assignNestedValue(target, keyPath, 'yes')).toThrow(
        /prototype chain/,
      );
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    },
  );

  it('refuses a dangerous segment in the final position too', () => {
    expect(() => assignNestedValue({ git: {} }, 'git.__proto__', {})).toThrow(
      /prototype chain/,
    );
  });

  it('creates intermediate objects and assigns the leaf for a safe path', () => {
    const target: Record<string, any> = {};

    assignNestedValue(target, 'git.addCommitInfo', false);

    expect(target).toEqual({ git: { addCommitInfo: false } });
  });

  it('keeps an existing intermediate object rather than replacing it', () => {
    const target: Record<string, any> = { git: { addCommitInfo: true } };

    assignNestedValue(target, 'git.commitFromSnapshotEnabled', true);

    expect(target).toEqual({
      git: { addCommitInfo: true, commitFromSnapshotEnabled: true },
    });
  });

  /**
   * The public route already refuses these paths, because the schema allow-list
   * rejects them before the writer runs. This case passes before the change as
   * well: it locks the guarantee in at the API surface rather than driving the
   * fix, and would catch a future relaxation of the allow-list.
   */
  it('still rejects a prototype path through the public setNested API', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-proto-'));

    try {
      const manager = new ConfigManager(root);

      await expect(
        manager.setNested('__proto__.polluted', 'yes'),
      ).rejects.toThrow(/Invalid configuration key path/);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
