/**
 * Result Manager Service
 *
 * Provides intelligent result processing and ranking algorithms for AI agents including:
 * - Multi-criteria ranking considering relevance, quality metrics, recency, and usage patterns
 * - Result diversification to prevent over-representation from single files or patterns
 * - Result explanation system that shows why results were selected and ranked
 * - Advanced filtering and post-processing for optimal AI agent consumption
 */

import { log, logVerbose } from '../logger';
import {
  EnhancedSemanticSearchResult,
  ProcessedQuery,
  EnhancedSemanticSearchOptions,
  RankingStrategy,
  SearchResultExplanation,
  ConfidenceFactor,
  ActionableSuggestion,
  AlternativeResult,
  BoostFactor,
  PenaltyFactor,
  SearchQualityMetrics,
  ResponseSuggestion,
} from '../types/enhancedSearch';
import { SemanticSearchResult } from './semanticSearchService';
import { QualityMetrics, ContextInfo } from '../types/enhancedChunking';

/**
 * Ranking configuration for multi-criteria ranking
 */
export interface RankingConfiguration {
  /** Primary ranking strategy */
  strategy: RankingStrategy;

  /** Weights for different ranking factors (should sum to 1.0) */
  weights: RankingWeights;

  /** Boost factors to apply */
  boostFactors: BoostFactor[];

  /** Penalty factors to apply */
  penaltyFactors: PenaltyFactor[];

  /** Whether to normalize scores */
  normalizeScores: boolean;

  /** Minimum score threshold */
  minScoreThreshold: number;
}

/**
 * Weights for different ranking factors
 */
export interface RankingWeights {
  /** Semantic relevance weight */
  relevance: number;

  /** Quality metrics weight */
  quality: number;

  /** Recency weight */
  recency: number;

  /** Usage patterns weight */
  usage: number;

  /** Complexity appropriateness weight */
  complexity: number;

  /** Documentation quality weight */
  documentation: number;
}

/**
 * Diversification configuration
 */
export interface DiversificationOptions {
  /** Maximum results per file */
  maxResultsPerFile: number;

  /** Maximum results per function/class */
  maxResultsPerFunction: number;

  /** Prefer different design patterns */
  preferDifferentPatterns: boolean;

  /** Prefer different complexity levels */
  preferDifferentComplexity: boolean;

  /** Prefer different architectural layers */
  preferDifferentLayers: boolean;

  /** Minimum diversity score (0-1) */
  minDiversityScore: number;

  /** Enable temporal diversification */
  enableTemporalDiversification: boolean;
}

/**
 * Result processing statistics
 */
export interface ResultProcessingStats {
  /** Original result count */
  originalCount: number;

  /** Results after filtering */
  filteredCount: number;

  /** Results after ranking */
  rankedCount: number;

  /** Results after diversification */
  diversifiedCount: number;

  /** Final result count */
  finalCount: number;

  /** Processing time in milliseconds */
  processingTime: number;

  /** Diversity score achieved */
  diversityScore: number;

  /** Average quality score */
  averageQualityScore: number;

  /** Ranking adjustments made */
  rankingAdjustments: number;
}

/**
 * Result Manager Service
 */
export class ResultManager {
  private defaultRankingWeights: RankingWeights = {
    relevance: 0.4,
    quality: 0.25,
    recency: 0.15,
    usage: 0.1,
    complexity: 0.05,
    documentation: 0.05,
  };

  private defaultDiversificationOptions: DiversificationOptions = {
    maxResultsPerFile: 3,
    maxResultsPerFunction: 2,
    preferDifferentPatterns: true,
    preferDifferentComplexity: true,
    preferDifferentLayers: true,
    minDiversityScore: 0.6,
    enableTemporalDiversification: true,
  };

  /**
   * Process and enhance search results with intelligent ranking and diversification
   */
  async processResults(
    results: SemanticSearchResult[],
    processedQuery: ProcessedQuery,
    options: EnhancedSemanticSearchOptions,
  ): Promise<{
    results: EnhancedSemanticSearchResult[];
    stats: ResultProcessingStats;
  }> {
    const startTime = Date.now();

    logVerbose(`Processing ${results.length} results with ResultManager`);

    // Convert base results to enhanced results
    const enhancedResults = await this.convertToEnhancedResults(
      results,
      processedQuery,
    );

    // Apply initial filtering
    const filteredResults = await this.applyInitialFiltering(
      enhancedResults,
      processedQuery,
      options,
    );

    // Rank results using multi-criteria ranking
    const rankedResults = await this.rankResults(
      filteredResults,
      processedQuery,
      options,
    );

    // Apply diversification
    const diversifiedResults = await this.diversifyResults(
      rankedResults,
      processedQuery,
      options,
    );

    // Generate explanations and suggestions
    const finalResults = await this.generateExplanationsAndSuggestions(
      diversifiedResults,
      processedQuery,
    );

    // Calculate processing statistics
    const processingTime = Date.now() - startTime;
    const stats: ResultProcessingStats = {
      originalCount: results.length,
      filteredCount: filteredResults.length,
      rankedCount: rankedResults.length,
      diversifiedCount: diversifiedResults.length,
      finalCount: finalResults.length,
      processingTime,
      diversityScore: this.calculateDiversityScore(finalResults),
      averageQualityScore: this.calculateAverageQualityScore(finalResults),
      rankingAdjustments: this.countRankingAdjustments(results, finalResults),
    };

    log(
      `ResultManager processed ${results.length} → ${finalResults.length} results in ${processingTime}ms`,
    );

    return { results: finalResults, stats };
  }

