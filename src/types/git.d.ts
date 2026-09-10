// Type definitions for the built-in VS Code Git extension API (`vscode.git`).
//
// Hand-written subset of the real API, checked against upstream
// (extensions/git/src/api/git.d.ts). The previous revision of this file was
// wrong in ways that matter:
//   * it declared `API.gitPath`, which does not exist — the real shape is
//     `API.git: Git` with `Git.path`;
//   * it declared `getRepository(uri): Repository | undefined`, but the real
//     method returns `Repository | null`;
//   * it shipped an invented `Status` member order, so every status comparison
//     made against it was meaningless;
//   * it was missing `getBranches`, `checkout`, `push`, `show`, `getBranch`,
//     `createBranch`, `deleteBranch` and the rest of the surface the CLI's git
//     commands need.
//
// Only the surface CodeLapse uses is declared: extend it from upstream rather
// than guessing a shape. Adding members that do not exist upstream is how this
// file became inaccurate in the first place.
//
// This is an ambient declaration file (`.d.ts`), so it has no runtime
// counterpart. Never import `RefType`, `Status` or `ForcePushMode` as values:
// a value import emits a `require()` for a module that does not exist at
// runtime. Import them with `import type` and compare against numeric literals.

import * as vscode from 'vscode';

export interface Git {
  /**
   * The path of the git executable.
   */
  readonly path: string;
}

export interface InputBox {
  value: string;
}

export const enum ForcePushMode {
  Force,
  ForceWithLease,
  ForceWithLeaseIfIncludes,
}

export const enum RefType {
  Head,
  RemoteHead,
  Tag,
}

export interface Ref {
  readonly type: RefType;
  readonly name?: string;
  readonly commit?: string;
  readonly commitDetails?: Commit;
  readonly remote?: string;
}

export interface UpstreamRef {
  readonly remote: string;
  readonly name: string;
  readonly commit?: string;
}

export interface Branch extends Ref {
  readonly upstream?: UpstreamRef;
  readonly ahead?: number;
  readonly behind?: number;
}

export interface CommitShortStat {
  readonly files: number;
  readonly insertions: number;
  readonly deletions: number;
}

export interface Commit {
  readonly hash: string;
  readonly message: string;
  readonly parents: string[];
  readonly authorDate?: Date;
  readonly authorName?: string;
  readonly authorEmail?: string;
  readonly commitDate?: Date;
  readonly shortStat?: CommitShortStat;
}

export interface Submodule {
  readonly name: string;
  readonly path: string;
  readonly url: string;
}

export interface Remote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
  readonly isReadOnly: boolean;
}

export interface Worktree {
  readonly name: string;
  readonly path: string;
  readonly ref: string;
  readonly main: boolean;
  readonly detached: boolean;
}

export const enum Status {
  INDEX_MODIFIED,
  INDEX_ADDED,
  INDEX_DELETED,
  INDEX_RENAMED,
  INDEX_COPIED,

  MODIFIED,
  DELETED,
  UNTRACKED,
  IGNORED,
  INTENT_TO_ADD,
  INTENT_TO_RENAME,
  TYPE_CHANGED,

  ADDED_BY_US,
  ADDED_BY_THEM,
  DELETED_BY_US,
  DELETED_BY_THEM,
  BOTH_ADDED,
  BOTH_DELETED,
  BOTH_MODIFIED,
}

export interface Change {
  /**
   * Returns either `originalUri` or `renameUri`, depending
   * on whether this change is a rename change. When
   * in doubt always use `uri` over the other two alternatives.
   */
  readonly uri: vscode.Uri;
  readonly originalUri: vscode.Uri;
  readonly renameUri: vscode.Uri | undefined;
  readonly status: Status;
}

export interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly refs: Ref[];
  readonly remotes: Remote[];
  readonly submodules: Submodule[];
  readonly worktrees: Worktree[];
  readonly rebaseCommit: Commit | undefined;

  readonly mergeChanges: Change[];
  readonly indexChanges: Change[];
  readonly workingTreeChanges: Change[];
  readonly untrackedChanges: Change[];

  readonly onDidChange: vscode.Event<void>;
}

/**
 * Log options.
 */
export interface LogOptions {
  /** Max number of log entries to retrieve. If not specified, the default is 32. */
  readonly maxEntries?: number;
  readonly path?: string;
  /** A commit range, such as "0a47c67..0bb4bde". */
  readonly range?: string;
  readonly reverse?: boolean;
  readonly sortByAuthorDate?: boolean;
  readonly shortStats?: boolean;
  readonly author?: string;
  readonly grep?: string;
  readonly refNames?: string[];
  readonly maxParents?: number;
  readonly skip?: number;
}

export interface CommitOptions {
  all?: boolean | 'tracked';
  amend?: boolean;
  signoff?: boolean;
  /**
   * true  - sign the commit
   * false - do not sign the commit
   * undefined - use the repository/global git config
   */
  signCommit?: boolean;
  empty?: boolean;
  noVerify?: boolean;
  requireUserConfig?: boolean;
  useEditor?: boolean;
  verbose?: boolean;
  /**
   * string    - execute the specified command after the commit operation
   * undefined - execute the command specified in git.postCommitCommand
   *             after the commit operation
   * null      - do not execute any command after the commit operation
   */
  postCommitCommand?: string | null;
}

