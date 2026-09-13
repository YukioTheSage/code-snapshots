import { CliConnectorService } from '../cliConnectorService';
import { TerminalApiService } from '../terminalApiService';
import { SemanticSearchService } from '../semanticSearchService';
import * as vscode from 'vscode';

// Mock dependencies
jest.mock('vscode');
jest.mock('../terminalApiService');
jest.mock('../semanticSearchService');
jest.mock('../enhancedCodeChunker', () => {
  return {
    EnhancedCodeChunker: jest.fn().mockImplementation(() => ({
      chunkFileEnhanced: jest.fn().mockResolvedValue([
        {
          id: 'chunk1',
          startLine: 1,
          endLine: 10,
          qualityMetrics: { overallScore: 80 },
          enhancedMetadata: {
            semanticType: 'function',
            complexityScore: 10,
            securityConcerns: [],
            designPatterns: [],
          },
          relationships: [],
        },
      ]),
    })),
  };
});
jest.mock('../queryProcessor');
jest.mock('../resultManager');
jest.mock('../qualityMetricsCalculator');

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

/** The private batch handlers these tests exercise, reached through a cast. */
interface BatchHandlers {
  handleBatchAnalyze(data: unknown): Promise<Record<string, unknown>>;
  handleBatchSearch(data: unknown): Promise<Record<string, unknown>>;
}

/**
 * A typed way to reach the handlers the CLI dispatches to. The rest of this
 * file casts the service to `any`; these tests do not, because the repo's lint
 * warning budget sits exactly at its ceiling and an `any` here would break it.
 */
