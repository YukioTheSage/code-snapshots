import { ChunkingCommands } from '../commands/chunking';
import { CodeLapseClient } from '../client';

// Mock the client
jest.mock('../client');

describe('ChunkingCommands', () => {
  let mockClient: jest.Mocked<CodeLapseClient>;
  let chunkingCommands: ChunkingCommands;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockClient = new CodeLapseClient() as jest.Mocked<CodeLapseClient>;
    chunkingCommands = new ChunkingCommands(mockClient);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('file', () => {
    it('should chunk a file with default options', async () => {
      const mockResult = {
        success: true,
        filePath: 'src/test.ts',
        snapshotId: 'snap-456',
        strategy: 'semantic',
        chunks: [
          {
            id: 'chunk-1',
            startLine: 1,
            endLine: 25,
            content: 'function test() {}',
            enhancedMetadata: {
              semanticType: 'function',
              complexityScore: 5
            },
            qualityMetrics: {
              overallScore: 85
            },
            relationships: [],
            contextInfo: {}
          }
        ],
        summary: {
          totalChunks: 1,
          averageSize: 24,
          semanticTypes: { function: 1 },
          qualityDistribution: { excellent: 0, good: 1, fair: 0, poor: 0 }
        },
        metadata: {
          chunkingTime: Date.now(),
          version: '1.0.0'
        }
      };

      mockClient.callApi.mockResolvedValue(mockResult);

      await chunkingCommands.file('src/test.ts', { snapshot: 'snap-456' });

      expect(mockClient.callApi).toHaveBeenCalledWith('enhancedChunkFile', {
        filePath: 'src/test.ts',
        snapshotId: 'snap-456',
        strategy: 'semantic',
        options: {
          maxChunkSize: 1000,
          minChunkSize: 50,
          overlap: 0,
          preserveStructure: true,
          includeContext: true
        }
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        filePath: 'src/test.ts',
        snapshotId: 'snap-456',
        strategy: 'semantic',
        chunks: mockResult.chunks,
        summary: mockResult.summary,
        metadata: mockResult.metadata
      }));
    });

    it('should require snapshot ID', async () => {
      await chunkingCommands.file('src/test.ts', {});

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: false,
        error: 'Snapshot ID is required for file chunking',
        suggestions: ['Use --snapshot <id> to specify snapshot']
      }));

      expect(mockClient.callApi).not.toHaveBeenCalled();
    });

    it('should handle chunking options', async () => {
      const mockResult = { success: true, chunks: [], summary: {}, metadata: {} };
      mockClient.callApi.mockResolvedValue(mockResult);

      await chunkingCommands.file('src/test.ts', {
        snapshot: 'snap-456',
        strategy: 'hierarchical',
        maxSize: '500',
        minSize: '25',
        overlap: '10',
        preserveStructure: false,
        context: false
      });

      expect(mockClient.callApi).toHaveBeenCalledWith('enhancedChunkFile', {
        filePath: 'src/test.ts',
        snapshotId: 'snap-456',
        strategy: 'hierarchical',
        options: {
          maxChunkSize: 500,
          minChunkSize: 25,
          overlap: 10,
          preserveStructure: false,
          includeContext: false
        }
      });
    });

    it('should handle chunking errors', async () => {
      mockClient.callApi.mockRejectedValue(new Error('File not found'));

      await chunkingCommands.file('invalid.ts', { snapshot: 'snap-456' });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: false,
        error: 'File not found',
        suggestions: ['Verify file path exists', 'Check snapshot availability', 'Validate chunking strategy']
      }));
    });
  });

  describe('snapshot', () => {
    it('should chunk a snapshot', async () => {
      const mockResult = {
        success: true,
        snapshotId: 'snap-456',
        strategy: 'semantic',
        results: [
          { filePath: 'src/test1.ts', chunks: 3, success: true },
          { filePath: 'src/test2.ts', chunks: 2, success: true }
        ],
        summary: {
          totalFiles: 2,
          successfulFiles: 2,
          totalChunks: 5
        },
        metadata: {
          chunkingTime: Date.now(),
          version: '1.0.0'
        }
      };

      mockClient.callApi.mockResolvedValue(mockResult);

      await chunkingCommands.snapshot('snap-456', {});

      expect(mockClient.callApi).toHaveBeenCalledWith('chunkSnapshot', {
        snapshotId: 'snap-456',
        strategy: 'semantic',
        filePatterns: undefined,
        options: {
          maxChunkSize: 1000,
          minChunkSize: 50,
          overlap: 0,
          preserveStructure: true,
          includeContext: true,
          excludeBinary: true,
          excludeTests: false
        }
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        snapshotId: 'snap-456',
        strategy: 'semantic',
        results: mockResult.results,
        summary: mockResult.summary,
        metadata: mockResult.metadata
      }));
    });

    it('should handle file patterns', async () => {
      const mockResult = { success: true, results: [], summary: {}, metadata: {} };
      mockClient.callApi.mockResolvedValue(mockResult);

      await chunkingCommands.snapshot('snap-456', {
        patterns: '*.ts,*.js',
        excludeTests: true,
        excludeBinary: false
      });

      expect(mockClient.callApi).toHaveBeenCalledWith('chunkSnapshot', {
        snapshotId: 'snap-456',
        strategy: 'semantic',
        filePatterns: ['*.ts', '*.js'],
        options: {
          maxChunkSize: 1000,
          minChunkSize: 50,
          overlap: 0,
          preserveStructure: true,
          includeContext: true,
          excludeBinary: false,
          excludeTests: true
        }
      });
    });
  });

  describe('list', () => {
    it('should list chunks with default options', async () => {
      const mockResult = {
        success: true,
        snapshotId: 'snap-456',
        chunks: [
          {
            id: 'chunk-1',
            filePath: 'src/test.ts',
            startLine: 1,
            endLine: 25,
            semanticType: 'function',
            qualityScore: 85,
            complexityScore: 12,
            lastModified: Date.now()
          }
        ],
        pagination: {
          total: 1,
          page: 1,
          limit: 50
        },
        metadata: {
          queryTime: Date.now(),
          version: '1.0.0'
        }
      };

      mockClient.callApi.mockResolvedValue(mockResult);

      await chunkingCommands.list('snap-456', {});

      expect(mockClient.callApi).toHaveBeenCalledWith('listChunks', {
        snapshotId: 'snap-456',
        filePath: undefined,
        filters: {
          semanticTypes: undefined,
          qualityThreshold: undefined,
          complexityRange: undefined,
          hasPatterns: undefined,
          excludeSmells: undefined
        },
        pagination: {
          page: 1,
          limit: 50
        },
        sortBy: 'startLine',
        sortOrder: 'asc'
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        snapshotId: 'snap-456',
        chunks: mockResult.chunks,
        pagination: mockResult.pagination,
        filters: {
          semanticTypes: undefined,
          qualityThreshold: undefined,
          complexityRange: undefined,
          hasPatterns: undefined,
          excludeSmells: undefined
        },
        metadata: mockResult.metadata
      }));
    });

    it('should handle filtering options', async () => {
      const mockResult = { success: true, chunks: [], pagination: {}, metadata: {} };
      mockClient.callApi.mockResolvedValue(mockResult);

      await chunkingCommands.list('snap-456', {
        file: 'src/test.ts',
        types: 'function,class',
        qualityMin: '0.8',
        complexityMin: '5',
        complexityMax: '20',
        patterns: 'Factory,Observer',
        excludeSmells: 'longMethod,duplicateCode',
        page: '2',
        limit: '25',
        sort: 'quality',
        order: 'desc'
      });

      expect(mockClient.callApi).toHaveBeenCalledWith('listChunks', {
        snapshotId: 'snap-456',
        filePath: 'src/test.ts',
        filters: {
          semanticTypes: ['function', 'class'],
          qualityThreshold: 0.8,
          complexityRange: [5, 20],
          hasPatterns: ['Factory', 'Observer'],
          excludeSmells: ['longMethod', 'duplicateCode']
        },
        pagination: {
          page: 2,
          limit: 25
        },
        sortBy: 'quality',
        sortOrder: 'desc'
      });
    });
  });

  describe('metadata', () => {
    it('should get chunk metadata', async () => {
      const mockResult = {
        success: true,
        chunkId: 'chunk-123',
        metadata: {
          semanticType: 'function',
          complexityScore: 15,
          maintainabilityIndex: 78,
          dependencies: ['lodash', 'express'],
          designPatterns: ['Factory'],
          codeSmells: [],
          securityConcerns: []
        },
        relationships: [],
        qualityMetrics: {
          overallScore: 82,
          readabilityScore: 0.85,
          maintainabilityScore: 78
        },
        responseMetadata: {
          retrievalTime: Date.now(),
          version: '1.0.0'
        }
      };

      mockClient.callApi.mockResolvedValue(mockResult);

      await chunkingCommands.metadata('chunk-123', {});

      expect(mockClient.callApi).toHaveBeenCalledWith('getChunkMetadata', {
        chunkId: 'chunk-123',
        includeRelationships: true,
        includeQuality: true,
        includeContext: true,
        contextRadius: 5
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        chunkId: 'chunk-123',
        metadata: mockResult.metadata,
        relationships: mockResult.relationships,
        qualityMetrics: mockResult.qualityMetrics,
        responseMetadata: mockResult.responseMetadata
      }));
    });

    it('should handle metadata options', async () => {
      const mockResult = { success: true, metadata: {}, responseMetadata: {} };
      mockClient.callApi.mockResolvedValue(mockResult);

      await chunkingCommands.metadata('chunk-123', {
        relationships: false,
        quality: false,
        context: false,
        contextRadius: '10'
      });

      expect(mockClient.callApi).toHaveBeenCalledWith('getChunkMetadata', {
        chunkId: 'chunk-123',
        includeRelationships: false,
        includeQuality: false,
        includeContext: false,
        contextRadius: 10
      });
    });
  });

  describe('context', () => {
    it('should get chunk context', async () => {
      const mockResult = {
        success: true,
        chunkId: 'chunk-123',
        context: {
          surroundingContext: '// Context lines would be here',
          architecturalLayer: 'service',
          frameworkContext: ['express', 'typescript'],
          businessContext: 'User authentication service',
          fileContext: {
            totalLines: 150,
            fileSize: 4500,
            lastModified: new Date(),
            siblingChunks: ['chunk-2', 'chunk-3']
          }
        },
        metadata: {
          contextRadius: 5,
          retrievalTime: Date.now(),
          version: '1.0.0'
        }
      };

      mockClient.callApi.mockResolvedValue(mockResult);

      await chunkingCommands.context('chunk-123', {});

      expect(mockClient.callApi).toHaveBeenCalledWith('getChunkContext', {
        chunkId: 'chunk-123',
        contextRadius: 5,
        includeFileContext: true,
        includeArchitecturalContext: true,
        includeBusinessContext: true
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        chunkId: 'chunk-123',
        context: mockResult.context,
        metadata: mockResult.metadata
      }));
    });

    it('should handle context options', async () => {
      const mockResult = { success: true, context: {}, metadata: {} };
      mockClient.callApi.mockResolvedValue(mockResult);

      await chunkingCommands.context('chunk-123', {
        radius: '10',
        fileContext: false,
        architectural: false,
        business: false
      });

      expect(mockClient.callApi).toHaveBeenCalledWith('getChunkContext', {
        chunkId: 'chunk-123',
        contextRadius: 10,
        includeFileContext: false,
        includeArchitecturalContext: false,
        includeBusinessContext: false
      });
    });
  });

  describe('dependencies', () => {
    it('should get chunk dependencies', async () => {
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
        ],
        metadata: {
          includeTransitive: true,
          maxDepth: 3,
          retrievalTime: Date.now(),
          version: '1.0.0'
        }
      };

      mockClient.callApi.mockResolvedValue(mockResult);

      await chunkingCommands.dependencies('chunk-123', {});

      expect(mockClient.callApi).toHaveBeenCalledWith('getChunkDependencies', {
        chunkId: 'chunk-123',
        includeTransitive: true,
        maxDepth: 3,
        dependencyTypes: undefined,
        includeStrength: true
      });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
        success: true,
        chunkId: 'chunk-123',
        dependencies: mockResult.dependencies,
        dependents: mockResult.dependents,
        metadata: mockResult.metadata,
        summary: {
          directDependencies: 1,
          transitiveDependencies: 0,
          totalDependents: 1
        }
      }));
    });

    it('should handle dependency options', async () => {
      const mockResult = {
        success: true,
        dependencies: { direct: [], transitive: undefined },
        dependents: [],
        metadata: {}
      };
      mockClient.callApi.mockResolvedValue(mockResult);

      await chunkingCommands.dependencies('chunk-123', {
        transitive: false,
        depth: '2',
        types: 'imports,calls',
        strength: false
      });

      expect(mockClient.callApi).toHaveBeenCalledWith('getChunkDependencies', {
        chunkId: 'chunk-123',
        includeTransitive: false,
        maxDepth: 2,
        dependencyTypes: ['imports', 'calls'],
        includeStrength: false
      });
    });
  });

  describe('parseComplexityRange', () => {
    it('should parse complexity range', () => {
      const options = { complexityMin: '5', complexityMax: '20' };
      const result = (chunkingCommands as any).parseComplexityRange(options);
      expect(result).toEqual([5, 20]);
    });

    it('should handle partial range', () => {
      const options = { complexityMin: '10' };
      const result = (chunkingCommands as any).parseComplexityRange(options);
      expect(result).toEqual([10, 100]);
    });

    it('should return undefined for empty options', () => {
      const result = (chunkingCommands as any).parseComplexityRange({});
      expect(result).toBeUndefined();
    });
  });
});