export interface RefQuery {
  readonly contains?: string;
  readonly count?: number;
  readonly pattern?: string | string[];
  readonly sort?: 'alphabetically' | 'committerdate' | 'creatordate';
}

export interface BranchQuery extends RefQuery {
  readonly remote?: boolean;
}

export interface Repository {
  /**
   * The root URI of the repository. This can be different from the workspace
   * folder URI when the workspace is inside a subdirectory of the repository.
   */
  readonly rootUri: vscode.Uri;

  /**
   * The input box for the Source Control view.
   */
  readonly inputBox: InputBox;

  /**
   * The state of the repository.
   */
  readonly state: RepositoryState;

  /**
   * Get the contents of a file at a given ref.
   * @param ref A ref, such as a commit hash, a branch name, or `HEAD`.
   * @param path A repository-relative path.
   */
  show(ref: string, path: string): Promise<string>;

  /**
   * Get the commit for a given ref.
   * @param ref A ref, such as a commit hash, a branch name, or `HEAD`.
   */
  getCommit(ref: string): Promise<Commit>;

  /**
   * Stage the given paths.
   * @param paths Repository-relative paths. An empty array stages nothing
   * (`git add --`), so pass explicit paths.
   */
  add(paths: string[]): Promise<void>;

  /**
   * Commit the staged changes.
   * @param message The commit message.
   * @param opts Commit options.
   */
  commit(message: string, opts?: CommitOptions): Promise<void>;

  /**
   * Get the diff between a ref and the working tree.
   */
  diffWith(ref: string, path: string): Promise<string>;

  /**
   * Get the diff between two refs.
   */
  diffBetween(ref1: string, ref2: string, path: string): Promise<string>;

  /**
   * Create a new branch.
   * @param name The name of the new branch.
   * @param checkout Whether to check out the new branch.
   * @param ref The ref the branch is created from. Defaults to `HEAD`.
   */
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;

  /**
   * Delete a branch.
   * @param name The name of the branch to delete.
   * @param force Whether to force the deletion of an unmerged branch.
   */
  deleteBranch(name: string, force?: boolean): Promise<void>;

  /**
   * Get a branch by name. `HEAD` resolves to the current branch, which has no
   * `name` while the repository is in a detached HEAD state.
   */
  getBranch(name: string): Promise<Branch>;

  /**
   * Get the refs matching a query. `Ref.name` is optional, so callers must
   * filter out the refs that have no name.
   */
  getBranches(
    query: BranchQuery,
    cancellationToken?: vscode.CancellationToken,
  ): Promise<Ref[]>;

  /**
   * Check out a ref (a branch name, a tag or a commit hash).
   */
  checkout(treeish: string): Promise<void>;

  /**
   * Push commits to a remote.
   * @param remoteName The remote to push to. Defaults to the branch's upstream.
   * @param branchName The branch to push. Defaults to the current branch.
   * @param setUpstream Whether to set the upstream of the branch being pushed.
   * @param force Whether to force push.
   */
  push(
    remoteName?: string,
    branchName?: string,
    setUpstream?: boolean,
    force?: ForcePushMode,
  ): Promise<void>;

  /**
   * Get the commits matching the given options, newest first.
   */
  log(options?: LogOptions): Promise<Commit[]>;
}

export type APIState = 'uninitialized' | 'initialized';

export interface API {
  /**
   * The state of the Git extension.
   */
  readonly state: APIState;

  /**
   * An event signalling a change in the state of the Git extension.
   */
  readonly onDidChangeState: vscode.Event<APIState>;

  /**
   * The git executable used by the extension.
   */
  readonly git: Git;

  /**
   * The currently available repositories.
   */
  readonly repositories: Repository[];

  /**
   * An event signalling a change in the set of repositories.
   */
  readonly onDidOpenRepository: vscode.Event<Repository>;

  /**
   * An event signalling the closing of a repository.
   */
  readonly onDidCloseRepository: vscode.Event<Repository>;

  /**
   * Find the repository that contains the given URI.
   * @param uri A uri.
   * @returns The repository that contains the given uri, or `null` when the uri
   * is not inside a repository.
   */
  getRepository(uri: vscode.Uri): Repository | null;
}

export interface GitExtension {
  /**
   * Whether git is enabled. When it is disabled, `getAPI` throws.
   */
  readonly enabled: boolean;

  /**
   * An event signalling that git was enabled or disabled.
   */
  readonly onDidChangeEnablement: vscode.Event<boolean>;

  /**
   * Returns a specific API version.
   *
   * Throws an error if the git extension is disabled. Listen to
   * `onDidChangeEnablement` to know when the extension becomes enabled again.
   *
   * @param version Version number. Only version 1 is supported.
   * @returns The Git API.
   */
  getAPI(version: 1): API;
}
