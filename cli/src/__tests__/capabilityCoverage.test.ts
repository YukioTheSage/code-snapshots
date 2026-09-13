/**
 * The CLI advertises an API surface in `apiAllowlist.ts`, serves part of it in
 * `unifiedClient.ts` and the rest in the extension's `cliConnectorService.ts`.
 * Nothing tied the three together, so eighteen methods -- the whole `filter`,
 * `rules` and `diagnostics` groups -- were allowlisted, documented and served by
 * neither mode. This guard is what keeps that from happening again.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ALLOWED_API_METHODS } from '../apiAllowlist';
import { STANDALONE_METHODS } from '../unifiedClient';

const repoRoot = path.join(__dirname, '..', '..', '..');
const read = (relative: string) =>
  fs.readFileSync(path.join(repoRoot, relative), 'utf8');

/**
 * Methods that are deliberately served by neither mode yet. Empty is the goal;
 * an entry here is a decision, not a backlog item, and needs a reason.
 */
const KNOWN_UNSERVED: ReadonlySet<string> = new Set([]);

function standaloneSwitchCases(): Set<string> {
  const source = read('cli/src/unifiedClient.ts');
  const start = source.indexOf("if (this.activeMode === 'standalone')");
  const end = source.indexOf("} else if (this.activeMode === 'ipc')", start);
  const body = source.slice(start, end);
  return new Set(
    [...body.matchAll(/case '([A-Za-z0-9_]+)'/g)].map((m) => m[1]),
  );
}

function ipcCases(): Set<string> {
  const source = read('src/services/cliConnectorService.ts');
  const start = source.indexOf('private async handleCliRequest');
  const end = source.indexOf('Unknown method', start);
  const body = source.slice(start, end);
  return new Set(
    [...body.matchAll(/case '([A-Za-z0-9_]+)'/g)].map((m) => m[1]),
  );
}

describe('CLI capability coverage', () => {
  const standalone = standaloneSwitchCases();
  const ipc = ipcCases();

  it('declares exactly the methods its own switch implements', () => {
    expect([...STANDALONE_METHODS].sort()).toEqual([...standalone].sort());
  });

  it('serves every allowlisted method in at least one mode', () => {
    const unserved = [...ALLOWED_API_METHODS]
      .filter(
        (m) => !standalone.has(m) && !ipc.has(m) && !KNOWN_UNSERVED.has(m),
      )
      .sort();

    expect(unserved).toEqual([]);
  });

  it('serves every standalone-declared method over IPC as well, or explains why not', () => {
    const ipcMissing = [...standalone].filter((m) => !ipc.has(m)).sort();
    expect(ipcMissing).toEqual([
      'compareSnapshotFile',
      'exportSnapshotFile',
      'getFileHistory',
      'getSnapshotFile',
      'listSnapshotFiles',
      'restoreSnapshotFile',
    ]);
  });

  // The two methods are named in the test title so a regression says WHICH one
  // is missing: the original loop failed with a bare 'Expected true / Received
  // false' and no method name.
  it.each(['autoSnapshotBeforeGitOperation', 'compareSnapshotWithGitCommit'])(
    'serves %s in standalone as well as over IPC',
    (method) => {
      // Both were allowlisted, documented and served by the extension, but absent
      // from STANDALONE_METHODS, so with no extension running 'git auto-commit'
      // and 'git compare' died in the per-method IPC fallback.
      expect(standalone.has(method)).toBe(true);
      expect(ipc.has(method)).toBe(true);
    },
  );

  it('leaves KNOWN_UNSERVED empty, so nothing is explained away', () => {
    // Empty is the goal the plan states; an entry here is a decision, not a
    // backlog item. Without this assertion an entry could be added silently and
    // the 'serves every allowlisted method' test above would still pass.
    expect([...KNOWN_UNSERVED]).toEqual([]);
  });
});
