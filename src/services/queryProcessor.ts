/**
 * Query Processor Service
 *
 * Provides intelligent query processing and enhancement for AI agents including:
 * - Natural language query understanding and intent classification
 * - Query enhancement with relevant technical terms and context
 * - Query decomposition for complex multi-part queries
 * - Query validation and suggestion system for better search results
 */

import { log, logVerbose } from '../logger';
import {
  ProcessedQuery,
  QueryIntent,
  SearchStrategy,
  SearchMode,
  RankingStrategy,
  BoostFactor,
  PenaltyFactor,
  QueryProcessingMetadata,
  EnhancedSemanticSearchOptions,
  SearchFilterCriteria,
} from '../types/enhancedSearch';

/**
 * Context information for query processing
 */
export interface QueryContext {
  /** Programming language context */
  language?: string;
  /** Current file being worked on */
  currentFile?: string;
  /** Recent search queries for context */
  recentSearches?: string[];
  /** Type of AI agent making the query */
  agentType?: string;
  /** Workspace information */
  workspaceContext?: WorkspaceInfo;
  /** Available snapshots */
  availableSnapshots?: string[];
}

/**
 * Workspace information for context
 */
export interface WorkspaceInfo {
  /** Primary programming languages in workspace */
  primaryLanguages: string[];
  /** Framework/library context */
  frameworks: string[];
  /** Project type (web, mobile, desktop, etc.) */
  projectType?: string;
  /** Architecture patterns detected */
  architecturePatterns: string[];
}

/**
 * Sub-query for complex query decomposition
 */
export interface SubQuery {
  /** Sub-query text */
  query: string;
  /** Intent of this sub-query */
  intent: QueryIntent;
  /** Priority for execution */
  priority: 'high' | 'medium' | 'low';
  /** Dependencies on other sub-queries */
  dependencies: string[];
  /** Expected result type */
  expectedResultType: string;
}

/**
 * Enhanced query with expansion and context
 */
export interface EnhancedQuery {
  /** Original query */
  original: string;
  /** Enhanced query text */
  enhanced: string;
  /** Added terms for expansion */
  addedTerms: string[];
  /** Context keywords */
  contextKeywords: string[];
  /** Confidence in enhancement */
  confidence: number;
}

/**
 * Query validation result
 */
export interface QueryValidationResult {
  /** Whether query is valid */
  isValid: boolean;
  /** Validation issues found */
  issues: ValidationIssue[];
  /** Suggestions for improvement */
  suggestions: QuerySuggestion[];
  /** Estimated result quality */
  estimatedQuality: number;
}

/**
 * Validation issue
 */
export interface ValidationIssue {
  /** Type of issue */
  type:
    | 'ambiguous'
    | 'too_broad'
    | 'too_narrow'
    | 'unclear_intent'
    | 'missing_context';
  /** Severity level */
  severity: 'low' | 'medium' | 'high';
  /** Description of the issue */
  description: string;
  /** Suggested fix */
  suggestedFix?: string;
}

/**
 * Query suggestion
 */
export interface QuerySuggestion {
  /** Type of suggestion */
  type: 'refinement' | 'expansion' | 'alternative' | 'context_addition';
  /** Suggested query text */
  suggestedQuery: string;
  /** Explanation of the suggestion */
  explanation: string;
  /** Expected improvement */
  expectedImprovement: string;
}

/**
 * Query Processor Service
 */
export class QueryProcessor {
  private intentPatterns: Map<string, RegExp[]> = new Map();
  private technicalTerms: Map<string, string[]> = new Map();
  private contextualEnhancements: Map<string, string[]> = new Map();

  constructor() {
    this.initializePatterns();
    this.initializeTechnicalTerms();
    this.initializeContextualEnhancements();
  }