  /**
   * Rank results using multi-criteria ranking algorithms
   */
  async rankResults(
    results: EnhancedSemanticSearchResult[],
    processedQuery: ProcessedQuery,
    options: EnhancedSemanticSearchOptions,
  ): Promise<EnhancedSemanticSearchResult[]> {
    if (results.length === 0) return results;

    const rankingConfig = this.createRankingConfiguration(
      processedQuery,
      options,
    );

    // Calculate composite scores for each result
    const scoredResults = results.map((result) => ({
      result,
      compositeScore: this.calculateCompositeScore(
        result,
        rankingConfig,
        processedQuery,
      ),
    }));

    // Sort by composite score (descending)
    scoredResults.sort((a, b) => b.compositeScore - a.compositeScore);

    // Apply boost and penalty factors
    const adjustedResults = this.applyBoostAndPenaltyFactors(
      scoredResults,
      rankingConfig,
    );

    // Normalize scores if requested
    if (rankingConfig.normalizeScores) {
      this.normalizeScores(adjustedResults);
    }

    // Filter by minimum threshold
    const thresholdResults = adjustedResults.filter(
      (item) => item.compositeScore >= rankingConfig.minScoreThreshold,
    );

    logVerbose(
      `Ranked ${results.length} results, ${thresholdResults.length} passed threshold`,
    );

    return thresholdResults.map((item) => ({
      ...item.result,
      score: item.compositeScore, // Update the score with composite score
    }));
  }

  /**
   * Apply diversification to prevent over-representation
   */
  async diversifyResults(
    results: EnhancedSemanticSearchResult[],
    processedQuery: ProcessedQuery,
    options: EnhancedSemanticSearchOptions,
  ): Promise<EnhancedSemanticSearchResult[]> {
    if (results.length === 0) return results;

    const diversificationOptions = this.createDiversificationOptions(options);
    const diversifiedResults: EnhancedSemanticSearchResult[] = [];

    // Track diversity metrics
    const fileCount = new Map<string, number>();
    const functionCount = new Map<string, number>();
    const patternCount = new Map<string, number>();
    const layerCount = new Map<string, number>();
    const complexityLevels = new Set<string>();

    for (const result of results) {
      const fileKey = `${result.snapshotId}:${result.filePath}`;
      const functionKey = this.extractFunctionKey(result);
      const patterns = result.enhancedMetadata?.designPatterns || [];
      const layer = result.enhancedMetadata?.architecturalLayer || 'unknown';
      const complexityLevel = this.getComplexityLevel(result.qualityMetrics);

      // Check file diversity
      const currentFileCount = fileCount.get(fileKey) || 0;
      if (currentFileCount >= diversificationOptions.maxResultsPerFile) {
        continue;
      }

      // Check function diversity
      const currentFunctionCount = functionCount.get(functionKey) || 0;
      if (
        currentFunctionCount >= diversificationOptions.maxResultsPerFunction
      ) {
        continue;
      }

      // Check pattern diversity
      let shouldIncludeForPatterns = true;
      if (
        diversificationOptions.preferDifferentPatterns &&
        patterns.length > 0
      ) {
        const hasNewPattern = patterns.some(
          (pattern) => (patternCount.get(pattern) || 0) === 0,
        );
        const totalPatternResults = Array.from(patternCount.values()).reduce(
          (sum, count) => sum + count,
          0,
        );

        if (!hasNewPattern && totalPatternResults > 5) {
          shouldIncludeForPatterns = false;
        }
      }

      // Check complexity diversity
      let shouldIncludeForComplexity = true;
      if (diversificationOptions.preferDifferentComplexity) {
        if (
          complexityLevels.has(complexityLevel) &&
          complexityLevels.size >= 3 &&
          diversifiedResults.length > 10
        ) {
          shouldIncludeForComplexity = false;
        }
      }

      // Check layer diversity
      let shouldIncludeForLayers = true;
      if (diversificationOptions.preferDifferentLayers) {
        const currentLayerCount = layerCount.get(layer) || 0;
        if (currentLayerCount >= 3 && diversifiedResults.length > 8) {
          shouldIncludeForLayers = false;
        }
      }

      // Include result if it passes diversity checks
      if (
        shouldIncludeForPatterns &&
        shouldIncludeForComplexity &&
        shouldIncludeForLayers
      ) {
        diversifiedResults.push(result);

        // Update counters
        fileCount.set(fileKey, currentFileCount + 1);
        functionCount.set(functionKey, currentFunctionCount + 1);
        patterns.forEach((pattern) =>
          patternCount.set(pattern, (patternCount.get(pattern) || 0) + 1),
        );
        layerCount.set(layer, (layerCount.get(layer) || 0) + 1);
        complexityLevels.add(complexityLevel);
      }

      // Stop if we have enough diverse results
      if (diversifiedResults.length >= (options.limit || 20)) {
        break;
      }
    }

    // Apply temporal diversification if enabled
    if (diversificationOptions.enableTemporalDiversification) {
      return this.applyTemporalDiversification(diversifiedResults);
    }

    logVerbose(
      `Diversified ${results.length} → ${diversifiedResults.length} results`,
    );
    return diversifiedResults;
  }

  /**
   * Generate explanations and actionable suggestions for results
   */
  async generateExplanationsAndSuggestions(
    results: EnhancedSemanticSearchResult[],
    processedQuery: ProcessedQuery,
  ): Promise<EnhancedSemanticSearchResult[]> {
    return Promise.all(
      results.map(async (result, index) => {
        // Generate explanation
        const explanation = await this.generateResultExplanation(
          result,
          processedQuery,
          index,
        );

        // Generate actionable suggestions
        const suggestions = await this.generateActionableSuggestions(
          result,
          processedQuery,
        );

        // Find alternative results
        const alternatives = await this.findAlternativeResults(result, results);

        return {
          ...result,
          explanation,
          suggestions,
          alternatives,
        };
      }),
    );
  }

