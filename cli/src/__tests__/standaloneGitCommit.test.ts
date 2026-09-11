import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StandaloneHandler } from '../standaloneHandler';
import { useRealFileSystem } from './realFs';

interface FakeGit {
  isGitRepository: jest.Mock;
  isGitAvailable: jest.Mock;
  hasUncommittedChanges: jest.Mock;
  getUntrackedFiles: jest.Mock;
  stageFiles: jest.Mock;
  stageAll: jest.Mock;
  createCommit: jest.Mock;
  createBranch: jest.Mock;
}

function fakeGit(overrides: Partial<FakeGit> = {}): FakeGit {
  return {
    isGitRepository: jest.fn(() => true),
    isGitAvailable: jest.fn(() => true),
    hasUncommittedChanges: jest.fn(() => false),
    getUntrackedFiles: jest.fn(() => []),
    stageFiles: jest.fn(),
    // Kept so the pre-fix implementation can reach createCommit; the fixed
    // implementation must never call it.
    stageAll: jest.fn(),
    createCommit: jest.fn((message: string) => ({
      commitHash: 'deadbeef',
      branch: 'main',
      message,
    })),
    createBranch: jest.fn(),
    ...overrides,
  };
}

describe('standalone git commit from a snapshot', () => {
  let root: string;

  beforeEach(() => {
    useRealFileSystem();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-git-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function handlerWithSnapshot(
    files: Record<string, unknown>,
    git: FakeGit,
  ): StandaloneHandler {
    const handler = new StandaloneHandler();
    (handler as any).workspaceRoot = root;
    (handler as any).gitIntegration = git;
    (handler as any).snapshotManager = {
      getSnapshot: async () => ({
        id: 'snapshot-1',
        description: 'd',
        files,
      }),
      getSnapshotFileContent: async (_id: string, rel: string) =>
        (files[rel] as any)?.content ?? null,
    };
    return handler;
  }

  it('refuses to write over a dirty working tree', async () => {
    const git = fakeGit({ hasUncommittedChanges: jest.fn(() => true) });
    const handler = handlerWithSnapshot(
      { 'kept.txt': { content: 'from snapshot' } },
      git,
    );
    fs.writeFileSync(path.join(root, 'kept.txt'), 'uncommitted work');

    await expect(
      handler.createGitCommitFromSnapshot({ snapshotId: 'snapshot-1' }),
    ).rejects.toThrow(/dirty working tree/i);

    // The uncommitted edit survived: nothing was written, staged or committed.
    expect(fs.readFileSync(path.join(root, 'kept.txt'), 'utf8')).toBe(
      'uncommitted work',
    );
    expect(git.stageFiles).not.toHaveBeenCalled();
    expect(git.createCommit).not.toHaveBeenCalled();
  });

  it('removes files the snapshot records as deleted', async () => {
    const git = fakeGit();
    const handler = handlerWithSnapshot(
      {
        'kept.txt': { content: 'one' },
        'gone.txt': { deleted: true },
      },
      git,
    );
    fs.writeFileSync(path.join(root, 'gone.txt'), 'x');

    await handler.createGitCommitFromSnapshot({ snapshotId: 'snapshot-1' });

    expect(fs.existsSync(path.join(root, 'gone.txt'))).toBe(false);
    const staged = git.stageFiles.mock.calls[0][0] as string[];
    expect(staged).toEqual(expect.arrayContaining(['kept.txt', 'gone.txt']));
  });

  it('leaves untracked clutter out of the commit by default', async () => {
    const git = fakeGit({ getUntrackedFiles: jest.fn(() => ['clutter.tmp']) });
    const handler = handlerWithSnapshot(
      { 'kept.txt': { content: 'one' } },
      git,
    );
    fs.writeFileSync(path.join(root, 'clutter.tmp'), 'noise');

    await handler.createGitCommitFromSnapshot({ snapshotId: 'snapshot-1' });

    const staged = git.stageFiles.mock.calls[0][0] as string[];
    expect(staged).not.toContain('clutter.tmp');
    expect(staged).toContain('kept.txt');
  });

  it('includes untracked files when asked', async () => {
    const git = fakeGit({ getUntrackedFiles: jest.fn(() => ['new.txt']) });
    const handler = handlerWithSnapshot(
      {
        'kept.txt': { content: 'one' },
        'new.txt': { content: 'fresh' },
      },
      git,
    );

    await handler.createGitCommitFromSnapshot({
      snapshotId: 'snapshot-1',
      includeUntracked: true,
    });

    const staged = git.stageFiles.mock.calls[0][0] as string[];
    expect(staged).toContain('new.txt');
  });
});