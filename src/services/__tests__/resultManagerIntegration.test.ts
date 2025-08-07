/**
 * Result Manager Integration Tests
 *
 * Tests the integration between ResultManager and SemanticSearchService
 * to ensure the enhanced result processing works correctly in the full pipeline.
 */

import { ResultManager } from '../resultManager';
import { QueryProcessor } from '../queryProcessor';
import {
  EnhancedSemanticSearchOptions,
  ProcessedQuery,
  QueryIntent,
  SearchStrategy,
} from '../../types/enhancedSearch';
import { SemanticSearchResult } from '../semanticSearchService';

describe('ResultManager Integration', () => {
  let resultManager: ResultManager;
  let queryProcessor: QueryProcessor;

  beforeEach(() => {
    resultManager = new ResultManager();
    queryProcessor = new QueryProcessor();
  });

  describe('End-to-End Result Processing', () => {
    it('should process results through the complete pipeline', async () => {
      // Create realistic search results
      const mockResults: SemanticSearchResult[] = [
        {
          snapshotId: 'snap1',
          snapshot: {
            id: 'snap1',
            timestamp: Date.now() - 86400000,
            files: {},
          } as any,
          filePath: 'src/auth/authentication.ts',
          startLine: 10,
          endLine: 30,
          score: 0.92,
          content: `
export class AuthenticationService {
  async authenticateUser(username: string, password: string): Promise<AuthResult> {
    // Validate input parameters
    if (!username || !password) {
      throw new Error('Username and password are required');
    }
    
    // Hash password and check against database
    const hashedPassword = await this.hashPassword(password);
    const user = await this.userRepository.findByUsername(username);
    
    if (!user || user.password !== hashedPassword) {
      throw new Error('Invalid credentials');
    }
    
    // Generate JWT token
    const token = this.jwtService.generateToken(user.id);
    return { success: true, token, user };
  }
}`,
          timestamp: Date.now() - 86400000,
        },
        {
          snapshotId: 'snap1',
          snapshot: {
            id: 'snap1',
            timestamp: Date.now() - 86400000,
            files: {},
          } as any,
          filePath: 'src/auth/validation.ts',
          startLine: 5,
          endLine: 25,
          score: 0.85,
          content: `
export function validatePassword(password: string): ValidationResult {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}`,
          timestamp: Date.now() - 86400000,
        },
        {
          snapshotId: 'snap2',
          snapshot: {
            id: 'snap2',
            timestamp: Date.now() - 172800000,
            files: {},
          } as any,
          filePath: 'src/test/auth.test.ts',
          startLine: 1,
          endLine: 20,
          score: 0.78,
          content: `
describe('Authentication Service', () => {
  let authService: AuthenticationService;
  
  beforeEach(() => {
    authService = new AuthenticationService();
  });
  
  test('should authenticate valid user', async () => {
    const result = await authService.authenticateUser('testuser', 'password123');
    expect(result.success).toBe(true);
    expect(result.token).toBeDefined();
  });
  
  test('should reject invalid credentials', async () => {
    await expect(
      authService.authenticateUser('testuser', 'wrongpassword')
    ).rejects.toThrow('Invalid credentials');
  });
});`,
          timestamp: Date.now() - 172800000,
        },
      ];

      // Create a realistic processed query
      const processedQuery: ProcessedQuery = {
        originalQuery: 'user authentication implementation',
        enhancedQuery: 'user authentication implementation login security',
        intent: {
          primary: 'find_implementation',
          secondary: ['security'],
          confidence: 0.9,
          context: ['authentication', 'login', 'security'],
          suggestedParameters: {
            searchMode: 'semantic',
            rankingStrategy: 'relevance',
            includeQualityMetrics: true,
            includeRelationships: false,
          },
        },
        searchStrategy: {
          mode: 'semantic',
          ranking: 'relevance',
          diversification: true,
          contextRadius: 5,
          boostFactors: [],
          penaltyFactors: [],
        },
        filters: {
          qualityThreshold: 0.6,
        },
        expectedResultTypes: ['function', 'class'],
        complexityScore: 0.7,
        processingMetadata: {
          processingTime: 150,
          enhancementsApplied: ['authentication', 'security'],
          autoFiltersApplied: ['qualityThreshold'],
          warnings: [],
          improvementSuggestions: [],
        },
      };

      // Create enhanced search options
      const options: EnhancedSemanticSearchOptions = {
        query: 'user authentication implementation',
        searchMode: 'semantic',
        includeExplanations: true,
        includeRelationships: false,
        includeQualityMetrics: true,
        contextRadius: 5,
        rankingStrategy: 'relevance',
        filterCriteria: {
          qualityThreshold: 0.6,
        },
        limit: 10,
        enableDiversification: true,
        maxResultsPerFile: 2,
      };

      // Process results through ResultManager
      const { results, stats } = await resultManager.processResults(
        mockResults,
        processedQuery,
        options,
      );

      // Verify results structure
      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(options.limit!);

      // Verify each result has enhanced properties
      results.forEach((result) => {
        // Basic properties
        expect(result.snapshotId).toBeDefined();
        expect(result.filePath).toBeDefined();
        expect(result.content).toBeDefined();
        expect(result.score).toBeGreaterThan(0);

        // Enhanced properties
        expect(result.explanation).toBeDefined();
        expect(result.explanation.whyRelevant).toBeTruthy();
        expect(result.explanation.confidenceFactors).toBeDefined();
        expect(result.explanation.confidenceFactors.length).toBeGreaterThan(0);

        expect(result.qualityMetrics).toBeDefined();
        expect(result.qualityMetrics.overallScore).toBeGreaterThan(0);
        expect(result.qualityMetrics.readabilityScore).toBeGreaterThanOrEqual(
          0,
        );

        expect(result.contextInfo).toBeDefined();
        expect(result.enhancedMetadata).toBeDefined();
        expect(result.suggestions).toBeDefined();
        expect(result.alternatives).toBeDefined();
      });

      // Verify stats
      expect(stats).toBeDefined();
      expect(stats.originalCount).toBe(mockResults.length);
      expect(stats.finalCount).toBe(results.length);
      expect(stats.processingTime).toBeGreaterThan(0);
      expect(stats.diversityScore).toBeGreaterThanOrEqual(0);
      expect(stats.averageQualityScore).toBeGreaterThan(0);

      // Verify ranking (results should be sorted by score)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }

      // Verify diversification (should not have too many results from same file)
      const fileCount = new Map<string, number>();
      results.forEach((result) => {
        const count = fileCount.get(result.filePath) || 0;
        fileCount.set(result.filePath, count + 1);
      });

      fileCount.forEach((count) => {
        expect(count).toBeLessThanOrEqual(options.maxResultsPerFile || 3);
      });
    });

    it('should handle different query intents appropriately', async () => {
      const mockResults: SemanticSearchResult[] = [
        {
          snapshotId: 'snap1',
          snapshot: { id: 'snap1', timestamp: Date.now(), files: {} } as any,
          filePath: 'src/examples/auth-example.ts',
          startLine: 1,
          endLine: 20,
          score: 0.88,
          content: `
// Example: How to implement basic authentication
export function basicAuthExample() {
  const username = 'demo';
  const password = 'demo123';
  
  // This is a simple example of authentication
  return authenticateUser(username, password);
}`,
          timestamp: Date.now(),
        },
      ];

      // Test with find_examples intent
      const examplesQuery = await queryProcessor.processQuery(
        'show me authentication examples',
        { language: 'typescript' },
      );

      const examplesOptions: EnhancedSemanticSearchOptions = {
        query: 'show me authentication examples',
        searchMode: 'semantic',
        includeExplanations: true,
        includeRelationships: false,
        includeQualityMetrics: true,
        contextRadius: 5,
        rankingStrategy: 'usage',
        filterCriteria: {},
        limit: 5,
      };

      const { results } = await resultManager.processResults(
        mockResults,
        examplesQuery,
        examplesOptions,
      );

      expect(results.length).toBeGreaterThan(0);

      // Should have example-specific explanations
      results.forEach((result) => {
        expect(result.explanation.whyRelevant).toContain('example');

        // Should have usage suggestions for examples
        const usageSuggestion = result.suggestions.find(
          (s) => s.type === 'usage',
        );
        expect(usageSuggestion).toBeDefined();
      });
    });

    it('should handle quality-focused queries', async () => {
      const mockResults: SemanticSearchResult[] = [
        {
          snapshotId: 'snap1',
          snapshot: { id: 'snap1', timestamp: Date.now(), files: {} } as any,
          filePath: 'src/quality/high-quality.ts',
          startLine: 1,
          endLine: 30,
          score: 0.85,
          content: `
/**
 * High-quality authentication service with comprehensive error handling,
 * input validation, and proper documentation.
 */
export class SecureAuthenticationService {
  /**
   * Authenticates a user with comprehensive validation and error handling
   * @param username - The username to authenticate
   * @param password - The password to verify
   * @returns Promise resolving to authentication result
   * @throws AuthenticationError when credentials are invalid
   */
  async authenticateUser(username: string, password: string): Promise<AuthResult> {
    try {
      this.validateInput(username, password);
      const user = await this.findUser(username);
      await this.verifyPassword(password, user.hashedPassword);
      return this.createAuthResult(user);
    } catch (error) {
      this.logAuthenticationAttempt(username, false);
      throw new AuthenticationError('Authentication failed', error);
    }
  }
}`,
          timestamp: Date.now(),
        },
      ];

      // Test with analyze_quality intent
      const qualityQuery = await queryProcessor.processQuery(
        'analyze authentication code quality',
        { language: 'typescript' },
      );

      const qualityOptions: EnhancedSemanticSearchOptions = {
        query: 'analyze authentication code quality',
        searchMode: 'semantic',
        includeExplanations: true,
        includeRelationships: false,
        includeQualityMetrics: true,
        contextRadius: 5,
        rankingStrategy: 'quality',
        filterCriteria: {
          qualityThreshold: 0.7,
        },
        limit: 5,
      };

      const { results } = await resultManager.processResults(
        mockResults,
        qualityQuery,
        qualityOptions,
      );

      expect(results.length).toBeGreaterThan(0);

      // Should focus on quality aspects
      results.forEach((result) => {
        expect(result.explanation.whyRelevant).toContain('quality');
        expect(result.qualityMetrics).toBeDefined();
        expect(result.qualityMetrics.overallScore).toBeGreaterThan(0);

        // Quality metrics should be comprehensive
        expect(result.qualityMetrics.readabilityScore).toBeDefined();
        expect(result.qualityMetrics.maintainabilityScore).toBeDefined();
        expect(result.qualityMetrics.technicalDebt).toBeDefined();
      });
    });

    it('should provide meaningful performance metrics', async () => {
      const mockResults: SemanticSearchResult[] = Array.from(
        { length: 20 },
        (_, i) => ({
          snapshotId: 'snap1',
          snapshot: { id: 'snap1', timestamp: Date.now(), files: {} } as any,
          filePath: `src/file${i}.ts`,
          startLine: 1,
          endLine: 10,
          score: 0.9 - i * 0.02,
          content: `function example${i}() { return ${i}; }`,
          timestamp: Date.now(),
        }),
      );

      const processedQuery = await queryProcessor.processQuery('test query');
      const options: EnhancedSemanticSearchOptions = {
        query: 'test query',
        searchMode: 'semantic',
        includeExplanations: true,
        includeRelationships: false,
        includeQualityMetrics: true,
        contextRadius: 5,
        rankingStrategy: 'relevance',
        filterCriteria: {},
        limit: 10,
      };

      const startTime = Date.now();
      const { results, stats } = await resultManager.processResults(
        mockResults,
        processedQuery,
        options,
      );
      const endTime = Date.now();

      // Verify performance metrics
      expect(stats.processingTime).toBeGreaterThan(0);
      expect(stats.processingTime).toBeLessThan(endTime - startTime + 100); // Allow some margin
      expect(stats.originalCount).toBe(20);
      expect(stats.finalCount).toBeLessThanOrEqual(10);
      expect(stats.diversityScore).toBeGreaterThanOrEqual(0);
      expect(stats.averageQualityScore).toBeGreaterThan(0);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle empty results gracefully', async () => {
      const processedQuery = await queryProcessor.processQuery('test query');
      const options: EnhancedSemanticSearchOptions = {
        query: 'test query',
        searchMode: 'semantic',
        includeExplanations: true,
        includeRelationships: false,
        includeQualityMetrics: true,
        contextRadius: 5,
        rankingStrategy: 'relevance',
        filterCriteria: {},
        limit: 10,
      };

      const { results, stats } = await resultManager.processResults(
        [],
        processedQuery,
        options,
      );

      expect(results).toEqual([]);
      expect(stats.originalCount).toBe(0);
      expect(stats.finalCount).toBe(0);
      expect(stats.processingTime).toBeGreaterThanOrEqual(0);
    });

    it('should handle malformed content gracefully', async () => {
      const mockResults: SemanticSearchResult[] = [
        {
          snapshotId: 'snap1',
          snapshot: { id: 'snap1', timestamp: Date.now(), files: {} } as any,
          filePath: 'src/malformed.ts',
          startLine: 1,
          endLine: 5,
          score: 0.8,
          content:
            '// Malformed content with special chars: ñáéíóú @#$%^&*(){}[]',
          timestamp: Date.now(),
        },
      ];

      const processedQuery = await queryProcessor.processQuery('test query');
      const options: EnhancedSemanticSearchOptions = {
        query: 'test query',
        searchMode: 'semantic',
        includeExplanations: true,
        includeRelationships: false,
        includeQualityMetrics: true,
        contextRadius: 5,
        rankingStrategy: 'relevance',
        filterCriteria: {},
        limit: 10,
      };

      const { results } = await resultManager.processResults(
        mockResults,
        processedQuery,
        options,
      );

      expect(results.length).toBe(1);
      expect(results[0].content).toBeDefined();
      expect(results[0].qualityMetrics).toBeDefined();
      expect(results[0].explanation).toBeDefined();
    });
  });
});
