/**
 * The core is not published from this tree: both packages consume it through a
 * `file:` link. A semver range happens to resolve to the same place today only
 * because the local version matches, and a re-resolve is free to swap in the
 * registry copy -- after which edits under `shared/` silently stop mattering.
 */
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.join(__dirname, '..', '..');
const readJson = (relative: string) =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));

describe('local core linkage', () => {
  it('declares the core as a file dependency, not a range', () => {
    expect(readJson('package.json').dependencies['codelapse-core']).toBe(
      'file:shared',
    );
    expect(readJson('cli/package.json').dependencies['codelapse-core']).toBe(
      'file:../shared',
    );
  });

  it('keeps the lockfiles pointing at the local directory', () => {
    expect(
      readJson('package-lock.json').packages['node_modules/codelapse-core'],
    ).toMatchObject({ resolved: 'shared', link: true });
    expect(
      readJson('cli/package-lock.json').packages['node_modules/codelapse-core'],
    ).toMatchObject({ resolved: '../shared', link: true });
  });
});
