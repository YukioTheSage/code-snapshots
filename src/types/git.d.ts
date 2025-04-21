// Type definitions for the VS Code Git extension API (vscode.git)
// Based on common usage and API shape. May need refinement.

import * as vscode from 'vscode';

export interface GitExtension {
  /**
   * The Git API.
   * @param version The API version number. Currently only 1 is supported.
   * @returns The Git API.
   */
  getAPI(version: 1): API;
}

export interface API {
  /**
   * The state of the Git extension.
   */
  state: 'uninitialized' | 'initialized';

  /**
   * An event signalling a change in the state of the Git extension.
   */
  readonly onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;

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
   * Get the path to the git executable.
   */
  readonly gitPath: string;

  /**
   * Find the repository that contains the given URI.
   * @param uri A uri.
   * @returns The repository that contains the given URI, or `undefined` if no repository is found.
   */
  getRepository(uri: vscode.Uri): Repository | undefined;
}

export interface Repository {
  /**
   * The root URI of the repository.
   */
  readonly rootUri: vscode.Uri;

  /**
   * The input box for the Source Control view.
   */
  readonly inputBox: vscode.SourceControlInputBox;

  /**
   * The state of the repository.
   */
  readonly state: RepositoryState;

  /**
   * An event signalling a change in the repository state.
   */
  readonly onDidChangeState: vscode.Event<RepositoryStateReason>;

  /**
   * Get the commit for the given commit hash.
   * @param hash A commit hash.
   * @returns The commit for the given commit hash, or `undefined` if no commit is found.
   */
  getCommit(hash: string): Promise<Commit>;

  /**
   * Stage the given paths.
   * @param paths Paths to stage. If empty, stages all changes.
   */
  add(paths: string[]): Promise<void>;

  /**
   * Commit the staged changes.
   * @param message The commit message.
   * @param opts Commit options.
   */
  commit(message: string, opts?: CommitOptions): Promise<void>;

  // Add other methods as needed (e.g., pull, push, checkout, branch, etc.)
}

export interface RepositoryState {
  /**
   * The HEAD commit.
   */
  readonly HEAD: Branch | undefined;

  /**
   * The set of remotes.
   */
  readonly remotes: Remote[];

  /**
   * The set of submodules.
   */
  readonly submodules: Submodule[];

  /**
   * The set of references.
   */
  readonly refs: Ref[];

  /**
   * The set of merge conflicts.
   */
  readonly mergeChanges: Change[];

  /**
   * The set of index changes.
   */
  readonly indexChanges: Change[];

  /**
   * The set of working tree changes.
   */
  readonly workingTreeChanges: Change[];

  /**
   * An event signalling a change in the repository state.
   */
  readonly onDidChange: vscode.Event<void>;
}

export type RepositoryStateReason = 'repository' | 'index' | 'workingTree';

export interface Commit {
  /**
   * The commit hash.
   */
  readonly hash: string;

  /**
   * The commit message.
   */
  readonly message: string;

  /**
   * The commit author.
   */
  readonly authorName?: string;
  readonly authorEmail?: string;
  readonly authorDate?: Date;

  /**
   * The commit committer.
   */
  readonly commitDate?: Date;

  /**
   * The parent commit hashes.
   */
  readonly parents: string[];
}

export interface Ref {
  readonly type: RefType;
  readonly name?: string;
  readonly commit?: string;
  readonly remote?: string;
}

export enum RefType {
  Head = 0,
  RemoteHead = 1,
  Tag = 2,
}

export interface Branch extends Ref {
  readonly type: RefType.Head | RefType.RemoteHead;
  readonly name: string;
  readonly commit: string;
  readonly upstream?: UpstreamRef;
  readonly ahead?: number;
  readonly behind?: number;
}

export interface UpstreamRef {
  readonly remote: string;
  readonly name: string;
}

export interface Remote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
  readonly isReadOnly: boolean;
}

export interface Submodule {
  readonly name: string;
  readonly path: string;
  readonly url: string;
}

export interface Change {
  /**
   * The path of the file.
   */
  readonly uri: vscode.Uri;

  /**
   * The original path of the file, if renamed.
   */
  readonly originalUri: vscode.Uri;

  /**
   * The path of the file, if renamed.
   */
  readonly renameUri: vscode.Uri;

  /**
   * The status of the file.
   */
  readonly status: Status;
}

export enum Status {
  INDEX_MODIFIED,
  INDEX_ADDED,
  INDEX_DELETED,
  INDEX_RENAMED,
  INDEX_COPIED,

  MODIFIED,
  ADDED,
  DELETED,
  RENAMED,
  COPIED,
  UNTRACKED,
  IGNORED,
  INTENT_TO_ADD,

  BOTH_DELETED,
  ADDED_BY_US,
  DELETED_BY_THEM,
  ADDED_BY_THEM,
  DELETED_BY_US,
  BOTH_ADDED,
  BOTH_MODIFIED,
}

export interface CommitOptions {
  /**
   * Commit all changes (including untracked files).
   */
  all?: boolean | 'tracked';

  /**
   * Amend the previous commit.
   */
  amend?: boolean;

  /**
   * Signoff the commit.
   */
  signoff?: boolean;

  /**
   * Sign the commit using GPG.
   */
  signCommit?: boolean;
}
