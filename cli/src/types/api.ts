/**
 * Type definitions for API responses
 *
 * This file provides strict type definitions for API responses,
 * replacing `Promise<unknown>` with specific return types.
 */

// ============================================================================
// Base Response Types
// ============================================================================

/**
 * Base API response structure
 */
export interface ApiResponse<T = unknown> {
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message (present when success is false) */
  error?: string;
  /** Response data */
  data?: T;
  /** Additional metadata */
  metadata?: ResponseMetadata;
  /** Helpful suggestions */
  suggestions?: string[];
  /** Status message */
  message?: string;
}

/**
 * Response metadata
 */
export interface ResponseMetadata {
  /** Response timestamp */
  timestamp?: string;
  /** Processing duration in milliseconds */
  duration?: number;
  /** API version */
  version?: string;
  /** Additional custom metadata */
  [key: string]: unknown;
}

/**
 * Paginated response structure
 */
export interface PaginatedResponse<T> {
  /** Array of results */
  results: T[];
  /** Total number of results available */
  total: number;
  /** Current page/offset */
  offset?: number;
  /** Results per page */
  limit?: number;
  /** Whether there are more results */
  hasMore?: boolean;
}

// ============================================================================
// Snapshot Types
// ============================================================================

/**
 * Snapshot metadata
 */
export interface SnapshotMetadata {
  /** Unique snapshot ID */
  id: string;
  /** Snapshot creation timestamp */
  timestamp: string;
  /** Snapshot description */
  description?: string;
  /** Snapshot notes */
  notes?: string;
  /** Associated tags */
  tags: string[];
  /** Task reference (e.g., ticket ID) */
  taskReference?: string;
  /** Favorite status */
  isFavorite: boolean;
  /** Git commit hash (if available) */
  gitCommit?: string;
  /** Git commit hash (alternative name) */
  gitCommitHash?: string;
  /** Git branch name */
  gitBranch?: string;
  /** Number of files in snapshot */
  fileCount: number;
  /** Total size in bytes */
  totalSize: number;
  /** Number of changed files (compared to previous) */
  changedFileCount?: number;
  /** Whether this is a selective snapshot */
  isSelective?: boolean;
  /** Selected files (for selective snapshots) */
  selectedFiles?: string[];
  /** Workspace root path */
  workspaceRoot?: string;
}

/**
 * Snapshot with file information
 */
export interface SnapshotWithFiles extends SnapshotMetadata {
  /** Files in the snapshot */
  files: FileInfo[];
}

/**
 * Response from snapshot creation
 */
export interface CreateSnapshotResponse extends ApiResponse<SnapshotMetadata> {
  /** Created snapshot metadata */
  snapshot?: SnapshotMetadata;
}

/**
 * Response from listing snapshots
 */
export interface ListSnapshotsResponse
  extends ApiResponse<PaginatedResponse<SnapshotMetadata>> {
  /** Paginated snapshots */
  snapshots?: SnapshotMetadata[];
  /** Total count */
  total?: number;
}

/**
 * Response from getting a single snapshot
 */
export interface GetSnapshotResponse extends ApiResponse<SnapshotWithFiles> {
  /** Snapshot with file information */
  snapshot?: SnapshotWithFiles;
}

/**
 * Response from snapshot restore
 */
export interface RestoreSnapshotResponse extends ApiResponse {
  /** Path to backup (if created) */
  backupPath?: string;
  /** Number of files restored */
  filesRestored?: number;
}

/**
 * Response from snapshot deletion
 */
export interface DeleteSnapshotResponse extends ApiResponse {
  /** ID of deleted snapshot */
  deletedId?: string;
}

// ============================================================================
// File Types
// ============================================================================

/**
 * File status types
 */
export type FileStatus = 'added' | 'modified' | 'deleted' | 'unchanged';

/**
 * File information
 */
