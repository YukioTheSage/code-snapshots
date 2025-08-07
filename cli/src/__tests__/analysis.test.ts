import { AnalysisCommands } from '../commands/analysis';
import { CodeLapseClient } from '../client';

// Mock the client
jest.mock('../client');

describe('AnalysisCommands', () => {
  let mockClient: jest.Mocked<CodeLapseClient>;
  let analysisCommands: AnalysisCommands;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockClient = new CodeLapseClient() as jest.Mocked<CodeLapseClient>;
    analysisCommands = new AnalysisCommands(mockClient);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('chunk', () => {
    it('should analyze a chunk with default options', async () => {
      const mockResult = {
        success: true,
        chunkId: 'chunk-123',
        snapshotId: 'snap-456',
        analysisType: 'full',
        analysis: {
          qualityMetrics: {
            overallScore: 85,
            readabilityScore: 0.8,
            maintainabilityScore: 78,
            complexityScore: 12
          },
          relationships: [
            { type: 'calls', targetChunkId: 'chunk-124', strength: 0.9 }
          ],
          securityConcerns: [],
          suggestions: [
            {
              type: 'improvement',
              description: 'Consider adding more documentation',
              priority: 'medium',
              effort: 'minimal'
            }
          ]
        }
      };

      mockClient.callApi.mockResolvedValue(mockResult);

      await analysisCommands.chunk('chunk-123', { snapshot: 'snap-456' });

      expect(mockClient.callApi).toHaveBeenCalledWith('analyzeChunk', {
        chunkId: 'chunk-123',
        snapshotId: 'snap-456',
        analysisType: 'full',
        includeRelationships: true,
        includeQuality: true,
        includeContext: true
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        chunkId: 'chunk-123',
        analysis: mockResult,
        summary: {
          qualityScore: 85,
          complexityScore: 12,
          relationshipCount: 1,
          securityConcerns: 0
        }
      }));
    });

    it('should handle missing snapshot ID', async () => {
      await analysisCommands.chunk('chunk-123', {});

      expect(mockClient.callApi).toHaveBeenCalledWith('analyzeChunk', {
        chunkId: 'chunk-123',
        snapshotId: undefined,
        analysisType: 'full',
        includeRelationships: true,
        includeQuality: true,
        includeContext: true
      });
    });

    it('should handle analysis options', async () => {
      const mockResult = { success: true, analysis: { qualityMetrics: { overallScore: 75 } } };
      mockClient.callApi.mockResolvedValue(mockResult);

      await analysisCommands.chunk('chunk-123', {
        snapshot: 'snap-456',
        type: 'quick',
        relationships: false,
        quality: false,
        context: false
      });

      expect(mockClient.callApi).toHaveBeenCalledWith('analyzeChunk', {
        chunkId: 'chunk-123',
        snapshotId: 'snap-456',
        analysisType: 'quick',
        includeRelationships: false,
        includeQuality: false,
        includeContext: false
      });
    });

    it('should handle analysis errors', async () => {
      mockClient.callApi.mockRejectedValue(new Error('Chunk not found'));

      await analysisCommands.chunk('invalid-chunk', { snapshot: 'snap-456' });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: false,
        error: 'Chunk not found',
        suggestions: ['Verify chunk ID exists', 'Check snapshot availability', 'Validate analysis type']
      }));
    });
  });

  describe('file', () => {
    it('should analyze a file', async () => {
      const mockResult = {
        success: true,
        filePath: 'src/test.ts',
        snapshotId: 'snap-456',
        fileMetrics: {
          totalChunks: 5,
          totalLines: 150,
          averageQuality: 82,
          securityConcerns: ['sql-injection'],
          designPatterns: ['Factory']
        },
        chunks: [
          {
            id: 'chunk-1',
            startLine: 1,
            endLine: 30,
            semanticType: 'function',
            qualityScore: 85
          }
        ]
      };

      mockClient.callApi.mockResolvedValue(mockResult);

      await analysisCommands.file('src/test.ts', { snapshot: 'snap-456' });

      expect(mockClient.callApi).toHaveBeenCalledWith('analyzeFile', {
        filePath: 'src/test.ts',
        snapshotId: 'snap-456',
        analysisType: 'full',
        includeChunks: true,
        includeMetrics: true,
        includeSuggestions: true
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        filePath: 'src/test.ts',
        snapshotId: 'snap-456',
        analysis: mockResult,
        summary: {
          totalChunks: 5,
          totalLines: 150,
          averageQuality: 82,
          securityConcerns: 1,
          designPatterns: 1
        }
      }));
    });

    it('should require snapshot ID', async () => {
      await analysisCommands.file('src/test.ts', {});

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: false,
        error: 'Snapshot ID is required for file analysis',
        suggestions: ['Use --snapshot <id> to specify snapshot']
      }));

      expect(mockClient.callApi).not.toHaveBeenCalled();
    });
  });

  describe('quality', () => {
    it('should analyze quality metrics', async () => {
      const mockResult = {
        success: true,
        target: 'src/module',
        snapshotId: 'snap-456',
        qualityAnalysis: {
          overallScore: 78,
          metrics: {
            readability: 0.82,
            maintainability: 75,
            testCoverage: 0.65,
            documentation: 0.58,
            complexity: 18,
            duplication: 0.12
          },
          trends: {
            improving: ['readability', 'testCoverage'],
            declining: ['documentation'],
            stable: ['maintainability', 'complexity']
          },
          recommendations: [
            {
              category: 'documentation',
              priority: 'high',
              description: 'Increase documentation coverage',
              estimatedEffort: '2-4 hours'
            }
          ]
        }
      };

      mockClient.callApi.mockResolvedValue(mockResult);

      await analysisCommands.quality('src/module', { snapshot: 'snap-456' });

      expect(mockClient.callApi).toHaveBeenCalledWith('analyzeQuality', {
        target: 'src/module',
        snapshotId: 'snap-456',
        metrics: ['all'],
        includeRecommendations: true,
        includeTrends: true,
        threshold: 0.7
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        target: 'src/module',
        snapshotId: 'snap-456',
        qualityAnalysis: mockResult.qualityAnalysis,
        summary: {
          overallScore: 78,
          improvingMetrics: 2,
          decliningMetrics: 1,
          recommendations: 1
        }
      }));
    });

    it('should require snapshot ID', async () => {
      await analysisCommands.quality('src/module', {});

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: false,
        error: 'Snapshot ID is required for quality analysis',
        suggestions: ['Use --snapshot <id> to specify snapshot']
      }));

      expect(mockClient.callApi).not.toHaveBeenCalled();
    });
  });

  describe('relationships', () => {
    it('should analyze chunk relationships', async () => {
      const mockResult = {
        success: true,
        chunkId: 'chunk-123',
        dependencies: {
          direct: [
            {
              chunkId: 'chunk-124',
              type: 'imports',
              strength: 0.9,
              description: 'Imports utility functions'
            }
          ],
          transitive: []
        },
        dependents: [
          {
            chunkId: 'chunk-125',
            type: 'calls',
            strength: 0.8,
            description: 'Called by main handler'
          }
        ]
      };

      mockClient.callApi.mockResolvedValue(mockResult);

      await analysisCommands.relationships('chunk-123', {});

      expect(mockClient.callApi).toHaveBeenCalledWith('getChunkDependencies', {
        chunkId: 'chunk-123',
        includeTransitive: true,
        maxDepth: 3,
        relationshipTypes: undefined,
        includeStrength: true
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        chunkId: 'chunk-123',
        relationships: mockResult,
        summary: {
          directDependencies: 1,
          transitiveDependencies: 0,
          dependents: 1,
          strongestRelationship: {
            chunkId: 'chunk-124',
            type: 'imports',
            strength: 0.9,
            description: 'Imports utility functions'
          }
        }
      }));
    });
  });

  describe('batch', () => {
    it('should perform batch analysis', async () => {
      const mockOperations = [
        { id: 'op1', type: 'analyzeChunk', data: { chunkId: 'chunk-1', snapshotId: 'snap-1' } },
        { id: 'op2', type: 'analyzeFile', data: { filePath: 'test.ts', snapshotId: 'snap-1' } }
      ];

      const mockResults = {
        totalOperations: 2,
        successfulOperations: 2,
        failedOperations: 0,
        results: [
          { operationId: 'op1', success: true, result: { analysis: {} } },
          { operationId: 'op2', success: true, result: { fileMetrics: {} } }
        ],
        metadata: { processingTime: Date.now() }
      };

      // Mock fs.readFileSync
      const mockFs = {
        readFileSync: jest.fn().mockReturnValue(JSON.stringify(mockOperations))
      };
      jest.doMock('fs', () => mockFs);

      mockClient.callApi.mockResolvedValue(mockResults);

      await analysisCommands.batch('operations.json', {});

      expect(mockClient.callApi).toHaveBeenCalledWith('batchAnalyze', {
        operations: [
          { id: 'op1', type: 'analyzeChunk', data: { chunkId: 'chunk-1', snapshotId: 'snap-1' } },
          { id: 'op2', type: 'analyzeFile', data: { filePath: 'test.ts', snapshotId: 'snap-1' } }
        ],
        parallel: true,
        maxConcurrency: 5
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        batchResults: mockResults,
        summary: {
          totalOperations: 2,
          successfulOperations: 2,
          failedOperations: 0,
          processingTime: mockResults.metadata.processingTime
        }
      }));
    });
  });

  describe('findStrongestRelationship', () => {
    it('should find the strongest relationship', () => {
      const result = {
        dependencies: {
          direct: [
            { chunkId: 'chunk-1', strength: 0.7 },
            { chunkId: 'chunk-2', strength: 0.9 }
          ]
        },
        dependents: [
          { chunkId: 'chunk-3', strength: 0.8 }
        ]
      };

      const strongest = (analysisCommands as any).findStrongestRelationship(result);
      expect(strongest).toEqual({ chunkId: 'chunk-2', strength: 0.9 });
    });

    it('should return null for empty relationships', () => {
      const result = { dependencies: { direct: [] }, dependents: [] };
      const strongest = (analysisCommands as any).findStrongestRelationship(result);
      expect(strongest).toBeNull();
    });
  });
});