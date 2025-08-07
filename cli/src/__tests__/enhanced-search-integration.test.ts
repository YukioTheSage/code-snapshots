import { SearchCommands } from '../commands/search';
import { CodeLapseClient } from '../client';

// Mock the client
jest.mock('../client');

describe('Enhanced Search Integration', () => {
  let searchCommands: SearchCommands;
  let mockClient: jest.Mocked<CodeLapseClient>;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockClient = new CodeLapseClient() as jest.Mocked<CodeLapseClient>;
    searchCommands = new SearchCommands(mockClient);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('Enhanced Query Search', () => {
    it('should use enhanced search with all options', async () => {
      const mockResults = {
        results: [
          {
            id: 'chunk-1',
            content: 'test content',
            score: 0.85,
            explanation: {
              whyRelevant: 'Matches authentication logic',
              keyFeatures: ['login', 'validation'],
              matchedConcepts: ['security', 'auth'],
              confidenceFactors: [{ factor: 'keyword_match', weight: 0.8, description: 'Strong keyword match' }]
            },
            qualityMetrics: {
              readabilityScore: 0.9,
              maintainabilityIndex: 0.8,
              complexityScore: 0.6
            },
            relationships: [
              { type: 'calls', targetChunkId: 'chunk-2', strength: 0.7, description: 'Calls validation function' }
            ]
          }
        ],
        metadata: {
          totalResults: 1,
          searchStrategy: { mode: 'semantic', ranking: 'relevance' },
          performanceMetrics: { totalTime: 150 }
        },
        suggestions: ['Try more specific terms'],
        relatedQueries: ['user authentication', 'login validation']
      };

      mockClient.callApi.mockResolvedValue(mockResults);

      const options = {
        limit: '10',
        threshold: '0.7',
        snapshots: 'snap1,snap2',
        languages: 'typescript,javascript',
        mode: 'hybrid',
        explanations: true,
        relationships: true,
        quality: true,
        context: '8',
        ranking: 'quality',
        complexityMin: '0.3',
        complexityMax: '0.8',
        qualityMin: '0.6',
        semanticTypes: 'function,class',
        patterns: 'factory,observer',
        excludeSmells: 'long-method,duplicate-code',
        domains: 'authentication,security',
        maxPerFile: '5',
        diversify: true
      };

      await searchCommands.query('find authentication code', options);

      expect(mockClient.callApi).toHaveBeenCalledWith('enhancedSearch', {
        query: 'find authentication code',
        limit: 10,
        scoreThreshold: 0.7,
        snapshotIds: ['snap1', 'snap2'],
        languages: ['typescript', 'javascript'],
        searchMode: 'hybrid',
        includeExplanations: true,
        includeRelationships: true,
        includeQualityMetrics: true,
        contextRadius: 8,
        rankingStrategy: 'quality',
        filterCriteria: {
          complexityRange: [0.3, 0.8],
          qualityThreshold: 0.6,
          semanticTypes: ['function', 'class'],
          designPatterns: ['factory', 'observer'],
          excludeCodeSmells: ['long-method', 'duplicate-code'],
          businessDomains: ['authentication', 'security']
        },
        maxResultsPerFile: 5,
        enableDiversification: true
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        query: 'find authentication code',
        results: mockResults.results,
        metadata: mockResults.metadata,
        suggestions: mockResults.suggestions,
        relatedQueries: mockResults.relatedQueries,
        enhanced: true
      }));
    });

    it('should fallback to basic search when enhanced search fails', async () => {
      const basicResults = [
        { id: 'chunk-1', content: 'test content', score: 0.8 }
      ];

      mockClient.callApi
        .mockRejectedValueOnce(new Error('Enhanced search not available'))
        .mockResolvedValueOnce(basicResults);

      const options = {
        limit: '20',
        threshold: '0.65',
        mode: 'semantic'
      };

      await searchCommands.query('test query', options);

      expect(mockClient.callApi).toHaveBeenCalledTimes(2);
      expect(mockClient.callApi).toHaveBeenNthCalledWith(1, 'enhancedSearch', expect.any(Object));
      expect(mockClient.callApi).toHaveBeenNthCalledWith(2, 'searchSnapshots', {
        query: 'test query',
        limit: 20,
        scoreThreshold: 0.65,
        snapshotIds: undefined,
        languages: undefined
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        query: 'test query',
        results: basicResults,
        total: 1,
        options: {
          query: 'test query',
          limit: 20,
          scoreThreshold: 0.65,
          snapshotIds: undefined,
          languages: undefined
        },
        enhanced: false,
        fallback: true
      }));
    });
  });

  describe('Behavioral Search', () => {
    it('should perform behavioral search with proper options', async () => {
      const mockResults = {
        results: [
          {
            id: 'chunk-1',
            content: 'error handling code',
            score: 0.9,
            explanation: {
              whyRelevant: 'Handles network timeout errors',
              matchedConcepts: ['error', 'timeout', 'network']
            }
          }
        ],
        metadata: { totalResults: 1 }
      };

      mockClient.callApi.mockResolvedValue(mockResults);

      const options = {
        limit: '15',
        threshold: '0.6',
        snapshots: 'snap1',
        languages: 'typescript',
        relationships: true,
        context: '10',
        qualityMin: '0.5'
      };

      await searchCommands.behavioral('code that handles network timeouts', options);

      expect(mockClient.callApi).toHaveBeenCalledWith('enhancedSearch', {
        query: 'code that handles network timeouts',
        searchMode: 'behavioral',
        limit: 15,
        scoreThreshold: 0.6,
        snapshotIds: ['snap1'],
        languages: ['typescript'],
        includeExplanations: true,
        includeRelationships: true,
        contextRadius: 10,
        filterCriteria: {
          qualityThreshold: 0.5
        }
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        description: 'code that handles network timeouts',
        searchMode: 'behavioral',
        results: mockResults.results,
        metadata: mockResults.metadata,
        behaviorAnalysis: {
          matchedBehaviors: [['error', 'timeout', 'network']],
          confidenceScores: [undefined]
        }
      }));
    });
  });

  describe('Pattern Search', () => {
    it('should perform pattern search with filtering options', async () => {
      const mockResults = {
        results: [
          {
            id: 'chunk-1',
            content: 'factory pattern implementation',
            score: 0.85,
            enhancedMetadata: {
              designPatterns: ['factory', 'singleton']
            },
            qualityMetrics: {
              overallScore: 0.8
            }
          }
        ],
        metadata: { totalResults: 1 }
      };

      mockClient.callApi.mockResolvedValue(mockResults);

      const options = {
        limit: '10',
        threshold: '0.75',
        languages: 'typescript,javascript',
        context: '12',
        complexityMin: '0.4',
        semanticTypes: 'class,function'
      };

      await searchCommands.pattern('factory', options);

      expect(mockClient.callApi).toHaveBeenCalledWith('enhancedSearch', {
        query: 'Find factory pattern implementations',
        searchMode: 'pattern',
        patternType: 'factory',
        limit: 10,
        scoreThreshold: 0.75,
        snapshotIds: undefined,
        languages: ['typescript', 'javascript'],
        includeExplanations: true,
        includeRelationships: true,
        contextRadius: 12,
        filterCriteria: {
          complexityRange: [0.4, 100],
          semanticTypes: ['class', 'function']
        }
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        patternType: 'factory',
        searchMode: 'pattern',
        results: mockResults.results,
        metadata: mockResults.metadata,
        patternAnalysis: {
          foundPatterns: [['factory', 'singleton']],
          implementations: 1,
          qualityScores: [0.8]
        }
      }));
    });
  });

  describe('Batch Search', () => {
    it('should execute batch search from file', async () => {
      const mockQueries = [
        {
          id: 'query-1',
          query: 'authentication code',
          searchMode: 'semantic',
          limit: 10
        },
        {
          id: 'query-2',
          query: 'error handling',
          searchMode: 'behavioral',
          scoreThreshold: 0.7
        }
      ];

      const mockResults = {
        totalQueries: 2,
        successfulQueries: 2,
        failedQueries: 0,
        averageResponseTime: 250
      };

      // Mock fs.readFileSync
      const mockFs = {
        readFileSync: jest.fn().mockReturnValue(JSON.stringify(mockQueries))
      };
      jest.doMock('fs', () => mockFs);

      mockClient.callApi.mockResolvedValue(mockResults);

      const options = {
        parallel: true,
        concurrency: '5'
      };

      await searchCommands.batch('queries.json', options);

      expect(mockClient.callApi).toHaveBeenCalledWith('batchSearch', {
        queries: [
          {
            id: 'query-1',
            query: 'authentication code',
            searchMode: 'semantic',
            limit: 10,
            scoreThreshold: 0.65,
            snapshotIds: undefined,
            languages: undefined,
            includeExplanations: true,
            includeRelationships: true,
            contextRadius: 5,
            filterCriteria: {}
          },
          {
            id: 'query-2',
            query: 'error handling',
            searchMode: 'behavioral',
            limit: 20,
            scoreThreshold: 0.7,
            snapshotIds: undefined,
            languages: undefined,
            includeExplanations: true,
            includeRelationships: true,
            contextRadius: 5,
            filterCriteria: {}
          }
        ],
        parallel: true,
        maxConcurrency: 5
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        batchResults: mockResults,
        summary: {
          totalQueries: 2,
          successfulQueries: 2,
          failedQueries: 0,
          averageResponseTime: 250
        }
      }));
    });

    it('should handle batch search API errors', async () => {
      const mockQueries = [
        { id: 'query-1', query: 'test query' }
      ];

      const mockFs = {
        readFileSync: jest.fn().mockReturnValue(JSON.stringify(mockQueries))
      };
      jest.doMock('fs', () => mockFs);

      mockClient.callApi.mockRejectedValue(new Error('Batch search service unavailable'));

      const options = {};

      await searchCommands.batch('queries.json', options);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: false,
        error: 'Batch search service unavailable',
        suggestions: ['Check queries file format', 'Verify file path', 'Validate query objects', 'Ensure queries array structure']
      }));
    });
  });

  describe('Filter Criteria Parsing', () => {
    it('should parse all filter criteria correctly', async () => {
      mockClient.callApi.mockResolvedValue({ results: [], metadata: {} });

      const options = {
        complexityMin: '0.2',
        complexityMax: '0.9',
        qualityMin: '0.7',
        semanticTypes: 'function,class,interface',
        patterns: 'factory,observer,strategy',
        excludeSmells: 'long-method,duplicate-code,god-class',
        domains: 'authentication,payment,reporting'
      };

      await searchCommands.query('test query', options);

      expect(mockClient.callApi).toHaveBeenCalledWith('enhancedSearch', expect.objectContaining({
        filterCriteria: {
          complexityRange: [0.2, 0.9],
          qualityThreshold: 0.7,
          semanticTypes: ['function', 'class', 'interface'],
          designPatterns: ['factory', 'observer', 'strategy'],
          excludeCodeSmells: ['long-method', 'duplicate-code', 'god-class'],
          businessDomains: ['authentication', 'payment', 'reporting']
        }
      }));
    });

    it('should handle partial filter criteria', async () => {
      mockClient.callApi.mockResolvedValue({ results: [], metadata: {} });

      const options = {
        complexityMin: '0.3',
        semanticTypes: 'function',
        excludeSmells: 'long-method'
      };

      await searchCommands.query('test query', options);

      expect(mockClient.callApi).toHaveBeenCalledWith('enhancedSearch', expect.objectContaining({
        filterCriteria: {
          complexityRange: [0.3, 100],
          semanticTypes: ['function'],
          excludeCodeSmells: ['long-method']
        }
      }));
    });
  });

  describe('Error Handling', () => {
    it('should handle search errors gracefully', async () => {
      mockClient.callApi.mockRejectedValue(new Error('Search service unavailable'));

      const options = {};

      await searchCommands.query('test query', options);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: false,
        error: 'Search service unavailable',
        suggestions: ['Check search service availability', 'Verify query parameters', 'Try simpler query terms']
      }));
    });

    it('should handle behavioral search errors with specific suggestions', async () => {
      mockClient.callApi.mockRejectedValue(new Error('Behavioral analysis failed'));

      const options = {};

      await searchCommands.behavioral('complex behavior description', options);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: false,
        error: 'Behavioral analysis failed',
        suggestions: ['Refine behavior description', 'Check available snapshots', 'Try more specific behavioral terms']
      }));
    });

    it('should handle pattern search errors with pattern-specific suggestions', async () => {
      mockClient.callApi.mockRejectedValue(new Error('Pattern not recognized'));

      const options = {};

      await searchCommands.pattern('unknown-pattern', options);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: false,
        error: 'Pattern not recognized',
        suggestions: ['Check pattern type spelling', 'Try common patterns like Factory, Observer, Strategy', 'Use more specific pattern names']
      }));
    });
  });
});