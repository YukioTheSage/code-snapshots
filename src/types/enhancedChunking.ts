/**
 * Enhanced Code Chunking Type Definitions
 *
 * This file contains comprehensive type definitions for enhanced code chunking features
 * including metadata, relationships, quality metrics, and context information.
 */

import { CodeChunk, ChunkMetadata } from '../services/codeChunker';

// ============================================================================
// Enhanced Code Chunk Interfaces
// ============================================================================

/**
 * Enhanced code chunk that extends the base CodeChunk with rich metadata,
 * relationships, quality metrics, and context information.
 */
export interface EnhancedCodeChunk extends CodeChunk {
  /** Enhanced metadata with semantic analysis and quality metrics */
  enhancedMetadata: EnhancedChunkMetadata;

  /** Relationships to other chunks (dependencies, calls, etc.) */
  relationships: ChunkRelationship[];

  /** Quality and complexity metrics for the chunk */
  qualityMetrics: QualityMetrics;

  /** Context information about surrounding code and architecture */
  contextInfo: ContextInfo;
}

/**
 * Enhanced chunk metadata that extends base metadata with semantic analysis,
 * complexity metrics, and architectural context.
 */
export interface EnhancedChunkMetadata extends ChunkMetadata {
  /** Semantic type classification of the code chunk */
  semanticType: SemanticType;

  /** Code complexity score (0-100, higher = more complex) */
  complexityScore: number;

  /** Maintainability index (0-100, higher = more maintainable) */
  maintainabilityIndex: number;

  /** List of dependencies (imports, requires, etc.) */
  dependencies: string[];

  /** List of dependents (what depends on this chunk) */
  dependents: string[];

  /** Business domain classification (optional) */
  businessDomain?: string;

  /** Detected design patterns in the code */
  designPatterns: string[];

  /** Identified code smells and anti-patterns */
  codeSmells: string[];

  /** Potential security concerns identified */
  securityConcerns: string[];

  /** Lines of code metrics */
  linesOfCode: LinesOfCodeMetrics;

  /** Test coverage information (if available) */
  testCoverage?: TestCoverageInfo;
}

// ============================================================================
// Semantic Type Classifications
// ============================================================================

/**
 * Semantic classification of code chunks based on their purpose and structure
 */
export type SemanticType =
  | 'function' // Function or method definition
  | 'class' // Class definition
  | 'interface' // Interface definition
  | 'type' // Type definition
  | 'enum' // Enumeration
  | 'module' // Module or namespace
  | 'config' // Configuration code
  | 'test' // Test code
  | 'documentation' // Documentation or comments
  | 'constant' // Constants or static data
  | 'utility' // Utility functions
  | 'component' // UI component (React, Vue, etc.)
  | 'service' // Service class or module
  | 'model' // Data model or entity
  | 'controller' // Controller or handler
  | 'middleware' // Middleware function
  | 'route' // Route definition
  | 'schema' // Database schema or validation schema
  | 'migration' // Database migration
  | 'fixture' // Test fixture or mock data
  | 'script' // Build script or automation
  | 'other'; // Other or unclassified

// ============================================================================
// Relationship Definitions
// ============================================================================

/**
 * Represents a relationship between code chunks
 */
export interface ChunkRelationship {
  /** Type of relationship */
  type: RelationshipType;

  /** ID of the target chunk */
  targetChunkId: string;

  /** Strength of the relationship (0-1, higher = stronger) */
  strength: number;

  /** Human-readable description of the relationship */
  description: string;

  /** Direction of the relationship */
  direction: RelationshipDirection;

  /** Additional metadata about the relationship */
  metadata?: RelationshipMetadata;
}

/**
 * Types of relationships between code chunks
 */
export type RelationshipType =
  | 'calls' // Function/method calls
  | 'imports' // Import/require statements
  | 'extends' // Class inheritance
  | 'implements' // Interface implementation
  | 'uses' // General usage or reference
  | 'tests' // Test relationship
  | 'mocks' // Mock or stub relationship
  | 'configures' // Configuration relationship
  | 'depends_on' // General dependency
  | 'similar_to' // Semantic similarity
  | 'overrides' // Method/property override
  | 'decorates' // Decorator pattern
  | 'composes' // Composition relationship
  | 'aggregates'; // Aggregation relationship

/**
 * Direction of the relationship
 */
export type RelationshipDirection = 'outgoing' | 'incoming' | 'bidirectional';

/**
 * Additional metadata for relationships
 */
export interface RelationshipMetadata {
  /** Line number where the relationship is established */
  lineNumber?: number;

  /** Confidence score for the relationship detection (0-1) */
  confidence: number;

  /** Source of the relationship detection */
  source: 'ast' | 'static_analysis' | 'semantic' | 'heuristic';

