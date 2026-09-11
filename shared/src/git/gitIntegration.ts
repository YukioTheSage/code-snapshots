import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { GitInfo, GitCommitResult, GitBranchInfo } from '../types/snapshot';

/** Regex for validating branch names (no spaces or shell-special chars) */
const BRANCH_NAME_REGEX = /^[a-zA-Z0-9._/-]+$/;

/**
 * Standalone Git integration
 * Uses command-line git to get repository information and perform write operations
 */
export class GitIntegration {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Check if the workspace is a Git repository
   */
  public isGitRepository(): boolean {
    try {
      const gitDir = path.join(this.workspaceRoot, '.git');
      return fs.existsSync(gitDir);
    } catch {
      return false;
    }
  }

  /**
   * Whether the `git` executable can actually be run here.
   *
   * Every getter below swallows a failed invocation and returns `undefined`,
   * which made "git is not installed / not runnable" indistinguishable from
   * "this repository has no commits yet": `codelapse git info` printed
   * `Commit hash: undefined` for both and exited 0. Callers that present
   * results to a user can check this first and report the real problem.
   */
  public isGitAvailable(): boolean {
    try {
      execFileSync('git', ['--version'], {
        stdio: ['pipe', 'pipe', 'ignore'],
        encoding: 'utf8',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current Git information
   */
  public getGitInfo(): GitInfo | null {
    if (!this.isGitRepository()) {
      return null;
    }

    try {
      const branch = this.getCurrentBranch();
      const commitHash = this.getCurrentCommit();
      const isDirty = this.hasUncommittedChanges();
      const remoteUrl = this.getRemoteUrl();

      return {
        branch,
        commitHash,
        isDirty,
        remoteUrl,
      };
    } catch (error) {
      console.error('Error getting Git info:', error);
      return null;
    }
  }

  /**
   * Get current branch name
   */
  public getCurrentBranch(): string | undefined {
    try {
      const result = execFileSync(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        {
          cwd: this.workspaceRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        },
      );
      return result.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Get current commit hash
   */
  public getCurrentCommit(): string | undefined {
    try {
      const result = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return result.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Get short commit hash (7 characters)
   */
  public getCurrentCommitShort(): string | undefined {
    try {
      const result = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return result.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Check if there are uncommitted changes
   */
  public hasUncommittedChanges(): boolean {
    try {
      const result = execFileSync('git', ['status', '--porcelain'], {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get remote URL
   */
  public getRemoteUrl(): string | undefined {
    try {
      const result = execFileSync('git', ['remote', 'get-url', 'origin'], {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return result.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Get commit message for a specific commit
   */
  public getCommitMessage(commitHash: string): string | undefined {
    // Validate commit hash to prevent injection
    if (!/^[a-fA-F0-9]{4,40}$/.test(commitHash)) {
      throw new Error(`Invalid commit hash: "${commitHash}"`);
    }

    try {
      const result = execFileSync(
        'git',
        ['log', '-1', '--format=%B', commitHash],
        {
          cwd: this.workspaceRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        },
      );
      return result.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Get list of changed files in working directory
   */
  public getChangedFiles(): string[] {
    try {
      const result = execFileSync('git', ['status', '--porcelain'], {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });

      const files: string[] = [];
      const lines = result.trim().split('\n');

      for (const line of lines) {
        if (line.trim()) {
          // Parse git status output: "XY filename"
          const match = line.match(/^..\s+(.+)$/);
          if (match) {
            files.push(match[1]);
          }
        }
      }

      return files;
    } catch {
      return [];
    }
  }

  /**
   * Get git diff for a specific file
   */
  public getFileDiff(filePath: string): string | undefined {
    try {
      const result = execFileSync('git', ['diff', 'HEAD', '--', filePath], {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return result;
    } catch {
      return undefined;
    }
  }

  /**
   * Get list of tags
   */
  public getTags(): string[] {
    try {
      const result = execFileSync('git', ['tag'], {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return result
        .trim()
        .split('\n')
        .filter((tag) => tag.trim().length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Get commit history
   */
  public getCommitHistory(limit: number = 10): Array<{
    hash: string;
    message: string;
    author: string;
    date: string;
  }> {
    // Validate limit is a safe positive integer
    const safeLimit = Math.max(
      1,
      Math.min(10000, Math.floor(Number(limit) || 10)),
    );

    try {
      const result = execFileSync(
        'git',
        ['log', `-${safeLimit}`, '--format=%H|%s|%an|%ai', '--no-decorate'],
        {
          cwd: this.workspaceRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        },
      );

      const commits: Array<{
        hash: string;
        message: string;
        author: string;
        date: string;
      }> = [];

      const lines = result.trim().split('\n');
      for (const line of lines) {
        const parts = line.split('|');
        if (parts.length >= 4) {
          commits.push({
            hash: parts[0],
            message: parts[1],
            author: parts[2],
            date: parts[3],
          });
        }
      }

      return commits;
    } catch {
      return [];
    }
  }

  // ── Write operations ──────────────────────────────────────────────

  private validateBranchName(name: string): void {
    if (!name || !BRANCH_NAME_REGEX.test(name)) {
      throw new Error(
        `Invalid branch name "${name}". Only alphanumeric characters, dots, slashes, hyphens, and underscores are allowed.`,
      );
    }
  }

  /**
   * How many paths go into one `git add --` invocation.
   *
   * Windows caps a command line near 32 KB, so spreading every path of a large
   * snapshot into a single argv fails with E2BIG/ENOBUFS. 100 long paths stay
   * well inside the limit on every platform.
   */
  private static readonly STAGE_BATCH_SIZE = 100;

  /**
   * Stage specific files
   */
  public stageFiles(files: string[]): void {
    if (!files || files.length === 0) {
      throw new Error('No files specified for staging');
    }

    for (let i = 0; i < files.length; i += GitIntegration.STAGE_BATCH_SIZE) {
      const batch = files.slice(i, i + GitIntegration.STAGE_BATCH_SIZE);
      execFileSync('git', ['add', '--', ...batch], {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
  }

  /**
   * The paths git reports as untracked, repository-relative.
   */
  public getUntrackedFiles(): string[] {
    try {
      return execFileSync(
        'git',
        ['ls-files', '--others', '--exclude-standard'],
        {
          cwd: this.workspaceRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Stage all changes
   */
  public stageAll(): void {
    execFileSync('git', ['add', '-A'], {
      cwd: this.workspaceRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Create a commit with the given message. Returns the new commit hash.
   */
  public createCommit(message: string): GitCommitResult {
    if (!message || message.trim().length === 0) {
      throw new Error('Commit message must not be empty');
    }

    execFileSync('git', ['commit', '-m', message], {
      cwd: this.workspaceRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const commitHash = this.getCurrentCommit() || '';
    const branch = this.getCurrentBranch() || '';

    return { commitHash, branch, message };
  }

  /**
   * List local branches.
   *
   * Uses `%(refname:lstrip=2)` rather than the more obvious
   * `%(refname:short)`. `:short` returns the *shortest unambiguous* name, so on
   * any repository that has a branch and a tag sharing a name -- release
   * branches such as `v0.9.4` almost always do -- it yields `heads/v0.9.4`
   * instead of `v0.9.4`. `getCurrentBranch()` uses
   * `git rev-parse --abbrev-ref`, which never disambiguates, so the two
   * disagreed and the current branch was missing from its own branch list
   * (the CLI marks it with `branch === result.currentBranch`).
   *
   * `lstrip=2` strips exactly `refs/heads/`, so names containing slashes
   * (`feature/foo`) survive intact.
   */
  public listBranches(): string[] {
    try {
      const result = execFileSync(
        'git',
        ['branch', '--list', '--format=%(refname:lstrip=2)'],
        {
          cwd: this.workspaceRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        },
      );

      return result
        .trim()
        .split('\n')
        .filter((b) => b.trim().length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Create a new branch
   */
  public createBranch(name: string, checkout: boolean = false): void {
    this.validateBranchName(name);

    if (checkout) {
      execFileSync('git', ['checkout', '-b', name], {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      execFileSync('git', ['branch', name], {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
  }

  /**
   * Switch to an existing branch
   */
  public switchBranch(name: string): void {
    this.validateBranchName(name);

    execFileSync('git', ['checkout', name], {
      cwd: this.workspaceRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Delete a branch
   */
  public deleteBranch(name: string, force: boolean = false): void {
    this.validateBranchName(name);

    const flag = force ? '-D' : '-d';
    execFileSync('git', ['branch', flag, name], {
      cwd: this.workspaceRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Get file content at a specific commit
   */
  public getFileAtCommit(commitHash: string, filePath: string): string | null {
    if (!/^[a-fA-F0-9]{4,40}$/.test(commitHash)) {
      throw new Error(`Invalid commit hash: "${commitHash}"`);
    }

    try {
      return execFileSync('git', ['show', `${commitHash}:${filePath}`], {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      return null;
    }
  }

  /**
   * Get comprehensive branch info
   */
  public getBranchInfo(): GitBranchInfo {
    return {
      currentBranch: this.getCurrentBranch() || '',
      branches: this.listBranches(),
      commitHash: this.getCurrentCommit(),
      remoteUrl: this.getRemoteUrl(),
      hasChanges: this.hasUncommittedChanges(),
    };
  }
}