  /**
   * Process a query with full enhancement and analysis
   */
  async processQuery(
    query: string,
    context: QueryContext = {},
  ): Promise<ProcessedQuery> {
    const startTime = Date.now();

    try {
      logVerbose(`Processing query: "${query}"`);

      // Validate the query first
      const validation = await this.validateQuery(query, context);

      // Classify intent
      const intent = await this.classifyIntent(query, context);

      // Enhance the query
      const enhancedQuery = await this.enhanceQuery(query, intent, context);

      // Determine search strategy
      const searchStrategy = this.determineSearchStrategy(intent, context);

      // Apply filters based on intent and context
      const filters = this.determineFilters(intent, context);

      // Get expected result types
      const expectedResultTypes = this.getExpectedResultTypes(intent);

      // Calculate complexity score
      const complexityScore = this.calculateQueryComplexity(query);

      const processingTime = Date.now() - startTime;

      const processingMetadata: QueryProcessingMetadata = {
        processingTime,
        enhancementsApplied: enhancedQuery.addedTerms,
        autoFiltersApplied: Object.keys(filters),
        warnings: validation.issues
          .filter((i) => i.severity === 'high')
          .map((i) => i.description),
        improvementSuggestions: validation.suggestions.map(
          (s) => s.explanation,
        ),
      };

      const processedQuery: ProcessedQuery = {
        originalQuery: query,
        enhancedQuery: enhancedQuery.enhanced,
        intent,
        searchStrategy,
        filters,
        expectedResultTypes,
        complexityScore,
        processingMetadata,
      };

      logVerbose(`Query processed in ${processingTime}ms`);
      return processedQuery;
    } catch (error) {
      log(`Error processing query: ${error}`);
      throw new Error(`Query processing failed: ${error}`);
    }
  }

  /**
   * Classify the intent of a search query
   */
  async classifyIntent(
    query: string,
    context: QueryContext = {},
  ): Promise<QueryIntent> {
    const lowerQuery = query.toLowerCase();
    const words = lowerQuery.split(/\s+/);

    let primary: QueryIntent['primary'] = 'find_implementation';
    const secondary: string[] = [];
    const contextKeywords: string[] = [];
    let confidence = 0.7;

    // Analyze query patterns for intent classification
    let bestMatch: { intent: QueryIntent['primary']; confidence: number } = {
      intent: primary,
      confidence: confidence,
    };

    for (const [intentType, patterns] of this.intentPatterns) {
      for (const pattern of patterns) {
        if (pattern.test(lowerQuery)) {
          let newConfidence = 0.7;
          let newPrimary: QueryIntent['primary'] = primary;

          switch (intentType) {
            case 'examples':
              newPrimary = 'find_examples';
              newConfidence = 0.9;
              contextKeywords.push('examples', 'tutorials', 'samples');
              break;
            case 'debugging':
              newPrimary = 'debug_issue';
              newConfidence = 0.85;
              contextKeywords.push(
                'debugging',
                'error_handling',
                'troubleshooting',
              );
              break;
            case 'testing':
              if (primary === 'find_implementation') {
                secondary.push('testing');
              }
              contextKeywords.push(
                'testing',
                'quality_assurance',
                'verification',
              );
              continue; // Don't change primary intent for testing
            case 'patterns':
              newPrimary = 'find_patterns';
              newConfidence = 0.8;
              contextKeywords.push('patterns', 'architecture', 'design');
              break;
            case 'usage':
              newPrimary = 'find_usage';
              newConfidence = 0.8;
              contextKeywords.push('usage', 'dependencies', 'references');
              break;
            case 'similarity':
              newPrimary = 'find_similar';
              newConfidence = 0.85;
              contextKeywords.push('similarity', 'alternatives', 'equivalents');
              break;
            case 'quality':
              newPrimary = 'analyze_quality';
              newConfidence = 0.8;
              contextKeywords.push('quality', 'performance', 'optimization');
              break;
            case 'behavior':
              newPrimary = 'understand_behavior';
              newConfidence = 0.75;
              contextKeywords.push('behavior', 'functionality', 'logic');
              break;
          }

          // Update if this is a better match
          if (newConfidence > bestMatch.confidence) {
            bestMatch = { intent: newPrimary, confidence: newConfidence };
          }
        }
      }
    }

    primary = bestMatch.intent;
    confidence = bestMatch.confidence;

    // Adjust confidence based on context
    if (
      context.language &&
      lowerQuery.includes(context.language.toLowerCase())
    ) {
      confidence += 0.1;
    }

    if (context.agentType) {
      // Adjust intent based on agent type
      if (
        context.agentType === 'code_review' &&
        primary === 'find_implementation'
      ) {
        primary = 'analyze_quality';
        confidence += 0.15;
      } else if (
        context.agentType === 'debugging' &&
        primary === 'find_implementation'
      ) {
        primary = 'debug_issue';
        confidence += 0.15;
      }
    }

    // Generate suggested parameters based on intent
    const suggestedParameters: Partial<EnhancedSemanticSearchOptions> = {
      searchMode: this.getRecommendedSearchMode(primary),
      rankingStrategy: this.getRecommendedRankingStrategy(primary),
      includeQualityMetrics: primary === 'analyze_quality',
      includeRelationships:
        primary === 'find_usage' || primary === 'find_similar',
      includeExplanations: true,
      contextRadius: primary === 'understand_behavior' ? 10 : 5,
    };

    return {
      primary,
      secondary,
      confidence: Math.min(confidence, 1.0),
      context: contextKeywords,
      suggestedParameters,
    };
  }