  /**
   * Convert base search results to enhanced results
   */
  private async convertToEnhancedResults(
    results: SemanticSearchResult[],
    processedQuery: ProcessedQuery,
  ): Promise<EnhancedSemanticSearchResult[]> {
    return Promise.all(
      results.map(async (result) => {
        // Create default quality metrics
        const qualityMetrics: QualityMetrics = {
          overallScore: 70,
          readabilityScore: 0.7,
          testCoverage: undefined,
          documentationRatio: 0.5,
          duplicationRisk: 0.3,
          performanceRisk: 0.2,
          securityRisk: 0.15,
          maintainabilityScore: 75,
          technicalDebt: {
            estimatedFixTime: 2,
            severity: 'low',
            categories: [],
            issues: [],
          },
          styleComplianceScore: 80,
        };

        // Create default context info
        const contextInfo: ContextInfo = {
          surroundingContext: '',
          architecturalLayer: 'unknown',
          frameworkContext: [],
          businessContext: undefined,
          fileContext: {
            totalLines: result.content.split('\n').length,
            fileSize: result.content.length,
            lastModified: new Date(result.timestamp),
            encoding: 'utf-8',
            siblingChunks: [],
          },
        };

        // Create enhanced metadata
        const enhancedMetadata = {
          semanticType: this.inferSemanticType(result.content) as any,
          designPatterns: this.detectDesignPatterns(result.content),
          architecturalLayer: this.inferArchitecturalLayer(result.filePath),
          businessDomain: undefined,
          frameworkContext: this.detectFrameworkContext(result.content),
          dependencies: this.extractDependencies(result.content),
          usageFrequency: 1,
          lastModified: result.timestamp,
          complexityMetrics: {
            cyclomaticComplexity: this.calculateCyclomaticComplexity(
              result.content,
            ),
            cognitiveComplexity: this.calculateCognitiveComplexity(
              result.content,
            ),
            linesOfCode: result.content.split('\n').length,
            nestingDepth: this.calculateNestingDepth(result.content),
            maintainabilityIndex: this.calculateMaintainabilityIndex(
              result.content,
            ),
          },
          securityConsiderations: this.identifySecurityConsiderations(
            result.content,
          ),
        };

        const enhancedResult: EnhancedSemanticSearchResult = {
          ...result,
          explanation: {
            whyRelevant: 'Semantic match found',
            keyFeatures: [],
            matchedConcepts: [],
            confidenceFactors: [],
            semanticSimilarity: 'Basic semantic similarity',
          },
          relationships: [],
          qualityMetrics,
          contextInfo,
          suggestions: [],
          alternatives: [],
          enhancedMetadata,
        };

        return enhancedResult;
      }),
    );
  }

  /**
   * Apply initial filtering based on query and options
   */
  private async applyInitialFiltering(
    results: EnhancedSemanticSearchResult[],
    processedQuery: ProcessedQuery,
    options: EnhancedSemanticSearchOptions,
  ): Promise<EnhancedSemanticSearchResult[]> {
    let filteredResults = results;

    // Apply filter criteria from processed query
    if (processedQuery.filters) {
      filteredResults = this.applyFilterCriteria(
        filteredResults,
        processedQuery.filters,
      );
    }

    // Apply additional filters from options
    if (options.filterCriteria) {
      filteredResults = this.applyFilterCriteria(
        filteredResults,
        options.filterCriteria,
      );
    }

    // Apply score threshold
    const scoreThreshold = options.scoreThreshold || 0.6;
    filteredResults = filteredResults.filter(
      (result) => result.score >= scoreThreshold,
    );

    logVerbose(
      `Applied initial filtering: ${results.length} → ${filteredResults.length} results`,
    );
    return filteredResults;
  }

  /**
   * Apply filter criteria to results
   */
  private applyFilterCriteria(
    results: EnhancedSemanticSearchResult[],
    criteria: any,
  ): EnhancedSemanticSearchResult[] {
    return results.filter((result) => {
      // Quality threshold filter
      if (
        criteria.qualityThreshold &&
        result.qualityMetrics.readabilityScore < criteria.qualityThreshold
      ) {
        return false;
      }

      // Complexity range filter
      if (criteria.complexityRange) {
        const complexity =
          result.enhancedMetadata?.complexityMetrics?.cyclomaticComplexity || 1;
        const [min, max] = criteria.complexityRange;
        if (complexity < min || complexity > max) {
          return false;
        }
      }

      // Semantic types filter
      if (criteria.semanticTypes && criteria.semanticTypes.length > 0) {
        const semanticType = result.enhancedMetadata?.semanticType;
        if (!semanticType || !criteria.semanticTypes.includes(semanticType)) {
          return false;
        }
      }

      // Design patterns filter
      if (criteria.designPatterns && criteria.designPatterns.length > 0) {
        const patterns = result.enhancedMetadata?.designPatterns || [];
        if (
          !criteria.designPatterns.some((pattern: string) =>
            patterns.includes(pattern),
          )
        ) {
          return false;
        }
      }

      // Exclude code smells filter
      if (criteria.excludeCodeSmells && criteria.excludeCodeSmells.length > 0) {
        // This would need to be implemented with actual code smell detection
        // For now, we'll skip this filter
      }

      return true;
    });
  }

