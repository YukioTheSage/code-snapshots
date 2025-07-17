import * as vscode from 'vscode';
import { Snapshot } from '../snapshotManager';

/**
 * Comprehensive API interface for terminal and external tool integration
 */
export interface TerminalApiInterface {
  // Snapshot operations
  takeSnapshot(options: TakeSnapshotOptions): Promise<SnapshotResponse>;
  getSnapshots(filter?: SnapshotFilter): Promise<Snapshot[]>;
  getSnapshot(id: string): Promise<Snapshot | null>;
  restoreSnapshot(id: string, options?: RestoreOptions): Promise<RestoreResponse>;
  deleteSnapshot(id: string): Promise<boolean>;
  navigateSnapshot(direction: 'previous' | 'next'): Promise<NavigationResponse>;
  
  // Snapshot content operations
  getSnapshotFileContent(snapshotId: string, filePath: string): Promise<string | null>;
  getSnapshotChanges(snapshotId: string): Promise<ChangesSummary>;
  compareSnapshots(snapshotId1: string, snapshotId2: string): Promise<ComparisonResult>;
  
  // Semantic search operations (experimental)
  searchSnapshots(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  indexSnapshots(snapshotIds?: string[]): Promise<IndexingResult>;
  
  // Workspace operations
  getWorkspaceInfo(): Promise<WorkspaceInfo>;
  getCurrentState(): Promise<CurrentState>;
  
  // Utility operations
  validateSnapshot(id: string): Promise<ValidationResult>;
  exportSnapshot(id: string, format: 'json' | 'zip'): Promise<ExportResult>;
  
  // Event subscriptions
  onSnapshotsChanged(callback: (snapshots: Snapshot[]) => void): vscode.Disposable;
  onCurrentSnapshotChanged(callback: (snapshot: Snapshot | null) => void): vscode.Disposable;
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