export interface FileInfo {
  /** Relative file path */
  path: string;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp */
  modified: string;
  /** File status */
  status: FileStatus;
  /** Number of lines added */
  linesAdded?: number;
  /** Number of lines removed */
  linesRemoved?: number;
  /** Content type/MIME type */
  contentType?: string;
  /** File hash (for deduplication) */
  hash?: string;
  /** Programming language */
  language?: string;
}

/**
 * File with content
 */
export interface FileWithContent extends FileInfo {
  /** File content */
  content: string;
  /** Content encoding */
  encoding?: string;
}

/**
 * Response from listing files
 */
export interface ListFilesResponse
  extends ApiResponse<PaginatedResponse<FileInfo>> {
  /** Files in snapshot */
  files?: FileInfo[];
  /** Total file count */
  totalFiles?: number;
  /** Changed file count */
  changedFiles?: number;
}

/**
 * Response from getting file content
 */
export interface GetFileResponse extends ApiResponse<FileWithContent> {
  /** File information */
  file?: FileInfo;
  /** File content */
  content?: string;
}

/**
 * File comparison result
 */
export interface FileDifference {
  /** Line number in original file */
  lineNumber: number;
  /** Type of change */
  type: 'added' | 'removed' | 'modified';
  /** Original content */
  oldContent?: string;
  /** New content */
  newContent?: string;
}

/**
 * Response from file comparison
 */
export interface CompareFileResponse extends ApiResponse {
  /** List of differences */
  differences?: FileDifference[];
  /** Comparison summary */
  summary?: {
    linesAdded: number;
    linesRemoved: number;
    linesModified: number;
    totalChanges: number;
  };
}

/**
 * Response from file restore
 */
export interface RestoreFileResponse extends ApiResponse {
  /** Path to backup (if created) */
  backupPath?: string;
  /** Restored file path */
  restoredPath?: string;
}

/**
 * File version history entry
 */
export interface FileVersionInfo {
  /** Snapshot ID */
  snapshotId: string;
  /** Snapshot timestamp */
  timestamp: string;
  /** File size at this version */
  size: number;
  /** File status */
  status: FileStatus;
  /** Number of changes */
  changeCount?: number;
}

/**
 * Response from file history
 */
export interface FileHistoryResponse extends ApiResponse {
  /** Version history */
  history?: FileVersionInfo[];
  /** Total versions */
  totalVersions?: number;
}

/**
 * Response from file export
 */
export interface ExportFileResponse extends ApiResponse {
  /** Output file path */
  outputPath?: string;
}

// ============================================================================
// Search Types
// ============================================================================

/**
 * Semantic type classification
 */
export type SemanticType =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'variable'
  | 'constant'
  | 'enum'
  | 'module'
  | 'import'
  | 'export';

/**
 * Search result match
 */
export interface SearchMatch {
  /** File path */
  filePath: string;
  /** Line number */
  lineNumber: number;
  /** Column number */
  columnNumber?: number;
  /** Matched content */
  content: string;
  /** Similarity score (0-1) */
  score: number;
  /** Semantic type */
  semanticType?: SemanticType;
  /** Explanation of match */
  explanation?: string;
  /** Context lines before */
  contextBefore?: string[];
  /** Context lines after */
  contextAfter?: string[];
  /** Quality metrics */
  qualityMetrics?: QualityMetrics;
  /** Related matches */
  relatedMatches?: string[];
}

/**
 * Search result with metadata
 */
export interface SearchResult {
  /** Search query */
  query: string;
  /** Matches found */
  matches: SearchMatch[];
  /** Total matches */
  totalMatches: number;
  /** Search duration in ms */
  duration?: number;
  /** Related queries */
  relatedQueries?: string[];
  /** Search suggestions */
  suggestions?: string[];
}

/**
 * Response from search
 */
export interface SearchResponse extends ApiResponse<SearchResult> {
  /** Search results */
  results?: SearchMatch[];
  /** Result metadata */
  metadata?: SearchMetadata;
  /** Related queries */
  relatedQueries?: string[];
}

/**
 * Search metadata
 */
