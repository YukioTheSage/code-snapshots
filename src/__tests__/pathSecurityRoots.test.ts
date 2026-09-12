import { ensureWithinDirectory, assertNoSymlinkPath } from '../pathSecurity';
import * as path from 'path';

describe('path guards with unusual roots', () => {
  it('accepts a file under a root written with a trailing separator', () => {
    // `path.normalize` keeps the trailing separator, so the old prefix check
    // built `...\\` and rejected every legitimate path.
    const root = `C:${path.sep}proj${path.sep}`;
    expect(() => ensureWithinDirectory(root, 'src/app.ts')).not.toThrow();
  });

  it('still rejects a sibling that shares the root prefix', () => {
    expect(() =>
      ensureWithinDirectory(
        `C:${path.sep}proj`,
        `..${path.sep}proj-other${path.sep}x`,
      ),
    ).toThrow(/traversal blocked/i);
  });

  it('applies the same normalisation in the symlink guard', async () => {
    await expect(
      assertNoSymlinkPath(
        `C:${path.sep}proj${path.sep}`,
        `C:${path.sep}proj${path.sep}src`,
      ),
    ).resolves.toBeUndefined();
  });
});