/**
 * Regression guard for `git info` / `git branches` reporting (BUG-9).
 *
 * Every getter on GitIntegration swallows a failed `git` invocation and
 * returns `undefined`, so with git unusable the CLI printed
 * "Commit hash: undefined", "Remote URL: undefined", an empty
 * "Current branch: " and an empty "Branches:" list -- and exited 0, as if it
 * had read a real repository. The same output appears for a repository with no
 * commits yet, which is why the two cases must be separated at the source.
 */

import { GitCommands } from '../commands/git';
import { StandaloneHandler } from '../standaloneHandler';
import { getFailure, resetFailure } from '../exitState';
import type { UnifiedClient } from '../unifiedClient';

function clientAnswering(answer: unknown | Error): UnifiedClient {
  return {
    callApi: async () => {
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
  } as unknown as UnifiedClient;
}

/** The shared jest setup replaces console.log/error with jest.fn()s. */
const stdout = (): string =>
  (console.log as jest.Mock).mock.calls
    .map((call) => String(call[0]))
    .join('\n');

const stderr = (): string =>
  (console.error as jest.Mock).mock.calls
    .map((call) => call.map(String).join(' '))
    .join('\n');

describe('git info reporting (BUG-9)', () => {
  beforeEach(() => resetFailure());

  it('never prints undefined for a repository with no commits', async () => {
    const commands = new GitCommands(
      clientAnswering({
        currentBranch: '',
        commitHash: undefined,
        remoteUrl: undefined,
        hasChanges: false,
        branches: [],
      }),
    );

    await commands.getBranchInfo({});

    const output = stdout();
    expect(output).not.toContain('undefined');
    expect(output).toContain('(none)');
    expect(getFailure()).toBe(false);
  });

  it('reports a failure when the git executable cannot be run', async () => {
    const commands = new GitCommands(
      clientAnswering(
        new Error('git is not available: the git executable could not be run'),
      ),
    );

    await commands.getBranchInfo({});

    expect(getFailure()).toBe(true);
    expect(stderr()).toMatch(/git is not available/);
  });

  it('says so when no branches can be listed', async () => {
    const commands = new GitCommands(clientAnswering({ branches: [] }));

    await commands.listBranches({});

    expect(stdout()).toMatch(/no branches/i);
  });
});

describe('standalone handler git availability (BUG-9)', () => {
  function handlerWithGit(git: Record<string, unknown>): StandaloneHandler {
    const handler = new StandaloneHandler();
    (handler as unknown as { gitIntegration: unknown }).gitIntegration = git;
    return handler;
  }

  it('refuses branch info when git cannot be executed', () => {
    const handler = handlerWithGit({
      isGitRepository: () => true,
      isGitAvailable: () => false,
    });

    expect(() => handler.getGitBranchInfo()).toThrow(/git is not available/i);
  });

  it('refuses branch info outside a repository', () => {
    const handler = handlerWithGit({
      isGitRepository: () => false,
      isGitAvailable: () => true,
    });

    expect(() => handler.getGitBranchInfo()).toThrow(/not a git repository/i);
  });

  it('delegates when git is available', () => {
    const handler = handlerWithGit({
      isGitRepository: () => true,
      isGitAvailable: () => true,
      getBranchInfo: () => ({ currentBranch: 'main', branches: ['main'] }),
    });

    expect(handler.getGitBranchInfo()).toMatchObject({
      currentBranch: 'main',
    });
  });
});
