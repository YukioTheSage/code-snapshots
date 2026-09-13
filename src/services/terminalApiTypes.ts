import * as vscode from 'vscode';
import { Snapshot } from '../snapshotManager';

/**
 * What an indexSnapshots request selects.
 *
 * Absent **or empty** snapshotIds means every snapshot. An empty list used to
 * be truthy, so the default CLI invocation took the explicit-ids branch and
 * answered "Individual snapshot indexing not supported" -- a command that could
 * never succeed.
 */
export interface IndexSnapshotsOptions {
  snapshotIds?: string[];
  /** Re-index snapshots recorded in the persisted indexed set. */
  force?: boolean;
  /** Delete each snapshot's vectors before indexing it. */
  purgeFirst?: boolean;
}

/**
 * Comprehensive API interface for terminal and external tool integration
 */
export interface TerminalApiInterface {
  // Snapshot operations
  takeSnapshot(options: TakeSnapshotOptions): Promise<SnapshotResponse>;
  getSnapshots(filter?: SnapshotFilter): Promise<Snapshot[]>;
  getSnapshot(id: string): Promise<Snapshot | null>;
  restoreSnapshot(
    id: string,
    options?: RestoreOptions,
  ): Promise<RestoreResponse>;
  deleteSnapshot(
    id: string,
    options?: { skipConfirm?: boolean },
  ): Promise<boolean>;
  navigateSnapshot(direction: 'previous' | 'next'): Promise<NavigationResponse>;

  // Snapshot content operations
  getSnapshotFileContent(
    snapshotId: string,
    filePath: string,
  ): Promise<string | null>;
  getSnapshotChanges(snapshotId: string): Promise<ChangesSummary>;
  compareSnapshots(
    snapshotId1: string,
    snapshotId2: string,
  ): Promise<ComparisonResult>;

  // Semantic search operations (experimental)
  searchSnapshots(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]>;
  indexSnapshots(options?: IndexSnapshotsOptions): Promise<IndexingResult>;

  // Workspace operations
  getWorkspaceInfo(): Promise<WorkspaceInfo>;
  getCurrentState(): Promise<CurrentState>;

  // Utility operations
  validateSnapshot(id: string): Promise<ValidationResult>;
  exportSnapshot(id: string, format: 'json' | 'zip'): Promise<ExportResult>;

  // Event subscriptions
  onSnapshotsChanged(
    callback: (snapshots: Snapshot[]) => void,
  ): vscode.Disposable;
  onCurrentSnapshotChanged(
    callback: (snapshot: Snapshot | null) => void,
  ): vscode.Disposable;
}

/**
 * Options for taking a snapshot
 */
export interface TakeSnapshotOptions {
  description?: string;
  tags?: string[];
  notes?: string;
  taskReference?: string;
  isFavorite?: boolean;
  isSelective?: boolean;
  selectedFiles?: string[];
  silent?: boolean; // For AI tools - don't show UI notifications
}

/**
 * Response from taking a snapshot
 */
export interface SnapshotResponse {
  success: boolean;
  snapshot?: Snapshot;
  error?: string;
  /**
   * True when nothing was recorded because the workspace was unchanged since
   * the base snapshot.
   *
   * This is a refusal, not a failure: `success` is false because no snapshot
   * exists to return, but a caller that only wants to know whether the store
   * moved can tell it apart from a genuine error.
   */
  noChanges?: boolean;
  statistics?: {
    filesProcessed: number;
    filesChanged: number;
    filesAdded: number;
    filesDeleted: number;
  };
}

/**
 * Filter options for getting snapshots
 */
