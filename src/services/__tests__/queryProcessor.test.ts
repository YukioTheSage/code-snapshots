/**
 * Unit tests for QueryProcessor service
 */

import { QueryProcessor, QueryContext, WorkspaceInfo } from '../queryProcessor';
import { QueryIntent } from '../../types/enhancedSearch';

describe('QueryProcessor', () => {
  let queryProcessor: QueryProcessor;

  beforeEach(() => {
    queryProcessor = new QueryProcessor();
  });

  describe('processQuery', () => {
    it('should process a simple query successfully', async () => {
      const result = await queryProcessor.processQuery(
        'find authentication code',
      );

      expect(result.originalQuery).toBe('find authentication code');
      expect(result.enhancedQuery).toContain('authentication');
      expect(result.intent.primary).toBe('find_implementation');
      expect(result.complexityScore).toBeGreaterThan(0);
      expect(result.processingMetadata.processingTime).toBeGreaterThan(0);
    });

    it('should enhance query with language context', async () => {
      const context: QueryContext = {
        language: 'typescript',
      };

      const result = await queryProcessor.processQuery(
        'user validation',
        context,
      );

      expect(result.enhancedQuery).toContain('typescript');
      expect(result.processingMetadata.enhancementsApplied).toContain(
        'typescript',
      );
    });

    it('should apply filters based on context', async () => {
      const context: QueryContext = {
        language: 'javascript',
        agentType: 'code_review',
      };

      const result = await queryProcessor.processQuery('code quality', context);

      expect(result.filters.includeFilePatterns).toContain('*.js');
      expect(result.intent.primary).toBe('analyze_quality');
    });
  });

  describe('classifyIntent', () => {
    it('should classify example-seeking queries correctly', async () => {
      const queries = [
        'show me examples of authentication',
        'how to implement user login',
        'sample code for API calls',
      ];

      for (const query of queries) {
        const intent = await queryProcessor.classifyIntent(query);
        expect(intent.primary).toBe('find_examples');
        expect(intent.confidence).toBeGreaterThan(0.8);
      }
    });

    it('should classify debugging queries correctly', async () => {
      const queries = [
        'fix authentication error',
        'debug login issue',
        'troubleshoot API connection problem',
      ];

      for (const query of queries) {
        const intent = await queryProcessor.classifyIntent(query);
        expect(intent.primary).toBe('debug_issue');
        expect(intent.confidence).toBeGreaterThan(0.8);
      }
    });

    it('should classify pattern-finding queries correctly', async () => {
      const queries = [
        'find singleton pattern implementation',
        'show design patterns in code',
        'architectural patterns used',
      ];

      for (const query of queries) {
        const intent = await queryProcessor.classifyIntent(query);
        expect(intent.primary).toBe('find_patterns');
        expect(intent.confidence).toBeGreaterThan(0.7);
      }
    });

    it('should classify usage queries correctly', async () => {
      const queries = [
        'where is this function used',
        'find usage of authentication service',
        'show references to user model',
      ];

      for (const query of queries) {
        const intent = await queryProcessor.classifyIntent(query);
        expect(intent.primary).toBe('find_usage');
        expect(intent.confidence).toBeGreaterThan(0.7);
      }
    });

    it('should adjust intent based on agent type', async () => {
      const context: QueryContext = {
        agentType: 'code_review',
      };

      const intent = await queryProcessor.classifyIntent(
        'analyze this code',
        context,
      );
      expect(intent.primary).toBe('analyze_quality');
    });

    it('should include suggested parameters', async () => {
      const intent = await queryProcessor.classifyIntent(
        'find similar functions',
      );

      expect(intent.suggestedParameters).toBeDefined();
      expect(intent.suggestedParameters.includeRelationships).toBe(true);
      expect(intent.suggestedParameters.searchMode).toBe('hybrid');
    });
  });

  describe('enhanceQuery', () => {
    it('should add technical terms based on intent', async () => {
      const intent: QueryIntent = {
        primary: 'find_implementation',
        secondary: [],
        confidence: 0.8,
        context: ['implementation'],
        suggestedParameters: {},
      };

      const result = await queryProcessor.enhanceQuery('user login', intent);

      expect(result.enhanced).toContain('implementation');
      expect(result.addedTerms).toContain('implementation');
    });

    it('should add language context when provided', async () => {
      const intent: QueryIntent = {
        primary: 'find_implementation',
        secondary: [],
        confidence: 0.8,
        context: [],
        suggestedParameters: {},
      };

      const context: QueryContext = {
        language: 'python',
      };

      const result = await queryProcessor.enhanceQuery(
        'data processing',
        intent,
        context,
      );

      expect(result.enhanced).toContain('python');
      expect(result.addedTerms).toContain('python');
    });

    it('should add contextual enhancements', async () => {
      const intent: QueryIntent = {
        primary: 'find_implementation',
        secondary: [],
        confidence: 0.8,
        context: [],
        suggestedParameters: {},
      };

      const result = await queryProcessor.enhanceQuery(
        'api authentication',
        intent,
      );

      expect(result.enhanced).toMatch(
        /(endpoint|service|client|request|response)/,
      );
    });

    it('should not add duplicate terms', async () => {
      const intent: QueryIntent = {
        primary: 'find_implementation',
        secondary: [],
        confidence: 0.8,
        context: [],
        suggestedParameters: {},
      };

      const result = await queryProcessor.enhanceQuery(
        'implementation of user authentication',
        intent,
      );

      // Should not add 'implementation' again since it's already in the query
      const implementationCount = (
        result.enhanced.match(/implementation/gi) || []
      ).length;
      expect(implementationCount).toBe(1);
    });

    it('should calculate enhancement confidence', async () => {
      const intent: QueryIntent = {
        primary: 'find_implementation',
        secondary: [],
        confidence: 0.8,
        context: [],
        suggestedParameters: {},
      };

      const result = await queryProcessor.enhanceQuery('short query', intent);

      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('decomposeComplexQuery', () => {
    it('should decompose queries with conjunctions', async () => {
      const query = 'find authentication code and error handling logic';
      const result = await queryProcessor.decomposeComplexQuery(query);

      expect(result.length).toBeGreaterThan(1);
      expect(result[0].query).toContain('authentication');
      expect(result[1].query).toContain('error handling');
    });

    it('should not decompose simple queries', async () => {
      const query = 'find user authentication';
      const result = await queryProcessor.decomposeComplexQuery(query);

      expect(result.length).toBe(0);
    });

    it('should set priorities correctly', async () => {
      const query =
        'find authentication implementation and also show testing examples';
      const result = await queryProcessor.decomposeComplexQuery(query);

      if (result.length > 0) {
        expect(result[0].priority).toBe('high');
        if (result.length > 1) {
          expect(result[1].priority).toBe('medium');
        }
      }
    });

    it('should set dependencies for later parts', async () => {
      const query = 'find user service and show its usage patterns';
      const result = await queryProcessor.decomposeComplexQuery(query);

      if (result.length > 1) {
        expect(result[1].dependencies.length).toBeGreaterThan(0);
      }
    });
  });

  describe('validateQuery', () => {
    it('should identify too short queries', async () => {
      const result = await queryProcessor.validateQuery('hi');

      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe('too_narrow');
      expect(result.issues[0].severity).toBe('high');
    });

    it('should identify too long queries', async () => {
      const longQuery = 'a'.repeat(250);
      const result = await queryProcessor.validateQuery(longQuery);

      expect(result.issues.some((issue) => issue.type === 'too_broad')).toBe(
        true,
      );
    });

    it('should identify ambiguous terms', async () => {
      const result = await queryProcessor.validateQuery('find this thing');

      expect(result.issues.some((issue) => issue.type === 'ambiguous')).toBe(
        true,
      );
    });

    it('should suggest language context when missing', async () => {
      const result = await queryProcessor.validateQuery(
        'find authentication code',
      );

      expect(
        result.suggestions.some((s) => s.type === 'context_addition'),
      ).toBe(true);
    });

    it('should identify unclear intent', async () => {
      const result = await queryProcessor.validateQuery('stuff about things');

      // The query should have low confidence or be flagged as unclear
      expect(
        result.issues.some(
          (issue) =>
            issue.type === 'unclear_intent' || issue.type === 'ambiguous',
        ),
      ).toBe(true);
    });

    it('should calculate estimated quality', async () => {
      const result = await queryProcessor.validateQuery(
        'find user authentication implementation',
      );

      expect(result.estimatedQuality).toBeGreaterThan(0);
      expect(result.estimatedQuality).toBeLessThanOrEqual(1);
    });

    it('should provide refinement suggestions', async () => {
      const result = await queryProcessor.validateQuery('vague query');

      expect(result.suggestions.length).toBeGreaterThan(0);
      // Should provide either refinement or context addition suggestions
      expect(
        result.suggestions.some(
          (s) => s.type === 'refinement' || s.type === 'context_addition',
        ),
      ).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty queries gracefully', async () => {
      const result = await queryProcessor.processQuery('');

      expect(result.originalQuery).toBe('');
      expect(result.processingMetadata.warnings.length).toBeGreaterThan(0);
    });

    it('should handle queries with special characters', async () => {
      const query = 'find @user.authenticate() method';
      const result = await queryProcessor.processQuery(query);

      expect(result.originalQuery).toBe(query);
      expect(result.enhancedQuery).toContain('authenticate');
    });

    it('should handle non-English queries gracefully', async () => {
      const query = 'найти функцию аутентификации';
      const result = await queryProcessor.processQuery(query);

      expect(result.originalQuery).toBe(query);
      expect(result.intent.confidence).toBeGreaterThan(0);
    });

    it('should handle very complex workspace context', async () => {
      const workspaceContext: WorkspaceInfo = {
        primaryLanguages: ['typescript', 'javascript', 'python'],
        frameworks: ['react', 'express', 'django'],
        projectType: 'web',
        architecturePatterns: ['mvc', 'microservices'],
      };

      const context: QueryContext = {
        language: 'typescript',
        workspaceContext,
        agentType: 'development_assistant',
        recentSearches: ['authentication', 'user management'],
      };

      const result = await queryProcessor.processQuery(
        'find user service',
        context,
      );

      expect(result.enhancedQuery).toContain('typescript');
      expect(result.intent.confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe('performance', () => {
    it('should process queries within reasonable time', async () => {
      const startTime = Date.now();
      await queryProcessor.processQuery(
        'find complex authentication implementation with error handling',
      );
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle batch processing efficiently', async () => {
      const queries = [
        'find authentication code',
        'show error handling examples',
        'locate user service implementation',
        'find API endpoint definitions',
        'show database query methods',
      ];

      const startTime = Date.now();
      const results = await Promise.all(
        queries.map((query) => queryProcessor.processQuery(query)),
      );
      const endTime = Date.now();

      expect(results.length).toBe(queries.length);
      expect(endTime - startTime).toBeLessThan(2000); // Should complete within 2 seconds
    });
  });
});
