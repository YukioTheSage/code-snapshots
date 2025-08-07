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

describe('CliConnectorService - Batch Operations', () => {
  let cliConnectorService: CliConnectorService;
  let mockTerminalApiService: jest.Mocked<TerminalApiService>;
  let mockSemanticSearchService: jest.Mocked<SemanticSearchService>;
  let mockContext: jest.Mocked<vscode.ExtensionContext>;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Setup mocks
    mockTerminalApiService = {
      getSnapshotFileContent: jest.fn(),
      getSnapshot: jest.fn(),
      getWorkspaceInfo: jest.fn().mockResolvedValue({
        workspaceRoot: '/test/workspace',
        totalSnapshots: 5,
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

    // Mock vscode workspace
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

  describe('handleBatchAnalyze', () => {
    it('should handle empty operations array', async () => {
      const data = { operations: [] };
      const result = await (cliConnectorService as any).handleBatchAnalyze(
        data,
      );

      expect(result.success).toBe(true);
      expect(result.totalOperations).toBe(0);
      expect(result.successfulOperations).toBe(0);
      expect(result.failedOperations).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('should validate operations array is required', async () => {
      const data = {};
      const result = await (cliConnectorService as any).handleBatchAnalyze(
        data,
      );

      expect(result.success).toBe(false);
      expect(result.error.message).toContain('operations array is required');
    });

    it('should validate operation types', async () => {
      const data = {
        operations: [{ type: 'invalidType', data: {} }],
      };
      const result = await (cliConnectorService as any).handleBatchAnalyze(
        data,
      );

      expect(result.success).toBe(false);
      expect(result.error.message).toContain('Invalid operations');
    });

    it('should process valid operations sequentially', async () => {
      mockTerminalApiService.getSnapshotFileContent.mockResolvedValue(
        'test content',
      );

      const data = {
        operations: [
          {
            id: 'op1',
            type: 'analyzeChunk',
            data: { chunkId: 'chunk1', snapshotId: 'snap1' },
          },
          {
            id: 'op2',
            type: 'analyzeFile',
            data: { filePath: 'test.ts', snapshotId: 'snap1' },
          },
        ],
        parallel: false,
      };

      const result = await (cliConnectorService as any).handleBatchAnalyze(
        data,
      );

      expect(result.success).toBe(true);
      expect(result.totalOperations).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].operationId).toBe('op1');
      expect(result.results[1].operationId).toBe('op2');
    });

    it('should process operations in parallel with concurrency limit', async () => {
      mockTerminalApiService.getSnapshotFileContent.mockResolvedValue(
        'test content',
      );

      const data = {
        operations: Array.from({ length: 10 }, (_, i) => ({
          id: `op${i}`,
          type: 'analyzeChunk',
          data: { chunkId: `chunk${i}`, snapshotId: 'snap1' },
        })),
        parallel: true,
        maxConcurrency: 3,
      };

      const result = await (cliConnectorService as any).handleBatchAnalyze(
        data,
      );

      expect(result.success).toBe(true);
      expect(result.totalOperations).toBe(10);
      expect(result.results).toHaveLength(10);
      expect(result.metadata.parallel).toBe(true);
      expect(result.metadata.maxConcurrency).toBe(3);
    });

    it('should handle operation failures with continueOnError=true', async () => {
      // Reset and configure mock for this specific test
      mockTerminalApiService.getSnapshotFileContent.mockReset();
      mockTerminalApiService.getSnapshotFileContent
        .mockResolvedValueOnce('test content')
        .mockRejectedValueOnce(new Error('File not found'));

      const data = {
        operations: [
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
        ],
        continueOnError: true,
        parallel: false, // Force sequential processing for predictable mock behavior
      };

      const result = await (cliConnectorService as any).handleBatchAnalyze(
        data,
      );

      expect(result.success).toBe(true);
      expect(result.totalOperations).toBe(2);
      expect(result.successfulOperations).toBe(1);
      expect(result.failedOperations).toBe(1);
    });

    it('should stop on first error when continueOnError=false', async () => {
      mockTerminalApiService.getSnapshotFileContent.mockRejectedValueOnce(
        new Error('File not found'),
      );

      const data = {
        operations: [
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
        ],
        continueOnError: false,
        parallel: false,
      };

      const result = await (cliConnectorService as any).handleBatchAnalyze(
        data,
      );

      expect(result.success).toBe(true);
      expect(result.totalOperations).toBe(2);
      expect(result.results).toHaveLength(1); // Should stop after first failure
      expect(result.results[0].success).toBe(false);
    });

    it('should include performance metrics', async () => {
      const data = {
        operations: [
          {
            id: 'op1',
            type: 'analyzeChunk',
            data: { chunkId: 'chunk1', snapshotId: 'snap1' },
          },
        ],
      };

      const result = await (cliConnectorService as any).handleBatchAnalyze(
        data,
      );

      expect(result.performance).toBeDefined();
      expect(result.performance.totalTime).toBeGreaterThan(0);
      expect(result.performance.averageTimePerOperation).toBeGreaterThan(0);
      expect(result.performance.throughput).toBeGreaterThan(0);
      expect(result.performance.memoryUsage).toBeDefined();
    });

    it('should handle timeout for operations', async () => {
      // Mock a slow operation
      mockTerminalApiService.getSnapshotFileContent.mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve('content'), 1000)),
      );

      const data = {
        operations: [
          {
            id: 'op1',
            type: 'analyzeFile',
            data: { filePath: 'test.ts', snapshotId: 'snap1' },
          },
        ],
        timeout: 100, // 100ms timeout
      };

      const result = await (cliConnectorService as any).handleBatchAnalyze(
        data,
      );

      expect(result.success).toBe(true);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error.message).toContain('timeout');
    });
  });

  describe('handleBatchSearch', () => {
    beforeEach(() => {
      mockSemanticSearchService.searchCodeEnhanced.mockResolvedValue([
        {
          snapshotId: 'snap1',
          snapshot: {
            id: 'snap1',
            timestamp: Date.now(),
            description: 'Test snapshot',
            files: {},
          },
          filePath: 'test.ts',
          startLine: 1,
          endLine: 10,
          score: 0.9,
          content: 'test content',
          timestamp: Date.now(),
          explanation: {
            whyRelevant: 'matches query',
            keyFeatures: ['function'],
            matchedConcepts: ['test'],
            confidenceFactors: [],
            semanticSimilarity:
              'High semantic similarity based on function matching',
          },
          relationships: [],
          qualityMetrics: {
            overallScore: 85,
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
        },
      ]);
    });

    it('should handle empty queries array', async () => {
      const data = { queries: [] };
      const result = await (cliConnectorService as any).handleBatchSearch(data);

      expect(result.success).toBe(true);
      expect(result.totalQueries).toBe(0);
      expect(result.successfulQueries).toBe(0);
      expect(result.failedQueries).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('should validate queries array is required', async () => {
      const data = {};
      const result = await (cliConnectorService as any).handleBatchSearch(data);

      expect(result.success).toBe(false);
      expect(result.error.message).toContain('queries array is required');
    });

    it('should validate query format', async () => {
      const data = {
        queries: [
          { query: '' }, // Empty query
          { query: 123 }, // Invalid type
          { query: 'valid query', limit: -1 }, // Invalid limit
        ],
      };
      const result = await (cliConnectorService as any).handleBatchSearch(data);

      expect(result.success).toBe(false);
      expect(result.error.message).toContain('Invalid queries');
    });

    it('should process valid queries sequentially', async () => {
      const data = {
        queries: [
          { id: 'q1', query: 'test query 1' },
          { id: 'q2', query: 'test query 2' },
        ],
        parallel: false,
      };

      const result = await (cliConnectorService as any).handleBatchSearch(data);

      expect(result.success).toBe(true);
      expect(result.totalQueries).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].queryId).toBe('q1');
      expect(result.results[1].queryId).toBe('q2');
      expect(
        mockSemanticSearchService.searchCodeEnhanced,
      ).toHaveBeenCalledTimes(2);
    });

    it('should process queries in parallel with concurrency limit', async () => {
      const data = {
        queries: Array.from({ length: 8 }, (_, i) => ({
          id: `q${i}`,
          query: `test query ${i}`,
        })),
        parallel: true,
        maxConcurrency: 3,
      };

      const result = await (cliConnectorService as any).handleBatchSearch(data);

      expect(result.success).toBe(true);
      expect(result.totalQueries).toBe(8);
      expect(result.results).toHaveLength(8);
      expect(result.metadata.parallel).toBe(true);
      expect(result.metadata.maxConcurrency).toBe(3);
    });

    it('should deduplicate queries when enabled', async () => {
      const data = {
        queries: [
          { id: 'q1', query: 'duplicate query' },
          { id: 'q2', query: 'duplicate query' },
          { id: 'q3', query: 'unique query' },
        ],
        deduplicateQueries: true,
      };

      const result = await (cliConnectorService as any).handleBatchSearch(data);

      expect(result.success).toBe(true);
      expect(result.originalQueryCount).toBe(3);
      expect(result.totalQueries).toBe(2); // After deduplication
      expect(result.deduplicatedCount).toBe(1);
    });

    it('should handle search failures with continueOnError=true', async () => {
      mockSemanticSearchService.searchCodeEnhanced
        .mockResolvedValueOnce([]) // First query succeeds
        .mockRejectedValueOnce(new Error('Search failed')); // Second query fails

      const data = {
        queries: [
          { id: 'q1', query: 'test query 1' },
          { id: 'q2', query: 'test query 2' },
        ],
        continueOnError: true,
      };

      const result = await (cliConnectorService as any).handleBatchSearch(data);

      expect(result.success).toBe(true);
      expect(result.totalQueries).toBe(2);
      expect(result.successfulQueries).toBe(1);
      expect(result.failedQueries).toBe(1);
    });

    it('should include performance metrics', async () => {
      const data = {
        queries: [{ id: 'q1', query: 'test query' }],
      };

      const result = await (cliConnectorService as any).handleBatchSearch(data);

      expect(result.performance).toBeDefined();
      expect(result.performance.totalTime).toBeGreaterThan(0);
      expect(result.performance.averageTimePerQuery).toBeGreaterThan(0);
      expect(result.performance.throughput).toBeGreaterThan(0);
      expect(result.performance.memoryUsage).toBeDefined();
    });

    it('should handle timeout for queries', async () => {
      // Mock a slow search
      mockSemanticSearchService.searchCodeEnhanced.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 1000)),
      );

      const data = {
        queries: [{ id: 'q1', query: 'test query' }],
        timeout: 100, // 100ms timeout
      };

      const result = await (cliConnectorService as any).handleBatchSearch(data);

      expect(result.success).toBe(true);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error.message).toContain('timeout');
    });
  });

  describe('Helper Methods', () => {
    describe('validateBatchOperations', () => {
      it('should validate operation types', () => {
        const operations = [
          { type: 'analyzeChunk', data: { chunkId: 'c1', snapshotId: 's1' } },
          { type: 'invalidType', data: {} },
        ];

        const errors = (cliConnectorService as any).validateBatchOperations(
          operations,
        );

        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('invalid type');
      });

      it('should validate required data fields', () => {
        const operations = [
          { type: 'analyzeChunk', data: { chunkId: 'c1' } }, // Missing snapshotId
          { type: 'analyzeFile', data: { filePath: 'test.ts' } }, // Missing snapshotId
          { type: 'analyzeQuality', data: {} }, // Missing both target and snapshotId
        ];

        const errors = (cliConnectorService as any).validateBatchOperations(
          operations,
        );

        expect(errors).toHaveLength(3);
      });
    });

    describe('validateBatchQueries', () => {
      it('should validate query strings', () => {
        const queries = [
          { query: 'valid query' },
          { query: '' }, // Empty query
          { query: 123 }, // Invalid type
          { query: 'valid', limit: -1 }, // Invalid limit
          { query: 'valid', scoreThreshold: 1.5 }, // Invalid threshold
        ];

        const errors = (cliConnectorService as any).validateBatchQueries(
          queries,
        );

        expect(errors).toHaveLength(4);
      });
    });

    describe('deduplicateQueries', () => {
      it('should remove duplicate queries', () => {
        const queries = [
          { query: 'test', snapshotIds: ['s1'] },
          { query: 'test', snapshotIds: ['s1'] }, // Duplicate
          { query: 'test', snapshotIds: ['s2'] }, // Different snapshot
          { query: 'different' },
        ];

        const deduplicated = (cliConnectorService as any).deduplicateQueries(
          queries,
        );

        expect(deduplicated).toHaveLength(3);
      });
    });

    describe('getErrorCode', () => {
      it('should categorize different error types', () => {
        const service = cliConnectorService as any;

        expect(service.getErrorCode(new Error('timeout occurred'))).toBe(
          'OPERATION_TIMEOUT',
        );
        expect(service.getErrorCode(new Error('file not found'))).toBe(
          'RESOURCE_NOT_FOUND',
        );
        expect(service.getErrorCode(new Error('permission denied'))).toBe(
          'PERMISSION_DENIED',
        );
        expect(service.getErrorCode(new Error('network error'))).toBe(
          'NETWORK_ERROR',
        );
        expect(service.getErrorCode(new Error('unknown error'))).toBe(
          'UNKNOWN_ERROR',
        );
      });
    });

    describe('isRetryableError', () => {
      it('should identify retryable errors', () => {
        const service = cliConnectorService as any;

        expect(service.isRetryableError(new Error('timeout'))).toBe(true);
        expect(service.isRetryableError(new Error('network error'))).toBe(true);
        expect(service.isRetryableError(new Error('rate limit exceeded'))).toBe(
          true,
        );
        expect(service.isRetryableError(new Error('service unavailable'))).toBe(
          true,
        );

        expect(service.isRetryableError(new Error('not found'))).toBe(false);
        expect(service.isRetryableError(new Error('permission denied'))).toBe(
          false,
        );
        expect(service.isRetryableError(new Error('invalid request'))).toBe(
          false,
        );
      });
    });
  });

  describe('Progress Tracking', () => {
    it('should call progress callback during batch operations', async () => {
      const progressCallback = jest.fn();

      const data = {
        operations: [
          {
            id: 'op1',
            type: 'analyzeChunk',
            data: { chunkId: 'c1', snapshotId: 's1' },
          },
          {
            id: 'op2',
            type: 'analyzeChunk',
            data: { chunkId: 'c2', snapshotId: 's1' },
          },
        ],
        progressCallback,
        parallel: false,
      };

      await (cliConnectorService as any).handleBatchAnalyze(data);

      expect(progressCallback).toHaveBeenCalledTimes(2);
      expect(progressCallback).toHaveBeenCalledWith({
        processed: 1,
        total: 2,
        percentage: 50,
        timestamp: expect.any(Number),
      });
    });

    it('should call progress callback during batch search', async () => {
      const progressCallback = jest.fn();

      const data = {
        queries: [
          { id: 'q1', query: 'test 1' },
          { id: 'q2', query: 'test 2' },
        ],
        progressCallback,
        parallel: false,
      };

      await (cliConnectorService as any).handleBatchSearch(data);

      expect(progressCallback).toHaveBeenCalledTimes(2);
      expect(progressCallback).toHaveBeenCalledWith({
        processed: 1,
        total: 2,
        percentage: 50,
        timestamp: expect.any(Number),
      });
    });
  });
});