export interface SnapshotFilter {
  tags?: string[];
  dateRange?: {
    start: number;
    end: number;
  };
  isFavorite?: boolean;
  hasChanges?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Options for restoring a snapshot
 */
export interface RestoreOptions {
  confirmRestore?: boolean;
  createBackupSnapshot?: boolean;
  silent?: boolean;
  selectedFiles?: string[]; // Restore only specific files
  /**
   * The non-interactive caller's answer to the unsaved-changes guard: when a
   * restore would overwrite a dirty editor buffer, `true` lets it proceed and
   * anything else (including the flag being absent) makes it refuse and report
   * the conflicts instead. `restoreSnapshot` never prompts a modal, because a
   * headless caller has no way to answer one.
   *
   * It arrives over IPC from the CLI's `-y/--yes`, and from `snapshot delete`'s
   * sibling plumbing, which it does not control -- so it is coerced to a strict
   * boolean at the socket, where a malformed truthy value could otherwise
   * disarm a data-loss guard.
   */
  skipConfirm?: boolean;
}

/**
 * Response from restoring a snapshot
 */
export interface RestoreResponse {
  success: boolean;
  backupSnapshotId?: string;
  filesRestored: number;
  filesSkipped: number;
  error?: string;
  conflicts?: string[]; // Files with unsaved changes
  /**
   * True when the snapshot could not be fully applied because part of its delta
   * chain is missing. The restore still ran; `filesSkipped` and
   * `refusedDeletions` say how much of it did.
   *
   * Without this, a partial restore was indistinguishable from a complete one:
   * the response said `success: true` and the caller had no way to tell that
   * some files were left at whatever the workspace already contained.
   */
  incomplete?: boolean;
  /** Files left in place because an incomplete snapshot cannot prove they are extraneous. */
  refusedDeletions?: number;
}

/**
 * Response from navigation
 */
export interface NavigationResponse {
  success: boolean;
  currentSnapshot?: Snapshot;
  previousIndex: number;
  newIndex: number;
  error?: string;
}

/**
 * Summary of changes in a snapshot
 */
export interface ChangesSummary {
  snapshotId: string;
  added: string[];
  modified: string[];
  deleted: string[];
  binary: string[];
  totalChanges: number;
}

/**
 * Result of comparing two snapshots
 */
export interface ComparisonResult {
  snapshotId1: string;
  snapshotId2: string;
  addedFiles: string[];
  removedFiles: string[];
  modifiedFiles: string[];
  identicalFiles: string[];
  filesDiff: {
    [filePath: string]: {
      changeType: 'added' | 'removed' | 'modified';
      linesAdded?: number;
      linesRemoved?: number;
      diff?: string;
    };
  };
}

/**
 * Search options for semantic search
 */
export interface SearchOptions {
  snapshotIds?: string[];
  languages?: string[];
  limit?: number;
  scoreThreshold?: number;
}

/**
 * Search result from semantic search
 */
export interface SearchResult {
  snapshotId: string;
  filePath: string;
  content: string;
  score: number;
  location: {
    startLine: number;
    endLine: number;
  };
  context: {
    snapshotDescription: string;
    snapshotTimestamp: number;
    tags: string[];
  };
}

/**
 * Result of indexing operation
 */
export interface IndexingResult {
  success: boolean;
  snapshotsIndexed: number;
  filesIndexed: number;
  error?: string;
  timeElapsed: number;
}

/**
 * Current workspace information
 */
export interface WorkspaceInfo {
  workspaceRoot: string | null;
  totalSnapshots: number;
  currentSnapshotIndex: number;
  currentSnapshot?: Snapshot;
  lastSnapshotTime?: number;
  gitInfo?: {
    branch: string;
    commit: string;
  };
}

/**
 * Current workspace state
 */
export interface CurrentState {
  hasUnsavedChanges: boolean;
  changedFiles: string[];
  openFiles: string[];
  activeFile?: string;
  workspaceStats: {
    totalFiles: number;
    totalLines: number;
    filesByLanguage: { [language: string]: number };
  };
}

/**
 * Validation result for a snapshot
 */
export interface ValidationResult {
  isValid: boolean;
  exists: boolean;
  hasIntegrityIssues: boolean;
  missingFiles: string[];
  corruptedFiles: string[];
  errors: string[];
}

/**
 * Export result
 */
export interface ExportResult {
  success: boolean;
  exportPath?: string;
  format: 'json' | 'zip';
  size: number;
  error?: string;
}
