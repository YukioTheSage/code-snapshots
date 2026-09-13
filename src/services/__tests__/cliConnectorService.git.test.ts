/**
 * Tests for the git IPC methods of CliConnectorService.
 *
 * The CLI (`cli/src/commands/git.ts`) reads these results field by field, so
 * the assertions here pin the result *shapes* — `branches` as an array of
 * strings, a non-empty commit hash/branch/message, a non-empty snapshot id and
 * description — and not just the fact that a handler ran.
 *
 * The VS Code Git API is mocked: no test needs a real repository. Requests go
 * through `handleCliRequest`, so the dispatcher's method wiring is covered too.
 */

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CliConnectorService } from '../cliConnectorService';
import { TerminalApiService } from '../terminalApiService';

jest.mock('../terminalApiService');
jest.mock('../semanticSearchService');
jest.mock('../enhancedCodeChunker', () => ({
  EnhancedCodeChunker: jest.fn().mockImplementation(() => ({
    chunkFileEnhanced: jest.fn().mockResolvedValue([]),
  })),
}));
jest.mock('../queryProcessor');
jest.mock('../resultManager');
jest.mock('../qualityMetricsCalculator');

/** A temp-dir root keeps the connection file the service writes out of the repo. */
const WORKSPACE_ROOT = path.join(os.tmpdir(), 'codelapse-cli-git-fixture');

// RefType members of the (ambient) Git API types: src/types/git.d.ts has no
// runtime module, so the numeric values are repeated here.
const REF_TYPE_HEAD = 0;
const REF_TYPE_REMOTE_HEAD = 1;

const HEAD_COMMIT = 'a'.repeat(40);
const NEW_COMMIT = 'c'.repeat(40);

interface MockRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD: unknown;
    refs: unknown[];
    remotes: unknown[];
    submodules: unknown[];
    worktrees: unknown[];
    rebaseCommit: unknown;
    mergeChanges: unknown[];
    indexChanges: unknown[];
    workingTreeChanges: unknown[];
    untrackedChanges: unknown[];
  };
  getBranches: jest.Mock;
  add: jest.Mock;
  commit: jest.Mock;
  createBranch: jest.Mock;
  deleteBranch: jest.Mock;
  checkout: jest.Mock;
  push: jest.Mock;
  show: jest.Mock;
  getCommit: jest.Mock;
}

function branchRef(name: string, commit = HEAD_COMMIT) {
  return { type: REF_TYPE_HEAD, name, commit };
}

function createMockRepository(
  overrides: Partial<MockRepository> = {},
): MockRepository {
  return {
    rootUri: vscode.Uri.file(WORKSPACE_ROOT),
    state: {
      HEAD: branchRef('main'),
      refs: [],
      remotes: [
        {
          name: 'origin',
          fetchUrl: 'https://example.com/repo.git',
          isReadOnly: false,
        },
      ],
      submodules: [],
      worktrees: [],
      rebaseCommit: undefined,
      mergeChanges: [],
      indexChanges: [],
      workingTreeChanges: [],
      untrackedChanges: [],
    },
    getBranches: jest.fn().mockResolvedValue([
      branchRef('main'),
      branchRef('feature/x'),
      // Remote heads are not local branches and must be filtered out.
      { type: REF_TYPE_REMOTE_HEAD, name: 'origin/main' },
      // `Ref.name` is optional; nameless refs must be filtered out.
      { type: REF_TYPE_HEAD },
      branchRef('release'),
    ]),
    add: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    createBranch: jest.fn().mockResolvedValue(undefined),
    deleteBranch: jest.fn().mockResolvedValue(undefined),
    checkout: jest.fn().mockResolvedValue(undefined),
    push: jest.fn().mockResolvedValue(undefined),
    show: jest.fn().mockRejectedValue(new Error('path does not exist')),
    getCommit: jest
      .fn()
      .mockResolvedValue({ hash: NEW_COMMIT, message: 'm', parents: [] }),
    ...overrides,
  };
}

