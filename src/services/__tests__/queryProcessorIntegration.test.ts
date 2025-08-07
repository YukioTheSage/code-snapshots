/**
 * Integration tests for QueryProcessor with SemanticSearchService
 */

import { QueryProcessor } from '../queryProcessor';
import { EnhancedSemanticSearchOptions } from '../../types/enhancedSearch';

describe('QueryProcessor Integration', () => {
  let queryProcessor: QueryProcessor;

  beforeEach(() => {
    queryProcessor = new QueryProcessor();
  });

  describe('Integration with Enhanced Search Options', () => {
    it('should process query and generate compatible search options', async () => {
      const query = 'find authentication implementation with error handling';
      const processedQuery = await queryProcessor.processQuery(query);

      expect(processedQuery.originalQuery).toBe(query);
      expect(processedQuery.enhancedQuery).toContain('authentication');
      expect(processedQuery.intent.primary).toBeDefined();
      expect(processedQuery.searchStrategy).toBeDefined();
      expect(processedQuery.filters).toBeDefined();
      expect(processedQuery.expectedResultTypes).toBeDefined();
      expect(processedQuery.complexityScore).toBeGreaterThan(0);
    });

    it('should generate search strategy compatible with enhanced search options', async () => {
      const query = 'show me examples of user authentication';
      const processedQuery = await queryProcessor.processQuery(query);

      expect(processedQuery.searchStrategy.mode).toMatch(
        /^(semantic|syntactic|behavioral|hybrid)$/,
      );
      expect(processedQuery.searchStrategy.ranking).toMatch(
        /^(relevance|quality|recency|usage|balanced)$/,
      );
      expect(typeof processedQuery.searchStrategy.diversification).toBe(
        'boolean',
      );
      expect(typeof processedQuery.searchStrategy.contextRadius).toBe('number');
      expect(Array.isArray(processedQuery.searchStrategy.boostFactors)).toBe(
        true,
      );
      expect(Array.isArray(processedQuery.searchStrategy.penaltyFactors)).toBe(
        true,
      );
    });

    it('should generate filters compatible with search filter criteria', async () => {
      const query = 'find high quality authentication code';
      const processedQuery = await queryProcessor.processQuery(query);

      // Should have quality-related filters for quality-focused queries
      if (processedQuery.intent.primary === 'analyze_quality') {
        expect(processedQuery.filters.qualityThreshold).toBeGreaterThan(0);
      }

      // Filters should be properly typed
      if (processedQuery.filters.complexityRange) {
        expect(Array.isArray(processedQuery.filters.complexityRange)).toBe(
          true,
        );
        expect(processedQuery.filters.complexityRange.length).toBe(2);
      }

      if (processedQuery.filters.semanticTypes) {
        expect(Array.isArray(processedQuery.filters.semanticTypes)).toBe(true);
      }
    });

    it('should handle context information properly', async () => {
      const context = {
        language: 'typescript',
        agentType: 'code_review',
        availableSnapshots: ['snapshot1', 'snapshot2'],
      };

      const processedQuery = await queryProcessor.processQuery(
        'analyze code quality',
        context,
      );

      expect(processedQuery.enhancedQuery).toContain('typescript');
      expect(processedQuery.intent.primary).toBe('analyze_quality');
    });

    it('should provide suggested parameters compatible with enhanced search options', async () => {
      const query = 'find similar functions to user authentication';
      const intent = await queryProcessor.classifyIntent(query);

      expect(intent.suggestedParameters).toBeDefined();

      // Check that suggested parameters are valid enhanced search option properties
      const validSearchModes = [
        'semantic',
        'syntactic',
        'behavioral',
        'hybrid',
      ];
      const validRankingStrategies = [
        'relevance',
        'quality',
        'recency',
        'usage',
        'balanced',
      ];

      if (intent.suggestedParameters.searchMode) {
        expect(validSearchModes).toContain(
          intent.suggestedParameters.searchMode,
        );
      }

      if (intent.suggestedParameters.rankingStrategy) {
        expect(validRankingStrategies).toContain(
          intent.suggestedParameters.rankingStrategy,
        );
      }

      if (intent.suggestedParameters.includeQualityMetrics !== undefined) {
        expect(typeof intent.suggestedParameters.includeQualityMetrics).toBe(
          'boolean',
        );
      }

      if (intent.suggestedParameters.includeRelationships !== undefined) {
        expect(typeof intent.suggestedParameters.includeRelationships).toBe(
          'boolean',
        );
      }
    });
  });

  describe('Query Enhancement Scenarios', () => {
    it('should enhance debugging queries appropriately', async () => {
      const query = 'fix authentication error';
      const processedQuery = await queryProcessor.processQuery(query);

      expect(processedQuery.intent.primary).toBe('debug_issue');
      expect(processedQuery.enhancedQuery).toContain('error');
      expect(processedQuery.searchStrategy.mode).toBe('syntactic');
      expect(processedQuery.searchStrategy.ranking).toBe('recency');
    });

    it('should enhance pattern-finding queries appropriately', async () => {
      const query = 'show design patterns in authentication';
      const processedQuery = await queryProcessor.processQuery(query);

      expect(processedQuery.intent.primary).toBe('find_patterns');
      expect(processedQuery.searchStrategy.mode).toBe('behavioral');
      expect(processedQuery.expectedResultTypes).toContain('pattern');
    });

    it('should enhance example-seeking queries appropriately', async () => {
      const query = 'show me examples of JWT authentication';
      const processedQuery = await queryProcessor.processQuery(query);

      expect(processedQuery.intent.primary).toBe('find_examples');
      expect(processedQuery.searchStrategy.ranking).toBe('usage');
      expect(processedQuery.expectedResultTypes).toContain('example');
    });
  });

  describe('Query Validation Integration', () => {
    it('should validate queries and provide actionable feedback', async () => {
      const shortQuery = 'hi';
      const validation = await queryProcessor.validateQuery(shortQuery);

      expect(validation.isValid).toBe(false);
      expect(validation.issues.length).toBeGreaterThan(0);
      expect(validation.suggestions.length).toBeGreaterThan(0);
      expect(validation.estimatedQuality).toBeGreaterThan(0);
      expect(validation.estimatedQuality).toBeLessThanOrEqual(1);
    });

    it('should provide quality estimates for different query types', async () => {
      const queries = [
        'find authentication code',
        'show me examples of user login with TypeScript',
        'debug authentication error in React component',
        'analyze code quality of authentication service',
      ];

      for (const query of queries) {
        const validation = await queryProcessor.validateQuery(query);
        expect(validation.estimatedQuality).toBeGreaterThan(0);
        expect(validation.estimatedQuality).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Complex Query Decomposition', () => {
    it('should decompose complex queries into manageable sub-queries', async () => {
      const complexQuery =
        'find authentication implementation and also show error handling patterns';
      const subQueries = await queryProcessor.decomposeComplexQuery(
        complexQuery,
      );

      expect(subQueries.length).toBeGreaterThan(1);

      for (const subQuery of subQueries) {
        expect(subQuery.query).toBeDefined();
        expect(subQuery.intent).toBeDefined();
        expect(['high', 'medium', 'low']).toContain(subQuery.priority);
        expect(Array.isArray(subQuery.dependencies)).toBe(true);
        expect(subQuery.expectedResultType).toBeDefined();
      }
    });

    it('should not decompose simple queries', async () => {
      const simpleQuery = 'find user authentication';
      const subQueries = await queryProcessor.decomposeComplexQuery(
        simpleQuery,
      );

      expect(subQueries.length).toBe(0);
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle edge cases gracefully', async () => {
      const edgeCases = [
        '',
        '   ',
        'a',
        'find @#$%^&*() code',
        'найти код аутентификации', // Non-English
        'find'.repeat(100), // Very long query
      ];

      for (const query of edgeCases) {
        const processedQuery = await queryProcessor.processQuery(query);
        expect(processedQuery.originalQuery).toBe(query);
        expect(processedQuery.intent).toBeDefined();
        expect(processedQuery.searchStrategy).toBeDefined();
        expect(
          processedQuery.processingMetadata.processingTime,
        ).toBeGreaterThanOrEqual(0);
      }
    });

    it('should maintain consistent performance', async () => {
      const query = 'find authentication implementation with error handling';
      const iterations = 10;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await queryProcessor.processQuery(query);
        const end = Date.now();
        times.push(end - start);
      }

      const averageTime =
        times.reduce((sum, time) => sum + time, 0) / times.length;
      const maxTime = Math.max(...times);

      expect(averageTime).toBeLessThan(100); // Should average under 100ms
      expect(maxTime).toBeLessThan(500); // No single operation should take more than 500ms
    });
  });
});