export interface SearchMetadata extends ResponseMetadata {
  /** Total results found */
  totalResults: number;
  /** Results returned */
  returnedResults: number;
  /** Search mode used */
  mode: 'semantic' | 'behavioral' | 'pattern';
  /** Snapshots searched */
  snapshotsSearched?: number;
}

/**
 * Batch search result
 */
export interface BatchSearchResult {
  /** Query text */
  query: string;
  /** Whether this query succeeded */
  success: boolean;
  /** Results for this query */
  results?: SearchMatch[];
  /** Error message if failed */
  error?: string;
}

/**
 * Response from batch search
 */
export interface BatchSearchResponse extends ApiResponse {
  /** Total queries processed */
  totalQueries?: number;
  /** Successful queries */
  successfulQueries?: number;
  /** Failed queries */
  failedQueries?: number;
  /** Average response time */
  averageResponseTime?: number;
  /** Individual query results */
  queryResults?: BatchSearchResult[];
}

/**
 * Response from indexing
 */
export interface IndexResponse extends ApiResponse {
  /** Number of snapshots indexed */
  snapshotsIndexed?: number;
  /** Total chunks created */
  chunksCreated?: number;
  /** Indexing duration in ms */
  duration?: number;
}

// ============================================================================
// Analysis Types
// ============================================================================

/**
 * Code quality metrics
 */
export interface QualityMetrics {
  /** Overall quality score (0-1) */
  overallScore: number;
  /** Maintainability score */
  maintainability?: number;
  /** Readability score */
  readability?: number;
  /** Complexity score */
  complexity?: number;
  /** Test coverage percentage */
  testCoverage?: number;
  /** Documentation coverage */
  documentation?: number;
  /** Code smells detected */
  codeSmells?: string[];
  /** Design patterns identified */
  designPatterns?: string[];
}

/**
 * Code complexity metrics
 */
export interface ComplexityMetrics {
  /** Cyclomatic complexity */
  cyclomaticComplexity: number;
  /** Cognitive complexity */
  cognitiveComplexity?: number;
  /** Lines of code */
  linesOfCode: number;
  /** Number of functions */
  functionCount?: number;
  /** Average function length */
  averageFunctionLength?: number;
  /** Maximum nesting depth */
  maxNestingDepth?: number;
}

/**
 * Relationship between code elements
 */
export interface CodeRelationship {
  /** Source element */
  source: string;
  /** Target element */
  target: string;
  /** Relationship type */
  type: 'imports' | 'extends' | 'implements' | 'calls' | 'uses' | 'depends-on';
  /** Relationship strength (0-1) */
  strength?: number;
  /** Additional context */
  context?: string;
}

/**
 * Code analysis result
 */
export interface AnalysisResult {
  /** Target identifier (file/chunk) */
  target: string;
  /** Quality metrics */
  qualityMetrics?: QualityMetrics;
  /** Complexity metrics */
  complexityMetrics?: ComplexityMetrics;
  /** Relationships */
  relationships?: CodeRelationship[];
  /** Improvement suggestions */
  suggestions?: string[];
  /** Refactoring recommendations */
  recommendations?: string[];
  /** Analysis timestamp */
  timestamp?: string;
}

/**
 * Response from code analysis
 */
export interface AnalysisResponse extends ApiResponse<AnalysisResult> {
  /** Analysis result */
  analysis?: AnalysisResult;
  /** Analysis summary */
  summary?: string;
}

/**
 * File analysis result
 */
export interface FileAnalysisResult extends AnalysisResult {
  /** File path */
  filePath: string;
  /** Programming language */
  language?: string;
  /** Chunks in file */
  chunks?: ChunkInfo[];
}

/**
 * Response from file analysis
 */
export interface FileAnalysisResponse extends ApiResponse<FileAnalysisResult> {
  /** File metrics */
  fileMetrics?: FileAnalysisResult;
}

/**
 * Dependency information
 */
export interface DependencyInfo {
  /** Element identifier */
  id: string;
  /** Element type */
  type: string;
  /** Dependency depth */
  depth: number;
  /** Whether this is a direct dependency */
  isDirect: boolean;
}

