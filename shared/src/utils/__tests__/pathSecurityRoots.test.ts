import { ensureWithinDirectory, assertNoSymlinkPath } from '../pathSecurity';
import * as path from 'path';

/**
 * An absolute root for the platform the suite runs on.
 *
 * These fixtures used to be written as `C:${path.sep}proj`, which is absolute on
 * Windows but a RELATIVE path on POSIX -- there `path.resolve` anchors it to the
 * working directory, so `ensureWithinDirectory` correctly reported the file as
 * outside the root and the first case failed. The suite never ran in CI until
 * the shared job gained a Test step, which is why a Windows-only case survived.
 */
const ROOT = path.resolve(path.sep, 'proj');

describe('shared path guards with unusual roots', () => {
  it('accepts a file under a root written with a trailing separator', () => {
    const root = `${ROOT}${path.sep}`;
    expect(() => ensureWithinDirectory(root, 'src/app.ts')).not.toThrow();
  });

  it('still rejects a sibling that shares the root prefix', () => {
    expect(() =>
      ensureWithinDirectory(ROOT, `..${path.sep}proj-other${path.sep}x`),
    ).toThrow(/traversal blocked/i);
  });

  it('applies the same normalisation in the symlink guard', () => {
    expect(() =>
      assertNoSymlinkPath(`${ROOT}${path.sep}`, `${ROOT}${path.sep}src`),
    ).not.toThrow();
  });
});