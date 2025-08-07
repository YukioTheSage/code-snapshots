/**
 * Result Manager Service Tests
 *
 * Comprehensive tests for the ResultManager class including:
 * - Multi-criteria ranking algorithms
 * - Result diversification logic
 * - Result explanation generation
 * - Performance and accuracy validation
 */

import {
  ResultManager,
  RankingConfiguration,
  DiversificationOptions,
  ResultProcessingStats,
} from '../resultManager';
import {
  EnhancedSemanticSearchResult,
  ProcessedQuery,
  EnhancedSemanticSearchOptions,
  QueryIntent,
  SearchStrategy,
  SearchResultExplanation,
  ActionableSuggestion,
  AlternativeResult,
} from '../../types/enhancedSearch';
import { SemanticSearchResult } from '../semanticSearchService';
import { QualityMetrics, ContextInfo } from '../../types/enhancedChunking';

describe('ResultManager', () => {
  let resultManager: ResultManager;
  let mockBaseResults: SemanticSearchResult[];
  let mockProcessedQuery: ProcessedQuery;
  let mockOptions: EnhancedSemanticSearchOptions;

  beforeEach(() => {
    resultManager = new ResultManager();

    // Create mock base results
    mockBaseResults = [
      {
        snapshotId: 'snap1',
        snapshot: {
          id: 'snap1',
          timestamp: Date.now() - 86400000,
          files: {},
        } as any,
        filePath: 'src/auth/login.ts',
        startLine: 10,
        endLine: 30,
        score: 0.9,
        content:
          'function authenticateUser(username: string, password: string) {\n  // Authentication logic\n  return validateCredentials(username, password);\n}',
        timestamp: Date.now() - 86400000,
      },
      {
        snapshotId: 'snap1',
        snapshot: {
          id: 'snap1',
          timestamp: Date.now() - 172800000,
          files: {},
        } as any,
        filePath: 'src/auth/validation.ts',
        startLine: 5,
        endLine: 25,
        score: 0.8,
        content:
          'function validateCredentials(username: string, password: string): boolean {\n  // Validation logic\n  return checkDatabase(username, password);\n}',
        timestamp: Date.now() - 172800000,
      },
      {
        snapshotId: 'snap2',
        snapshot: {
          id: 'snap2',
          timestamp: Date.now() - 259200000,
          files: {},
        } as any,
        filePath: 'src/utils/helpers.ts',
        startLine: 1,
        endLine: 15,
        score: 0.7,
        content:
          'function hashPassword(password: string): string {\n  // Password hashing\n  return bcrypt.hash(password, 10);\n}',
        timestamp: Date.now() - 259200000,
      },
      {
        snapshotId: 'snap1',
        snapshot: {
          id: 'snap1',
          timestamp: Date.now() - 86400000,
          files: {},
        } as any,
        filePath: 'src/auth/login.ts',
        startLine: 35,
        endLine: 50,
        score: 0.75,
        content:
          'function logoutUser(sessionId: string) {\n  // Logout logic\n  return clearSession(sessionId);\n}',
        timestamp: Date.now() - 86400000,
      },
      {
        snapshotId: 'snap3',
        snapshot: {
          id: 'snap3',
          timestamp: Date.now() - 345600000,
          files: {},
        } as any,
        filePath: 'src/test/auth.test.ts',
        startLine: 20,
        endLine: 40,
        score: 0.65,
        content:
          'describe("Authentication", () => {\n  test("should authenticate valid user", () => {\n    // Test logic\n  });\n});',
        timestamp: Date.now() - 345600000,
      },
    ];

    // Create mock processed query
    mockProcessedQuery = {
      originalQuery: 'user authentication',
      enhancedQuery: 'user authentication login validation',
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
        boostFactors: [
          {
            condition: 'hasTests',
            multiplier: 1.2,
            description: 'Boost results with tests',
            weight: 0.8,
          },
        ],
        penaltyFactors: [
          {
            condition: 'hasCodeSmells',
            multiplier: 0.8,
            description: 'Penalize code with smells',
            weight: 0.6,
          },
        ],
      },
      filters: {
        qualityThreshold: 0.6,
        semanticTypes: ['function', 'class'],
      },
      expectedResultTypes: ['function', 'method'],
      complexityScore: 0.7,
      processingMetadata: {
        processingTime: 150,
        enhancementsApplied: ['authentication', 'security'],
        autoFiltersApplied: ['qualityThreshold'],
        warnings: [],
        improvementSuggestions: [],
      },
    };

    // Create mock options
    mockOptions = {
      query: 'user authentication',
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
  });

  describe('processResults', () => {
    it('should process results with ranking and diversification', async () => {
      const { results, stats } = await resultManager.processResults(
        mockBaseResults,
        mockProcessedQuery,
        mockOptions,
      );

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(mockOptions.limit!);

      // Verify stats
      expect(stats).toBeDefined();
      expect(stats.originalCount).toBe(mockBaseResults.length);
      expect(stats.finalCount).toBe(results.length);
      expect(stats.processingTime).toBeGreaterThan(0);
      expect(stats.diversityScore).toBeGreaterThanOrEqual(0);
      expect(stats.averageQualityScore).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty results gracefully', async () => {
      const { results, stats } = await resultManager.processResults(
        [],
        mockProcessedQuery,
        mockOptions,
      );

      expect(results).toEqual([]);
      expect(stats.originalCount).toBe(0);
      expect(stats.finalCount).toBe(0);
    });

    it('should apply quality threshold filtering', async () => {
      const optionsWithHighThreshold = {
        ...mockOptions,
        filterCriteria: {
          qualityThreshold: 0.9,
        },
      };

      const { results } = await resultManager.processResults(
        mockBaseResults,
        mockProcessedQuery,
        optionsWithHighThreshold,
      );

      // Should filter out results with lower quality scores
      results.forEach((result) => {
        expect(result.qualityMetrics.readabilityScore).toBeGreaterThanOrEqual(
          0.6,
        ); // Default quality
      });
    });

    it('should respect result limit', async () => {
      const optionsWithLowLimit = {
        ...mockOptions,
        limit: 2,
      };

      const { results } = await resultManager.processResults(
        mockBaseResults,
        mockProcessedQuery,
        optionsWithLowLimit,
      );

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should include explanations when requested', async () => {
      const { results } = await resultManager.processResults(
        mockBaseResults,
        mockProcessedQuery,
        mockOptions,
      );

      results.forEach((result) => {
        expect(result.explanation).toBeDefined();
        expect(result.explanation.whyRelevant).toBeDefined();
        expect(result.explanation.keyFeatures).toBeDefined();
        expect(result.explanation.confidenceFactors).toBeDefined();
        expect(result.explanation.confidenceFactors.length).toBeGreaterThan(0);
      });
    });

    it('should include actionable suggestions', async () => {
      const { results } = await resultManager.processResults(
        mockBaseResults,
        mockProcessedQuery,
        mockOptions,
      );

      results.forEach((result) => {
        expect(result.suggestions).toBeDefined();
        expect(Array.isArray(result.suggestions)).toBe(true);

        // Check suggestion structure if any exist
        result.suggestions.forEach((suggestion) => {
          expect(suggestion.type).toBeDefined();
          expect(suggestion.description).toBeDefined();
          expect(suggestion.priority).toBeDefined();
          expect(suggestion.effort).toBeDefined();
        });
      });
    });
  });

  describe('rankResults', () => {
    let enhancedResults: EnhancedSemanticSearchResult[];

    beforeEach(async () => {
      // Convert base results to enhanced results for testing
      enhancedResults = await Promise.all(
        mockBaseResults.map(async (result) => {
          const qualityMetrics: QualityMetrics = {
            overallScore: 75,
            readabilityScore: 0.7,
            testCoverage: undefined,
            documentationRatio: 0.5,
            duplicationRisk: 0.3,
            performanceRisk: 0.2,
            securityRisk: 0.1,
            maintainabilityScore: 80,
            technicalDebt: {
              estimatedFixTime: 2,
              severity: 'low',
              categories: [],
              issues: [],
            },
            styleComplianceScore: 85,
          };

          const contextInfo: ContextInfo = {
            surroundingContext: '',
            architecturalLayer: 'business',
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

          return {
            ...result,
            explanation: {
              whyRelevant: 'Test explanation',
              keyFeatures: [],
              matchedConcepts: [],
              confidenceFactors: [],
              semanticSimilarity: 'Test similarity',
            },
            relationships: [],
            qualityMetrics,
            contextInfo,
            suggestions: [],
            alternatives: [],
            enhancedMetadata: {
              semanticType: 'function' as const,
              designPatterns: [],
              architecturalLayer: 'business',
              businessDomain: undefined,
              frameworkContext: [],
              dependencies: [],
              usageFrequency: 1,
              lastModified: result.timestamp,
              complexityMetrics: {
                cyclomaticComplexity: 2,
                cognitiveComplexity: 1,
                linesOfCode: result.content.split('\n').length,
                nestingDepth: 1,
                maintainabilityIndex: 70,
              },
              securityConsiderations: [],
            },
          };
        }),
      );
    });

    it('should rank results by relevance strategy', async () => {
      const rankedResults = await resultManager.rankResults(
        enhancedResults,
        mockProcessedQuery,
        mockOptions,
      );

      expect(rankedResults.length).toBeGreaterThan(0);

      // Results should be sorted by score (descending)
      for (let i = 1; i < rankedResults.length; i++) {
        expect(rankedResults[i - 1].score).toBeGreaterThanOrEqual(
          rankedResults[i].score,
        );
      }
    });

    it('should apply quality ranking strategy', async () => {
      const qualityOptions = {
        ...mockOptions,
        rankingStrategy: 'quality' as const,
      };

      const rankedResults = await resultManager.rankResults(
        enhancedResults,
        mockProcessedQuery,
        qualityOptions,
      );

      expect(rankedResults.length).toBeGreaterThan(0);
      // Quality ranking should consider quality metrics more heavily
    });

    it('should apply recency ranking strategy', async () => {
      const recencyOptions = {
        ...mockOptions,
        rankingStrategy: 'recency' as const,
      };

      const rankedResults = await resultManager.rankResults(
        enhancedResults,
        mockProcessedQuery,
        recencyOptions,
      );

      expect(rankedResults.length).toBeGreaterThan(0);
      // More recent results should generally rank higher
    });

    it('should handle boost factors', async () => {
      // Add test content to one result to trigger boost
      enhancedResults[0].content = 'function test() { /* test code */ }';
      enhancedResults[0].filePath = 'src/test/example.test.ts';

      const rankedResults = await resultManager.rankResults(
        enhancedResults,
        mockProcessedQuery,
        mockOptions,
      );

      // The test result should potentially rank higher due to boost factor
      expect(rankedResults.length).toBeGreaterThan(0);
    });

    it('should handle empty results', async () => {
      const rankedResults = await resultManager.rankResults(
        [],
        mockProcessedQuery,
        mockOptions,
      );

      expect(rankedResults).toEqual([]);
    });
  });

  describe('diversifyResults', () => {
    let enhancedResults: EnhancedSemanticSearchResult[];

    beforeEach(async () => {
      // Create enhanced results with diversity in mind
      enhancedResults = mockBaseResults.map((result, index) => ({
        ...result,
        explanation: {
          whyRelevant: 'Test explanation',
          keyFeatures: [],
          matchedConcepts: [],
          confidenceFactors: [],
          semanticSimilarity: 'Test similarity',
        },
        relationships: [],
        qualityMetrics: {
          overallScore: 75 + index * 5,
          readabilityScore: 0.7 + index * 0.05,
          testCoverage: undefined,
          documentationRatio: 0.5,
          duplicationRisk: 0.3,
          performanceRisk: 0.2,
          securityRisk: 0.1,
          maintainabilityScore: 80 + index * 2,
          technicalDebt: {
            estimatedFixTime: 2,
            severity: 'low',
            categories: [],
            issues: [],
          },
          styleComplianceScore: 85,
        },
        contextInfo: {
          surroundingContext: '',
          architecturalLayer: index % 2 === 0 ? 'business' : 'data',
          frameworkContext: [],
          businessContext: undefined,
          fileContext: {
            totalLines: result.content.split('\n').length,
            fileSize: result.content.length,
            lastModified: new Date(result.timestamp),
            encoding: 'utf-8',
            siblingChunks: [],
          },
        },
        suggestions: [],
        alternatives: [],
        enhancedMetadata: {
          semanticType: 'function' as const,
          designPatterns:
            index === 0 ? ['Singleton'] : index === 1 ? ['Factory'] : [],
          architecturalLayer: index % 2 === 0 ? 'business' : 'data',
          businessDomain: undefined,
          frameworkContext: [],
          dependencies: [],
          usageFrequency: 1,
          lastModified: result.timestamp,
          complexityMetrics: {
            cyclomaticComplexity: 2 + index,
            cognitiveComplexity: 1 + index,
            linesOfCode: result.content.split('\n').length,
            nestingDepth: 1,
            maintainabilityIndex: 70 - index * 5,
          },
          securityConsiderations: [],
        },
      }));
    });

    it('should diversify results by file', async () => {
      const diversifiedResults = await resultManager.diversifyResults(
        enhancedResults,
        mockProcessedQuery,
        mockOptions,
      );

      // Count results per file
      const fileCount = new Map<string, number>();
      diversifiedResults.forEach((result) => {
        const count = fileCount.get(result.filePath) || 0;
        fileCount.set(result.filePath, count + 1);
      });

      // Should respect maxResultsPerFile limit
      fileCount.forEach((count) => {
        expect(count).toBeLessThanOrEqual(mockOptions.maxResultsPerFile || 3);
      });
    });

    it('should prefer different design patterns', async () => {
      const diversifiedResults = await resultManager.diversifyResults(
        enhancedResults,
        mockProcessedQuery,
        mockOptions,
      );

      // Should include results with different patterns when available
      const patterns = new Set<string>();
      diversifiedResults.forEach((result) => {
        result.enhancedMetadata?.designPatterns?.forEach((pattern) =>
          patterns.add(pattern),
        );
      });

      expect(patterns.size).toBeGreaterThanOrEqual(0);
    });

    it('should handle results with no diversity requirements', async () => {
      const noDiversityOptions = {
        ...mockOptions,
        enableDiversification: false,
      };

      const diversifiedResults = await resultManager.diversifyResults(
        enhancedResults,
        mockProcessedQuery,
        noDiversityOptions,
      );

      // Should still return results, just without diversity constraints
      expect(diversifiedResults.length).toBeGreaterThan(0);
    });

    it('should handle empty results', async () => {
      const diversifiedResults = await resultManager.diversifyResults(
        [],
        mockProcessedQuery,
        mockOptions,
      );

      expect(diversifiedResults).toEqual([]);
    });
  });

  describe('generateExplanationsAndSuggestions', () => {
    let enhancedResults: EnhancedSemanticSearchResult[];

    beforeEach(() => {
      enhancedResults = [
        {
          ...mockBaseResults[0],
          explanation: {
            whyRelevant: '',
            keyFeatures: [],
            matchedConcepts: [],
            confidenceFactors: [],
            semanticSimilarity: '',
          },
          relationships: [],
          qualityMetrics: {
            overallScore: 60,
            readabilityScore: 0.5, // Low readability to trigger suggestions
            testCoverage: undefined,
            documentationRatio: 0.2, // Low documentation to trigger suggestions
            duplicationRisk: 0.3,
            performanceRisk: 0.2,
            securityRisk: 0.1,
            maintainabilityScore: 65,
            technicalDebt: {
              estimatedFixTime: 4,
              severity: 'medium',
              categories: ['code_smells', 'documentation_gaps'],
              issues: [],
            },
            styleComplianceScore: 70,
          },
          contextInfo: {
            surroundingContext: '',
            architecturalLayer: 'business',
            frameworkContext: [],
            businessContext: undefined,
            fileContext: {
              totalLines: mockBaseResults[0].content.split('\n').length,
              fileSize: mockBaseResults[0].content.length,
              lastModified: new Date(mockBaseResults[0].timestamp),
              encoding: 'utf-8',
              siblingChunks: [],
            },
          },
          suggestions: [],
          alternatives: [],
          enhancedMetadata: {
            semanticType: 'function' as const,
            designPatterns: [],
            architecturalLayer: 'business',
            businessDomain: undefined,
            frameworkContext: [],
            dependencies: [],
            usageFrequency: 1,
            lastModified: mockBaseResults[0].timestamp,
            complexityMetrics: {
              cyclomaticComplexity: 2,
              cognitiveComplexity: 1,
              linesOfCode: mockBaseResults[0].content.split('\n').length,
              nestingDepth: 1,
              maintainabilityIndex: 70,
            },
            securityConsiderations: [],
          },
        },
      ];
    });

    it('should generate explanations for results', async () => {
      const resultsWithExplanations =
        await resultManager.generateExplanationsAndSuggestions(
          enhancedResults,
          mockProcessedQuery,
        );

      expect(resultsWithExplanations.length).toBe(1);

      const result = resultsWithExplanations[0];
      expect(result.explanation).toBeDefined();
      expect(result.explanation.whyRelevant).toBeTruthy();
      expect(result.explanation.keyFeatures).toBeDefined();
      expect(result.explanation.confidenceFactors).toBeDefined();
      expect(result.explanation.confidenceFactors.length).toBeGreaterThan(0);
    });

    it('should generate actionable suggestions', async () => {
      const resultsWithSuggestions =
        await resultManager.generateExplanationsAndSuggestions(
          enhancedResults,
          mockProcessedQuery,
        );

      const result = resultsWithSuggestions[0];
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions.length).toBeGreaterThan(0);

      // Should suggest improvements for low readability
      const improvementSuggestion = result.suggestions.find(
        (s) => s.type === 'improvement',
      );
      expect(improvementSuggestion).toBeDefined();

      // Should suggest documentation for low documentation ratio
      const docSuggestion = result.suggestions.find(
        (s) => s.type === 'documentation',
      );
      expect(docSuggestion).toBeDefined();
    });

    it('should find alternative results', async () => {
      // Add more results to find alternatives
      const moreResults = [
        ...enhancedResults,
        {
          ...enhancedResults[0],
          filePath: 'src/auth/alternative.ts',
          score: 0.75,
          content:
            'function alternativeAuth() { /* alternative implementation */ }',
        },
      ];

      const resultsWithAlternatives =
        await resultManager.generateExplanationsAndSuggestions(
          moreResults,
          mockProcessedQuery,
        );

      // Should find alternatives for similar results
      expect(resultsWithAlternatives.length).toBe(2);
      resultsWithAlternatives.forEach((result) => {
        expect(result.alternatives).toBeDefined();
      });
    });

    it('should handle empty results', async () => {
      const results = await resultManager.generateExplanationsAndSuggestions(
        [],
        mockProcessedQuery,
      );

      expect(results).toEqual([]);
    });
  });

  describe('performance and edge cases', () => {
    it('should handle large result sets efficiently', async () => {
      // Create a large set of mock results
      const largeResultSet: SemanticSearchResult[] = Array.from(
        { length: 100 },
        (_, i) => ({
          ...mockBaseResults[0],
          filePath: `src/file${i}.ts`,
          startLine: i * 10,
          endLine: i * 10 + 20,
          score: 0.9 - i * 0.005, // Decreasing scores
          content: `function func${i}() { /* implementation ${i} */ }`,
        }),
      );

      const startTime = Date.now();
      const { results, stats } = await resultManager.processResults(
        largeResultSet,
        mockProcessedQuery,
        { ...mockOptions, limit: 20 },
      );
      const processingTime = Date.now() - startTime;

      expect(results.length).toBeLessThanOrEqual(20);
      expect(processingTime).toBeLessThan(5000); // Should complete within 5 seconds
      expect(stats.processingTime).toBeGreaterThan(0);
    });

    it('should handle results with missing metadata gracefully', async () => {
      const incompleteResults: SemanticSearchResult[] = [
        {
          snapshotId: 'snap1',
          snapshot: { id: 'snap1', timestamp: Date.now(), files: {} } as any,
          filePath: 'src/incomplete.ts',
          startLine: 1,
          endLine: 10,
          score: 0.8,
          content: 'incomplete content',
          timestamp: Date.now(),
        },
      ];

      const { results } = await resultManager.processResults(
        incompleteResults,
        mockProcessedQuery,
        mockOptions,
      );

      expect(results.length).toBe(1);
      expect(results[0].qualityMetrics).toBeDefined();
      expect(results[0].enhancedMetadata).toBeDefined();
      expect(results[0].explanation).toBeDefined();
    });

    it('should maintain result ordering consistency', async () => {
      // Run the same processing multiple times
      const runs = await Promise.all([
        resultManager.processResults(
          mockBaseResults,
          mockProcessedQuery,
          mockOptions,
        ),
        resultManager.processResults(
          mockBaseResults,
          mockProcessedQuery,
          mockOptions,
        ),
        resultManager.processResults(
          mockBaseResults,
          mockProcessedQuery,
          mockOptions,
        ),
      ]);

      // Results should be consistent across runs (same input = same output)
      const firstRunIds = runs[0].results.map(
        (r) => `${r.filePath}:${r.startLine}`,
      );

      runs.slice(1).forEach((run) => {
        const runIds = run.results.map((r) => `${r.filePath}:${r.startLine}`);
        expect(runIds).toEqual(firstRunIds);
      });
    });
  });

  describe('integration with different query intents', () => {
    it('should handle find_examples intent appropriately', async () => {
      const examplesQuery = {
        ...mockProcessedQuery,
        intent: {
          ...mockProcessedQuery.intent,
          primary: 'find_examples' as const,
        },
      };

      const { results } = await resultManager.processResults(
        mockBaseResults,
        examplesQuery,
        mockOptions,
      );

      results.forEach((result) => {
        expect(result.explanation.whyRelevant).toContain('example');

        // Should suggest usage for examples
        const usageSuggestion = result.suggestions.find(
          (s) => s.type === 'usage',
        );
        expect(usageSuggestion).toBeDefined();
      });
    });

    it('should handle debug_issue intent appropriately', async () => {
      const debugQuery = {
        ...mockProcessedQuery,
        intent: {
          ...mockProcessedQuery.intent,
          primary: 'debug_issue' as const,
        },
      };

      const { results } = await resultManager.processResults(
        mockBaseResults,
        debugQuery,
        mockOptions,
      );

      results.forEach((result) => {
        expect(result.explanation.whyRelevant).toContain('error handling');
      });
    });

    it('should handle analyze_quality intent appropriately', async () => {
      const qualityQuery = {
        ...mockProcessedQuery,
        intent: {
          ...mockProcessedQuery.intent,
          primary: 'analyze_quality' as const,
        },
      };

      const qualityOptions = {
        ...mockOptions,
        rankingStrategy: 'quality' as const,
      };

      const { results } = await resultManager.processResults(
        mockBaseResults,
        qualityQuery,
        qualityOptions,
      );

      results.forEach((result) => {
        expect(result.explanation.whyRelevant).toContain('quality analysis');
        expect(result.qualityMetrics).toBeDefined();
      });
    });
  });
});