  /** Additional context or notes */
  context?: string;
}

// ============================================================================
// Quality Metrics
// ============================================================================

/**
 * Comprehensive quality metrics for code chunks
 */
export interface QualityMetrics {
  /** Overall quality score (0-100, higher = better quality) */
  overallScore: number;

  /** Readability score (0-100, higher = more readable) */
  readabilityScore: number;

  /** Test coverage percentage (0-100) */
  testCoverage?: number;

  /** Documentation ratio (0-1, comments/code ratio) */
  documentationRatio: number;

  /** Code duplication risk (0-100, higher = more duplication risk) */
  duplicationRisk: number;

  /** Performance risk assessment (0-100, higher = more performance risk) */
  performanceRisk: number;

  /** Security risk assessment (0-100, higher = more security risk) */
  securityRisk: number;

  /** Maintainability score (0-100, higher = more maintainable) */
  maintainabilityScore: number;

  /** Technical debt indicators */
  technicalDebt: TechnicalDebtMetrics;

  /** Code style compliance score (0-100) */
  styleComplianceScore?: number;
}

/**
 * Technical debt metrics
 */
export interface TechnicalDebtMetrics {
  /** Estimated time to fix technical debt (in hours) */
  estimatedFixTime: number;

  /** Severity of technical debt */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /** Categories of technical debt present */
  categories: TechnicalDebtCategory[];

  /** Specific issues identified */
  issues: TechnicalDebtIssue[];
}

/**
 * Categories of technical debt
 */
export type TechnicalDebtCategory =
  | 'code_smells'
  | 'security_vulnerabilities'
  | 'performance_issues'
  | 'maintainability_issues'
  | 'documentation_gaps'
  | 'test_coverage_gaps'
  | 'architectural_violations'
  | 'style_violations';

/**
 * Specific technical debt issue
 */
export interface TechnicalDebtIssue {
  /** Category of the issue */
  category: TechnicalDebtCategory;

  /** Description of the issue */
  description: string;

  /** Severity of the issue */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /** Suggested fix or improvement */
  suggestion?: string;

  /** Line number where the issue occurs */
  lineNumber?: number;

  /** Estimated effort to fix (in hours) */
  estimatedEffort?: number;
}

// ============================================================================
// Context Information
// ============================================================================

/**
 * Context information about the code chunk and its environment
 */
export interface ContextInfo {
  /** Code context around the chunk (surrounding lines) */
  surroundingContext: string;

  /** Architectural layer classification */
  architecturalLayer: ArchitecturalLayer;

  /** Frameworks and libraries used in this context */
  frameworkContext: string[];

  /** Business context description */
  businessContext?: string;

  /** File-level context information */
  fileContext: FileContext;

  /** Project-level context information */
  projectContext?: ProjectContext;

  /** Git context information */
  gitContext?: GitContext;
}

/**
 * Architectural layer classification
 */
export type ArchitecturalLayer =
  | 'presentation' // UI/View layer
  | 'business' // Business logic layer
  | 'data' // Data access layer
  | 'service' // Service layer
  | 'infrastructure' // Infrastructure/utility layer
  | 'test' // Test layer
  | 'configuration' // Configuration layer
  | 'unknown'; // Unknown or mixed

/**
 * File-level context information
 */
export interface FileContext {
  /** Total lines in the file */
  totalLines: number;

  /** File size in bytes */
  fileSize: number;

  /** File creation date */
  createdDate?: Date;

  /** Last modified date */
  lastModified: Date;

  /** File encoding */
  encoding?: string;

  /** Other chunks in the same file */
  siblingChunks: string[];
}

/**
 * Project-level context information
 */
export interface ProjectContext {
  /** Project name */
  projectName?: string;

  /** Project type (web, mobile, library, etc.) */
  projectType?: string;

  /** Main programming languages used */
  primaryLanguages: string[];

  /** Build tools and package managers */
  buildTools: string[];

  /** Testing frameworks used */
  testingFrameworks: string[];

  /** Project size metrics */
  projectSize: ProjectSizeMetrics;
}

/**
 * Project size metrics
 */
export interface ProjectSizeMetrics {
  /** Total lines of code in project */
  totalLinesOfCode: number;

  /** Number of files in project */
  totalFiles: number;

  /** Number of directories */
  totalDirectories: number;

  /** Project complexity score */
  complexityScore: number;
}

/**
 * Git context information
 */
export interface GitContext {
  /** Current branch name */
  currentBranch?: string;

  /** Last commit hash */
  lastCommitHash?: string;

  /** Last commit date */
  lastCommitDate?: Date;

  /** Number of commits affecting this chunk */
  commitCount?: number;

  /** Contributors who modified this chunk */
  contributors?: string[];

  /** File change frequency */
  changeFrequency?: 'low' | 'medium' | 'high';
}