  /**
   * Create ranking configuration based on query and options
   */
  private createRankingConfiguration(
    processedQuery: ProcessedQuery,
    options: EnhancedSemanticSearchOptions,
  ): RankingConfiguration {
    const strategy =
      options.rankingStrategy || processedQuery.searchStrategy.ranking;

    // Adjust weights based on ranking strategy
    let weights = { ...this.defaultRankingWeights };

    switch (strategy) {
      case 'quality':
        weights = {
          ...weights,
          quality: 0.5,
          relevance: 0.3,
          documentation: 0.1,
          usage: 0.05,
          recency: 0.03,
          complexity: 0.02,
        };
        break;
      case 'recency':
        weights = {
          ...weights,
          recency: 0.4,
          relevance: 0.35,
          quality: 0.15,
          usage: 0.05,
          complexity: 0.03,
          documentation: 0.02,
        };
        break;
      case 'usage':
        weights = {
          ...weights,
          usage: 0.35,
          relevance: 0.3,
          quality: 0.2,
          recency: 0.1,
          complexity: 0.03,
          documentation: 0.02,
        };
        break;
      case 'balanced':
        // Use default weights
        break;
      default: // 'relevance'
        weights = {
          ...weights,
          relevance: 0.6,
          quality: 0.2,
          usage: 0.1,
          recency: 0.05,
          complexity: 0.03,
          documentation: 0.02,
        };
    }

    return {
      strategy,
      weights,
      boostFactors: processedQuery.searchStrategy.boostFactors || [],
      penaltyFactors: processedQuery.searchStrategy.penaltyFactors || [],
      normalizeScores: true,
      minScoreThreshold: 0.1,
    };
  }

  /**
   * Create diversification options based on search options
   */
  private createDiversificationOptions(
    options: EnhancedSemanticSearchOptions,
  ): DiversificationOptions {
    return {
      ...this.defaultDiversificationOptions,
      maxResultsPerFile:
        options.maxResultsPerFile ||
        this.defaultDiversificationOptions.maxResultsPerFile,
      preferDifferentPatterns: options.enableDiversification !== false,
      preferDifferentComplexity: options.enableDiversification !== false,
      preferDifferentLayers: options.enableDiversification !== false,
    };
  }

  /**
   * Calculate composite score for ranking
   */
  private calculateCompositeScore(
    result: EnhancedSemanticSearchResult,
    config: RankingConfiguration,
    processedQuery: ProcessedQuery,
  ): number {
    const weights = config.weights;

    // Relevance score (from semantic search)
    const relevanceScore = result.score;

    // Quality score
    const qualityScore = this.calculateQualityScore(result.qualityMetrics);

    // Recency score
    const recencyScore = this.calculateRecencyScore(result.timestamp);

    // Usage score (placeholder - would need actual usage data)
    const usageScore = result.enhancedMetadata?.usageFrequency || 0.5;

    // Complexity appropriateness score
    const complexityScore = this.calculateComplexityAppropriatenessScore(
      result.enhancedMetadata?.complexityMetrics,
      processedQuery.intent,
    );

    // Documentation score
    const documentationScore = result.qualityMetrics.documentationRatio;

    // Calculate weighted composite score
    const compositeScore =
      relevanceScore * weights.relevance +
      qualityScore * weights.quality +
      recencyScore * weights.recency +
      usageScore * weights.usage +
      complexityScore * weights.complexity +
      documentationScore * weights.documentation;

    return Math.max(0, Math.min(1, compositeScore));
  }

  /**
   * Calculate quality score from quality metrics
   */
  private calculateQualityScore(metrics: QualityMetrics): number {
    let score = 0;
    let factors = 0;

    // Readability score
    score += metrics.readabilityScore;
    factors++;

    // Test coverage (if available)
    if (metrics.testCoverage !== undefined) {
      score += metrics.testCoverage;
      factors++;
    }

    // Documentation ratio
    score += metrics.documentationRatio;
    factors++;

    // Invert risk scores (lower risk = higher quality)
    score += 1 - metrics.duplicationRisk;
    factors++;

    score += 1 - metrics.performanceRisk;
    factors++;

    return factors > 0 ? score / factors : 0.5;
  }

  /**
   * Calculate recency score based on timestamp
   */
  private calculateRecencyScore(timestamp: number): number {
    const now = Date.now();
    const ageInDays = (now - timestamp) / (1000 * 60 * 60 * 24);

    // Score decreases with age, but levels off after 365 days
    if (ageInDays <= 7) return 1.0;
    if (ageInDays <= 30) return 0.9;
    if (ageInDays <= 90) return 0.7;
    if (ageInDays <= 180) return 0.5;
    if (ageInDays <= 365) return 0.3;
    return 0.1;
  }

  /**
   * Calculate complexity appropriateness score
   */
  private calculateComplexityAppropriatenessScore(
    complexityMetrics: any,
    intent: any,
  ): number {
    if (!complexityMetrics) return 0.5;

    const cyclomaticComplexity = complexityMetrics.cyclomaticComplexity || 1;
    const cognitiveComplexity = complexityMetrics.cognitiveComplexity || 1;

    // Different intents prefer different complexity levels
    let idealComplexity = 5; // Default

    switch (intent.primary) {
      case 'find_examples':
        idealComplexity = 3; // Prefer simpler examples
        break;
      case 'debug_issue':
        idealComplexity = 8; // Complex code more likely to have issues
        break;
      case 'find_patterns':
        idealComplexity = 6; // Moderate complexity for patterns
        break;
      case 'analyze_quality':
        idealComplexity = 10; // Any complexity for quality analysis
        break;
    }

    // Calculate score based on distance from ideal complexity
    const complexityDistance = Math.abs(cyclomaticComplexity - idealComplexity);
    const score = Math.max(0, 1 - complexityDistance / idealComplexity);

    return score;
  }