/**
 * Response from dependency analysis
 */
export interface DependencyResponse extends ApiResponse {
  /** Dependencies (things this depends on) */
  dependencies?: DependencyInfo[];
  /** Dependents (things that depend on this) */
  dependents?: DependencyInfo[];
  /** Dependency graph metadata */
  metadata?: {
    totalDependencies: number;
    totalDependents: number;
    maxDepth: number;
  };
}

/**
 * Batch analysis result
 */
export interface BatchAnalysisResult {
  /** Target identifier */
  target: string;
  /** Whether analysis succeeded */
  success: boolean;
  /** Analysis result */
  result?: AnalysisResult;
  /** Error message if failed */
  error?: string;
}

/**
 * Response from batch analysis
 */
export interface BatchAnalysisResponse extends ApiResponse {
  /** Total operations */
  totalOperations?: number;
  /** Successful operations */
  successfulOperations?: number;
  /** Failed operations */
  failedOperations?: number;
  /** Individual analysis results */
  analysisResults?: BatchAnalysisResult[];
  /** Batch metadata */
  metadata?: ResponseMetadata;
}

// ============================================================================
// Chunking Types
// ============================================================================

/**
 * Code chunk information
 */
export interface ChunkInfo {
  /** Unique chunk ID */
  id: string;
  /** File path */
  filePath: string;
  /** Start line number */
  startLine: number;
  /** End line number */
  endLine: number;
  /** Chunk content */
  content: string;
  /** Semantic type */
  semanticType?: SemanticType;
  /** Chunk size (tokens/characters) */
  size: number;
  /** Complexity score */
  complexity?: number;
  /** Quality score */
  quality?: number;
  /** Related chunk IDs */
  relatedChunks?: string[];
}

/**
 * Chunking summary
 */
export interface ChunkingSummary {
  /** Total chunks created */
  totalChunks: number;
  /** Total files processed */
  totalFiles: number;
  /** Average chunk size */
  averageChunkSize: number;
  /** Strategy used */
  strategy: string;
  /** Processing duration in ms */
  duration?: number;
}

/**
 * Response from chunking
 */
export interface ChunkingResponse extends ApiResponse {
  /** Created chunks */
  chunks?: ChunkInfo[];
  /** Chunking summary */
  summary?: ChunkingSummary;
  /** Response metadata */
  metadata?: ResponseMetadata;
}

/**
 * Response from listing chunks
 */
export interface ListChunksResponse
  extends ApiResponse<PaginatedResponse<ChunkInfo>> {
  /** Chunks */
  chunks?: ChunkInfo[];
  /** Pagination info */
  pagination?: {
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  };
  /** Metadata */
  metadata?: ResponseMetadata;
}

/**
 * Chunk metadata response
 */
export interface ChunkMetadataResponse extends ApiResponse {
  /** Chunk metadata */
  metadata?: {
    id: string;
    semanticType?: SemanticType;
    complexity?: number;
    quality?: number;
    size: number;
  };
  /** Relationships */
  relationships?: CodeRelationship[];
  /** Quality metrics */
  qualityMetrics?: QualityMetrics;
  /** Response metadata */
  responseMetadata?: ResponseMetadata;
}

/**
 * Chunk context information
 */
export interface ChunkContext {
  /** Target chunk */
  chunk: ChunkInfo;
  /** File-level context */
  fileContext?: string;
  /** Surrounding chunks */
  surroundingChunks?: ChunkInfo[];
  /** Architectural context */
  architecturalContext?: string;
  /** Business domain context */
  businessContext?: string;
}

/**
 * Response from getting chunk context
 */
