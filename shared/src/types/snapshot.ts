/**
 * Core snapshot data structure
 */
export interface Snapshot {
  id: string;
  timestamp: number;
  description: string;
  gitBranch?: string;
  gitCommitHash?: string;
  // fields for Enhanced Snapshot Context
  tags?: string[];
  notes?: string;
  taskReference?: string;
  isFavorite?: boolean;
  // fields for Selective Snapshots
  isSelective?: boolean; // Indicates if this snapshot only includes specific files
  selectedFiles?: string[]; // List of explicitly selected files (when isSelective is true)
  files: {
    [relativePath: string]: {
      content?: string | null;
      diff?: string;
      baseSnapshotId?: string;
      deleted?: boolean;
      isBinary?: boolean;
    };
  };
}

/**
 * Snapshot index file structure
 */
export interface SnapshotIndex {
  snapshots: Array<{ id: string; timestamp: number; description: string }>;
  currentIndex: number;
}

/**
 * Options for taking a snapshot
 */
export interface SnapshotOptions {
  description?: string;
  tags?: string[];
  notes?: string;
  taskReference?: string;
  isFavorite?: boolean;
  isSelective?: boolean;
  selectedFiles?: string[];
}

/**
 * Options for restoring a snapshot
 */
export interface RestoreOptions {
  backup?: boolean;
  selectedFiles?: string[];
}

/**
 * Filter options for listing snapshots
 */
export interface SnapshotFilter {
  tag?: string;
  favorite?: boolean;
  startDate?: number;
  endDate?: number;
  search?: string;
  filePath?: string;
}

/**
 * Snapshot comparison result
 */
export interface SnapshotComparison {
  snapshot1: Snapshot;
  snapshot2: Snapshot;
  addedFiles: string[];
  deletedFiles: string[];
  modifiedFiles: string[];
  diffs: {
    [filePath: string]: string;
  };
}

/**
 * Git information
 */
export interface GitInfo {
  branch?: string;
  commitHash?: string;
  isDirty?: boolean;
  remoteUrl?: string;
}

/**
 * Result of a git commit operation
 */
export interface GitCommitResult {
  commitHash: string;
  branch: string;
  message: string;
}

/**
 * Git branch information
 */
export interface GitBranchInfo {
  currentBranch: string;
  branches: string[];
  commitHash?: string;
  remoteUrl?: string;
  hasChanges: boolean;
}