  /**
   * Apply boost and penalty factors
   */
  private applyBoostAndPenaltyFactors(
    scoredResults: Array<{
      result: EnhancedSemanticSearchResult;
      compositeScore: number;
    }>,
    config: RankingConfiguration,
  ): Array<{ result: EnhancedSemanticSearchResult; compositeScore: number }> {
    return scoredResults.map((item) => {
      let adjustedScore = item.compositeScore;

      // Apply boost factors
      for (const boost of config.boostFactors) {
        if (this.evaluateCondition(boost.condition, item.result)) {
          adjustedScore *= boost.multiplier * boost.weight;
        }
      }

      // Apply penalty factors
      for (const penalty of config.penaltyFactors) {
        if (this.evaluateCondition(penalty.condition, item.result)) {
          adjustedScore *= penalty.multiplier * penalty.weight;
        }
      }

      return {
        ...item,
        compositeScore: Math.max(0, Math.min(1, adjustedScore)),
      };
    });
  }

  /**
   * Evaluate a condition for boost/penalty factors
   */
  private evaluateCondition(
    condition: string,
    result: EnhancedSemanticSearchResult,
  ): boolean {
    switch (condition) {
      case 'hasTests':
        return (
          result.filePath.includes('test') ||
          result.content.includes('test') ||
          result.content.includes('spec')
        );
      case 'highQualityScore':
        return result.qualityMetrics.readabilityScore > 0.8;
      case 'hasErrorHandling':
        return (
          result.content.includes('try') ||
          result.content.includes('catch') ||
          result.content.includes('error')
        );
      case 'hasCodeSmells':
        // Placeholder - would need actual code smell detection
        return false;
      case 'noDocumentation':
        return result.qualityMetrics.documentationRatio < 0.2;
      default:
        return false;
    }
  }

  /**
   * Normalize scores across all results
   */
  private normalizeScores(
    scoredResults: Array<{
      result: EnhancedSemanticSearchResult;
      compositeScore: number;
    }>,
  ): void {
    if (scoredResults.length === 0) return;

    const scores = scoredResults.map((item) => item.compositeScore);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const range = maxScore - minScore;

    if (range === 0) return; // All scores are the same

    scoredResults.forEach((item) => {
      item.compositeScore = (item.compositeScore - minScore) / range;
    });
  }

  /**
   * Generate result explanation
   */
  private async generateResultExplanation(
    result: EnhancedSemanticSearchResult,
    processedQuery: ProcessedQuery,
    rank: number,
  ): Promise<SearchResultExplanation> {
    const keyFeatures = this.extractKeyFeatures(result.content);
    const matchedConcepts = this.findMatchedConcepts(
      result.content,
      processedQuery.originalQuery,
    );

    const confidenceFactors: ConfidenceFactor[] = [
      {
        factor: 'Semantic Similarity',
        weight: 0.4,
        description: 'Semantic similarity to query',
        value: result.score,
      },
      {
        factor: 'Quality Score',
        weight: 0.3,
        description: 'Code quality metrics',
        value: result.qualityMetrics.readabilityScore,
      },
      {
        factor: 'Relevance Rank',
        weight: 0.2,
        description: 'Position in search results',
        value: Math.max(0, 1 - rank / 20),
      },
      {
        factor: 'Documentation',
        weight: 0.1,
        description: 'Documentation quality',
        value: result.qualityMetrics.documentationRatio,
      },
    ];

    const whyRelevant = this.generateRelevanceExplanation(
      result,
      processedQuery,
      rank,
    );
    const semanticSimilarity = this.generateSemanticSimilarityExplanation(
      result,
      processedQuery,
    );

    return {
      whyRelevant,
      keyFeatures,
      matchedConcepts,
      confidenceFactors,
      semanticSimilarity,
      behavioralSimilarity:
        processedQuery.searchStrategy.mode === 'behavioral'
          ? this.generateBehavioralSimilarityExplanation(result, processedQuery)
          : undefined,
    };
  }

  /**
   * Generate actionable suggestions
   */
  private async generateActionableSuggestions(
    result: EnhancedSemanticSearchResult,
    processedQuery: ProcessedQuery,
  ): Promise<ActionableSuggestion[]> {
    const suggestions: ActionableSuggestion[] = [];

    // Quality improvement suggestions
    if (result.qualityMetrics.readabilityScore < 0.6) {
      suggestions.push({
        type: 'improvement',
        description: 'Consider refactoring for better readability',
        priority: 'medium',
        effort: 'moderate',
        action: 'Review variable names, function structure, and comments',
        expectedBenefit: 'Improved code maintainability and understanding',
      });
    }

    // Testing suggestions
    if (
      !result.content.includes('test') &&
      result.qualityMetrics.testCoverage === undefined
    ) {
      suggestions.push({
        type: 'testing',
        description: 'Add unit tests for this code',
        priority: 'high',
        effort: 'moderate',
        action: 'Create test cases covering main functionality',
        expectedBenefit: 'Better code reliability and regression prevention',
      });
    }

    // Documentation suggestions
    if (result.qualityMetrics.documentationRatio < 0.3) {
      suggestions.push({
        type: 'documentation',
        description: 'Add more comprehensive documentation',
        priority: 'medium',
        effort: 'minimal',
        action: 'Add JSDoc comments or inline documentation',
        expectedBenefit: 'Better code understanding for team members',
      });
    }

    // Usage suggestions based on intent
    if (processedQuery.intent.primary === 'find_examples') {
      suggestions.push({
        type: 'usage',
        description:
          'This code can serve as a good example for similar implementations',
        priority: 'low',
        effort: 'minimal',
        action: 'Study the implementation pattern and adapt for your use case',
        expectedBenefit: 'Faster development with proven patterns',
      });
    }

    return suggestions;
  }