  /**
   * Enhance a query with relevant technical terms and context
   */
  async enhanceQuery(
    query: string,
    intent: QueryIntent,
    context: QueryContext = {},
  ): Promise<EnhancedQuery> {
    let enhanced = query.trim();
    const addedTerms: string[] = [];
    const contextKeywords: string[] = [...intent.context];

    // Add language context if available and not already present
    if (
      context.language &&
      !enhanced.toLowerCase().includes(context.language.toLowerCase())
    ) {
      enhanced = `${context.language} ${enhanced}`;
      addedTerms.push(context.language);
    }

    // Add technical terms based on intent
    const relevantTerms = this.getTechnicalTermsForIntent(
      intent.primary,
      enhanced,
    );
    for (const term of relevantTerms) {
      if (!enhanced.toLowerCase().includes(term.toLowerCase())) {
        enhanced += ` ${term}`;
        addedTerms.push(term);
      }
    }

    // Add contextual enhancements
    const contextualTerms = this.getContextualEnhancements(enhanced, context);
    for (const term of contextualTerms) {
      if (!enhanced.toLowerCase().includes(term.toLowerCase())) {
        enhanced += ` ${term}`;
        addedTerms.push(term);
        contextKeywords.push(term);
      }
    }

    // Add framework context if available
    if (context.workspaceContext?.frameworks) {
      for (const framework of context.workspaceContext.frameworks) {
        if (
          (!enhanced.toLowerCase().includes(framework.toLowerCase()) &&
            query.toLowerCase().includes('framework')) ||
          query.toLowerCase().includes(framework.toLowerCase())
        ) {
          enhanced += ` ${framework}`;
          addedTerms.push(framework);
        }
      }
    }

    const confidence = this.calculateEnhancementConfidence(
      query,
      enhanced,
      addedTerms,
    );

    return {
      original: query,
      enhanced,
      addedTerms,
      contextKeywords,
      confidence,
    };
  }

  /**
   * Decompose complex multi-part queries into sub-queries
   */
  async decomposeComplexQuery(
    query: string,
    context: QueryContext = {},
  ): Promise<SubQuery[]> {
    const subQueries: SubQuery[] = [];

    // Check if query is complex enough to decompose
    if (!this.isComplexQuery(query)) {
      return subQueries;
    }

    // Split on common conjunctions and separators
    const parts = query
      .split(/\b(and|or|also|plus|additionally|furthermore|moreover)\b/i)
      .map((part) => part.trim())
      .filter(
        (part) =>
          part.length > 3 &&
          !/^(and|or|also|plus|additionally|furthermore|moreover)$/i.test(part),
      );

    if (parts.length <= 1) {
      return subQueries;
    }

    // Process each part as a sub-query
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const intent = await this.classifyIntent(part, context);

      const subQuery: SubQuery = {
        query: part,
        intent,
        priority: i === 0 ? 'high' : 'medium', // First part usually most important
        dependencies: i > 0 ? [parts[0]] : [], // Later parts may depend on first
        expectedResultType: this.getExpectedResultTypes(intent)[0] || 'code',
      };

      subQueries.push(subQuery);
    }

