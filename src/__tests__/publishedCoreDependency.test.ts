/**
 * npm does not rewrite `file:` specifiers when packing a tarball. A `file:`
 * dependency that reaches the registry therefore produces a package no consumer
 * can install: the published manifest points at a directory that does not exist
 * beside it. Both manifests were declared that way until the 0.9.6 release, so
 * this test exists to stop it coming back.
 *
 * The replacement is a semver range covering the core's own version, resolved
 * from the registry in the lockfiles rather than from a local link.
 */
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.join(__dirname, '..', '..');
const readJson = (relative: string) =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));

const coreVersion = readJson('shared/package.json').version;

describe('published core dependency', () => {
  it('declares the core as a semver range, never a file: specifier', () => {
    for (const manifest of ['package.json', 'cli/package.json']) {
      const declared = readJson(manifest).dependencies['codelapse-core'];
      expect(declared).not.toMatch(/^file:/);
      expect(declared).toBe(`^${coreVersion}`);
    }
  });

  it('resolves the core from the registry in both lockfiles', () => {
    for (const lock of ['package-lock.json', 'cli/package-lock.json']) {
      const entry = readJson(lock).packages['node_modules/codelapse-core'];
      expect(entry.link).toBeUndefined();
      expect(entry.version).toBe(coreVersion);
      expect(entry.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(entry.integrity).toMatch(/^sha512-/);
    }
  });
});