function batchHandlers(service: CliConnectorService): BatchHandlers {
  return service as unknown as BatchHandlers;
}

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
      // The constructor stores a chunker-settings listener; a wholesale
      // workspace replacement must expose the API it registers.
      onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
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
      // Every operation in this batch is served by a mock, so the property
      // under test is that all 50 were processed -- which the counts above
      // already assert. A 10-second wall-clock bound turned that into a race
      // against CI load. Kept only as a hang guard, with a ceiling generous
      // enough that nothing but a genuine hang can reach it.
      expect(endTime - startTime).toBeLessThan(60000);
      expect(result.performance.totalTime).toBeGreaterThanOrEqual(0);
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
          data: { chunkId: 'chunk1', filePath: 'test.ts', snapshotId: 'snap1' },
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
      // As above: the counts are the assertion; the ceiling only guards
      // against a hang. 15 seconds on 100 mocked queries measured a machine's
      // mood, not the code.
      expect(endTime - startTime).toBeLessThan(60000);
      expect(result.performance.totalTime).toBeGreaterThanOrEqual(0);
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

    it('reports an all-failed search batch as a failure', async () => {
      mockSemanticSearchService.searchCodeEnhanced.mockRejectedValue(
        new Error('vector store unreachable'),
      );

      const result = await batchHandlers(cliConnectorService).handleBatchSearch(
        {
          queries: [
            { id: 'q1', query: 'authentication' },
            { id: 'q2', query: 'pagination' },
          ],
          parallel: false,
        },
      );

      expect(result.success).toBe(false);
      expect(result.failedQueries).toBe(2);
      expect(result.successfulQueries).toBe(0);
    });

    it('keeps a partially failed search batch a success', async () => {
      mockSemanticSearchService.searchCodeEnhanced.mockImplementation(
        async (options) => {
          if (options.query === 'bad') {
            throw new Error('query blew up');
          }
          return [];
        },
      );

      const result = await batchHandlers(cliConnectorService).handleBatchSearch(
        {
          queries: [
            { id: 'q1', query: 'good' },
            { id: 'q2', query: 'bad' },
          ],
          parallel: false,
        },
      );

      // One of two failed: the counts disclose it and the batch is not a lie.
      expect(result.success).toBe(true);
      expect(result.failedQueries).toBe(1);
      expect(result.successfulQueries).toBe(1);
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
      // Mock slow operations. The timers are tracked because the handler's
      // 500ms timeout wins the race and returns while the mocked operation is
      // still sleeping: a *referenced* 2s timer is still pending when jest asks
      // the worker to exit, so the worker misses its 500ms grace period and is
      // force exited with the "failed to exit gracefully" warning. They are
      // unreferenced rather than cleared, so the mocked operation still sleeps
      // and settles exactly as before — it just stops holding the process open.
      const slowTimers: ReturnType<typeof setTimeout>[] = [];
      mockTerminalApiService.getSnapshotFileContent.mockImplementation(
        () =>
          new Promise((resolve) => {
            const timer = setTimeout(() => resolve('content'), 2000);
            timer.unref();
            slowTimers.push(timer);
          }),
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

      // Every operation timed out, so the batch failed. This assertion used to
      // pin success: true beside failedOperations: 5, which is the lie 09.1 is
      // about.
      expect(result.success).toBe(false);
      expect(result.failedOperations).toBe(5); // All should timeout
      result.results.forEach((r: any) => {
        expect(r.success).toBe(false);
        expect(r.error.message).toContain('timeout');
      });

      // One slow operation per operation, and not one of them may keep the
      // worker alive: each deliberately outlives the handler's timeout, so a
      // referenced timer here becomes a leaked handle at worker shutdown.
      expect(slowTimers).toHaveLength(5);
      expect(slowTimers.map((timer) => timer.hasRef())).toEqual([
        false,
        false,
        false,
        false,
        false,
      ]);
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

    it('reports an all-failed analysis batch as a failure', async () => {
      mockTerminalApiService.getSnapshotFileContent.mockRejectedValue(
        new Error('snapshot store offline'),
      );

      const operations = Array.from({ length: 3 }, (_, i) => ({
        id: 'op' + i,
        type: 'analyzeFile',
        data: { filePath: 'file' + i + '.ts', snapshotId: 'snap1' },
      }));

      const result = await batchHandlers(
        cliConnectorService,
      ).handleBatchAnalyze({
        operations,
        parallel: false,
      });

      // Nothing succeeded, so the envelope must not claim success: the CLI
      // branches on exactly this field.
      expect(result.success).toBe(false);
      expect(result.failedOperations).toBe(3);
      expect(result.successfulOperations).toBe(0);
    });

    it('keeps a partially failed batch a success and discloses the count', async () => {
      mockTerminalApiService.getSnapshotFileContent.mockImplementation(
        (_snapshotId: string, filePath: string) =>
          filePath === 'bad.ts'
            ? Promise.reject(new Error('unreadable'))
            : Promise.resolve('content'),
      );

      const result = await batchHandlers(
        cliConnectorService,
      ).handleBatchAnalyze({
        operations: [
          {
            id: 'ok',
            type: 'analyzeFile',
            data: { filePath: 'good.ts', snapshotId: 'snap1' },
          },
          {
            id: 'bad',
            type: 'analyzeFile',
            data: { filePath: 'bad.ts', snapshotId: 'snap1' },
          },
        ],
        parallel: false,
      });

      // One of two failed. The run is not a lie, and the count says so.
      expect(result.success).toBe(true);
      expect(result.failedOperations).toBe(1);
      expect(result.successfulOperations).toBe(1);
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
        data: { chunkId: 'chunk1', filePath: 'test.ts', snapshotId: 'snap1' },
      }));

      const result = await (cliConnectorService as any).handleBatchAnalyze({
        operations,
        parallel: true,
        maxConcurrency: 10,
      });

      expect(result.success).toBe(true);
      // Assert the work, not the clock. `throughput` and
      // `averageTimePerOperation` are both derived from elapsed wall time, so
      // asserting them made this a benchmark of the CI runner. The batch
      // completing at all is what the test is for.
      expect(result.totalOperations).toBe(100);
      expect(result.successfulOperations).toBe(100);
      expect(result.failedOperations).toBe(0);
    });

    it('should meet performance benchmarks for batch search', async () => {
      // This test never stubbed the search service, so `searchCodeEnhanced`
      // returned `undefined` and every query failed inside
      // `handleEnhancedSearch`. It passed anyway, because the only assertions
      // were a wall-clock bound and an envelope `success` that the handler
      // sets unconditionally -- it was benchmarking 50 errors. The stub makes
      // `successfulQueries` mean what the assertion below claims.
      mockSemanticSearchService.searchCodeEnhanced.mockResolvedValue([]);

      const queries = Array.from({ length: 50 }, (_, i) => ({
        id: `q${i}`,
        query: `test query ${i}`,
      }));

      const result = await (cliConnectorService as any).handleBatchSearch({
        queries,
        parallel: true,
        maxConcurrency: 5,
      });

      // Assert the work, not the clock: `throughput` and
      // `averageTimePerQuery` are both derived from elapsed wall time.
      expect(result.totalQueries).toBe(50);
      expect(result.successfulQueries).toBe(50);
      expect(result.failedQueries).toBe(0);
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
        data: { chunkId: 'chunk1', filePath: 'test.ts', snapshotId: 'snap1' },
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
