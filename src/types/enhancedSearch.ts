/**
 * Enhanced Semantic Search Type Definitions
 *
 * This file contains comprehensive type definitions for enhanced semantic search features
 * including AI-optimized search options, result explanations, confidence scoring, and
 * rich metadata integration for better AI agent consumption.
 */

import {
  SemanticSearchOptions,
  SemanticSearchResult,
} from '../services/semanticSearchService';
import {
  EnhancedCodeChunk,
  QualityMetrics,
  ContextInfo,
  ChunkRelationship,
} from './enhancedChunking';

// ============================================================================
// Enhanced Search Options
// ============================================================================

/**
 * Enhanced semantic search options that extend base options with AI-agent-specific features
 */
export interface EnhancedSemanticSearchOptions extends SemanticSearchOptions {
  /** Search mode to use */
  searchMode: SearchMode;

  /** Whether to include detailed explanations in results */
  includeExplanations: boolean;

  /** Whether to include chunk relationships in results */
  includeRelationships: boolean;

  /** Whether to include quality metrics in results */
  includeQualityMetrics: boolean;

  /** Number of context lines to include around matches */
  contextRadius: number;

  /** Strategy for ranking results */
  rankingStrategy: RankingStrategy;

  /** Filter criteria for search results */
  filterCriteria: SearchFilterCriteria;

  /** Maximum results per file for diversity */
  maxResultsPerFile?: number;

  /** Whether to enable result diversification */
  enableDiversification?: boolean;

  /** Query enhancement options */
  queryEnhancement?: QueryEnhancementOptions;

  /** Response formatting options */
  responseFormat?: ResponseFormatOptions;
}

/**
 * Search modes available for enhanced semantic search
 */
export type SearchMode =
  | 'semantic' // Pure semantic similarity search
  | 'syntactic' // Syntax-based pattern matching
  | 'behavioral' // Behavior and functionality-based search
  | 'hybrid'; // Combination of multiple modes

/**
 * Ranking strategies for search results
 */
export type RankingStrategy =
  | 'relevance' // Pure relevance-based ranking
  | 'quality' // Quality metrics weighted ranking
  | 'recency' // Recent modifications weighted
  | 'usage' // Usage patterns weighted
  | 'balanced'; // Balanced multi-criteria ranking

/**
 * Filter criteria for refining search results
 */
export interface SearchFilterCriteria {
  /** Complexity score range filter */
  complexityRange?: [number, number];

  /** Minimum quality threshold */
  qualityThreshold?: number;

  /** Semantic types to include */
  semanticTypes?: string[];

  /** Design patterns to include */
  designPatterns?: string[];

  /** Code smells to exclude */
  excludeCodeSmells?: string[];

  /** Business domains to include */
  businessDomains?: string[];

  /** Architectural layers to include */
  architecturalLayers?: string[];

  /** Minimum test coverage threshold */
  minTestCoverage?: number;

  /** Maximum technical debt severity */
  maxTechnicalDebtSeverity?: 'low' | 'medium' | 'high' | 'critical';

  /** File path patterns to include */
  includeFilePatterns?: string[];

  /** File path patterns to exclude */
  excludeFilePatterns?: string[];

  /** Date range for last modified */
  lastModifiedRange?: [Date, Date];
}

/**
 * Query enhancement options
 */
export interface QueryEnhancementOptions {
  /** Enable automatic query expansion */
  enableExpansion: boolean;

  /** Enable intent classification */
  enableIntentClassification: boolean;

  /** Enable context-aware enhancement */
  enableContextAware: boolean;

  /** Custom enhancement rules */
  customRules?: QueryEnhancementRule[];
}

/**
 * Custom query enhancement rule
 */
export interface QueryEnhancementRule {
  /** Pattern to match in query */
  pattern: string;

  /** Replacement or enhancement text */
  enhancement: string;

  /** Rule priority */
  priority: number;
}

/**
 * Response formatting options
 */
export interface ResponseFormatOptions {
  /** Output format */
  format: 'json' | 'yaml' | 'csv' | 'markdown';

