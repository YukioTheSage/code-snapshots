import { CliConnectorService } from '../cliConnectorService';
import { TerminalApiService } from '../terminalApiService';
import { SemanticSearchService } from '../semanticSearchService';
import * as vscode from 'vscode';

// Mock dependencies
jest.mock('vscode');
jest.mock('../terminalApiService');
jest.mock('../semanticSearchService');
jest.mock('../enhancedCodeChunker');
jest.mock('../queryProcessor');
jest.mock('../resultManager');
jest.mock('../qualityMetricsCalculator');
jest.mock('../relationshipAnalyzer');

// Mock vscode workspace configuration
const mockGetConfiguration = jest.fn().mockReturnValue({
  get: jest.fn().mockReturnValue(200),
});

(vscode as any).workspace = {
  getConfiguration: mockGetConfiguration,
  workspaceFolders: [
    {
      uri: { fsPath: '/test/workspace' },
    },
  ],
};

describe('Batch Operations Integration Tests', () => {
  let cliConnectorService: CliConnectorService;
  let mockTerminalApiService: jest.Mocked<TerminalApiService>;
  let mockSemanticSearchService: jest.Mocked<SemanticSearchService>;
  let mockContext: jest.Mocked<vscode.ExtensionContext>;

  beforeEach(() => {
    // Setup comprehensive mocks
    mockTerminalApiService = {
      getSnapshotFileContent: jest.fn(),
      getSnapshot: jest.fn(),
      getWorkspaceInfo: jest.fn().mockResolvedValue({
        workspaceRoot: '/test/workspace',
        totalSnapshots: 10,
        currentSnapshot: null,
      }),
    } as any;

    mockSemanticSearchService = {
      searchCodeEnhanced: jest.fn(),
    } as any;

    mockContext = {
      extension: {
        packageJSON: { version: '1.0.0' },
      },
    } as any;

    (vscode.workspace as any) = {
      workspaceFolders: [
        {
          uri: { fsPath: '/test/workspace' },
        },
      ],
    };

    cliConnectorService = new CliConnectorService(
      mockTerminalApiService,
      mockContext,
      mockSemanticSearchService,
    );
  });

  afterEach(() => {
    cliConnectorService.dispose();
    jest.clearAllMocks();
  });

  describe('Large Scale Batch Analysis', () => {
    it('should handle large batch of file analysis operations efficiently', async () => {
      // Mock file content for multiple files
      const fileContents = Array.from(
        { length: 50 },
        (_, i) => `// File ${i}\nfunction test${i}() {\n  return ${i};\n}`,
      );

      mockTerminalApiService.getSnapshotFileContent.mockImplementation(
        (snapshotId, filePath) => {
          const index = parseInt(filePath.split('.')[0].replace('file', ''));
          return Promise.resolve(fileContents[index] || 'default content');
        },
      );

      const operations = Array.from({ length: 50 }, (_, i) => ({
        id: `analyze-file-${i}`,
        type: 'analyzeFile',
        data: {
          filePath: `file${i}.ts`,
          snapshotId: 'snapshot-1',
          analysisType: 'full',
        },
      }));

      const startTime = Date.now();
      const result = await (cliConnectorService as any).handleBatchAnalyze({
        operations,
        parallel: true,
        maxConcurrency: 10,
      });
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(result.totalOperations).toBe(50);
      expect(result.successfulOperations).toBe(50);
      expect(result.failedOperations).toBe(0);
      expect(result.performance.totalTime).toBeLessThan(10000); // Should complete in under 10 seconds
      expect(endTime - startTime).toBeLessThan(10000);
    });

    it('should handle mixed operation types in batch', async () => {
      mockTerminalApiService.getSnapshotFileContent.mockResolvedValue(
        'test content',
      );
      mockTerminalApiService.getSnapshot.mockResolvedValue({
        id: 'snap1',
        timestamp: Date.now(),
        description: 'Test snapshot',
        files: {
          'test.ts': { deleted: false, isBinary: false },
        },
      });

      const operations = [
        // File analysis operations
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `file-${i}`,
          type: 'analyzeFile',
          data: { filePath: `file${i}.ts`, snapshotId: 'snap1' },
        })),
        // Chunk analysis operations
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `chunk-${i}`,
          type: 'analyzeChunk',
          data: { chunkId: `chunk${i}`, snapshotId: 'snap1' },
        })),
        // Quality analysis operations
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `quality-${i}`,
          type: 'analyzeQuality',
          data: { target: `target${i}`, snapshotId: 'snap1' },
        })),
      ];

      const result = await (cliConnectorService as any).handleBatchAnalyze({
        operations,
        parallel: true,
        maxConcurrency: 8,
      });

      expect(result.success).toBe(true);
      expect(result.totalOperations).toBe(25);
      expect(result.results).toHaveLength(25);

      // Verify different operation types were processed
      const fileOps = result.results.filter(
        (r: any) => r.operationType === 'analyzeFile',
      );
      const chunkOps = result.results.filter(
        (r: any) => r.operationType === 'analyzeChunk',
      );
      const qualityOps = result.results.filter(
        (r: any) => r.operationType === 'analyzeQuality',
      );

      expect(fileOps).toHaveLength(10);
      expect(chunkOps).toHaveLength(10);
      expect(qualityOps).toHaveLength(5);
    });
  });

  describe('Large Scale Batch Search', () => {
    beforeEach(() => {
      mockSemanticSearchService.searchCodeEnhanced.mockImplementation(
        (options) => {
          // Simulate different search results based on query
          const resultCount = Math.floor(Math.random() * 10) + 1;
          return Promise.resolve(
            Array.from({ length: resultCount }, (_, i) => ({
              snapshotId: 'snap1',
              snapshot: {
                id: 'snap1',
                timestamp: Date.now(),
                description: 'Test snapshot',
                files: {},
              },
              filePath: `file${i}.ts`,
              startLine: i * 10 + 1,
              endLine: i * 10 + 10,
              score: 0.8 + Math.random() * 0.2,
              content: `Result ${i} for query: ${options.query}`,
              timestamp: Date.now(),
              explanation: {
                whyRelevant: `Matches query: ${options.query}`,
                keyFeatures: ['function', 'class'],
                matchedConcepts: [options.query],
                confidenceFactors: [],
                semanticSimilarity: 'High semantic similarity',
              },
              relationships: [],
              qualityMetrics: {
                overallScore: 80 + Math.random() * 20,
                readabilityScore: 0.8,
                maintainabilityScore: 80,
                testCoverage: 0.7,
                documentationRatio: 0.6,
                duplicationRisk: 0.1,
                performanceRisk: 0.2,
                securityRisk: 0.1,
                technicalDebt: {
                  estimatedFixTime: 2,
                  severity: 'low',
                  categories: ['code_smells'],
                  issues: [],
                },
              },
              contextInfo: {
                surroundingContext: 'context',
                architecturalLayer: 'service',
                frameworkContext: ['express'],
                businessContext: 'test',
                fileContext: {
                  totalLines: 50,
                  fileSize: 1024,
                  lastModified: new Date(),
                  encoding: 'utf-8',
                  siblingChunks: [],
                },
              },
              suggestions: [],
              alternatives: [],
              enhancedMetadata: {
                semanticType: 'function',
                designPatterns: [],
                architecturalLayer: 'service',
                frameworkContext: ['express'],
                dependencies: [],
                usageFrequency: 1,
                lastModified: Date.now(),
                complexityMetrics: {
                  cyclomaticComplexity: 5,
                  cognitiveComplexity: 3,
                  linesOfCode: 10,
                  nestingDepth: 2,
                  maintainabilityIndex: 80,
                },
                securityConsiderations: [],
              },
            })),
          );
        },
      );
    });

    it('should handle large batch of search queries efficiently', async () => {
      const queries = Array.from({ length: 100 }, (_, i) => ({
        id: `query-${i}`,
        query: `search term ${i}`,
        limit: 10,
        scoreThreshold: 0.7,
      }));

      const startTime = Date.now();
      const result = await (cliConnectorService as any).handleBatchSearch({
        queries,
        parallel: true,
        maxConcurrency: 5,
      });
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(result.totalQueries).toBe(100);
      expect(result.successfulQueries).toBe(100);
      expect(result.failedQueries).toBe(0);
      expect(result.performance.totalTime).toBeLessThan(15000); // Should complete in under 15 seconds
      expect(endTime - startTime).toBeLessThan(15000);
    });

    it('should handle query deduplication effectively', async () => {
      const queries = [
        // Duplicate queries
        { id: 'q1', query: 'function authentication', snapshotIds: ['snap1'] },
        { id: 'q2', query: 'function authentication', snapshotIds: ['snap1'] },
        { id: 'q3', query: 'function authentication', snapshotIds: ['snap1'] },
        // Unique queries
        { id: 'q4', query: 'class UserService', snapshotIds: ['snap1'] },
        { id: 'q5', query: 'interface ApiResponse', snapshotIds: ['snap1'] },
        // Same query but different snapshot
        { id: 'q6', query: 'function authentication', snapshotIds: ['snap2'] },
      ];

      const result = await (cliConnectorService as any).handleBatchSearch({
        queries,
        deduplicateQueries: true,
      });

      expect(result.success).toBe(true);
      expect(result.originalQueryCount).toBe(6);
      expect(result.totalQueries).toBe(4); // After deduplication
      expect(result.deduplicatedCount).toBe(2);
      expect(
        mockSemanticSearchService.searchCodeEnhanced,
      ).toHaveBeenCalledTimes(4);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle partial failures in batch analysis with retry', async () => {
      let callCount = 0;
      mockTerminalApiService.getSnapshotFileContent.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.reject(new Error('Temporary network error'));
        }
        return Promise.resolve('test content');
      });

      const operations = [
        {
          id: 'op1',
          type: 'analyzeFile',
          data: { filePath: 'test1.ts', snapshotId: 'snap1' },
        },
        {
          id: 'op2',
          type: 'analyzeFile',
          data: { filePath: 'test2.ts', snapshotId: 'snap1' },
        },
      ];

      const result = await (cliConnectorService as any).handleBatchAnalyze({
        operations,
        retryFailedOperations: true,
        maxRetries: 2,
        parallel: false,
      });

      expect(result.success).toBe(true);
      expect(result.successfulOperations).toBeGreaterThan(0);
      // Some operations should succeed after retry
    });

    it('should handle timeout scenarios gracefully', async () => {
      // Mock slow operations
      mockTerminalApiService.getSnapshotFileContent.mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve('content'), 2000)),
      );

      const operations = Array.from({ length: 5 }, (_, i) => ({
        id: `op${i}`,
        type: 'analyzeFile',
        data: { filePath: `file${i}.ts`, snapshotId: 'snap1' },
      }));

      const result = await (cliConnectorService as any).handleBatchAnalyze({
        operations,
        timeout: 500, // 500ms timeout
        continueOnError: true,
      });

      expect(result.success).toBe(true);
      expect(result.failedOperations).toBe(5); // All should timeout
      result.results.forEach((r: any) => {
        expect(r.success).toBe(false);
        expect(r.error.message).toContain('timeout');
      });
    });

    it('should handle memory pressure during large batch operations', async () => {
      // Mock memory-intensive operations
      mockTerminalApiService.getSnapshotFileContent.mockImplementation(() => {
        // Simulate memory usage
        const largeString = 'x'.repeat(1000000); // 1MB string
        return Promise.resolve(largeString);
      });

      const operations = Array.from({ length: 20 }, (_, i) => ({
        id: `op${i}`,
        type: 'analyzeFile',
        data: { filePath: `file${i}.ts`, snapshotId: 'snap1' },
      }));

      const result = await (cliConnectorService as any).handleBatchAnalyze({
        operations,
        parallel: true,
        maxConcurrency: 3, // Lower concurrency to manage memory
      });

      expect(result.success).toBe(true);
      expect(result.performance.memoryUsage).toBeDefined();
      expect(result.performance.memoryUsage.heapUsed).toBeGreaterThan(0);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should meet performance benchmarks for batch analysis', async () => {
      mockTerminalApiService.getSnapshotFileContent.mockResolvedValue(
        'test content',
      );

      const operations = Array.from({ length: 100 }, (_, i) => ({
        id: `op${i}`,
        type: 'analyzeChunk',
        data: { chunkId: `chunk${i}`, snapshotId: 'snap1' },
      }));

      const result = await (cliConnectorService as any).handleBatchAnalyze({
        operations,
        parallel: true,
        maxConcurrency: 10,
      });

      expect(result.success).toBe(true);
      expect(result.performance.throughput).toBeGreaterThan(10); // At least 10 operations per second
      expect(result.performance.averageTimePerOperation).toBeLessThan(1000); // Less than 1 second per operation
    });

    it('should meet performance benchmarks for batch search', async () => {
      const queries = Array.from({ length: 50 }, (_, i) => ({
        id: `q${i}`,
        query: `test query ${i}`,
      }));

      const result = await (cliConnectorService as any).handleBatchSearch({
        queries,
        parallel: true,
        maxConcurrency: 5,
      });

      expect(result.success).toBe(true);
      expect(result.performance.throughput).toBeGreaterThan(5); // At least 5 queries per second
      expect(result.performance.averageTimePerQuery).toBeLessThan(2000); // Less than 2 seconds per query
    });
  });

  describe('Concurrency Control', () => {
    it('should respect concurrency limits in parallel processing', async () => {
      let concurrentCalls = 0;
      let maxConcurrentCalls = 0;

      mockTerminalApiService.getSnapshotFileContent.mockImplementation(() => {
        concurrentCalls++;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);

        return new Promise((resolve) => {
          setTimeout(() => {
            concurrentCalls--;
            resolve('test content');
          }, 100);
        });
      });

      const operations = Array.from({ length: 20 }, (_, i) => ({
        id: `op${i}`,
        type: 'analyzeFile',
        data: { filePath: `file${i}.ts`, snapshotId: 'snap1' },
      }));

      await (cliConnectorService as any).handleBatchAnalyze({
        operations,
        parallel: true,
        maxConcurrency: 5,
      });

      expect(maxConcurrentCalls).toBeLessThanOrEqual(5);
    });

    it('should handle dynamic concurrency adjustment', async () => {
      const operations = Array.from({ length: 15 }, (_, i) => ({
        id: `op${i}`,
        type: 'analyzeChunk',
        data: { chunkId: `chunk${i}`, snapshotId: 'snap1' },
      }));

      // Test with different concurrency levels
      const results = await Promise.all([
        (cliConnectorService as any).handleBatchAnalyze({
          operations: operations.slice(0, 5),
          parallel: true,
          maxConcurrency: 1,
        }),
        (cliConnectorService as any).handleBatchAnalyze({
          operations: operations.slice(5, 10),
          parallel: true,
          maxConcurrency: 3,
        }),
        (cliConnectorService as any).handleBatchAnalyze({
          operations: operations.slice(10, 15),
          parallel: true,
          maxConcurrency: 5,
        }),
      ]);

      results.forEach((result) => {
        expect(result.success).toBe(true);
        expect(result.successfulOperations).toBe(5);
      });
    });
  });
});
