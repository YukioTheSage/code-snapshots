/**
 * Core configuration structure
 */
export interface AutoSnapshotRule {
  pattern: string;
  intervalMinutes: number;
  enabled?: boolean;
}

export interface AutoSnapshotConfig {
  rules: AutoSnapshotRule[];
}

export interface CodelapseConfig {
  snapshotLocation: string;
  maxSnapshots: number;
  autoSnapshot: AutoSnapshotConfig;
  git: {
    addCommitInfo: boolean;
    autoSnapshotBeforeOperation: boolean;
  };
  semanticSearch?: {
    enabled: boolean;
    provider?: string;
    apiKey?: string;
    chunkSize?: number;
    autoIndex?: boolean;
  };
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: CodelapseConfig = {
  snapshotLocation: '.snapshots',
  maxSnapshots: 50,
  autoSnapshot: {
    rules: [],
  },
  git: {
    addCommitInfo: true,
    autoSnapshotBeforeOperation: false,
  },
  semanticSearch: {
    enabled: false,
    chunkSize: 200,
    autoIndex: false,
  },
};

/**
 * Environment variable names
 */
export const ENV_VARS = {
  GEMINI_API_KEY: 'GEMINI_API_KEY',
  PINECONE_API_KEY: 'PINECONE_API_KEY',
  SNAPSHOT_LOCATION: 'CODELAPSE_SNAPSHOT_LOCATION',
  MAX_SNAPSHOTS: 'CODELAPSE_MAX_SNAPSHOTS',
};