  /** Include metadata in response */
  includeMetadata: boolean;

  /** Include performance metrics */
  includePerformanceMetrics: boolean;

  /** Compress large responses */
  enableCompression: boolean;

  /** Maximum response size in bytes */
  maxResponseSize?: number;
}

// ============================================================================
// Enhanced Search Results
// ============================================================================

/**
 * Enhanced semantic search result with rich metadata and explanations
 */
export interface EnhancedSemanticSearchResult extends SemanticSearchResult {
  /** Detailed explanation of why this result is relevant */
  explanation: SearchResultExplanation;

  /** Relationships to other code chunks */
  relationships: ChunkRelationship[];

  /** Quality metrics for this code chunk */
  qualityMetrics: QualityMetrics;

  /** Context information */
  contextInfo: ContextInfo;

  /** Actionable suggestions based on the result */
  suggestions: ActionableSuggestion[];

  /** Alternative similar results */
  alternatives: AlternativeResult[];

  /** Enhanced metadata */
  enhancedMetadata: EnhancedResultMetadata;
}

/**
 * Detailed explanation of search result relevance
 */
export interface SearchResultExplanation {
  /** Why this result is relevant to the query */
  whyRelevant: string;

  /** Key features that matched the query */
  keyFeatures: string[];

  /** Concepts that were matched */
  matchedConcepts: string[];

  /** Confidence factors contributing to the score */
  confidenceFactors: ConfidenceFactor[];

  /** Semantic similarity explanation */
  semanticSimilarity: string;

  /** Behavioral similarity explanation */
  behavioralSimilarity?: string;
}

/**
 * Confidence factor contributing to result relevance
 */
export interface ConfidenceFactor {
  /** Name of the factor */
  factor: string;

  /** Weight of this factor (0-1) */
  weight: number;

  /** Description of how this factor contributes */
  description: string;

  /** Actual value for this factor */
  value: number;
}

/**
 * Actionable suggestion based on search result
 */
export interface ActionableSuggestion {
  /** Type of suggestion */
  type:
    | 'improvement'
    | 'usage'
    | 'refactoring'
    | 'testing'
    | 'documentation'
    | 'security';

  /** Description of the suggestion */
  description: string;

  /** Priority level */
  priority: 'low' | 'medium' | 'high' | 'critical';

  /** Estimated effort required */
  effort: 'minimal' | 'moderate' | 'significant' | 'major';

  /** Specific action to take */
  action?: string;

  /** Expected benefit */
  expectedBenefit?: string;
}

/**
 * Alternative result that's similar to the main result
 */
export interface AlternativeResult {
  /** Reference to the alternative chunk */
  chunkId: string;

  /** Similarity score to the main result */
  similarityScore: number;

  /** Brief description of the alternative */
  description: string;

  /** Key differences from the main result */
  differences: string[];

  /** When to prefer this alternative */
  preferWhen?: string;
}

/**
 * Enhanced metadata for search results
 */
export interface EnhancedResultMetadata {
  /** Semantic type of the code */
  semanticType:
    | 'function'
    | 'class'
    | 'interface'
    | 'module'
    | 'config'
    | 'test'
    | 'documentation';

  /** Design patterns detected */
  designPatterns: string[];

  /** Architectural layer */
  architecturalLayer: string;

  /** Business domain */
  businessDomain?: string;

  /** Framework context */
  frameworkContext: string[];

  /** Dependencies */
  dependencies: string[];

  /** Usage frequency */
  usageFrequency: number;

  /** Last modification timestamp */
  lastModified: number;

  /** Code complexity metrics */
  complexityMetrics: ComplexityMetrics;

  /** Security considerations */
  securityConsiderations: SecurityConsideration[];
}

/**
 * Code complexity metrics
 */
export interface ComplexityMetrics {
  /** Cyclomatic complexity */
  cyclomaticComplexity: number;

  /** Cognitive complexity */
  cognitiveComplexity: number;

