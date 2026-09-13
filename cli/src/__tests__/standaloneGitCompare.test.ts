/* eslint-disable @typescript-eslint/no-explicit-any */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitIntegration, SnapshotManager } from 'codelapse-core';
import { StandaloneHandler } from '../standaloneHandler';
import { useRealFileSystem } from './realFs';

/**
 * 'codelapse git compare <snapshot-id> <commit-hash>' in standalone mode.
 *
 * The comparison is driven by a REAL repository. A fixture repo is created in a
 * temp directory outside this workspace, committed, snapshotted, changed and
 * snapshotted again, and the second snapshot is compared against a real commit
 * hash. Every answer about a commit -- whether a path is in that commit's tree
 * and what the file said there -- comes from `git show` through the real
 * GitIntegration, so the classification is proven against git's own tree rather
 * than against a table of answers this file also wrote.
 *
 * `jest.spyOn` is used where the test has to see WHICH paths the walk asked
 * about. A spy installs a pass-through wrapper: the real method still runs and
 * still shells out to git, only the call log is synthetic.
 */

/** Run git in the fixture repository, and fail the test if it fails. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

interface GitCompareFixture {
  root: string;
  handler: StandaloneHandler;
  manager: SnapshotManager;
  gitIntegration: GitIntegration;
  /** The commit the tree was in before the working-tree changes below. */
  commitA: string;
  /** The snapshot that records those changes. */
  snapshotId: string;
}

/**
 * Build a repository whose second snapshot differs from its first in every way
 * the comparison classifies:
 *
 *   commit A          src/modified.ts ('old line'), src/identical.ts ('same'),
 *                     legacy/removed.ts (two lines). legacy/untracked.ts is on
 *                     disk but was deliberately never committed.
 *   snapshot 1        the whole tree as commit A has it.
 *   working tree      src/modified.ts rewritten, src/added.ts created,
 *                     assets/logo.png (binary) created, legacy/removed.ts and
 *                     legacy/untracked.ts deleted.
 *   snapshot 2        the changed tree: a diff, two additions (one binary), an
 *                     unchanged entry, and two deletion tombstones -- one for a
 *                     path commit A has, one for a path it never had.
 */
async function buildFixture(): Promise<GitCompareFixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-gitcompare-'));

  git(root, 'init', '--quiet', '--initial-branch=main');
  // Local identity, and no signing: the fixture has to commit on a machine with
  // no global git configuration at all.
  git(root, 'config', 'user.name', 'CodeLapse Test');
  git(root, 'config', 'user.email', 'codelapse-test@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');

  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'legacy'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'modified.ts'), 'old line\n');
  fs.writeFileSync(path.join(root, 'src', 'identical.ts'), 'same\n');
  fs.writeFileSync(
    path.join(root, 'legacy', 'removed.ts'),
    'gone one\ngone two\n',
  );
  fs.writeFileSync(
    path.join(root, 'legacy', 'untracked.ts'),
    'never committed\n',
  );

  git(
    root,
    'add',
    '--',
    'src/modified.ts',
    'src/identical.ts',
    'legacy/removed.ts',
  );
  git(root, 'commit', '--quiet', '-m', 'commit A');
  const commitA = git(root, 'rev-parse', 'HEAD');

  // The real store, initialized the way initialize() initializes it, so the
  // snapshot the comparison walks is a snapshot that was really persisted.
  const manager = new SnapshotManager(root);
  await manager.initialize();
  await manager.takeSnapshot({ description: 'before the rewrite' });

  fs.writeFileSync(path.join(root, 'src', 'modified.ts'), 'new line\n');
  fs.writeFileSync(path.join(root, 'src', 'added.ts'), 'one\ntwo\n');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'assets', 'logo.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]),
  );
  fs.rmSync(path.join(root, 'legacy', 'removed.ts'));
  fs.rmSync(path.join(root, 'legacy', 'untracked.ts'));

  const snapshot = await manager.takeSnapshot({ description: 'after it' });

  const handler = new StandaloneHandler();
  const gitIntegration = new GitIntegration(root);
  (handler as any).workspaceRoot = root;
  (handler as any).snapshotManager = manager;
  (handler as any).gitIntegration = gitIntegration;

  return {
    root,
    handler,
    manager,
    gitIntegration,
    commitA,
    snapshotId: snapshot.id,
  };
}