export interface ChunkContextResponse extends ApiResponse<ChunkContext> {
  /** Context information */
  context?: ChunkContext;
  /** Metadata */
  metadata?: ResponseMetadata;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration value response
 */
export interface ConfigValueResponse extends ApiResponse {
  /** Configuration key */
  key?: string;
  /** Configuration value */
  value?: unknown;
}

/**
 * Configuration schema
 */
export interface ConfigSchema {
  /** Configuration keys */
  availableKeys: string[];
  /** Schema definition */
  schema: Record<
    string,
    {
      type: string;
      description: string;
      default?: unknown;
      required?: boolean;
    }
  >;
}

/**
 * Response from getting config schema
 */
export interface ConfigSchemaResponse extends ApiResponse<ConfigSchema> {
  /** Schema information */
  schema?: ConfigSchema;
}

/**
 * Config validation result
 */
export interface ConfigValidation {
  /** Whether config is valid */
  isValid: boolean;
  /** Validation errors */
  errors?: string[];
  /** Validation warnings */
  warnings?: string[];
}

/**
 * Response from config validation
 */
export interface ConfigValidationResponse
  extends ApiResponse<ConfigValidation> {
  /** Validation result */
  validation?: ConfigValidation;
}

/**
 * Response from config export
 */
export interface ExportConfigResponse extends ApiResponse {
  /** Export file path */
  filePath?: string;
}

/**
 * Response from config import
 */
export interface ImportConfigResponse extends ApiResponse {
  /** Imported configuration keys */
  importedKeys?: string[];
}

// ============================================================================
// Git Integration Types
// ============================================================================

/**
 * Git branch information
 */
export interface GitBranchInfo {
  /** Current branch name */
  currentBranch: string;
  /** Current commit hash */
  commitHash: string;
  /** Remote URL */
  remoteUrl?: string;
  /** Whether there are uncommitted changes */
  hasChanges: boolean;
  /** List of all branches */
  branches?: string[];
}

/**
 * Response from Git branch info
 */
export interface GitBranchInfoResponse extends ApiResponse<GitBranchInfo> {
  /** Branch information */
  branchInfo?: GitBranchInfo;
}

/**
 * Git commit result
 */
export interface GitCommitResult {
  /** Commit hash */
  commitHash: string;
  /** Branch name */
  branch: string;
  /** Commit message */
  message: string;
  /** Files committed */
  filesCommitted?: number;
}

/**
 * Response from Git commit creation
 */
export interface GitCommitResponse extends ApiResponse<GitCommitResult> {
  /** Commit result */
  commit?: GitCommitResult;
}

/**
 * Git comparison result.
 *
 * The difference shape here is deliberately **not** `FileDifference` above.
 * `compareSnapshotWithGitCommit` returns one entry per changed *file*, and
 * `commands/git.ts` reads `diff.file`, `diff.changeType`, `diff.linesAdded` and
 * `diff.linesRemoved`. `FileDifference` describes a per-line edit
 * (`lineNumber`, `type`, `oldContent`, `newContent`) and would silently mistype
 * every field. This matches `GitComparisonResult` in
 * `src/services/cliConnectorService.ts` on the extension side.
 */
export interface GitFileDifference {
  /** Repository-relative path of the changed file */
  file: string;
  /** How the file changed */
  changeType: 'added' | 'modified' | 'deleted';
  /** Lines added, when the caller asked for the file list */
  linesAdded?: number;
  /** Lines removed, when the caller asked for the file list */
  linesRemoved?: number;
}

export interface GitComparisonResult {
  /** Differences found */
  differences: GitFileDifference[];
  /** File changes summary */
  fileChanges?: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
}

/**
 * Response from Git comparison
 */
export interface GitComparisonResponse
  extends ApiResponse<GitComparisonResult> {
  /** Comparison result */
  comparison?: GitComparisonResult;
}

// ============================================================================
// Rules and Automation Types
// ============================================================================

/**
 * Auto-snapshot rule
 */
export interface AutoSnapshotRule {
  /** Rule ID */
  id: string;
  /** File pattern */
  pattern: string;
  /** Interval in minutes */
  intervalMinutes: number;
  /** Whether rule is enabled */
  enabled: boolean;
  /** Rule description */
  description?: string;
  /** Tags to apply */
  tags?: string[];
  /** Last triggered timestamp */
  lastTriggered?: string;
  /** Number of times triggered */
  triggerCount?: number;
}

/**
 * Response from getting rules
 */
export interface GetRulesResponse extends ApiResponse {
  /** Auto-snapshot rules */
  rules?: AutoSnapshotRule[];
}

/**
 * Response from rule mutation (add/update/delete)
 */
export interface RuleMutationResponse extends ApiResponse {
  /** Affected rule */
  rule?: AutoSnapshotRule;
}

/**
 * Rule test result
 */
export interface RuleTestResult {
  /** Whether pattern matched */
  matches: boolean;
  /** Matched files/paths */
  matchedPaths?: string[];
}

/**
 * Response from rule testing
 */
export interface RuleTestResponse extends ApiResponse<RuleTestResult> {
  /** Test result */
  result?: RuleTestResult;
}

// ============================================================================
// Diagnostics Types
// ============================================================================

/**
 * Diagnostic severity level
 */
export type DiagnosticLevel = 'info' | 'warning' | 'error';

/**
 * Diagnostic result
 */
export interface DiagnosticResult {
  /** Diagnostic category */
  category: string;
  /** Severity level */
  level: DiagnosticLevel;
  /** Diagnostic message */
  message: string;
  /** Additional details */
  details?: unknown;
  /** Timestamp */
  timestamp: string;
}

/**
 * System information
 */
export interface SystemInfo {
  /** CLI version */
  version: string;
  /** Workspace path */
  workspace: string | null;
  /** Snapshot storage location */
  snapshotLocation: string;
  /** Total snapshots */
  totalSnapshots: number;
  /** Disk usage */
  diskUsage: string;
  /** Whether in Git repository */
  gitRepository: boolean;
  /** Current Git branch */
  gitBranch?: string;
  /** Extension version */
  extensionVersion: string;
  /** Node.js version */
  nodeVersion: string;
  /** Platform */
  platform: string;
  /** Architecture */
  architecture: string;
}

/**
 * Response from diagnostics
 */
export interface DiagnosticsResponse extends ApiResponse {
  /** Diagnostic results */
  diagnostics?: DiagnosticResult[];
  /** System information */
  systemInfo?: SystemInfo;
  /** Diagnostics summary */
  summary?: {
    totalIssues: number;
    errors: number;
    warnings: number;
    info: number;
  };
}

/**
 * Response from system info
 */
export interface SystemInfoResponse extends ApiResponse<SystemInfo> {
  /** System information */
  systemInfo?: SystemInfo;
}

/**
 * Log entry
 */
export interface LogEntry {
  /** Timestamp */
  timestamp: string;
  /** Log level */
  level: DiagnosticLevel;
  /** Log message */
  message: string;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Response from getting logs
 */
export interface LogsResponse extends ApiResponse {
  /** Log entries */
  logs?: LogEntry[];
  /** Total entries available */
  totalEntries?: number;
}

/**
 * Response from clearing logs
 */
export interface ClearLogsResponse extends ApiResponse {
  /** Number of entries cleared */
  clearedEntries?: number;
}

/**
 * Health check issue
 */
export interface HealthIssue {
  /** Issue category */
  category: string;
  /** Severity level */
  level: DiagnosticLevel;
  /** Issue description */
  description: string;
  /** Suggested fix */
  fix?: string;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  /** Overall health status */
  health: 'healthy' | 'degraded' | 'unhealthy';
  /** Health score (0-100) */
  score: number;
  /** Detected issues */
  issues: HealthIssue[];
}

/**
 * Response from health check
 */
export interface HealthCheckResponse extends ApiResponse<HealthCheckResult> {
  /** Health check result */
  health?: HealthCheckResult;
}

/**
 * Performance metric
 */
export interface PerformanceMetric {
  /** Metric name */
  name: string;
  /** Current value */
  value: number;
  /** Unit of measurement */
  unit: string;
  /** Whether this is within acceptable range */
  isHealthy: boolean;
}

/**
 * Response from performance metrics
 */
export interface PerformanceMetricsResponse extends ApiResponse {
  /** Current metrics */
  metrics?: PerformanceMetric[];
  /** Historical data */
  history?: Array<{
    timestamp: string;
    metrics: PerformanceMetric[];
  }>;
}

// ============================================================================
// Workspace Types
// ============================================================================

/**
 * Workspace information
 */
export interface WorkspaceInfo {
  /** Workspace root path */
  rootPath: string;
  /** Workspace name */
  name: string;
  /** Whether this is a Git repository */
  isGitRepository: boolean;
  /** Current Git branch */
  gitBranch?: string;
  /** Total files in workspace */
  totalFiles?: number;
  /** Programming languages detected */
  languages?: string[];
  /** Project type (if detectable) */
  projectType?: string;
}

/**
 * Response from workspace info
 */
export interface WorkspaceInfoResponse extends ApiResponse<WorkspaceInfo> {
  /** Workspace information */
  info?: WorkspaceInfo;
}

/**
 * Current workspace state
 */
export interface WorkspaceState {
  /** Open files in editor */
  openFiles: string[];
  /** Files with unsaved changes */
  changedFiles: string[];
  /** Currently active file */
  activeFile?: string;
}

/**
 * Response from workspace state
 */
export interface WorkspaceStateResponse extends ApiResponse<WorkspaceState> {
  /** Current state */
  state?: WorkspaceState;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Snapshot validation result
 */
export interface SnapshotValidation {
  /** Whether snapshot is valid */
  isValid: boolean;
  /** Validation issues */
  issues?: string[];
  /** Missing files */
  missingFiles?: string[];
  /** Corrupted files */
  corruptedFiles?: string[];
}

/**
 * Response from snapshot validation
 */
export interface ValidateSnapshotResponse
  extends ApiResponse<SnapshotValidation> {
  /** Validation result */
  validation?: SnapshotValidation;
}

/**
 * Response from snapshot export
 */
export interface ExportSnapshotResponse extends ApiResponse {
  /** Export file path */
  exportPath?: string;
  /** Export size in bytes */
  exportSize?: number;
}

// ============================================================================
// Snapshot Comparison Types
// ============================================================================

/**
 * File change in comparison
 */
export interface FileChange {
  /** File path */
  path: string;
  /** Change type */
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  /** Old path (for renames) */
  oldPath?: string;
  /** Lines added */
  linesAdded?: number;
  /** Lines removed */
  linesRemoved?: number;
}

/**
 * Snapshot comparison result
 */
export interface SnapshotComparison {
  /** First snapshot ID */
  snapshot1: string;
  /** Second snapshot ID */
  snapshot2: string;
  /** File changes */
  fileChanges: FileChange[];
  /** Summary statistics */
  summary: {
    filesAdded: number;
    filesModified: number;
    filesDeleted: number;
    totalLinesAdded: number;
    totalLinesRemoved: number;
  };
}

/**
 * Response from snapshot comparison
 */
export interface CompareSnapshotsResponse
  extends ApiResponse<SnapshotComparison> {
  /** Comparison result */
  comparison?: SnapshotComparison;
}

// ============================================================================
// Navigation Types
// ============================================================================

/**
 * Navigation direction
 */
export type NavigationDirection = 'next' | 'previous' | 'first' | 'last';

/**
 * Response from snapshot navigation
 */
export interface NavigateSnapshotResponse extends ApiResponse {
  /**
   * Current snapshot after navigation.
   *
   * This one really is an object: navigating returns the snapshot itself
   * (`terminalApiService.navigateSnapshot` hands back the entry from the
   * snapshot list), and `snapshot navigate` forwards the whole result.
   *
   * It is NOT the same field as `status`'s `currentSnapshot`, which is a
   * snapshot *id* (`string | null` in `client.ts`). Same name, different
   * envelope — do not "unify" them.
   */
  currentSnapshot?: SnapshotMetadata;
  /** Whether navigation was possible */
  success: boolean;
}