// ============================================================================
// Lines of Code Metrics
// ============================================================================

/**
 * Detailed lines of code metrics
 */
export interface LinesOfCodeMetrics {
  /** Total lines including empty lines and comments */
  total: number;

  /** Lines containing actual code */
  code: number;

  /** Lines containing only comments */
  comments: number;

  /** Empty or whitespace-only lines */
  blank: number;

  /** Mixed lines (code + comments) */
  mixed: number;

  /** Logical lines of code (statements) */
  logical?: number;
}

// ============================================================================
// Test Coverage Information
// ============================================================================

/**
 * Test coverage information for the code chunk
 */
export interface TestCoverageInfo {
  /** Line coverage percentage (0-100) */
  lineCoverage: number;

  /** Branch coverage percentage (0-100) */
  branchCoverage?: number;

  /** Function coverage percentage (0-100) */
  functionCoverage?: number;

  /** Statement coverage percentage (0-100) */
  statementCoverage?: number;

  /** Uncovered lines */
  uncoveredLines: number[];

  /** Test files that cover this chunk */
  testFiles: string[];

  /** Coverage tool used */
  coverageTool?: string;

  /** Coverage data timestamp */
  timestamp?: Date;
}

// ============================================================================
// Chunking Strategy Interfaces
// ============================================================================

/**
 * Interface for different chunking strategies
 */
export interface ChunkingStrategy {
  /** Strategy name */
  name: string;

  /** Strategy description */
  description: string;

  /** Check if strategy is applicable for given language/content */
  isApplicable(language: string, content: string): boolean;

  /** Perform chunking with this strategy */
  chunk(
    content: string,
    filePath: string,
    snapshotId: string,
  ): Promise<EnhancedCodeChunk[]>;

  /** Strategy configuration options */
  options?: ChunkingStrategyOptions;
}

/**
 * Configuration options for chunking strategies
 */
export interface ChunkingStrategyOptions {
  /** Maximum chunk size in lines */
  maxChunkSize?: number;

  /** Minimum chunk size in lines */
  minChunkSize?: number;

  /** Overlap between chunks in lines */
  overlapSize?: number;

  /** Whether to preserve semantic boundaries */
  preserveSemanticBoundaries?: boolean;

  /** Whether to include context around chunks */
  includeContext?: boolean;

  /** Context radius in lines */
  contextRadius?: number;

  /** Additional strategy-specific options */
  [key: string]: any;
}

// ============================================================================
// Validation and Serialization Interfaces
// ============================================================================

/**
 * Validation result for enhanced metadata
 */
export interface ValidationResult {
  /** Whether validation passed */
  isValid: boolean;

  /** Validation errors */
  errors: ValidationError[];

  /** Validation warnings */
  warnings: ValidationWarning[];

  /** Validation score (0-100) */
  score: number;
}

/**
 * Validation error
 */
export interface ValidationError {
  /** Error code */
  code: string;

  /** Error message */
  message: string;

  /** Field path where error occurred */
  field: string;

  /** Error severity */
  severity: 'error' | 'warning' | 'info';
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  /** Warning code */
  code: string;

  /** Warning message */
  message: string;

  /** Field path where warning occurred */
  field: string;

  /** Suggested fix */
  suggestion?: string;
}

/**
 * Serialization options for enhanced chunks
 */
export interface SerializationOptions {
  /** Include relationships in serialization */
  includeRelationships?: boolean;

  /** Include quality metrics */
  includeQualityMetrics?: boolean;

  /** Include context information */
  includeContext?: boolean;

  /** Compression level (0-9) */
  compressionLevel?: number;

  /** Output format */
  format?: 'json' | 'binary' | 'compressed';

  /** Pretty print JSON */
  prettyPrint?: boolean;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Partial enhanced code chunk for updates
 */
export type PartialEnhancedCodeChunk = Partial<EnhancedCodeChunk> & {
  id: string;
};

/**
 * Enhanced chunk summary for listings
 */
export interface EnhancedChunkSummary {
  /** Chunk ID */
  id: string;

  /** File path */
  filePath: string;

  /** Semantic type */
  semanticType: SemanticType;

  /** Quality score */
  qualityScore: number;

  /** Complexity score */
  complexityScore: number;

  /** Number of relationships */
  relationshipCount: number;

  /** Lines of code */
  linesOfCode: number;

  /** Last modified date */
  lastModified: Date;
}

/**
 * Batch operation result
 */
export interface BatchOperationResult<T> {
  /** Successful operations */
  successful: T[];

  /** Failed operations with errors */
  failed: Array<{
    item: any;
    error: string;
  }>;

  /** Total operations attempted */
  total: number;

  /** Success rate (0-1) */
  successRate: number;

  /** Processing time in milliseconds */
  processingTime: number;
}