    logVerbose(
      `Decomposed complex query into ${subQueries.length} sub-queries`,
    );
    return subQueries;
  }

  /**
   * Validate a query and provide suggestions for improvement
   */
  async validateQuery(
    query: string,
    context: QueryContext = {},
  ): Promise<QueryValidationResult> {
    const issues: ValidationIssue[] = [];
    const suggestions: QuerySuggestion[] = [];

    // Check for common issues
    if (query.length < 3) {
      issues.push({
        type: 'too_narrow',
        severity: 'high',
        description: 'Query is too short to be meaningful',
        suggestedFix: 'Add more descriptive terms',
      });
    }

    if (query.length > 200) {
      issues.push({
        type: 'too_broad',
        severity: 'medium',
        description: 'Query is very long and may be too broad',
        suggestedFix: 'Consider breaking into multiple specific queries',
      });
    }

    // Check for ambiguous terms
    const ambiguousTerms = ['it', 'this', 'that', 'thing', 'stuff', 'code'];
    const foundAmbiguous = ambiguousTerms.filter(
      (term) =>
        query.toLowerCase().includes(term) && query.split(/\s+/).length < 5,
    );

    if (foundAmbiguous.length > 0) {
      issues.push({
        type: 'ambiguous',
        severity: 'medium',
        description: `Query contains ambiguous terms: ${foundAmbiguous.join(
          ', ',
        )}`,
        suggestedFix: "Be more specific about what you're looking for",
      });
    }

    // Check for missing context
    if (!context.language && !this.hasLanguageContext(query)) {
      suggestions.push({
        type: 'context_addition',
        suggestedQuery: `${query} (specify programming language)`,
        explanation: 'Adding language context will improve results',
        expectedImprovement: 'More relevant language-specific results',
      });
    }

    // Suggest refinements based on intent
    const intent = await this.classifyIntent(query, context);
    if (intent.confidence < 0.6) {
      issues.push({
        type: 'unclear_intent',
        severity: 'medium',
        description: 'Query intent is unclear',
        suggestedFix: 'Be more specific about what you want to find or do',
      });

      // Suggest more specific alternatives
      suggestions.push({
        type: 'refinement',
        suggestedQuery: `find implementation of ${query}`,
        explanation: 'Specify that you want to find implementation code',
        expectedImprovement: 'More targeted search results',
      });
    }

    // Calculate estimated quality
    const estimatedQuality = this.calculateEstimatedQuality(
      query,
      issues,
      context,
    );

    return {
      isValid: issues.filter((i) => i.severity === 'high').length === 0,
      issues,
      suggestions,
      estimatedQuality,
    };
  }

  /**
   * Initialize intent classification patterns
   */
  private initializePatterns(): void {
    this.intentPatterns.set('examples', [
      /\b(how to|example|sample|demo|tutorial|guide|show me)\b/i,
      /\b(examples? of|samples? of|demos? of)\b/i,
    ]);

    this.intentPatterns.set('debugging', [
      /\b(error|bug|issue|problem|fix|debug|troubleshoot|broken)\b/i,
      /\b(not working|fails?|crash|exception)\b/i,
    ]);

    this.intentPatterns.set('testing', [
      /\b(test|testing|spec|assert|mock|stub|verify|unit test|integration test)\b/i,
    ]);

    this.intentPatterns.set('patterns', [
      /\b(pattern|design pattern|architecture|architectural pattern)\b/i,
      /\b(singleton|factory|observer|strategy|decorator)\b/i,
      /\b(patterns? in|patterns? used)\b/i,
    ]);

    this.intentPatterns.set('usage', [
      /\b(usage|used|call|invoke|reference|depend|import)\b/i,
      /\b(where.*used|how.*used|who.*uses)\b/i,
      /\b(usage of|references to)\b/i,
    ]);

    this.intentPatterns.set('similarity', [
      /\b(similar|like|equivalent|alternative|comparable)\b/i,
      /\b(same as|looks like|works like)\b/i,
    ]);

    this.intentPatterns.set('quality', [
      /\b(quality|performance|optimize|improve|refactor|clean)\b/i,
      /\b(best practice|code smell|maintainability|analyze)\b/i,
    ]);

    this.intentPatterns.set('behavior', [
      /\b(what does|how does|behavior|functionality|logic)\b/i,
      /\b(works by|operates|functions)\b/i,
    ]);
  }

  /**
   * Initialize technical terms mapping
   */
  private initializeTechnicalTerms(): void {
    this.technicalTerms.set('find_implementation', [
      'implementation',
      'code',
      'function',
      'method',
      'class',
    ]);

    this.technicalTerms.set('find_examples', [
      'example',
      'sample',
      'demo',
      'tutorial',
      'usage',
    ]);

    this.technicalTerms.set('debug_issue', [
      'error handling',
      'exception',
      'debugging',
      'troubleshooting',
    ]);

    this.technicalTerms.set('find_patterns', [
      'design pattern',
      'architecture',
      'structure',
      'organization',
    ]);

    this.technicalTerms.set('find_usage', [
      'usage',
      'reference',
      'dependency',
      'import',
      'call',
    ]);

    this.technicalTerms.set('find_similar', [
      'similar',
      'alternative',
      'equivalent',
      'comparable',
    ]);

    this.technicalTerms.set('analyze_quality', [
      'quality',
      'metrics',
      'performance',
      'maintainability',
    ]);

    this.technicalTerms.set('understand_behavior', [
      'behavior',
      'functionality',
      'logic',
      'algorithm',
    ]);
  }

  /**
   * Initialize contextual enhancements
   */
  private initializeContextualEnhancements(): void {
    this.contextualEnhancements.set('api', [
      'endpoint',
      'service',
      'client',
      'request',
      'response',
    ]);
    this.contextualEnhancements.set('database', [
      'query',
      'schema',
      'model',
      'repository',
      'orm',
    ]);
    this.contextualEnhancements.set('auth', [
      'authentication',
      'authorization',
      'token',
      'session',
      'login',
    ]);
    this.contextualEnhancements.set('ui', [
      'component',
      'interface',
      'view',
      'render',
      'display',
    ]);
    this.contextualEnhancements.set('test', [
      'unit test',
      'integration test',
      'mock',
      'assert',
      'verify',
    ]);
    this.contextualEnhancements.set('config', [
      'configuration',
      'settings',
      'environment',
      'parameter',
    ]);
  }

  /**
   * Get technical terms for a specific intent
   */
  private getTechnicalTermsForIntent(intent: string, query: string): string[] {
    const terms = this.technicalTerms.get(intent) || [];

    // Filter terms that would be relevant and not redundant
    return terms
      .filter((term) => {
        const lowerQuery = query.toLowerCase();
        const lowerTerm = term.toLowerCase();

        // Don't add if already present
        if (lowerQuery.includes(lowerTerm)) {
          return false;
        }

        // Add if it would enhance the query
        return true;
      })
      .slice(0, 2); // Limit to 2 terms to avoid over-enhancement
  }

  /**
   * Get contextual enhancements based on query content
   */
  private getContextualEnhancements(
    query: string,
    context: QueryContext,
  ): string[] {
    const enhancements: string[] = [];
    const lowerQuery = query.toLowerCase();

    for (const [keyword, terms] of this.contextualEnhancements) {
      if (lowerQuery.includes(keyword)) {
        // Add relevant terms that aren't already in the query
        const relevantTerms = terms
          .filter((term) => !lowerQuery.includes(term.toLowerCase()))
          .slice(0, 1); // Limit to 1 term per category

        enhancements.push(...relevantTerms);
      }
    }

    return enhancements;
  }

  /**
   * Determine search strategy based on intent and context
   */
  private determineSearchStrategy(
    intent: QueryIntent,
    context: QueryContext,
  ): SearchStrategy {
    const mode = this.getRecommendedSearchMode(intent.primary);
    const ranking = this.getRecommendedRankingStrategy(intent.primary);

    return {
      mode,
      ranking,
      diversification: true,
      contextRadius: intent.primary === 'understand_behavior' ? 10 : 5,
      boostFactors: this.getBoostFactors(intent),
      penaltyFactors: this.getPenaltyFactors(intent),
    };
  }

  /**
   * Get recommended search mode for intent
   */
  private getRecommendedSearchMode(intent: string): SearchMode {
    switch (intent) {
      case 'find_patterns':
      case 'understand_behavior':
        return 'behavioral';
      case 'find_usage':
      case 'find_similar':
        return 'hybrid';
      case 'debug_issue':
        return 'syntactic';
      default:
        return 'semantic';
    }
  }

  /**
   * Get recommended ranking strategy for intent
   */
  private getRecommendedRankingStrategy(intent: string): RankingStrategy {
    switch (intent) {
      case 'analyze_quality':
        return 'quality';
      case 'find_examples':
        return 'usage';
      case 'debug_issue':
        return 'recency';
      default:
        return 'relevance';
    }
  }

  /**
   * Get boost factors for intent
   */
  private getBoostFactors(intent: QueryIntent): BoostFactor[] {
    const factors: BoostFactor[] = [];

    switch (intent.primary) {
      case 'find_examples':
        factors.push({
          condition: 'hasTests',
          multiplier: 1.3,
          description: 'Code with tests is better for examples',
          weight: 0.8,
        });
        break;
      case 'analyze_quality':
        factors.push({
          condition: 'highQualityScore',
          multiplier: 1.5,
          description: 'High quality code for quality analysis',
          weight: 1.0,
        });
        break;
      case 'debug_issue':
        factors.push({
          condition: 'hasErrorHandling',
          multiplier: 1.4,
          description: 'Error handling code for debugging',
          weight: 0.9,
        });
        break;
    }

    return factors;
  }

  /**
   * Get penalty factors for intent
   */
  private getPenaltyFactors(intent: QueryIntent): PenaltyFactor[] {
    const factors: PenaltyFactor[] = [];

    // Common penalties
    factors.push({
      condition: 'hasCodeSmells',
      multiplier: 0.7,
      description: 'Penalize code with detected smells',
      weight: 0.6,
    });

    if (intent.primary === 'find_examples') {
      factors.push({
        condition: 'noDocumentation',
        multiplier: 0.8,
        description: 'Examples should be well documented',
        weight: 0.7,
      });
    }

    return factors;
  }

  /**
   * Determine filters based on intent and context
   */
  private determineFilters(
    intent: QueryIntent,
    context: QueryContext,
  ): SearchFilterCriteria {
    const filters: SearchFilterCriteria = {};

    // Apply quality threshold for quality-focused searches
    if (intent.primary === 'analyze_quality') {
      filters.qualityThreshold = 0.7;
    }

    // Filter by language if specified
    if (context.language) {
      filters.includeFilePatterns = [
        `*.${this.getFileExtensionForLanguage(context.language)}`,
      ];
    }

    // Exclude test files for implementation searches (unless specifically looking for tests)
    if (
      intent.primary === 'find_implementation' &&
      !intent.secondary.includes('testing')
    ) {
      filters.excludeFilePatterns = [
        '*test*',
        '*spec*',
        '*.test.*',
        '*.spec.*',
      ];
    }

    return filters;
  }

  /**
   * Get expected result types for intent
   */
  private getExpectedResultTypes(intent: QueryIntent): string[] {
    switch (intent.primary) {
      case 'find_implementation':
        return ['function', 'class', 'method'];
      case 'find_examples':
        return ['example', 'tutorial', 'demo'];
      case 'debug_issue':
        return ['error_handling', 'exception', 'debugging'];
      case 'find_patterns':
        return ['pattern', 'architecture', 'design'];
      case 'find_usage':
        return ['usage', 'reference', 'call'];
      case 'find_similar':
        return ['similar', 'alternative'];
      case 'analyze_quality':
        return ['quality_metrics', 'performance'];
      case 'understand_behavior':
        return ['behavior', 'logic', 'algorithm'];
      default:
        return ['code'];
    }
  }

  /**
   * Calculate query complexity score
   */
  private calculateQueryComplexity(query: string): number {
    let complexity = 0;

    // Base complexity from length
    complexity += Math.min(query.length / 100, 1.0) * 0.3;

    // Add complexity for multiple concepts
    const concepts = query.split(/\s+/).length;
    complexity += Math.min(concepts / 10, 1.0) * 0.3;

    // Add complexity for technical terms
    const technicalTermCount = this.countTechnicalTerms(query);
    complexity += Math.min(technicalTermCount / 5, 1.0) * 0.2;

    // Add complexity for conjunctions (and, or, etc.)
    const conjunctions = (query.match(/\b(and|or|but|also|plus)\b/gi) || [])
      .length;
    complexity += Math.min(conjunctions / 3, 1.0) * 0.2;

    return Math.min(complexity, 1.0);
  }

  /**
   * Calculate enhancement confidence
   */
  private calculateEnhancementConfidence(
    original: string,
    enhanced: string,
    addedTerms: string[],
  ): number {
    let confidence = 0.8; // Base confidence

    // Reduce confidence if too many terms were added
    if (addedTerms.length > 5) {
      confidence -= 0.2;
    }

    // Increase confidence if enhancement is proportional
    const enhancementRatio = enhanced.length / original.length;
    if (enhancementRatio > 1.2 && enhancementRatio < 2.0) {
      confidence += 0.1;
    } else if (enhancementRatio > 2.0) {
      confidence -= 0.15;
    }

    return Math.max(0.1, Math.min(confidence, 1.0));
  }

  /**
   * Check if query is complex enough to decompose
   */
  private isComplexQuery(query: string): boolean {
    // Check for conjunctions
    if (
      /\b(and|or|also|plus|additionally|furthermore|moreover)\b/i.test(query)
    ) {
      return true;
    }

    // Check for multiple sentences
    if (query.split(/[.!?]/).length > 1) {
      return true;
    }

    // Check for length and complexity
    if (query.length > 100 && query.split(/\s+/).length > 15) {
      return true;
    }

    return false;
  }

  /**
   * Check if query has language context
   */
  private hasLanguageContext(query: string): boolean {
    const languages = [
      'javascript',
      'typescript',
      'python',
      'java',
      'c#',
      'c++',
      'go',
      'rust',
      'php',
      'ruby',
    ];
    const lowerQuery = query.toLowerCase();

    return languages.some((lang) => lowerQuery.includes(lang));
  }

  /**
   * Count technical terms in query
   */
  private countTechnicalTerms(query: string): number {
    const technicalTerms = [
      'function',
      'method',
      'class',
      'interface',
      'api',
      'database',
      'service',
      'component',
      'module',
      'library',
      'framework',
      'algorithm',
      'pattern',
      'authentication',
      'authorization',
      'validation',
      'configuration',
    ];

    const lowerQuery = query.toLowerCase();
    return technicalTerms.filter((term) => lowerQuery.includes(term)).length;
  }

  /**
   * Get file extension for programming language
   */
  private getFileExtensionForLanguage(language: string): string {
    const extensions: Record<string, string> = {
      javascript: 'js',
      typescript: 'ts',
      python: 'py',
      java: 'java',
      'c#': 'cs',
      'c++': 'cpp',
      go: 'go',
      rust: 'rs',
      php: 'php',
      ruby: 'rb',
    };

    return extensions[language.toLowerCase()] || '*';
  }

  /**
   * Calculate estimated quality of search results
   */
  private calculateEstimatedQuality(
    query: string,
    issues: ValidationIssue[],
    context: QueryContext,
  ): number {
    let quality = 0.8; // Base quality

    // Reduce quality for issues
    const highSeverityIssues = issues.filter(
      (i) => i.severity === 'high',
    ).length;
    const mediumSeverityIssues = issues.filter(
      (i) => i.severity === 'medium',
    ).length;

    quality -= highSeverityIssues * 0.3;
    quality -= mediumSeverityIssues * 0.15;

    // Increase quality for good context
    if (context.language) quality += 0.1;
    if (context.workspaceContext) quality += 0.1;
    if (context.recentSearches && context.recentSearches.length > 0)
      quality += 0.05;

    // Increase quality for specific queries
    if (query.length > 20 && query.length < 100) quality += 0.1;

    return Math.max(0.1, Math.min(quality, 1.0));
  }
}
