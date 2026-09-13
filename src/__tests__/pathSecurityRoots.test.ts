import { ensureWithinDirectory, assertNoSymlinkPath } from '../pathSecurity';
import * as path from 'path';

// An absolute root spelled the same way on every platform. A literal
// `C:\proj` is not absolute on POSIX -- it is a single relative component
// there -- so a fixture built from one checks a different rule on Linux than
// the one this suite is about.
const FILESYSTEM_ROOT = path.parse(process.cwd()).root;
const PROJ = path.join(FILESYSTEM_ROOT, 'proj');

describe('path guards with unusual roots', () => {
  it('accepts a file under a root written with a trailing separator', () => {
    // `path.normalize` keeps the trailing separator, so the old prefix check
    // built the separator twice and rejected every legitimate path.
    expect(() =>
      ensureWithinDirectory(`${PROJ}${path.sep}`, 'src/app.ts'),
    ).not.toThrow();
  });

  it('still rejects a sibling that shares the root prefix', () => {
    expect(() =>
      ensureWithinDirectory(PROJ, `..${path.sep}proj-other${path.sep}x`),
    ).toThrow(/traversal blocked/i);
  });

  it('applies the same normalisation in the symlink guard', async () => {
    await expect(
      assertNoSymlinkPath(`${PROJ}${path.sep}`, path.join(PROJ, 'src')),
    ).resolves.toBeUndefined();
  });
});