  /**
   * Find alternative results
   */
  private async findAlternativeResults(
    result: EnhancedSemanticSearchResult,
    allResults: EnhancedSemanticSearchResult[],
  ): Promise<AlternativeResult[]> {
    const alternatives: AlternativeResult[] = [];

    // Find results with similar functionality but different implementation
    for (const other of allResults) {
      if (other === result) continue;

      const similarity = this.calculateSimilarity(result, other);
      if (similarity > 0.6 && similarity < 0.9) {
        const differences = this.identifyDifferences(result, other);

        alternatives.push({
          chunkId: `${other.snapshotId}:${other.filePath}:${other.startLine}`,
          similarityScore: similarity,
          description: this.generateAlternativeDescription(other),
          differences,
          preferWhen: this.generatePreferenceCondition(result, other),
        });
      }

      // Limit alternatives to avoid overwhelming
      if (alternatives.length >= 3) break;
    }

    return alternatives;
  }

  // Helper methods for various calculations and extractions

  private extractFunctionKey(result: EnhancedSemanticSearchResult): string {
    // Extract function/class name from content for diversity tracking
    const content = result.content;
    const functionMatch = content.match(
      /(?:function|class|const|let|var)\s+(\w+)/,
    );
    const functionName = functionMatch ? functionMatch[1] : 'anonymous';
    return `${result.filePath}:${functionName}`;
  }

  private getComplexityLevel(qualityMetrics: QualityMetrics): string {
    const readability = qualityMetrics.readabilityScore;
    if (readability > 0.8) return 'simple';
    if (readability > 0.6) return 'moderate';
    if (readability > 0.4) return 'complex';
    return 'very_complex';
  }

  private applyTemporalDiversification(
    results: EnhancedSemanticSearchResult[],
  ): EnhancedSemanticSearchResult[] {
    // Group results by time periods and ensure representation from different periods
    const timeGroups = new Map<string, EnhancedSemanticSearchResult[]>();

    results.forEach((result) => {
      const date = new Date(result.timestamp);
      const timeKey = `${date.getFullYear()}-${Math.floor(
        date.getMonth() / 3,
      )}`; // Quarterly groups

      if (!timeGroups.has(timeKey)) {
        timeGroups.set(timeKey, []);
      }
      timeGroups.get(timeKey)!.push(result);
    });

    // Take top results from each time group
    const diversifiedResults: EnhancedSemanticSearchResult[] = [];
    const maxPerGroup = Math.max(
      1,
      Math.floor(results.length / timeGroups.size),
    );

    for (const [, groupResults] of timeGroups) {
      diversifiedResults.push(...groupResults.slice(0, maxPerGroup));
    }

    return diversifiedResults.sort((a, b) => b.score - a.score);
  }

  private calculateDiversityScore(
    results: EnhancedSemanticSearchResult[],
  ): number {
    if (results.length === 0) return 0;

    const uniqueFiles = new Set(results.map((r) => r.filePath)).size;
    const uniquePatterns = new Set(
      results.flatMap((r) => r.enhancedMetadata?.designPatterns || []),
    ).size;
    const uniqueLayers = new Set(
      results.map((r) => r.enhancedMetadata?.architecturalLayer),
    ).size;

    const filesDiversity = uniqueFiles / results.length;
    const patternsDiversity = Math.min(1, uniquePatterns / 5); // Normalize to max 5 patterns
    const layersDiversity = Math.min(1, uniqueLayers / 3); // Normalize to max 3 layers

    return (filesDiversity + patternsDiversity + layersDiversity) / 3;
  }

  private calculateAverageQualityScore(
    results: EnhancedSemanticSearchResult[],
  ): number {
    if (results.length === 0) return 0;

    const totalQuality = results.reduce(
      (sum, result) => sum + result.qualityMetrics.overallScore,
      0,
    );
    return totalQuality / results.length;
  }

  private countRankingAdjustments(
    originalResults: SemanticSearchResult[],
    finalResults: EnhancedSemanticSearchResult[],
  ): number {
    // Count how many results changed their relative order
    let adjustments = 0;

    for (
      let i = 0;
      i < Math.min(originalResults.length, finalResults.length);
      i++
    ) {
      const originalId = `${originalResults[i].snapshotId}:${originalResults[i].filePath}:${originalResults[i].startLine}`;
      const finalId = `${finalResults[i].snapshotId}:${finalResults[i].filePath}:${finalResults[i].startLine}`;

      if (originalId !== finalId) {
        adjustments++;
      }
    }

    return adjustments;
  }

  // Content analysis helper methods

  private inferSemanticType(content: string): string {
    if (content.includes('class ')) return 'class';
    if (content.includes('interface ')) return 'interface';
    if (
      content.includes('function ') ||
      content.includes('const ') ||
      content.includes('let ')
    )
      return 'function';
    if (content.includes('module.exports') || content.includes('export '))
      return 'module';
    if (content.includes('test(') || content.includes('describe('))
      return 'test';
    if (content.includes('//') || content.includes('/*'))
      return 'documentation';
    return 'function';
  }

  private detectDesignPatterns(content: string): string[] {
    const patterns: string[] = [];

    if (content.includes('getInstance') || content.includes('singleton'))
      patterns.push('Singleton');
    if (content.includes('factory') || content.includes('create'))
      patterns.push('Factory');
    if (content.includes('observer') || content.includes('subscribe'))
      patterns.push('Observer');
    if (content.includes('strategy') || content.includes('algorithm'))
      patterns.push('Strategy');
    if (content.includes('decorator') || content.includes('wrapper'))
      patterns.push('Decorator');

    return patterns;
  }

