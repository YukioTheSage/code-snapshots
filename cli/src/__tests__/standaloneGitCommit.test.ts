import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitIntegration } from 'codelapse-core';
import { StandaloneHandler } from '../standaloneHandler';
import { useRealFileSystem } from './realFs';

/**
 * 'git commit from a snapshot' in standalone mode, driven by a REAL repository.
 *
 * The suite used to hand StandaloneHandler a fakeGit double, so the paths it
 * "staged" and the commit it "created" were answers the test itself wrote. It
 * now builds a temporary repository the way the comparison suite does -- local
 * identity, signing off, `execFileSync` for setup -- and lets GitIntegration
 * shell out to git. `jest.spyOn` is used where the test has to see WHICH paths
 * were staged: a spy is a pass-through wrapper, so the real method still runs
 * and still talks to git, and only the call log is synthetic.
 *
 * One thing the double hid is asserted below: `hasUncommittedChanges` counts
 * untracked files, so a real repository carrying clutter never reaches the
 * staging filter at all. The paths a snapshot adds are therefore untracked
 * when git first sees them, which is exactly what the default run excludes.
 */

/** Run git in a fixture repository, and fail the test if it fails. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const SNAPSHOT_ID = 'snapshot-1';

interface CommitFixture {
  root: string;
  handler: StandaloneHandler;
  gitIntegration: GitIntegration;
}

let fixture: CommitFixture;

describe('standalone git commit from a snapshot', () => {
  beforeEach(() => {
    useRealFileSystem();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-gitcommit-'));
    // A real repository with a local identity and no signing, so the fixture
    // commits on a machine with a global git configuration -- or none at all.
    git(root, 'init', '--quiet', '--initial-branch=main');
    git(root, 'config', 'user.name', 'CodeLapse Test');
    git(root, 'config', 'user.email', 'codelapse-test@example.invalid');
    git(root, 'config', 'commit.gpgsign', 'false');

    const gitIntegration = new GitIntegration(root);
    const handler = new StandaloneHandler();
    (handler as any).workspaceRoot = root;
    (handler as any).gitIntegration = gitIntegration;

    fixture = { root, handler, gitIntegration };
  });

  afterEach(() => {
    // A beforeEach failure leaves `fixture` unset; without this guard the
    // TypeError here would mask the real error and leak the temp repository.
    if (fixture) {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  /** Commit files so the working tree is clean when a test starts. */
  function commitFiles(files: Record<string, string>): string {
    for (const [relativePath, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(fixture.root, relativePath), content);
    }
    git(fixture.root, 'add', '--', ...Object.keys(files));
    git(fixture.root, 'commit', '--quiet', '-m', 'baseline');
    return git(fixture.root, 'rev-parse', 'HEAD');
  }

  /** Lines git printed, split the way git printed them. */
  function gitLines(...args: string[]): string[] {
    return git(fixture.root, ...args)
      .split(/\r?\n/)
      .filter(Boolean);
  }

  /** The paths a commit's tree contains, as git itself reports them. */
  function treePaths(commit: string): string[] {
    return gitLines('ls-tree', '-r', '--name-only', commit);
  }

  /**
   * The snapshot store alone is stubbed: a healthy store cannot be asked for a
   * snapshot that exists only in a test, and the snapshot's content is the
   * input this suite drives git's write path with. Git stays real.
   */
  function handlerWithSnapshot(
    files: Record<string, unknown>,
  ): StandaloneHandler {
    const handler = fixture.handler;
    (handler as any).snapshotManager = {
      getSnapshot: async () => ({
        id: SNAPSHOT_ID,
        description: 'd',
        files,
      }),
      getSnapshotFileContent: async (_id: string, rel: string) =>
        (files[rel] as any)?.content ?? null,
    };
    return handler;
  }

  it('refuses to write over a dirty working tree', async () => {
    const { root, gitIntegration } = fixture;
    const baseCommit = commitFiles({ 'kept.txt': 'committed' });

    // The user's own uncommitted edit, in the repository the handler uses.
    fs.writeFileSync(path.join(root, 'kept.txt'), 'uncommitted work');

    const stageFiles = jest.spyOn(gitIntegration, 'stageFiles');
    const stageAll = jest.spyOn(gitIntegration, 'stageAll');
    const createCommit = jest.spyOn(gitIntegration, 'createCommit');
    const handler = handlerWithSnapshot({
      'kept.txt': { content: 'from snapshot' },
    });

    await expect(
      handler.createGitCommitFromSnapshot({ snapshotId: SNAPSHOT_ID }),
    ).rejects.toThrow(/dirty working tree/i);

    // The uncommitted edit survived: nothing was written, staged or committed.
    expect(fs.readFileSync(path.join(root, 'kept.txt'), 'utf8')).toBe(
      'uncommitted work',
    );
    expect(stageFiles).not.toHaveBeenCalled();
    expect(stageAll).not.toHaveBeenCalled();
    expect(createCommit).not.toHaveBeenCalled();
    // A git fact rather than a mock fact: HEAD did not move.
    expect(git(root, 'rev-parse', 'HEAD')).toBe(baseCommit);
  });

  it('removes files the snapshot records as deleted', async () => {
    const { root, gitIntegration } = fixture;
    commitFiles({ 'kept.txt': 'one', 'gone.txt': 'x' });

    const stageFiles = jest.spyOn(gitIntegration, 'stageFiles');
    const stageAll = jest.spyOn(gitIntegration, 'stageAll');
    const handler = handlerWithSnapshot({
      'kept.txt': { content: 'one' },
      'gone.txt': { deleted: true },
    });

    const result = await handler.createGitCommitFromSnapshot({
      snapshotId: SNAPSHOT_ID,
    });

    expect(fs.existsSync(path.join(root, 'gone.txt'))).toBe(false);
    // `stageAll` is what the pre-fix implementation called; a real one would
    // now run `git add -A` if the handler still went through it. Asserted
    // before the staging log is dereferenced, so the regression reports itself
    // instead of surfacing as a TypeError on an empty call list.
    expect(stageAll).not.toHaveBeenCalled();
    const staged = stageFiles.mock.calls[0][0];
    expect(staged).toEqual(expect.arrayContaining(['kept.txt', 'gone.txt']));

    // What the repository recorded, which the double could only pretend: the
    // tombstone is gone from the tree, the message is the handler's, and the
    // hash the handler reports is the commit git actually made.
    expect(treePaths('HEAD')).toEqual(['kept.txt']);
    expect(git(root, 'log', '-1', '--format=%s')).toBe(
      `Snapshot ${SNAPSHOT_ID}: d`,
    );
    expect(result.commitHash).toBe(git(root, 'rev-parse', 'HEAD'));
    expect(result.branch).toBe('main');
  });

  it('leaves untracked files out of the commit by default', async () => {
    const { gitIntegration } = fixture;
    commitFiles({ 'kept.txt': 'old' });

    const stageFiles = jest.spyOn(gitIntegration, 'stageFiles');
    const stageAll = jest.spyOn(gitIntegration, 'stageAll');
    const handler = handlerWithSnapshot({
      'kept.txt': { content: 'one' },
      'new.txt': { content: 'fresh' },
    });

    await handler.createGitCommitFromSnapshot({ snapshotId: SNAPSHOT_ID });

    // new.txt is not in git yet, so once the handler writes it git reports it
    // untracked and the default run leaves it out; the tracked change is what
    // gets staged and committed.
    expect(stageAll).not.toHaveBeenCalled();
    const staged = stageFiles.mock.calls[0][0];
    expect(staged).toContain('kept.txt');
    expect(staged).not.toContain('new.txt');
    expect(treePaths('HEAD')).toEqual(['kept.txt']);
  });

  it('includes untracked files when asked', async () => {
    const { root, gitIntegration } = fixture;
    commitFiles({ 'kept.txt': 'old' });

    const stageFiles = jest.spyOn(gitIntegration, 'stageFiles');
    const stageAll = jest.spyOn(gitIntegration, 'stageAll');
    const handler = handlerWithSnapshot({
      'kept.txt': { content: 'one' },
      'new.txt': { content: 'fresh' },
    });

    await handler.createGitCommitFromSnapshot({
      snapshotId: SNAPSHOT_ID,
      includeUntracked: true,
    });

    expect(stageAll).not.toHaveBeenCalled();
    const staged = stageFiles.mock.calls[0][0];
    expect(staged).toContain('new.txt');
    expect(treePaths('HEAD')).toEqual(['kept.txt', 'new.txt']);
    expect(git(root, 'show', 'HEAD:new.txt')).toBe('fresh');
  });

  it('refuses over untracked clutter, because git status counts it', async () => {
    const { root, gitIntegration } = fixture;
    const baseCommit = commitFiles({ 'kept.txt': 'old' });
    fs.writeFileSync(path.join(root, 'clutter.tmp'), 'noise');

    const stageFiles = jest.spyOn(gitIntegration, 'stageFiles');
    const handler = handlerWithSnapshot({ 'kept.txt': { content: 'one' } });

    // The old double could hold an untracked file and still report a clean
    // tree. A real one cannot: `git status --porcelain` lists the clutter, so
    // the guard refuses before the staging filter -- the code path the old
    // clutter case believed it was covering -- is ever reached.
    await expect(
      handler.createGitCommitFromSnapshot({ snapshotId: SNAPSHOT_ID }),
    ).rejects.toThrow(/dirty working tree/i);

    expect(stageFiles).not.toHaveBeenCalled();
    expect(git(root, 'rev-parse', 'HEAD')).toBe(baseCommit);
    expect(fs.readFileSync(path.join(root, 'clutter.tmp'), 'utf8')).toBe(
      'noise',
    );
  });

  it('commits onto a branch it creates when asked', async () => {
    const { root, gitIntegration } = fixture;
    const baseCommit = commitFiles({ 'kept.txt': 'old' });

    const stageAll = jest.spyOn(gitIntegration, 'stageAll');
    const handler = handlerWithSnapshot({ 'kept.txt': { content: 'one' } });
    await handler.createGitCommitFromSnapshot({
      snapshotId: SNAPSHOT_ID,
      createBranch: 'snapshot-branch',
    });

    expect(git(root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(
      'snapshot-branch',
    );
    expect(git(root, 'rev-parse', 'HEAD')).not.toBe(baseCommit);
    expect(stageAll).not.toHaveBeenCalled();
    expect(treePaths('HEAD')).toEqual(['kept.txt']);
    expect(
      gitLines('branch', '--list', '--format=%(refname:lstrip=2)').sort(),
    ).toEqual(['main', 'snapshot-branch']);
  });
});
