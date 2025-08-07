import { EnhancedSearchCommands } from '../commands/enhanced-search';
import { CodeLapseClient } from '../client';

// Mock the client
jest.mock('../client');

describe('EnhancedSearchCommands', () => {
  let mockClient: jest.Mocked<CodeLapseClient>;
  let enhancedSearchCommands: EnhancedSearchCommands;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockClient = new CodeLapseClient() as jest.Mocked<CodeLapseClient>;
    enhancedSearchCommands = new EnhancedSearchCommands(mockClient);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('enhanced', () => {
    it('should perform enhanced search with default options', async () => {
      const mockResults = {
        results: [
          {
            id: 'chunk-1',
            content: 'function test() {}',
            score: 0.85,
            explanation: { whyRelevant: 'Contains test function' }
          }
        ],
        metadata: { totalResults: 1 },
        suggestions: [],
        relatedQueries: []
      };

      mockClient.callApi.mockResolvedValue(mockResults);

      await enhancedSearchCommands.enhanced('test function', {});

      expect(mockClient.callApi).toHaveBeenCalledWith('enhancedSearch', {
        query: 'test function',
        limit: 20,
        scoreThreshold: 0.65,
        snapshotIds: undefined,
        languages: undefined,
        searchMode: 'semantic',
        includeExplanations: true,
        includeRelationships: true,
        includeQualityMetrics: true,
        contextRadius: 5,
        rankingStrategy: 'relevance',
        filterCriteria: {},
        maxResultsPerFile: undefined,
        enableDiversification: true
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        query: 'test function',
        results: mockResults,
        metadata: mockResults.metadata,
        suggestions: mockResults.suggestions,
        relatedQueries: mockResults.relatedQueries
      }));
    });

    it('should handle search options correctly', async () => {
      const mockResults = { results: [], metadata: {}, suggestions: [], relatedQueries: [] };
      mockClient.callApi.mockResolvedValue(mockResults);

      const options = {
        limit: '10',
        threshold: '0.8',
        snapshots: 'snap1,snap2',
        languages: 'typescript,javascript',
        mode: 'behavioral',
        explanations: false,
        relationships: false,
        quality: false,
        context: '10',
        ranking: 'quality',
        complexityMin: '5',
        complexityMax: '20',
        qualityMin: '0.7',
        semanticTypes: 'function,class',
        patterns: 'Factory,Observer',
        excludeSmells: 'longMethod,duplicateCode',
        domains: 'auth,payment',
        maxPerFile: '5',
        diversify: false
      };

      await enhancedSearchCommands.enhanced('search query', options);

      expect(mockClient.callApi).toHaveBeenCalledWith('enhancedSearch', {
        query: 'search query',
        limit: 10,
        scoreThreshold: 0.8,
        snapshotIds: ['snap1', 'snap2'],
        languages: ['typescript', 'javascript'],
        searchMode: 'behavioral',
        includeExplanations: false,
        includeRelationships: false,
        includeQualityMetrics: false,
        contextRadius: 10,
        rankingStrategy: 'quality',
        filterCriteria: {
          complexityRange: [5, 20],
          qualityThreshold: 0.7,
          semanticTypes: ['function', 'class'],
          designPatterns: ['Factory', 'Observer'],
          excludeCodeSmells: ['longMethod', 'duplicateCode'],
          businessDomains: ['auth', 'payment']
        },
        maxResultsPerFile: 5,
        enableDiversification: false
      });
    });

    it('should handle search errors', async () => {
      mockClient.callApi.mockRejectedValue(new Error('Search service unavailable'));

      await enhancedSearchCommands.enhanced('test query', {});

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: false,
        error: 'Search service unavailable',
        suggestions: ['Check semantic search service availability', 'Verify query parameters']
      }));
    });
  });

  describe('behavioral', () => {
    it('should perform behavioral search', async () => {
      const mockResults = {
        results: [
          {
            id: 'chunk-1',
            explanation: { matchedConcepts: ['authentication', 'validation'] },
            metadata: { behaviorAnalysis: true }
          }
        ],
        metadata: { searchMode: 'behavioral' }
      };

      mockClient.callApi.mockResolvedValue(mockResults);

      await enhancedSearchCommands.behavioral('validates user credentials', {});

      expect(mockClient.callApi).toHaveBeenCalledWith('enhancedSearch', {
        query: 'validates user credentials',
        searchMode: 'behavioral',
        limit: 20,
        scoreThreshold: 0.6,
        snapshotIds: undefined,
        languages: undefined,
        includeExplanations: true,
        includeRelationships: true,
        contextRadius: 5
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        description: 'validates user credentials',
        searchMode: 'behavioral',
        results: mockResults,
        metadata: mockResults.metadata,
        behaviorAnalysis: {
          matchedBehaviors: [['authentication', 'validation']],
          confidenceScores: [undefined]
        }
      }));
    });
  });

  describe('pattern', () => {
    it('should perform pattern search', async () => {
      const mockResults = {
        results: [
          {
            id: 'chunk-1',
            enhancedMetadata: { designPatterns: ['Factory'] },
            qualityMetrics: { overallScore: 85 }
          }
        ],
        metadata: { patternType: 'Factory' }
      };

      mockClient.callApi.mockResolvedValue(mockResults);

      await enhancedSearchCommands.pattern('Factory', {});

      expect(mockClient.callApi).toHaveBeenCalledWith('enhancedSearch', {
        query: 'Find Factory pattern implementations',
        searchMode: 'pattern',
        patternType: 'Factory',
        limit: 15,
        scoreThreshold: 0.7,
        snapshotIds: undefined,
        languages: undefined,
        includeExplanations: true,
        includeRelationships: true,
        contextRadius: 8
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        patternType: 'Factory',
        searchMode: 'pattern',
        results: mockResults,
        metadata: mockResults.metadata,
        patternAnalysis: {
          foundPatterns: [['Factory']],
          implementations: 1,
          qualityScores: [85]
        }
      }));
    });
  });

  describe('batch', () => {
    it('should perform batch search from file', async () => {
      const mockQueries = [
        { id: 'q1', query: 'test function', searchMode: 'semantic' },
        { id: 'q2', query: 'error handling', searchMode: 'behavioral' }
      ];

      const mockResults = {
        totalQueries: 2,
        successfulQueries: 2,
        failedQueries: 0,
        results: [
          { queryId: 'q1', success: true, result: { results: [] } },
          { queryId: 'q2', success: true, result: { results: [] } }
        ]
      };

      // Mock fs.readFileSync
      const mockFs = {
        readFileSync: jest.fn().mockReturnValue(JSON.stringify(mockQueries))
      };
      jest.doMock('fs', () => mockFs);

      mockClient.callApi.mockResolvedValue(mockResults);

      await enhancedSearchCommands.batch('queries.json', {});

      expect(mockClient.callApi).toHaveBeenCalledWith('batchSearch', {
        queries: [
          {
            id: 'q1',
            query: 'test function',
            searchMode: 'semantic',
            limit: 20,
            scoreThreshold: 0.65,
            snapshotIds: undefined,
            languages: undefined,
            includeExplanations: true,
            includeRelationships: true,
            contextRadius: 5
          },
          {
            id: 'q2',
            query: 'error handling',
            searchMode: 'behavioral',
            limit: 20,
            scoreThreshold: 0.65,
            snapshotIds: undefined,
            languages: undefined,
            includeExplanations: true,
            includeRelationships: true,
            contextRadius: 5
          }
        ],
        parallel: true,
        maxConcurrency: 3
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        batchResults: mockResults,
        summary: {
          totalQueries: 2,
          successfulQueries: 2,
          failedQueries: 0
        }
      }));
    });

    it('should handle invalid queries file', async () => {
      await enhancedSearchCommands.batch('invalid.json', {});

      const callArgs = consoleSpy.mock.calls[0][0];
      const result = JSON.parse(callArgs);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.suggestions).toEqual(['Check queries file format', 'Verify file path', 'Validate query objects']);
    });
  });

  describe('parseFilterCriteria', () => {
    it('should parse filter criteria correctly', () => {
      const options = {
        complexityMin: '5',
        complexityMax: '20',
        qualityMin: '0.8',
        semanticTypes: 'function,class',
        patterns: 'Factory,Observer',
        excludeSmells: 'longMethod',
        domains: 'auth,payment'
      };

      const result = (enhancedSearchCommands as any).parseFilterCriteria(options);

      expect(result).toEqual({
        complexityRange: [5, 20],
        qualityThreshold: 0.8,
        semanticTypes: ['function', 'class'],
        designPatterns: ['Factory', 'Observer'],
        excludeCodeSmells: ['longMethod'],
        businessDomains: ['auth', 'payment']
      });
    });

    it('should handle empty options', () => {
      const result = (enhancedSearchCommands as any).parseFilterCriteria({});
      expect(result).toEqual({});
    });
  });
});