describe('standalone compareSnapshotWithGitCommit', () => {
  let fixture: GitCompareFixture;

  beforeEach(async () => {
    useRealFileSystem();
    fixture = await buildFixture();
  });

  afterEach(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  it('classifies added, modified and deleted files against a real commit', async () => {
    const { handler, gitIntegration, commitA, snapshotId } = fixture;
    const getFileAtCommit = jest.spyOn(gitIntegration, 'getFileAtCommit');

    const result = await handler.compareSnapshotWithGitCommit({
      snapshotId,
      commitHash: commitA,
      includeFileList: true,
    });

    expect(result.differences).toEqual([
      { file: 'assets/logo.png', changeType: 'added' },
      {
        file: 'legacy/removed.ts',
        changeType: 'deleted',
        linesAdded: 0,
        linesRemoved: 2,
      },
      {
        file: 'src/added.ts',
        changeType: 'added',
        linesAdded: 2,
        linesRemoved: 0,
      },
      {
        file: 'src/modified.ts',
        changeType: 'modified',
        linesAdded: 1,
        linesRemoved: 1,
      },
    ]);
    expect(result.fileChanges).toEqual({
      added: ['assets/logo.png', 'src/added.ts'],
      modified: ['src/modified.ts'],
      deleted: ['legacy/removed.ts'],
    });

    // The walk asks git about every path the snapshot records -- the binary,
    // the two tombstones and the unchanged file included -- so their presence
    // in the commit can be decided, with the forward-slash path a commit tree
    // is addressed by and the hash the caller gave.
    expect(getFileAtCommit.mock.calls.map((call) => call[1]).sort()).toEqual([
      'assets/logo.png',
      'legacy/removed.ts',
      'legacy/untracked.ts',
      'src/added.ts',
      'src/identical.ts',
      'src/modified.ts',
    ]);
    expect(
      getFileAtCommit.mock.calls.every((call) => call[0] === commitA),
    ).toBe(true);
  });

  it('omits per-file line counts when includeFileList is false', async () => {
    const { handler, commitA, snapshotId } = fixture;

    const result = await handler.compareSnapshotWithGitCommit({
      snapshotId,
      commitHash: commitA,
      includeFileList: false,
    });

    expect(result.differences).toEqual([
      { file: 'assets/logo.png', changeType: 'added' },
      { file: 'legacy/removed.ts', changeType: 'deleted' },
      { file: 'src/added.ts', changeType: 'added' },
      { file: 'src/modified.ts', changeType: 'modified' },
    ]);
    expect(result.fileChanges).toBeUndefined();
  });

  it('reads the commit it was given, not the working tree', async () => {
    const { handler, root, commitA, snapshotId } = fixture;

    // Commit the working tree exactly as snapshot 2 recorded it. Compared
    // against THIS commit every snapshot path is unchanged -- which is the
    // assertion: a comparison that quietly asked about the working tree (or
    // HEAD's status) instead of the named commit would still see the changes
    // it reported a moment ago against commit A, and could not answer [].
    git(root, 'add', '--', 'src/added.ts', 'assets/logo.png');
    git(root, 'commit', '--quiet', '-a', '-m', 'commit B');
    const commitB = git(root, 'rev-parse', 'HEAD');
    expect(commitB).not.toBe(commitA);

    const result = await handler.compareSnapshotWithGitCommit({
      snapshotId,
      commitHash: commitB,
      includeFileList: true,
    });

    expect(result.differences).toEqual([]);
    expect(result.fileChanges).toEqual({
      added: [],
      modified: [],
      deleted: [],
    });
  });

  it('resolves an abbreviated commit hash to the same tree', async () => {
    const { handler, commitA, snapshotId } = fixture;
    const abbreviated = commitA.slice(0, 8);
    expect(abbreviated).not.toBe(commitA);

    const full = await handler.compareSnapshotWithGitCommit({
      snapshotId,
      commitHash: commitA,
      includeFileList: true,
    });
    const short = await handler.compareSnapshotWithGitCommit({
      snapshotId,
      commitHash: abbreviated,
      includeFileList: true,
    });

    // Guard the equality below against passing vacuously.
    expect(full.differences.length).toBeGreaterThan(0);
    expect(short.differences).toEqual(full.differences);
    expect(short.fileChanges).toEqual(full.fileChanges);
  });

  it("rejects a malformed hash before reading anything, with the integration's own message", async () => {
    const { root, handler, manager, gitIntegration, snapshotId } = fixture;
    const getSnapshot = jest.spyOn(manager, 'getSnapshot');
    const getFileAtCommit = jest.spyOn(gitIntegration, 'getFileAtCommit');
    // A second, unspied integration for the message-parity check below: going
    // through the spied instance would put its own calls in the log this test
    // asserts is empty.
    const unrecordedIntegration = new GitIntegration(root);

    for (const bad of ['abc', 'not-a-hash', undefined]) {
      const message = 'Invalid commit hash: "' + String(bad) + '"';

      await expect(
        handler.compareSnapshotWithGitCommit({
          snapshotId,
          commitHash: bad as string,
          includeFileList: true,
        }),
      ).rejects.toThrow(message);

      // Both modes answer a malformed ref with the same message because they
      // apply the same rule; GitIntegration is where the extension's path
      // enforces it, so pin that the two answers really are the same.
      expect(() =>
        unrecordedIntegration.getFileAtCommit(bad as string, 'src/added.ts'),
      ).toThrow(message);
    }

    expect(getSnapshot).not.toHaveBeenCalled();
    expect(getFileAtCommit).not.toHaveBeenCalled();
  });

  it('skips a file the store cannot reconstruct instead of guessing', async () => {
    const { handler, root, commitA } = fixture;
    // The only stub in the suite, and it stands in for the store read alone: a
    // healthy store cannot be asked to fail a reconstruction on demand (the
    // real one answers null when a stored patch no longer applies). Git's side
    // stays real -- the same commit is read through the same GitIntegration.
    const manager = new SnapshotManager(root);
    await manager.initialize();
    jest.spyOn(manager, 'getSnapshot').mockResolvedValue({
      id: 'snapshot-unresolved',
      timestamp: 1,
      description: 'fixture with one unresolvable file',
      files: {
        [path.join('src', 'added.ts')]: {
          diff: 'a patch that does not apply',
          baseSnapshotId: 'snapshot-1',
        },
        [path.join('src', 'modified.ts')]: { content: 'new line\n' },
      },
    } as any);
    jest.spyOn(manager, 'getSnapshotFileContent').mockResolvedValue(null);
    (handler as any).snapshotManager = manager;

    const result = await handler.compareSnapshotWithGitCommit({
      snapshotId: 'snapshot-unresolved',
      commitHash: commitA,
      includeFileList: true,
    });

    // src/added.ts is not in commit A, and src/modified.ts is there with other
    // content -- but neither can be reconstructed, so neither is classified and
    // nothing is reported. Without the guard the walk would crash on the null
    // content, or call the unreconstructable file 'added'.
    expect(result.differences).toEqual([]);
    expect(result.fileChanges).toEqual({
      added: [],
      modified: [],
      deleted: [],
    });
  });

  it('names the snapshot that does not exist', async () => {
    const { handler, commitA } = fixture;
    // The real store announces the missing snapshot directory on stderr; the
    // suite asserts the message the caller sees, so keep that noise out of the
    // report.
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      handler.compareSnapshotWithGitCommit({
        snapshotId: 'missing',
        commitHash: commitA,
      }),
    ).rejects.toThrow('Snapshot missing not found');
  });
});