  /** Lines of code */
  linesOfCode: number;

  /** Number of parameters */
  parameterCount?: number;

  /** Nesting depth */
  nestingDepth: number;

  /** Maintainability index */
  maintainabilityIndex: number;
}

/**
 * Security consideration for code
 */
export interface SecurityConsideration {
  /** Type of security concern */
  type: 'vulnerability' | 'best_practice' | 'compliance' | 'data_handling';

  /** Severity level */
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';

  /** Description of the concern */
  description: string;

  /** Recommendation for addressing */
  recommendation?: string;
}

// ============================================================================
// Query Processing Types
// ============================================================================

/**
 * Processed query with enhanced understanding
 */
export interface ProcessedQuery {
  /** Original query string */
  originalQuery: string;

  /** Enhanced query string */
  enhancedQuery: string;

  /** Detected intent */
  intent: QueryIntent;

  /** Search strategy to use */
  searchStrategy: SearchStrategy;

  /** Applied filters */
  filters: SearchFilterCriteria;

  /** Expected result types */
  expectedResultTypes: string[];

  /** Query complexity score */
  complexityScore: number;

  /** Processing metadata */
  processingMetadata: QueryProcessingMetadata;
}

/**
 * Query intent classification
 */
export interface QueryIntent {
  /** Primary intent */
  primary:
    | 'find_implementation'
    | 'find_usage'
    | 'find_similar'
    | 'analyze_quality'
    | 'find_patterns'
    | 'understand_behavior'
    | 'find_examples'
    | 'debug_issue';

  /** Secondary intents */
  secondary: string[];

  /** Confidence in intent classification */
  confidence: number;

  /** Context keywords that influenced classification */
  context: string[];

  /** Suggested search parameters based on intent */
  suggestedParameters: Partial<EnhancedSemanticSearchOptions>;
}

/**
 * Search strategy configuration
 */
export interface SearchStrategy {
  /** Primary search mode */
  mode: SearchMode;

  /** Ranking approach */
  ranking: RankingStrategy;

  /** Enable result diversification */
  diversification: boolean;

  /** Context radius for results */
  contextRadius: number;

  /** Boost factors to apply */
  boostFactors: BoostFactor[];

  /** Penalty factors to apply */
  penaltyFactors: PenaltyFactor[];
}

/**
 * Boost factor for search ranking
 */
export interface BoostFactor {
  /** Condition that triggers the boost */
  condition: string;

  /** Multiplier to apply */
  multiplier: number;

  /** Description of the boost */
  description: string;

  /** Weight of this boost factor */
  weight: number;
}

/**
 * Penalty factor for search ranking
 */
export interface PenaltyFactor {
  /** Condition that triggers the penalty */
  condition: string;

  /** Multiplier to apply (< 1.0) */
  multiplier: number;

  /** Description of the penalty */
  description: string;

  /** Weight of this penalty factor */
  weight: number;
}

/**
 * Query processing metadata
 */
export interface QueryProcessingMetadata {
  /** Time taken to process query (ms) */
  processingTime: number;

  /** Enhancements applied */
  enhancementsApplied: string[];

  /** Filters automatically applied */
  autoFiltersApplied: string[];

  /** Warnings during processing */
  warnings: string[];

  /** Suggestions for query improvement */
  improvementSuggestions: string[];
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Batch search query
 */
export interface BatchSearchQuery {
  /** Unique identifier for this query */
  id: string;

  /** Search options */
  options: EnhancedSemanticSearchOptions;

  /** Priority for processing */
  priority: 'low' | 'normal' | 'high';

  /** Metadata for this query */
  metadata?: Record<string, any>;
}

/**
 * Batch search result
 */
export interface BatchSearchResult {
  /** Query ID */
  queryId: string;

  /** Success status */
  success: boolean;

  /** Results if successful */
  results?: EnhancedSemanticSearchResult[];

  /** Error if failed */
  error?: string;

  /** Processing time */
  processingTime: number;