  private inferArchitecturalLayer(filePath: string): string {
    const path = filePath.toLowerCase();

    if (
      path.includes('controller') ||
      path.includes('api') ||
      path.includes('route')
    )
      return 'presentation';
    if (
      path.includes('service') ||
      path.includes('business') ||
      path.includes('logic')
    )
      return 'business';
    if (
      path.includes('repository') ||
      path.includes('dao') ||
      path.includes('database')
    )
      return 'data';
    if (path.includes('model') || path.includes('entity')) return 'domain';
    if (path.includes('util') || path.includes('helper')) return 'utility';
    if (path.includes('config') || path.includes('setting'))
      return 'configuration';

    return 'unknown';
  }

  private detectFrameworkContext(content: string): string[] {
    const frameworks: string[] = [];

    if (content.includes('React') || content.includes('jsx'))
      frameworks.push('React');
    if (content.includes('Vue') || content.includes('vue'))
      frameworks.push('Vue');
    if (content.includes('Angular') || content.includes('@angular'))
      frameworks.push('Angular');
    if (content.includes('Express') || content.includes('express'))
      frameworks.push('Express');
    if (content.includes('Spring') || content.includes('@RestController'))
      frameworks.push('Spring');
    if (content.includes('Django') || content.includes('django'))
      frameworks.push('Django');

    return frameworks;
  }

  private extractDependencies(content: string): string[] {
    const dependencies: string[] = [];

    // Extract import statements
    const importMatches = content.match(/import.*from\s+['"]([^'"]+)['"]/g);
    if (importMatches) {
      importMatches.forEach((match) => {
        const depMatch = match.match(/from\s+['"]([^'"]+)['"]/);
        if (depMatch) dependencies.push(depMatch[1]);
      });
    }

    // Extract require statements
    const requireMatches = content.match(/require\(['"]([^'"]+)['"]\)/g);
    if (requireMatches) {
      requireMatches.forEach((match) => {
        const depMatch = match.match(/require\(['"]([^'"]+)['"]\)/);
        if (depMatch) dependencies.push(depMatch[1]);
      });
    }

    return dependencies;
  }

  private calculateCyclomaticComplexity(content: string): number {
    // Simple approximation of cyclomatic complexity
    const complexityKeywords = [
      'if',
      'else',
      'while',
      'for',
      'switch',
      'case',
      'catch',
    ];
    const operatorKeywords = ['&&', '||', '?'];
    let complexity = 1; // Base complexity

    // Count keyword-based complexity
    complexityKeywords.forEach((keyword) => {
      const matches = content.match(new RegExp(`\\b${keyword}\\b`, 'g'));
      if (matches) complexity += matches.length;
    });

    // Count operator-based complexity (escape special regex characters)
    operatorKeywords.forEach((operator) => {
      const escapedOperator = operator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = content.match(new RegExp(escapedOperator, 'g'));
      if (matches) complexity += matches.length;
    });

    return complexity;
  }

  private calculateCognitiveComplexity(content: string): number {
    // Simplified cognitive complexity calculation
    let complexity = 0;
    const lines = content.split('\n');
    let nestingLevel = 0;

    lines.forEach((line) => {
      const trimmed = line.trim();

      // Increase nesting for control structures
      if (
        trimmed.includes('if') ||
        trimmed.includes('for') ||
        trimmed.includes('while')
      ) {
        complexity += 1 + nestingLevel;
        nestingLevel++;
      }

      // Decrease nesting for closing braces
      if (trimmed === '}') {
        nestingLevel = Math.max(0, nestingLevel - 1);
      }

      // Add complexity for logical operators
      const logicalOps = (trimmed.match(/&&|\|\|/g) || []).length;
      complexity += logicalOps;
    });

    return complexity;
  }

  private calculateNestingDepth(content: string): number {
    let maxDepth = 0;
    let currentDepth = 0;

    for (const char of content) {
      if (char === '{') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === '}') {
        currentDepth = Math.max(0, currentDepth - 1);
      }
    }

