/**
 * Type definitions for CLI command options
 *
 * This file provides strict type definitions for all command options,
 * replacing `unknown` types throughout the codebase with specific interfaces.
 */

// Import shared types from api to avoid duplication (not re-exported)
import type { DiagnosticLevel } from './api';

// ============================================================================
// Base Interfaces
// ============================================================================

/**
 * Base options available for all commands
 */
export interface BaseCommandOptions {
  /** Output results in JSON format */
  json?: boolean;
  /** Enable verbose output */
  verbose?: boolean;
}

/**
 * Pagination options for list-based commands
 */
export interface PaginationOptions {
  /** Maximum number of results to return */
  limit?: number;
  /** Number of results to skip (alternative to page) */
  offset?: number;
  /** Page number (alternative to offset) */
  page?: number;
}

/**
 * Sorting options for list-based commands
 */
export interface SortOptions {
  /** Field to sort by */
  sortBy?: string;
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// Snapshot Command Options
// ============================================================================

/**
 * Options for creating a new snapshot
 */
export interface CreateSnapshotOptions extends BaseCommandOptions {
  /** Comma-separated tags for the snapshot */
  tags?: string;
  /** Description/notes for the snapshot */
  notes?: string;
  /** Task reference ID (e.g., ticket number, PR number) */
  taskRef?: string;
  /** Mark snapshot as favorite */
  favorite?: boolean;
  /** Create selective snapshot (only specified files) */
  selective?: boolean;
  /** Comma-separated list of files to include (for selective snapshots) */
  files?: string;
  /** Create backup before taking snapshot */
  backup?: boolean;
  /** Include only changed files */
  changedOnly?: boolean;
}

/**
 * Options for listing snapshots
 */
export interface ListSnapshotsOptions
  extends BaseCommandOptions,
    PaginationOptions {
  /** Filter by specific criteria */
  filter?: SnapshotFilterOptions;
  /** Filter by tags (comma-separated) */
  tags?: string;
  /** Filter by favorites */
  favorites?: boolean;
  /** Filter by date (since) */
  since?: string;
}

/**
 * Options for restoring a snapshot
 */
export interface RestoreSnapshotOptions extends BaseCommandOptions {
  /** Snapshot ID to restore */
  snapshotId: string;
  /** Create backup before restoring */
  backup?: boolean;
  /** Skip confirmation prompts */
  force?: boolean;
  /** Specific files to restore (comma-separated) */
  files?: string;
}

/**
 * Options for comparing snapshots
 */
export interface CompareSnapshotsOptions extends BaseCommandOptions {
  /** First snapshot ID */
  id1: string;
  /** Second snapshot ID */
  id2: string;
  /** Include file list in comparison */
  files?: boolean;
}

// ============================================================================
// File Command Options
// ============================================================================

/**
 * Options for listing files in a snapshot
 */
export interface ListFilesOptions extends BaseCommandOptions, SortOptions {
  /** Snapshot ID */
  snapshotId: string;
  /** Show only changed files */
  changedOnly?: boolean;
  /** Include file content in results */
  content?: boolean;
  /** Include file metadata in results */
  metadata?: boolean;
  /** Filter by file pattern (glob) */
  pattern?: string;
  /** Filter by date (ISO format or relative like "2d", "1w") */
  since?: string;
}

/**
 * Options for viewing a file from a snapshot
 */
export interface ViewFileOptions extends BaseCommandOptions {
  /** Snapshot ID */
  snapshotId: string;
  /** File path */
  filePath: string;
  /**
   * Encoding the `--no-x` flags. Commander maps `--no-syntax` to
   * `options.syntax === false`, so the positive name is what actually gets
   * populated. These were previously spelled `noSyntax` / `noLineNumbers`,
   * which are never set: reading them always yielded `undefined`, so the
   * documented flags were silent no-ops.
   */
  syntax?: boolean;
  /** Show line numbers */
  lineNumbers?: boolean;
}

/**
 * Options for comparing a file across snapshots
 */
export interface CompareFileOptions extends BaseCommandOptions {
  /** Source snapshot ID */
  fromSnapshotId: string;
  /** Target snapshot ID */
  toSnapshotId: string;
  /** File path */
  filePath: string;
  /** Number of context lines in diff */
  context?: number;
  /** Ignore whitespace changes */
  ignoreWhitespace?: boolean;
  /** Show side-by-side diff */
  sideBySide?: boolean;
}

/**
 * Options for restoring a single file
 */
export interface RestoreFileOptions extends BaseCommandOptions {
  /** Snapshot ID */
  snapshotId: string;
  /** Source file path in snapshot */
  filePath: string;
  /** Target restore path (defaults to original path) */
  to?: string;
  /** Create a backup before restoring (`--no-backup` sets this false) */
  backup?: boolean;
  /** Skip confirmation prompts */
  force?: boolean;
}

/**
 * Options for exporting a file
 */
export interface ExportFileOptions extends BaseCommandOptions {
  /** Snapshot ID */
  snapshotId: string;
  /** File path */
  filePath: string;
  /** Output path for exported file */
  output: string;
}

// ============================================================================
// Filter Command Options
// ============================================================================

/**
 * Date range filter
 */
export interface DateRangeFilter {
  /** Start date (ISO format or relative) */
  from?: string;
  /** End date (ISO format or relative) */
  to?: string;
}

/**
 * Comprehensive snapshot filter options
 */
export interface SnapshotFilterOptions {
  /** Filter by tags */
  tags?: string[];
  /** Filter by favorite status (use isFavorite for API) */
  favorites?: boolean;
  /** Filter by favorite status */
  isFavorite?: boolean;
  /** Filter by date range */
  dateRange?: DateRangeFilter;
  /** Filter by files */
  files?: string[];
  /** Filter by Git branch */
  gitBranch?: string;
  /** Search in snapshot metadata */
  searchText?: string;
  /** Maximum number of results */
  limit?: number;
  /** Number of results to skip */
  offset?: number;
}

/**
 * Options for updating snapshot metadata
 */
export interface UpdateSnapshotOptions extends BaseCommandOptions {
  /** Snapshot ID */
  snapshotId: string;
  /** Updated tags (comma-separated) */
  tags?: string;
  /** Updated notes */
  notes?: string;
  /** Updated task reference */
  taskRef?: string;
  /** Toggle favorite status */
  favorite?: boolean;
}

// ============================================================================
// Git Command Options
// ============================================================================

/**
 * Options for creating Git commit from snapshot
 */
export interface GitCommitOptions extends BaseCommandOptions {
  /** Snapshot ID */
  snapshotId: string;
  /** Commit message */
  message?: string;
  /** Include untracked files */
  includeUntracked?: boolean;
  /** Create new branch */
  branch?: string;
  /** Push after commit */
  push?: boolean;
}

/**
 * Options for auto-snapshot before Git operation
 */
export interface GitAutoSnapshotOptions extends BaseCommandOptions {
  /** Description for the auto-snapshot */
  description?: string;
  /** Include untracked files */
  includeUntracked?: boolean;
}

/**
 * Options for comparing snapshot with Git commit
 */
export interface GitCompareOptions extends BaseCommandOptions {
  /** Snapshot ID */
  snapshotId: string;
  /** Git commit hash */
  commitHash?: string;
  /** Include file list */
  files?: boolean;
}

// ============================================================================
// Search Command Options
// ============================================================================

/**
 * Filter criteria for search results
 */
export interface SearchFilterCriteria {
  /** Complexity range [min, max] */
  complexityRange?: [number, number];
  /** Minimum quality threshold */
  qualityThreshold?: number;
  /** Filter by semantic types */
  semanticTypes?: string[];
  /** Filter by design patterns */
  designPatterns?: string[];
  /** Exclude code smells */
  excludeCodeSmells?: string[];
  /** Filter by business domains */
  businessDomains?: string[];
}

/**
 * Options for enhanced semantic search
 */
export interface SearchOptions extends BaseCommandOptions, PaginationOptions {
  /** Search query */
  query: string;
  /** Minimum similarity score threshold (0-1) */
  threshold?: number;
  /** Limit results to specific snapshot IDs */
  snapshots?: string;
  /** Filter by programming languages */
  languages?: string;
  /** Search mode */
  mode?: 'semantic' | 'behavioral' | 'pattern';
  /** Include result explanations */
  explanations?: boolean;
  /** Include relationship information */
  relationships?: boolean;
  /** Include quality metrics */
  quality?: boolean;
  /** Context radius (lines around result) */
  context?: number;
  /** Ranking strategy */
  ranking?: string;
  /** Maximum results per file */
  maxPerFile?: number;
  /** Enable result diversification */
  diversify?: boolean;
  /** Minimum complexity */
  complexityMin?: number;
  /** Maximum complexity */
  complexityMax?: number;
  /** Minimum quality score */
  qualityMin?: number;
  /** Comma-separated semantic types */
  semanticTypes?: string;
  /** Comma-separated patterns */
  patterns?: string;
  /** Comma-separated code smells to exclude */
  excludeSmells?: string;
  /** Comma-separated business domains */
  domains?: string;
}

/**
 * Options for batch search operations
 */
export interface BatchSearchOptions extends BaseCommandOptions {
  /** File containing search queries (one per line) */
  queriesFile: string;
  /** Enable parallel execution */
  parallel?: boolean;
  /** Maximum concurrent operations */
  concurrency?: number;
}

/**
 * Options for indexing snapshots
 */
export interface IndexOptions extends BaseCommandOptions {
  /** Index all snapshots */
  all?: boolean;
  /** Specific snapshot IDs to index */
  snapshotIds?: string[];
}

// ============================================================================
// Analysis Command Options
// ============================================================================

/**
 * Options for code analysis
 */
export interface AnalysisOptions extends BaseCommandOptions {
  /** Snapshot ID (required for file/quality analysis) */
  snapshot?: string;
  /** Analysis type */
  type?: 'full' | 'quick' | 'custom';
  /** Include relationship analysis */
  relationships?: boolean;
  /** Include quality metrics */
  quality?: boolean;
  /** Include context analysis */
  context?: boolean;
  /** Include chunk information */
  chunks?: boolean;
  /** Comma-separated metric names, or false if disabled */
  metrics?: string | boolean;
  /** Include improvement suggestions */
  suggestions?: boolean;
  /** Include refactoring recommendations */
  recommendations?: boolean;
  /** Include trend analysis */
  trends?: boolean;
  /** Quality threshold (0-1) */
  threshold?: number;
  /** Include transitive dependencies */
  transitive?: boolean;
  /** Maximum dependency depth */
  depth?: number;
  /** Comma-separated relationship types */
  types?: string;
  /** Include relationship strength analysis */
  strength?: boolean;
}

/**
 * Options for file-specific analysis
 */
export interface FileAnalysisOptions extends AnalysisOptions {
  /** File path to analyze */
  filePath: string;
}

/**
 * Options for chunk analysis
 */
export interface ChunkAnalysisOptions extends AnalysisOptions {
  /** Chunk ID to analyze */
  chunkId: string;
}

/**
 * Options for dependency analysis
 */
export interface DependencyAnalysisOptions extends BaseCommandOptions {
  /** Snapshot ID */
  snapshotId: string;
  /** Target identifier (file path or chunk ID) */
  target: string;
  /** Include transitive dependencies */
  transitive?: boolean;
  /** Maximum depth */
  depth?: number;
  /** Filter by relationship types */
  types?: string;
}

/**
 * Options for batch analysis
 */
export interface BatchAnalysisOptions extends BaseCommandOptions {
  /** File containing analysis targets */
  targetsFile: string;
  /** Enable parallel execution */
  parallel?: boolean;
  /** Maximum concurrent operations */
  concurrency?: number;
}

// ============================================================================
// Chunking Command Options
// ============================================================================

/**
 * Chunking strategy types
 */
export type ChunkingStrategy =
  | 'semantic'
  | 'structural'
  | 'size-based'
  | 'hybrid';

/**
 * Options for file chunking
 */
export interface ChunkingOptions extends BaseCommandOptions {
  /** Snapshot ID (required for file chunking) */
  snapshot?: string;
  /** Chunking strategy */
  strategy?: ChunkingStrategy;
  /** Maximum chunk size (tokens/characters) */
  maxSize?: number;
  /** Minimum chunk size */
  minSize?: number;
  /** Overlap between chunks */
  overlap?: number;
  /** Preserve code structure boundaries */
  preserveStructure?: boolean;
  /** Include context information */
  context?: boolean;
  /** File patterns to chunk */
  patterns?: string;
  /** Exclude binary files */
  excludeBinary?: boolean;
  /** Exclude test files */
  excludeTests?: boolean;
}

/**
 * Options for file-specific chunking
 */
export interface FileChunkingOptions extends ChunkingOptions {
  /** File path to chunk */
  filePath: string;
}

/**
 * Options for snapshot chunking
 */
export interface SnapshotChunkingOptions extends ChunkingOptions {
  /** Snapshot ID to chunk */
  snapshotId: string;
}

/**
 * Options for listing chunks
 */
export interface ListChunksOptions
  extends BaseCommandOptions,
    PaginationOptions,
    SortOptions {
  /** Snapshot ID */
  snapshotId: string;
  /** Filter by file path */
  file?: string;
  /** Filter by semantic types */
  types?: string;
  /** Minimum quality score */
  qualityMin?: number;
  /** Minimum complexity */
  complexityMin?: number;
  /** Maximum complexity */
  complexityMax?: number;
  /** Exclude code smells */
  excludeSmells?: string;
}

/**
 * Options for getting chunk metadata
 */
export interface ChunkMetadataOptions extends BaseCommandOptions {
  /** Chunk ID */
  chunkId: string;
  /** Include quality metrics */
  quality?: boolean;
  /** Include relationships */
  relationships?: boolean;
}

/**
 * Options for getting chunk context
 */
export interface ChunkContextOptions extends BaseCommandOptions {
  /** Chunk ID */
  chunkId: string;
  /** Context radius (lines) */
  radius?: number;
  /** Include file-level context */
  fileContext?: boolean;
  /** Include architectural context */
  architectural?: boolean;
  /** Include business domain context */
  business?: boolean;
}

// ============================================================================
// Configuration Command Options
// ============================================================================

/**
 * Git configuration settings
 */
export interface GitConfigSettings {
  /** Add commit info to snapshots */
  addCommitInfo: boolean;
  /** Enable creating commits from snapshots */
  commitFromSnapshotEnabled: boolean;
}

/**
 * Auto-snapshot rule configuration
 */
export interface AutoSnapshotRuleConfig {
  /** File pattern to watch */
  pattern: string;
  /** Interval in minutes */
  intervalMinutes: number;
}

/**
 * Auto-snapshot configuration
 */
export interface AutoSnapshotConfig {
  /** Auto-snapshot rules */
  rules: AutoSnapshotRuleConfig[];
}

/**
 * UX configuration settings
 */
export interface UXConfigSettings {
  /** Show welcome message on startup */
  showWelcomeOnStartup: boolean;
  /** Show keyboard shortcut hints */
  showKeyboardShortcutHints: boolean;
  /** Use animations in UI */
  useAnimations: boolean;
  /** Confirm before restore operations */
  confirmRestoreOperations: boolean;
}

/**
 * Semantic search configuration
 */
export interface SemanticSearchConfig {
  /** Enable semantic search */
  enabled: boolean;
  /** Default chunk size */
  chunkSize: number;
  /** Chunk overlap */
  chunkOverlap: number;
  /** Auto-index new snapshots */
  autoIndex: boolean;
}

/**
 * Complete configuration settings
 */
export interface ConfigSettings {
  /** Snapshot storage location */
  snapshotLocation: string;
  /** Maximum number of snapshots to keep */
  maxSnapshots: number;
  /** Maximum bytes the snapshot store may occupy (0 = no limit) */
  maxSnapshotStoreBytes: number;
  /** Auto-snapshot interval in minutes */
  autoSnapshotInterval: number;
  /** Enable logging */
  loggingEnabled: boolean;
  /** Enable verbose logging */
  verboseLogging: boolean;
  /** Git integration settings */
  git: GitConfigSettings;
  /** Auto-snapshot settings */
  autoSnapshot: AutoSnapshotConfig;
  /** Show only changed files by default */
  showOnlyChangedFiles: boolean;
  /** UX settings */
  ux: UXConfigSettings;
  /** Semantic search settings */
  semanticSearch: SemanticSearchConfig;
}

/**
 * Options for config export
 */
export interface ExportConfigOptions extends BaseCommandOptions {
  /** Export format */
  format?: 'json' | 'yaml';
  /** Output file path */
  output?: string;
}

/**
 * Options for config import
 */
export interface ImportConfigOptions extends BaseCommandOptions {
  /** Input file path */
  input: string;
  /** Merge with existing config (vs replace) */
  merge?: boolean;
}

// ============================================================================
// Diagnostics Command Options
// ============================================================================

/**
 * Options for running diagnostics
 */
export interface DiagnosticsOptions extends BaseCommandOptions {
  /** Include system info (`--no-system` sets this false) */
  system?: boolean;
  /** Include snapshot diagnostics (`--no-snapshots` sets this false) */
  snapshots?: boolean;
  /** Include Git diagnostics (`--no-git` sets this false) */
  git?: boolean;
  /** Include config diagnostics (`--no-config` sets this false) */
  config?: boolean;
}

/**
 * Options for viewing logs
 */
export interface LogOptions extends BaseCommandOptions {
  /** Number of log lines to show */
  lines?: number;
  /** Filter by log level */
  level?: DiagnosticLevel;
  /** Show logs since timestamp/duration */
  since?: string;
  /** Follow log stream (live updates) */
  follow?: boolean;
}

/**
 * Options for clearing logs
 */
export interface ClearLogsOptions extends BaseCommandOptions {
  /** Clear logs older than duration */
  olderThan?: string;
  /** Clear only a specific log level */
  level?: DiagnosticLevel;
}

/**
 * Options for health check
 */
export interface HealthCheckOptions extends BaseCommandOptions {
  /** Include performance checks (`--no-performance` sets this false) */
  performance?: boolean;
  /** Include connectivity checks (`--no-connectivity` sets this false) */
  connectivity?: boolean;
  /** Include storage checks (`--no-storage` sets this false) */
  storage?: boolean;
}

/**
 * Options for performance metrics
 */
export interface PerformanceMetricsOptions extends BaseCommandOptions {
  /** Include historical data (`--no-history` sets this false) */
  history?: boolean;
  /** Time range for metrics */
  timeRange?: string;
}

// ============================================================================
// Rules Command Options
// ============================================================================

/**
 * Options for adding auto-snapshot rule
 */
export interface AddRuleOptions extends BaseCommandOptions {
  /** File pattern */
  pattern: string;
  /** Interval in minutes */
  interval: number;
  /** Rule description */
  description?: string;
  /** Tags (comma-separated) */
  tags?: string;
  /** Create rule in disabled state */
  disabled?: boolean;
}

/**
 * Options for updating auto-snapshot rule
 */
export interface UpdateRuleOptions extends BaseCommandOptions {
  /** Rule ID */
  ruleId: string;
  /** Updated pattern */
  pattern?: string;
  /** Updated interval */
  interval?: number;
  /** Updated description */
  description?: string;
  /** Updated tags */
  tags?: string;
  /** Updated enabled status */
  enabled?: boolean;
  /** Updated disabled status */
  disabled?: boolean;
}

/**
 * Options for testing rule pattern
 */
export interface TestRuleOptions extends BaseCommandOptions {
  /** Pattern to test */
  pattern: string;
  /** Test path */
  path?: string;
}

// ============================================================================
// Utility Command Options
// ============================================================================

/**
 * Options for snapshot validation
 */
export interface ValidateSnapshotOptions extends BaseCommandOptions {
  /** Snapshot ID */
  snapshotId: string;
}

/**
 * Options for snapshot export
 */
export interface ExportSnapshotOptions extends BaseCommandOptions {
  /** Snapshot ID */
  snapshotId: string;
  /** Export format */
  format?: 'json' | 'zip' | 'tar';
  /** Output path */
  output: string;
}

// ============================================================================
// Workspace Command Options
// ============================================================================

/**
 * Options for workspace info
 */
export type WorkspaceInfoOptions = BaseCommandOptions;

/**
 * Options for current state
 */
export interface WorkspaceStateOptions extends BaseCommandOptions {
  /** Show only changed files */
  changed?: boolean;
}