  /** Result metadata */
  metadata: BatchResultMetadata;
}

/**
 * Batch result metadata
 */
export interface BatchResultMetadata {
  /** Total results found */
  totalResults: number;

  /** Results returned after filtering */
  returnedResults: number;

  /** Search strategy used */
  searchStrategy: SearchStrategy;

  /** Performance metrics */
  performanceMetrics: PerformanceMetrics;

  /** Cache hit information */
  cacheInfo: CacheInfo;
}

/**
 * Performance metrics for search operations
 */
export interface PerformanceMetrics {
  /** Query processing time */
  queryProcessingTime: number;

  /** Search execution time */
  searchTime: number;

  /** Result processing time */
  resultProcessingTime: number;

  /** Total time */
  totalTime: number;

  /** Memory usage peak */
  memoryUsage: number;

  /** Cache hit rate */
  cacheHitRate: number;

  /** Number of chunks searched */
  chunksSearched: number;

  /** Vector operations performed */
  vectorOperations: number;
}

/**
 * Cache information
 */
export interface CacheInfo {
  /** Whether result was cached */
  wasCached: boolean;

  /** Cache key used */
  cacheKey?: string;

  /** Cache hit rate for this session */
  sessionHitRate: number;

  /** Cache size */
  cacheSize: number;

  /** Cache expiry time */
  expiryTime?: number;
}

// ============================================================================
// AI Agent Response Format
// ============================================================================

/**
 * Structured response format optimized for AI agent consumption
 */
export interface AIAgentResponse {
  /** Success status */
  success: boolean;

  /** Response timestamp */
  timestamp: string;

  /** Total execution time */
  executionTime: number;

  /** Query information */
  query: {
    /** Original query */
    original: string;
    /** Processed query */
    processed: string;
    /** Detected intent */
    intent: QueryIntent;
  };

  /** Search results */
  results: EnhancedSemanticSearchResult[];

  /** Response metadata */
  metadata: ResponseMetadata;

  /** Suggestions for follow-up actions */
  suggestions: ResponseSuggestion[];

  /** Related queries that might be useful */
  relatedQueries: string[];

  /** Error information if applicable */
  error?: ErrorInfo;
}

/**
 * Response metadata
 */
export interface ResponseMetadata {
  /** Total results found */
  totalResults: number;

  /** Search strategy used */
  searchStrategy: SearchStrategy;

  /** Ranking applied */
  rankingApplied: RankingStrategy;

  /** Filters applied */
  filtersApplied: SearchFilterCriteria;

  /** Performance metrics */
  performanceMetrics: PerformanceMetrics;

  /** Quality metrics for the search */
  searchQualityMetrics: SearchQualityMetrics;
}

/**
 * Search quality metrics
 */
export interface SearchQualityMetrics {
  /** Average relevance score */
  averageRelevanceScore: number;

  /** Result diversity score */
  diversityScore: number;

  /** Coverage of different result types */
  typeCoverage: number;

  /** Confidence in result quality */
  qualityConfidence: number;
}

/**
 * Response suggestion for AI agents
 */
export interface ResponseSuggestion {
  /** Type of suggestion */
  type:
    | 'query_refinement'
    | 'related_search'
    | 'code_improvement'
    | 'workflow_optimization'
    | 'follow_up_action';

  /** Description of the suggestion */
  description: string;

  /** Suggested action or command */
  action?: string;

  /** Priority level */
  priority: 'low' | 'medium' | 'high';

  /** Expected benefit */
  expectedBenefit?: string;

  /** Context for when to use this suggestion */
  context?: string;
}

/**
 * Error information for failed operations
 */
export interface ErrorInfo {
  /** Error code */
  code: string;

  /** Error message */
  message: string;

  /** Error category */
  category:
    | 'query_processing'
    | 'search_execution'
    | 'result_formatting'
    | 'system_error';

  /** Error severity */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /** Suggestions for resolving the error */
  suggestions: string[];

  /** Whether the operation can be retried */
  retryable: boolean;

  /** Fallback options */
  fallbackOptions: string[];
}