    return maxDepth;
  }

  private calculateMaintainabilityIndex(content: string): number {
    // Simplified maintainability index calculation
    const linesOfCode = content.split('\n').length;
    const cyclomaticComplexity = this.calculateCyclomaticComplexity(content);
    const commentRatio =
      (content.match(/\/\/|\/\*/g) || []).length / linesOfCode;

    // Simplified formula (real MI is more complex)
    const mi = Math.max(
      0,
      100 - cyclomaticComplexity * 2 - linesOfCode * 0.1 + commentRatio * 10,
    );
    return Math.min(100, mi);
  }

  private identifySecurityConsiderations(content: string): any[] {
    const considerations: any[] = [];

    // Check for potential security issues
    if (content.includes('eval(') || content.includes('innerHTML')) {
      considerations.push({
        type: 'vulnerability',
        severity: 'high',
        description: 'Potential XSS vulnerability detected',
        recommendation: 'Avoid using eval() or innerHTML with user input',
      });
    }

    if (content.includes('password') && !content.includes('hash')) {
      considerations.push({
        type: 'data_handling',
        severity: 'medium',
        description: 'Password handling detected',
        recommendation: 'Ensure passwords are properly hashed and secured',
      });
    }

    return considerations;
  }

  private extractKeyFeatures(content: string): string[] {
    const features: string[] = [];

    // Extract function names
    const functionMatches = content.match(
      /(?:function|const|let|var)\s+(\w+)/g,
    );
    if (functionMatches) {
      features.push(...functionMatches.map((match) => match.split(/\s+/)[1]));
    }

    // Extract class names
    const classMatches = content.match(/class\s+(\w+)/g);
    if (classMatches) {
      features.push(...classMatches.map((match) => match.split(/\s+/)[1]));
    }

    return features.slice(0, 5); // Limit to top 5 features
  }

  private findMatchedConcepts(content: string, query: string): string[] {
    const queryWords = query.toLowerCase().split(/\s+/);
    const contentWords = content.toLowerCase().split(/\s+/);

    return queryWords.filter(
      (word) =>
        word.length > 2 &&
        contentWords.some((contentWord) => contentWord.includes(word)),
    );
  }

  private generateRelevanceExplanation(
    result: EnhancedSemanticSearchResult,
    processedQuery: ProcessedQuery,
    rank: number,
  ): string {
    const intent = processedQuery.intent.primary;
    const score = result.score;

    let explanation = `This result ranks #${rank + 1} `;

    if (score > 0.8) {
      explanation += 'with high semantic similarity to your query. ';
    } else if (score > 0.6) {
      explanation += 'with good semantic similarity to your query. ';
    } else {
      explanation += 'with moderate semantic similarity to your query. ';
    }

    switch (intent) {
      case 'find_examples':
        explanation += 'It appears to be a good example implementation ';
        break;
      case 'debug_issue':
        explanation += 'It contains relevant error handling or debugging code ';
        break;
      case 'find_patterns':
        explanation += 'It demonstrates relevant design patterns ';
        break;
      case 'analyze_quality':
        explanation += 'It provides code suitable for quality analysis ';
        break;
      default:
        explanation += 'It contains relevant implementation code ';
    }

    explanation += `based on the detected semantic type: ${
      result.enhancedMetadata?.semanticType || 'unknown'
    }.`;

    return explanation;
  }

  private generateSemanticSimilarityExplanation(
    result: EnhancedSemanticSearchResult,
    processedQuery: ProcessedQuery,
  ): string {
    const score = result.score;
    const enhancedQuery = processedQuery.enhancedQuery;

    if (score > 0.8) {
      return `Strong semantic match (${(score * 100).toFixed(
        1,
      )}%) with the enhanced query: "${enhancedQuery}"`;
    } else if (score > 0.6) {
      return `Good semantic match (${(score * 100).toFixed(
        1,
      )}%) with the enhanced query: "${enhancedQuery}"`;
    } else {
      return `Moderate semantic match (${(score * 100).toFixed(
        1,
      )}%) with the enhanced query: "${enhancedQuery}"`;
    }
  }

  private generateBehavioralSimilarityExplanation(
    result: EnhancedSemanticSearchResult,
    processedQuery: ProcessedQuery,
  ): string {
    return `Behavioral analysis indicates this code performs similar operations to what was requested in the query.`;
  }

  private calculateSimilarity(
    result1: EnhancedSemanticSearchResult,
    result2: EnhancedSemanticSearchResult,
  ): number {
    // Simple similarity calculation based on multiple factors
    let similarity = 0;
    let factors = 0;

    // File path similarity
    if (result1.filePath === result2.filePath) {
      similarity += 0.3;
    } else if (
      result1.filePath.split('/').slice(0, -1).join('/') ===
      result2.filePath.split('/').slice(0, -1).join('/')
    ) {
      similarity += 0.1;
    }
    factors++;

    // Semantic type similarity
    if (
      result1.enhancedMetadata?.semanticType ===
      result2.enhancedMetadata?.semanticType
    ) {
      similarity += 0.2;
    }
    factors++;

    // Score similarity
    const scoreDiff = Math.abs(result1.score - result2.score);
    similarity += Math.max(0, 0.3 - scoreDiff);
    factors++;

    return similarity / factors;
  }

  private identifyDifferences(
    result1: EnhancedSemanticSearchResult,
    result2: EnhancedSemanticSearchResult,
  ): string[] {
    const differences: string[] = [];

    if (result1.filePath !== result2.filePath) {
      differences.push(
        `Different files: ${result1.filePath} vs ${result2.filePath}`,
      );
    }

    if (
      result1.enhancedMetadata?.semanticType !==
      result2.enhancedMetadata?.semanticType
    ) {
      differences.push(
        `Different types: ${result1.enhancedMetadata?.semanticType} vs ${result2.enhancedMetadata?.semanticType}`,
      );
    }

    const score1 = result1.qualityMetrics.readabilityScore;
    const score2 = result2.qualityMetrics.readabilityScore;
    if (Math.abs(score1 - score2) > 0.2) {
      differences.push(
        `Different quality scores: ${score1.toFixed(2)} vs ${score2.toFixed(
          2,
        )}`,
      );
    }

    return differences;
  }

  private generateAlternativeDescription(
    result: EnhancedSemanticSearchResult,
  ): string {
    const type = result.enhancedMetadata?.semanticType || 'code';
    const quality = result.qualityMetrics.readabilityScore;

    let description = `Alternative ${type} implementation`;

    if (quality > 0.8) {
      description += ' with high quality';
    } else if (quality < 0.5) {
      description += ' with lower quality';
    }

    return description;
  }

  private generatePreferenceCondition(
    original: EnhancedSemanticSearchResult,
    alternative: EnhancedSemanticSearchResult,
  ): string {
    const originalQuality = original.qualityMetrics.readabilityScore;
    const alternativeQuality = alternative.qualityMetrics.readabilityScore;

    if (alternativeQuality > originalQuality + 0.1) {
      return 'When higher code quality is preferred';
    } else if (alternativeQuality < originalQuality - 0.1) {
      return 'When simpler implementation is acceptable';
    } else {
      return 'When alternative approach is needed';
    }
  }
}