/**
 * Wire a fake `vscode.git` extension into the shared vscode mock.
 */
function installGitExtension(
  repository: MockRepository | null,
  options: { enabled?: boolean; apiThrows?: string } = {},
) {
  const getRepository = jest.fn().mockReturnValue(repository);
  const getAPI = jest.fn(() => {
    if (options.apiThrows) {
      throw new Error(options.apiThrows);
    }
    return { getRepository, repositories: repository ? [repository] : [] };
  });

  (vscode.extensions.getExtension as jest.Mock).mockReturnValue({
    isActive: true,
    activate: jest.fn().mockResolvedValue(undefined),
    exports: {
      enabled: options.enabled ?? true,
      onDidChangeEnablement: jest.fn(),
      getAPI,
    },
  });

  return { getAPI, getRepository };
}

describe('CliConnectorService git methods', () => {
  let service: CliConnectorService;
  let terminalApi: {
    getSnapshot: jest.Mock;
    getSnapshotFileContent: jest.Mock;
    restoreSnapshot: jest.Mock;
    takeSnapshot: jest.Mock;
  };

  const context = {
    extension: { packageJSON: { version: '0.0.0-test' } },
  } as unknown as vscode.ExtensionContext;

  beforeEach(() => {
    jest.clearAllMocks();

    (
      vscode.workspace as unknown as { workspaceFolders: unknown[] }
    ).workspaceFolders = [
      { uri: vscode.Uri.file(WORKSPACE_ROOT), name: 'fixture', index: 0 },
    ];

    terminalApi = {
      getSnapshot: jest.fn().mockResolvedValue(null),
      getSnapshotFileContent: jest.fn().mockResolvedValue(null),
      restoreSnapshot: jest.fn().mockResolvedValue({
        success: true,
        filesRestored: 0,
        filesSkipped: 0,
      }),
      takeSnapshot: jest.fn(),
    };

    service = new CliConnectorService(
      terminalApi as unknown as TerminalApiService,
      context,
    );
  });

  afterEach(() => {
    service.dispose();
  });

  /** Send a request exactly as the CLI's IPC client does. */
  async function callApi(method: string, data: unknown = {}) {
    return await (
      service as unknown as {
        handleCliRequest: (message: unknown) => Promise<{
          success: boolean;
          result?: any;
          error?: string;
        }>;
      }
    ).handleCliRequest({ id: 'test-request', method, data });
  }

  describe('refusal paths', () => {
    it('refuses when the workspace is not a Git repository', async () => {
      installGitExtension(null);

      const response = await callApi('getGitBranchInfo');

      expect(response.success).toBe(false);
      expect(response.error).toContain(
        'No Git repository found for this workspace',
      );
      expect(response.error).toContain('inside a Git repository');
    });

    it('refuses when no workspace folder is open', async () => {
      installGitExtension(createMockRepository());
      (
        vscode.workspace as unknown as { workspaceFolders: unknown[] }
      ).workspaceFolders = [];

      const response = await callApi('getGitBranchInfo');

      expect(response.success).toBe(false);
      expect(response.error).toContain('No workspace folder is open');
    });

    it('refuses when the Git extension is not installed', async () => {
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

      const response = await callApi('listBranches');

      expect(response.success).toBe(false);
      expect(response.error).toContain(
        'VS Code Git extension is not available',
      );
    });

    it('refuses when the Git extension is disabled', async () => {
      installGitExtension(createMockRepository(), { enabled: false });

      const response = await callApi('listBranches');

      expect(response.success).toBe(false);
      expect(response.error).toContain('Git extension is disabled');
    });

    it('refuses when getAPI throws (disabled git)', async () => {
      installGitExtension(createMockRepository(), {
        apiThrows: 'Git is not enabled',
      });

      const response = await callApi('listBranches');

      expect(response.success).toBe(false);
      expect(response.error).toContain('Failed to obtain the VS Code Git API');
      expect(response.error).toContain('Git is not enabled');
    });

    it('refuses to report branch info for a repository without commits', async () => {
      const repository = createMockRepository();
      repository.state.HEAD = undefined;
      installGitExtension(repository);

      const response = await callApi('getGitBranchInfo');

      expect(response.success).toBe(false);
      expect(response.error).toContain('has no commits yet');
    });
  });

  describe('getGitBranchInfo', () => {
    it('returns branch info with branches as an array of strings', async () => {
      installGitExtension(createMockRepository());

      const response = await callApi('getGitBranchInfo');

      expect(response.success).toBe(true);
      expect(response.result).toEqual({
        currentBranch: 'main',
        commitHash: HEAD_COMMIT,
        remoteUrl: 'https://example.com/repo.git',
        hasChanges: false,
        branches: ['main', 'feature/x', 'release'],
      });
      expect(Array.isArray(response.result.branches)).toBe(true);
      expect(
        response.result.branches.every(
          (branch: unknown) => typeof branch === 'string',
        ),
      ).toBe(true);
    });

    it('reports changes when the working tree has untracked files', async () => {
      const repository = createMockRepository();
      repository.state.untrackedChanges = [
        { uri: vscode.Uri.file(path.join(WORKSPACE_ROOT, 'scratch.ts')) },
      ];
      installGitExtension(repository);

      const response = await callApi('getGitBranchInfo');

      expect(response.result.hasChanges).toBe(true);
    });

    it('prefers the origin remote over other remotes', async () => {
      const repository = createMockRepository();
      repository.state.remotes = [
        { name: 'upstream', fetchUrl: 'https://example.com/upstream.git' },
        { name: 'origin', fetchUrl: 'https://example.com/origin.git' },
      ];
      installGitExtension(repository);

      const response = await callApi('getGitBranchInfo');

      expect(response.result.remoteUrl).toBe('https://example.com/origin.git');
    });

    it('reports HEAD as the branch name while detached', async () => {
      const repository = createMockRepository();
      repository.state.HEAD = { type: REF_TYPE_HEAD, commit: HEAD_COMMIT };
      installGitExtension(repository);

      const response = await callApi('getGitBranchInfo');

      expect(response.result.currentBranch).toBe('HEAD');
      expect(response.result.commitHash).toBe(HEAD_COMMIT);
    });
  });

  describe('listBranches', () => {
    it('returns local branch names as strings', async () => {
      const repository = createMockRepository();
      installGitExtension(repository);

      const response = await callApi('listBranches');

      expect(response.success).toBe(true);
      expect(response.result.branches).toEqual([
        'main',
        'feature/x',
        'release',
      ]);
      expect(
        response.result.branches.every(
          (branch: unknown) => typeof branch === 'string',
        ),
      ).toBe(true);
      expect(repository.getBranches).toHaveBeenCalledWith({});
    });
  });

  describe('createBranch', () => {
    it('creates and optionally checks out the branch', async () => {
      const repository = createMockRepository();
      installGitExtension(repository);

      const response = await callApi('createBranch', {
        name: 'feature/new',
        checkout: true,
      });

      expect(response.success).toBe(true);
      expect(repository.createBranch).toHaveBeenCalledWith('feature/new', true);
    });

    it('rejects a missing branch name', async () => {
      installGitExtension(createMockRepository());

      const response = await callApi('createBranch', { checkout: true });

      expect(response.success).toBe(false);
      expect(response.error).toContain('"name"');
    });

    it('rejects a malformed branch name', async () => {
      installGitExtension(createMockRepository());

      const response = await callApi('createBranch', {
        name: 42,
        checkout: true,
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('"name"');
    });

    it('surfaces a clear message when git refuses', async () => {
      const repository = createMockRepository();
      repository.createBranch.mockRejectedValue(
        new Error('fatal: a branch named "main" already exists'),
      );
      installGitExtension(repository);

      const response = await callApi('createBranch', {
        name: 'main',
        checkout: false,
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('Failed to create branch "main"');
      expect(response.error).toContain('already exists');
    });
  });

  describe('switchBranch', () => {
    it('checks out the requested branch', async () => {
      const repository = createMockRepository();
      installGitExtension(repository);

      const response = await callApi('switchBranch', { name: 'release' });

      expect(response.success).toBe(true);
      expect(repository.checkout).toHaveBeenCalledWith('release');
    });

    it('surfaces a clear message when the checkout fails', async () => {
      const repository = createMockRepository();
      repository.checkout.mockRejectedValue(
        new Error('local changes would be overwritten'),
      );
      installGitExtension(repository);

      const response = await callApi('switchBranch', { name: 'release' });

      expect(response.success).toBe(false);
      expect(response.error).toContain('Failed to switch to branch "release"');
    });
  });

  describe('deleteBranch', () => {
    it('deletes the branch with the requested force flag', async () => {
      const repository = createMockRepository();
      installGitExtension(repository);

      const response = await callApi('deleteBranch', {
        name: 'feature/x',
        force: true,
      });

      expect(response.success).toBe(true);
      expect(repository.deleteBranch).toHaveBeenCalledWith('feature/x', true);
    });

    it('defaults force to false', async () => {
      const repository = createMockRepository();
      installGitExtension(repository);

      await callApi('deleteBranch', { name: 'feature/x' });

      expect(repository.deleteBranch).toHaveBeenCalledWith('feature/x', false);
    });
  });

  describe('createGitCommitFromSnapshot', () => {
    const snapshot = {
      id: 'snap-1',
      timestamp: Date.now(),
      description: 'Refactor the parser',
      files: {
        'src/a.ts': { content: 'a\n' },
        'src/b.ts': { content: 'b\n' },
        'legacy/gone.ts': { deleted: true },
      },
    };

    beforeEach(() => {
      terminalApi.getSnapshot.mockResolvedValue(snapshot);
      terminalApi.restoreSnapshot.mockResolvedValue({
        success: true,
        filesRestored: 2,
        filesSkipped: 0,
      });
    });

    it('restores, stages explicit paths, commits and reports git state', async () => {
      const repository = createMockRepository();
      installGitExtension(repository);

      const response = await callApi('createGitCommitFromSnapshot', {
        snapshotId: 'snap-1',
        includeUntracked: true,
        push: false,
      });

      expect(response.success).toBe(true);
      // The CLI prints all three, so every one must be non-empty.
      expect(response.result.commitHash).toBe(NEW_COMMIT);
      expect(response.result.branch).toBe('main');
      expect(response.result.message).toBe(
        'Snapshot: Refactor the parser [snap-1]',
      );
      expect(response.result.commitHash.length).toBeGreaterThan(0);
      expect(response.result.branch.length).toBeGreaterThan(0);
      expect(response.result.message.length).toBeGreaterThan(0);

      expect(terminalApi.restoreSnapshot).toHaveBeenCalledWith('snap-1', {
        silent: true,
      });
      // Deleted files are skipped and `add` never receives an empty array:
      // `add([])` runs `git add --` and stages nothing.
      expect(repository.add).toHaveBeenCalledWith(['src/a.ts', 'src/b.ts']);
      expect(repository.commit).toHaveBeenCalledWith(
        'Snapshot: Refactor the parser [snap-1]',
      );
      expect(repository.push).not.toHaveBeenCalled();
    });

    it('accepts a caller-supplied commit message', async () => {
      const repository = createMockRepository();
      installGitExtension(repository);

      const response = await callApi('createGitCommitFromSnapshot', {
        snapshotId: 'snap-1',
        commitMessage: 'feat: parser rewrite',
        includeUntracked: false,
      });

      expect(response.result.message).toBe('feat: parser rewrite');
      expect(repository.commit).toHaveBeenCalledWith('feat: parser rewrite');
    });

    it('creates and checks out the requested branch first', async () => {
      const repository = createMockRepository();
      // The Git extension's cached state can still point at the previous branch
      // right after a checkout, so the branch that was created has to win.
      repository.state.HEAD = branchRef('main');
      installGitExtension(repository);

      const response = await callApi('createGitCommitFromSnapshot', {
        snapshotId: 'snap-1',
        includeUntracked: true,
        createBranch: 'feature/from-snapshot',
        push: true,
      });

      expect(repository.createBranch).toHaveBeenCalledWith(
        'feature/from-snapshot',
        true,
      );
      expect(response.result.branch).toBe('feature/from-snapshot');
      expect(repository.push).toHaveBeenCalledWith(
        undefined,
        'feature/from-snapshot',
        true,
      );
    });

    it('leaves untracked files out of the commit unless requested', async () => {
      const repository = createMockRepository();
      repository.state.untrackedChanges = [
        { uri: vscode.Uri.file(path.join(WORKSPACE_ROOT, 'src/b.ts')) },
      ];
      installGitExtension(repository);

      await callApi('createGitCommitFromSnapshot', {
        snapshotId: 'snap-1',
        includeUntracked: false,
        push: false,
      });

      expect(repository.add).toHaveBeenCalledWith(['src/a.ts']);

      repository.add.mockClear();

      await callApi('createGitCommitFromSnapshot', {
        snapshotId: 'snap-1',
        includeUntracked: true,
        push: false,
      });

      expect(repository.add).toHaveBeenCalledWith(['src/a.ts', 'src/b.ts']);
    });

    it('skips snapshot files outside the repository root', async () => {
      terminalApi.getSnapshot.mockResolvedValue({
        id: 'snap-1',
        timestamp: Date.now(),
        description: 'Refactor the parser',
        files: {
          'src/a.ts': { content: 'a\n' },
          [path.join('..', 'outside.ts')]: { content: 'outside\n' },
        },
      });
      const repository = createMockRepository();
      installGitExtension(repository);

      await callApi('createGitCommitFromSnapshot', {
        snapshotId: 'snap-1',
        includeUntracked: true,
      });

      // `add` is never handed a path git cannot stage.
      expect(repository.add).toHaveBeenCalledWith(['src/a.ts']);
    });

    it('never calls add with an empty array when everything is deleted', async () => {
      terminalApi.getSnapshot.mockResolvedValue({
        id: 'snap-empty',
        timestamp: Date.now(),
        description: 'All files deleted',
        files: { 'src/a.ts': { deleted: true } },
      });
      const repository = createMockRepository();
      installGitExtension(repository);

      await callApi('createGitCommitFromSnapshot', {
        snapshotId: 'snap-empty',
        includeUntracked: true,
      });

      expect(repository.add).not.toHaveBeenCalled();
    });

    it('throws a clear error when the snapshot does not exist', async () => {
      installGitExtension(createMockRepository());
      terminalApi.getSnapshot.mockResolvedValue(null);

      const response = await callApi('createGitCommitFromSnapshot', {
        snapshotId: 'missing-snapshot',
        includeUntracked: true,
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('Snapshot missing-snapshot not found');
    });

    it('reports a failed restore instead of committing', async () => {
      terminalApi.restoreSnapshot.mockResolvedValue({
        success: false,
        filesRestored: 0,
        filesSkipped: 0,
        error: 'disk on fire',
      });
      const repository = createMockRepository();
      installGitExtension(repository);

      const response = await callApi('createGitCommitFromSnapshot', {
        snapshotId: 'snap-1',
        includeUntracked: true,
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('Failed to restore snapshot snap-1');
      expect(response.error).toContain('disk on fire');
      expect(repository.commit).not.toHaveBeenCalled();
    });

    it('rejects a missing snapshotId', async () => {
      installGitExtension(createMockRepository());

      const response = await callApi('createGitCommitFromSnapshot', {});

      expect(response.success).toBe(false);
      expect(response.error).toContain('"snapshotId"');
    });
  });

  describe('autoSnapshotBeforeGitOperation', () => {
    it('returns a snapshot with a non-empty id and description', async () => {
      installGitExtension(createMockRepository());
      terminalApi.takeSnapshot.mockResolvedValue({
        success: true,
        snapshot: {
          id: 'snapshot-123',
          timestamp: Date.now(),
          description: 'Auto-snapshot before merge',
          files: {},
        },
      });

      const response = await callApi('autoSnapshotBeforeGitOperation', {
        operation: 'merge',
        description: 'Auto-snapshot before merge',
        includeUntracked: true,
      });

      expect(response.success).toBe(true);
      expect(response.result.snapshot.id).toBe('snapshot-123');
      expect(response.result.snapshot.description).toBe(
        'Auto-snapshot before merge',
      );
      expect(response.result.snapshot.id.length).toBeGreaterThan(0);
      expect(response.result.snapshot.description.length).toBeGreaterThan(0);
      expect(terminalApi.takeSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Auto-snapshot before merge',
          silent: true,
          // 'auto-snapshot' is not in treeView's classifier list, so the
          // snapshot this path created was filed under Manual. The tag set is
          // the contract. 'auto' is the tag the classifier reads.
          tags: ['auto', 'git'],
        }),
      );
    });

    it('generates a description when the caller omits one', async () => {
      installGitExtension(createMockRepository());
      terminalApi.takeSnapshot.mockResolvedValue({
        success: true,
        snapshot: {
          id: 'snapshot-456',
          timestamp: Date.now(),
          description: 'Auto-snapshot before rebase',
          files: {},
        },
      });

      const response = await callApi('autoSnapshotBeforeGitOperation', {
        operation: 'rebase',
        includeUntracked: false,
      });

      expect(response.success).toBe(true);
      expect(terminalApi.takeSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Auto-snapshot before rebase',
        }),
      );
    });

    it('surfaces a failed snapshot instead of reporting a fake one', async () => {
      installGitExtension(createMockRepository());
      terminalApi.takeSnapshot.mockResolvedValue({
        success: false,
        error: 'No workspace folder open',
      });

      const response = await callApi('autoSnapshotBeforeGitOperation', {
        operation: 'pull',
        description: 'before pull',
        includeUntracked: false,
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain(
        'Failed to take a snapshot before "pull"',
      );
      expect(response.error).toContain('No workspace folder open');
    });

    it('refuses a snapshot without an id or description', async () => {
      installGitExtension(createMockRepository());
      terminalApi.takeSnapshot.mockResolvedValue({
        success: true,
        snapshot: { id: '', timestamp: Date.now(), description: '', files: {} },
      });

      const response = await callApi('autoSnapshotBeforeGitOperation', {
        operation: 'merge',
        description: 'before merge',
        includeUntracked: false,
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('without an id or description');
    });
  });

  describe('compareSnapshotWithGitCommit', () => {
    const snapshot = {
      id: 'snap-2',
      timestamp: Date.now(),
      description: 'Before the rewrite',
      files: {
        'src/added.ts': { content: 'one\ntwo\n' },
        'src/modified.ts': { diff: 'patch', baseSnapshotId: 'snap-1' },
        'src/identical.ts': { content: 'same\n' },
        'legacy/removed.ts': { deleted: true },
        'assets/logo.png': { isBinary: true },
      },
    };

    beforeEach(() => {
      terminalApi.getSnapshot.mockResolvedValue(snapshot);
      terminalApi.getSnapshotFileContent.mockImplementation(
        async (_snapshotId: string, filePath: string) => {
          switch (filePath) {
            case 'src/added.ts':
              return 'one\ntwo\n';
            case 'src/modified.ts':
              return 'new line\n';
            case 'src/identical.ts':
              return 'same\n';
            default:
              return null;
          }
        },
      );
    });

    function installRepositoryWithCommit() {
      const repository = createMockRepository();
      repository.show.mockImplementation(
        async (_ref: string, repositoryPath: string) => {
          switch (repositoryPath) {
            case 'src/modified.ts':
              return 'old line\n';
            case 'src/identical.ts':
              return 'same\n';
            case 'legacy/removed.ts':
              return 'gone one\ngone two\n';
            default:
              throw new Error(
                `fatal: path '${repositoryPath}' does not exist in '${HEAD_COMMIT}'`,
              );
          }
        },
      );
      installGitExtension(repository);
      return repository;
    }

    it('validates the commit hash', async () => {
      installRepositoryWithCommit();

      const response = await callApi('compareSnapshotWithGitCommit', {
        snapshotId: 'snap-2',
        commitHash: 'not-a-hash',
        includeFileList: true,
      });

      expect(response.success).toBe(false);
      expect(response.error).toBe('Invalid commit hash: "not-a-hash"');
      // The repository must not be queried with a ref that was never validated.
      expect(terminalApi.getSnapshot).not.toHaveBeenCalled();
    });

    it('rejects a missing commit hash', async () => {
      installRepositoryWithCommit();

      const response = await callApi('compareSnapshotWithGitCommit', {
        snapshotId: 'snap-2',
        includeFileList: true,
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('Invalid commit hash');
    });

    it('classifies added, modified and deleted files', async () => {
      installRepositoryWithCommit();

      const response = await callApi('compareSnapshotWithGitCommit', {
        snapshotId: 'snap-2',
        commitHash: HEAD_COMMIT,
        includeFileList: true,
      });

      expect(response.success).toBe(true);
      expect(response.result.differences).toEqual([
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
      expect(response.result.fileChanges).toEqual({
        added: expect.arrayContaining(['src/added.ts', 'assets/logo.png']),
        modified: ['src/modified.ts'],
        deleted: ['legacy/removed.ts'],
      });
      expect(response.result.fileChanges.added).toHaveLength(2);
    });

    it('omits per-file line counts when includeFileList is false', async () => {
      installRepositoryWithCommit();

      const response = await callApi('compareSnapshotWithGitCommit', {
        snapshotId: 'snap-2',
        commitHash: HEAD_COMMIT,
        includeFileList: false,
      });

      expect(response.success).toBe(true);
      expect(response.result.differences).toEqual([
        { file: 'assets/logo.png', changeType: 'added' },
        { file: 'legacy/removed.ts', changeType: 'deleted' },
        { file: 'src/added.ts', changeType: 'added' },
        { file: 'src/modified.ts', changeType: 'modified' },
      ]);
      expect(response.result.fileChanges).toBeUndefined();
    });

    it('throws a clear error when the snapshot does not exist', async () => {
      installRepositoryWithCommit();
      terminalApi.getSnapshot.mockResolvedValue(null);

      const response = await callApi('compareSnapshotWithGitCommit', {
        snapshotId: 'missing',
        commitHash: HEAD_COMMIT,
        includeFileList: true,
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('Snapshot missing not found');
    });
  });

  describe('injected Git API', () => {
    it('uses the Git API passed to the constructor without the extension', async () => {
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
      const repository = createMockRepository();

      const injected = new CliConnectorService(
        terminalApi as unknown as TerminalApiService,
        context,
        undefined,
        { getRepository: jest.fn().mockReturnValue(repository) } as any,
      );

      try {
        const response = await (
          injected as unknown as {
            handleCliRequest: (message: unknown) => Promise<{
              success: boolean;
              result?: any;
            }>;
          }
        ).handleCliRequest({
          id: 'injected',
          method: 'listBranches',
          data: {},
        });

        expect(response.success).toBe(true);
        expect(response.result.branches).toEqual([
          'main',
          'feature/x',
          'release',
        ]);
      } finally {
        injected.dispose();
      }
    });
  });

  describe('unknown methods', () => {
    it('still rejects methods the dispatcher does not implement', async () => {
      installGitExtension(createMockRepository());

      const response = await callApi('definitelyNotAMethod');

      expect(response.success).toBe(false);
      expect(response.error).toBe('Unknown method: definitelyNotAMethod');
    });
  });
});
