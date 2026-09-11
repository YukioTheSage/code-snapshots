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
});
