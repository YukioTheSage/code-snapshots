/**
 * Regression guard for snapshot pollution by CLI byproducts (BUG-10).
 *
 * The default ignore list covered `.git`, `node_modules`, the snapshot
 * directory and virtualenvs, but not the CLI's own artefacts. Snapshots taken
 * in a workspace therefore contained `.vscode/codelapse.json` (CLI
 * configuration), `.snapshotignore`, and the `*.backup-<timestamp>` files that
 * `snapshot restore` / `files restore` write next to the originals -- so each
 * restore polluted every later snapshot of the same tree.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitignoreParser } from 'codelapse-core';
import { useRealFileSystem } from './realFs';

describe('GitignoreParser default ignores (BUG-10)', () => {
  let root: string;
  let parser: GitignoreParser;

  beforeEach(() => {
    useRealFileSystem();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-ignore-'));
    parser = new GitignoreParser(root, '.snapshots');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([
    '.vscode/codelapse.json',
    '.snapshotignore',
    'sample.ts.backup-2026-09-11T09-58-07-945Z',
    'src/deep/code.ts.backup-2026-09-11T09-58-07-945Z',
    'scratch.codelapse-tmp',
  ])('ignores the CLI byproduct %s', (filePath) => {
    expect(parser.shouldIgnore(filePath)).toBe(true);
  });

  it('still ignores the snapshot directory and other defaults', () => {
    expect(parser.shouldIgnore('.snapshots')).toBe(true);
    expect(parser.shouldIgnore('node_modules')).toBe(true);
    expect(parser.shouldIgnore('.git')).toBe(true);
  });

  it('keeps ordinary project files', () => {
    for (const filePath of [
      'src/main.ts',
      'package.json',
      'README.md',
      'src/codelapse.ts',
      '.vscode/settings.json',
      'backup-notes.md',
    ]) {
      expect(parser.shouldIgnore(filePath)).toBe(false);
    }
  });

  it('honours a user .gitignore entry alongside the defaults', () => {
    fs.writeFileSync(path.join(root, '.gitignore'), 'build/\n');
    const withGitignore = new GitignoreParser(root, '.snapshots');

    expect(withGitignore.shouldIgnore('build/out.js')).toBe(true);
    expect(withGitignore.shouldIgnore('.vscode/codelapse.json')).toBe(true);
  });

  /**
   * The store is excluded through patterns derived from the location it is
   * configured with. Hardcoding `.snapshots` left a custom store inside the
   * scanned tree, so every snapshot captured the store's own index and payload
   * files -- and a restore, which deletes workspace files the snapshot does not
   * contain, deleted those payloads.
   */
  it('ignores the configured snapshot location, not the default one', () => {
    const custom = new GitignoreParser(root, '.snapshots-test');

    // `shouldIgnore` matches file paths, so the bare directory name is not
    // enough: the contents are what a snapshot scan sees.
    expect(custom.shouldIgnore('.snapshots-test')).toBe(true);
    expect(custom.shouldIgnore('.snapshots-test/index.json')).toBe(true);
    expect(
      custom.shouldIgnore('.snapshots-test/snapshot-1/snapshot.json'),
    ).toBe(true);
    // Not only at the workspace root: the store can sit in a subdirectory.
    expect(custom.shouldIgnore('sub/dir/.snapshots-test/index.json')).toBe(
      true,
    );
    // A store left behind at the default location keeps its exclusion; no file
    // that was ignored before this change becomes capturable.
    expect(custom.shouldIgnore('.snapshots/index.json')).toBe(true);
    // Ordinary project files are still kept, at the same depth.
    expect(custom.shouldIgnore('src/main.ts')).toBe(false);
    expect(custom.shouldIgnore('sub/dir/snapshots-test/index.json')).toBe(
      false,
    );
  });

  it('normalises a hand-written location into the patterns it emits', () => {
    // `snapshotLocation` is a user setting: trailing slashes, a leading `./`
    // and Windows separators all name the same directory.
    for (const configured of [
      '.snapshots-test',
      '.snapshots-test/',
      './.snapshots-test',
      '.snapshots-test\\',
    ]) {
      const parser = new GitignoreParser(root, configured);

      expect(parser.shouldIgnore('.snapshots-test/index.json')).toBe(true);
      expect(
        parser.getPatterns().filter((p) => p.includes('.snapshots-test')),
      ).toEqual([
        '.snapshots-test',
        '**/.snapshots-test',
        '**/.snapshots-test/**',
        '.snapshots-test/**',
      ]);
    }
  });

  it('emits the same patterns for the default location as before', () => {
    // Byte-identical set: `.snapshots` bare, `**/.snapshots`, `**/.snapshots/**`.
    // The custom-location branch must not leak into the default one.
    const defaults = new GitignoreParser(root, '.snapshots').getPatterns();
    const storePatterns = defaults.filter((p) => p.includes('snapshots'));

    expect(storePatterns).toEqual([
      '.snapshots',
      '**/.snapshots',
      '**/.snapshots/**',
    ]);
  });
});
