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

/**
 * A stride of 0 or a negative value never advances the batch handlers' chunking
 * loop (`i += maxConcurrency`), and that loop runs synchronously — so an
 * unguarded handler spins forever and no assertion ever gets to run. This proxy
 * caps how many times the loop may slice: an unguarded handler aborts with
 * "chunking loop did not advance" (a fast, bounded test failure), while a
 * handler that validates its stride never reaches the loop. `Array.isArray`
 * still reports true for the proxy, so the handler's own input check is
 * unaffected.
 */
function capChunkingIterations<T>(items: T[], cap: number): T[] {
  let sliceCalls = 0;

  return new Proxy(items, {
    get(target, property, receiver) {
      if (property === 'slice') {
        return (start?: number, end?: number) => {
          sliceCalls += 1;
          if (sliceCalls > cap) {
            throw new Error(
              'chunking loop did not advance: aborted to keep the suite bounded',
            );
          }
          return target.slice(start, end);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

/**
 * The defect is a hang, so an assertion alone cannot bound the call: it is
 * raced against a timeout that fails the test instead of wedging the suite. The
 * timer is cleared on the way out so a passing test does not linger.
 */
async function withHandlerTimeout(
  invocation: Promise<any>,
  reason: string,
): Promise<any> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      invocation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`handler did not return: ${reason}`)),
          2000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** The `{success, error}` envelope both batch handlers answer with. */
interface BatchEnvelope {
  success: boolean;
  error?: { message?: string };
}

/**
 * Bounds a hang-shaped call on the fake clock. `withHandlerTimeout` bounds the
 * *test*, but not the defect: a retry loop parked on a real backoff timer would
 * keep running after the race gave up and outlive the jest worker. With fake
 * timers nothing can leak, so each round fires whatever retry timer is pending
 * at that moment (and awaits the async work behind it): a value that reaches the
 * loop is observed still retrying after `rounds` attempts, while a value the
 * handler rejects is seen settling straight away. The caller installs the fake
 * timers, so the abandoned loop is discarded with the fake clock.
 */
async function settleAfterRetryRounds(
  invocation: Promise<BatchEnvelope>,
  rounds: number,
): Promise<{ settled: boolean; result: BatchEnvelope | undefined }> {
  let settled = false;
  let result: BatchEnvelope | undefined;

  // The handlers report failure as an envelope rather than by rejecting, so an
  // unexpected rejection is normalised the same way and reported by the
  // assertion instead of becoming an unhandled rejection.
  void invocation.then(
    (value) => {
      settled = true;
      result = value;
    },
    (error) => {
      settled = true;
      result = {
        success: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    },
  );

  for (let round = 0; round < rounds && !settled; round += 1) {
    await jest.runOnlyPendingTimersAsync();
    await Promise.resolve();
  }

  return { settled, result };
}

/** An `analyzeFile` operation whose data resolves against the mocked snapshot. */
function analyzeFileOperation(id = 'op1'): {
  id: string;
  type: string;
  data: { filePath: string; snapshotId: string };
} {
  return {
    id,
    type: 'analyzeFile',
    data: { filePath: 'test.ts', snapshotId: 'snap1' },
  };
}

/** What the batch-analyze envelope is read for, without an `any` cast. */
interface BatchAnalyzeEnvelope {
  success: boolean;
  results: Array<{ success: boolean }>;
}

/**
 * The private `handleBatchAnalyze`, reached through a typed seam. The rest of
 * this file calls the handler through an `any` cast, and the lint ceiling is
 * exact, so this test — the newest — adds no warning of its own.
 */
function batchAnalyzeHandler(
  service: CliConnectorService,
): (data: unknown) => Promise<BatchAnalyzeEnvelope> {
  return (
    service as unknown as {
      handleBatchAnalyze: (data: unknown) => Promise<BatchAnalyzeEnvelope>;
    }
  ).handleBatchAnalyze.bind(service);
}

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

      // Every analyzeChunk operation fails here (the snapshot lookup is not
      // stubbed in this test), so the batch verdict is false. What this test
      // pins is the chunking stride and the metadata, asserted below. The count
      // pins the premise: if a later setup change let an operation succeed, the
      // verdict would flip and this test must say so through the counts.
      expect(result.success).toBe(false);
      expect(result.totalOperations).toBe(10);
      expect(result.failedOperations).toBe(10);
      expect(result.results).toHaveLength(10);
      expect(result.metadata.parallel).toBe(true);
      expect(result.metadata.maxConcurrency).toBe(3);
    });

    it('should reject maxConcurrency 0 instead of looping forever', async () => {
      // A stride of 0 makes the chunking loop spin, so the operations array is
      // capped and the call is bounded: without the guard this test fails fast
      // ("chunking loop did not advance") instead of hanging the worker.
      const data = {
        operations: capChunkingIterations(
          [
            {
              id: 'op1',
              type: 'analyzeChunk',
              data: { chunkId: 'chunk1', snapshotId: 'snap1' },
            },
          ],
          1,
        ),
        parallel: true,
        maxConcurrency: 0,
      };

      const result = await withHandlerTimeout(
        (cliConnectorService as any).handleBatchAnalyze(data),
        'maxConcurrency 0 was not rejected',
      );

      expect(result.success).toBe(false);
      expect(result.error.message).toMatch(/maxConcurrency/i);
      expect(result.error.message).toContain('0');
    });

    it('should reject a negative maxConcurrency', async () => {
      const data = {
        operations: capChunkingIterations(
          [
            {
              id: 'op1',
              type: 'analyzeChunk',
              data: { chunkId: 'chunk1', snapshotId: 'snap1' },
            },
          ],
          1,
        ),
        parallel: true,
        maxConcurrency: -1,
      };

      const result = await withHandlerTimeout(
        (cliConnectorService as any).handleBatchAnalyze(data),
        'maxConcurrency -1 was not rejected',
      );

      expect(result.success).toBe(false);
      expect(result.error.message).toMatch(/maxConcurrency/i);
      expect(result.error.message).toContain('-1');
    });

    it('should reject a non-finite maxConcurrency', async () => {
      // Neither value can spin the loop (i becomes NaN/Infinity and the loop
      // stops immediately), but both are invalid strides and reach the chunker.
      for (const maxConcurrency of [Number.NaN, Number.POSITIVE_INFINITY]) {
        const result = await withHandlerTimeout(
          (cliConnectorService as any).handleBatchAnalyze({
            operations: [
              {
                id: 'op1',
                type: 'analyzeChunk',
                data: { chunkId: 'chunk1', snapshotId: 'snap1' },
              },
            ],
            parallel: true,
            maxConcurrency,
          }),
          `maxConcurrency ${String(maxConcurrency)} was not rejected`,
        );

        expect(result.success).toBe(false);
        expect(result.error.message).toMatch(/maxConcurrency/i);
      }
    });

    it('should reject a non-numeric maxConcurrency', async () => {
      // A destructuring default only covers `undefined`, so JSON null (and any
      // other non-number) reaches the stride: `0 + null`, `0 + ''` and
      // `0 + false` all stay 0, which is the same freeze as an explicit 0 — the
      // capped array keeps that from wedging the worker here.
      for (const maxConcurrency of ['3', null, '', false]) {
        const result = await withHandlerTimeout(
          (cliConnectorService as any).handleBatchAnalyze({
            operations: capChunkingIterations(
              [
                {
                  id: 'op1',
                  type: 'analyzeChunk',
                  data: { chunkId: 'chunk1', snapshotId: 'snap1' },
                },
              ],
              1,
            ),
            parallel: true,
            maxConcurrency,
          }),
          `maxConcurrency ${JSON.stringify(maxConcurrency)} was not rejected`,
        );

        expect(result.success).toBe(false);
        expect(result.error.message).toMatch(/maxConcurrency/i);
      }
    });

    it('should still process a valid maxConcurrency', async () => {
      mockTerminalApiService.getSnapshotFileContent.mockResolvedValue(
        'test content',
      );

      const data = {
        operations: Array.from({ length: 5 }, (_, i) => ({
          id: `op${i}`,
          type: 'analyzeChunk',
          data: { chunkId: `chunk${i}`, snapshotId: 'snap1' },
        })),
        parallel: true,
        maxConcurrency: 2,
      };

      const result = await withHandlerTimeout(
        (cliConnectorService as any).handleBatchAnalyze(data),
        'valid maxConcurrency 2 never returned',
      );

      // As above: the operations themselves fail, so the batch is a failure.
      // The count pins that premise; the assertions below are about the stride
      // covering each entry once.
      expect(result.success).toBe(false);
      expect(result.totalOperations).toBe(5);
      expect(result.failedOperations).toBe(5);
      expect(result.metadata.maxConcurrency).toBe(2);

      // Every operation is processed exactly once: the chunk stride still
      // covers the whole array without repeating or dropping an entry.
      const processedIds = result.results.map(
        (entry: any) => entry.operationId,
      );
      expect(processedIds).toHaveLength(5);
      expect(new Set(processedIds).size).toBe(5);
      expect([...processedIds].sort()).toEqual([
        'op0',
        'op1',
        'op2',
        'op3',
        'op4',
      ]);
    });

    it('should reject a non-finite maxRetries instead of retrying forever', async () => {
      // JSON `1e999` parses to Infinity, and `retryFailedOperations`'s
      // `while (retryCount < maxRetries && !success)` never terminates for it:
      // the loop only leaves an attempt behind by succeeding, so an attempt that
      // throws is retried forever — a socket client could wedge the host. The
      // loop cannot be bounded from outside (it parks on a backoff timer between
      // attempts), so it runs on the fake clock: the invalid value has to be
      // rejected before the loop is reached, while a value that does reach it is
      // still retrying after eight rounds and fails the assertion below instead
      // of hanging the run.
      const executeAnalysisOperation = jest
        .spyOn(cliConnectorService as any, 'executeAnalysisOperation')
        .mockRejectedValue(new Error('Temporary failure'));

      jest.useFakeTimers();
      try {
        const outcome = await settleAfterRetryRounds(
          (cliConnectorService as any).handleBatchAnalyze({
            operations: [analyzeFileOperation()],
            parallel: false,
            retryFailedOperations: true,
            maxRetries: Number.POSITIVE_INFINITY,
          }),
          8,
        );

        expect(outcome.settled).toBe(true);
        expect(outcome.result?.success).toBe(false);
        expect(String(outcome.result?.error?.message)).toMatch(/maxRetries/i);
        // Rejected up front: before the guard this seam was hit once per
        // attempt, forever.
        expect(executeAnalysisOperation).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('should reject a maxRetries that is not a non-negative integer', async () => {
      mockTerminalApiService.getSnapshotFileContent.mockResolvedValue(
        'test content',
      );

      for (const maxRetries of [-1, 1.5, '2', Number.NaN]) {
        const result = await withHandlerTimeout(
          (cliConnectorService as any).handleBatchAnalyze({
            operations: [analyzeFileOperation()],
            parallel: false,
            maxRetries,
          }),
          `maxRetries ${String(maxRetries)} was not rejected`,
        );

        expect(result.success).toBe(false);
        expect(result.error.message).toMatch(/maxRetries/i);
      }
    });

    it('should accept maxRetries 0 as "do not retry"', async () => {
      // 0 is a legitimate value — "do not retry" — so the guard must not reject
      // it, and it must still reach the retry helper, which then does nothing.
      mockTerminalApiService.getSnapshotFileContent.mockRejectedValue(
        new Error('Temporary failure'),
      );

      const result = await withHandlerTimeout(
        (cliConnectorService as any).handleBatchAnalyze({
          operations: [analyzeFileOperation()],
          parallel: false,
          retryFailedOperations: true,
          maxRetries: 0,
        }),
        'maxRetries 0 was rejected',
      );

      // The single operation was rejected, so the batch is a failure; that
      // maxRetries 0 was accepted is asserted by the call count below.
      expect(result.success).toBe(false);
      expect(result.failedOperations).toBe(1);
      // The operation ran once and was never re-executed.
      expect(
        mockTerminalApiService.getSnapshotFileContent,
      ).toHaveBeenCalledTimes(1);
    });

    it('should reject an invalid timeout instead of faking a timeout failure', async () => {
      // `setTimeout` coerces a null, NaN, zero or negative delay to 0 and
      // overflows Infinity to 1ms, so the race reported a timeout on operations
      // that had not timed out at all.
      mockTerminalApiService.getSnapshotFileContent.mockResolvedValue(
        'test content',
      );

      for (const timeout of [
        null,
        Number.NaN,
        0,
        -1,
        Number.POSITIVE_INFINITY,
        '300000',
      ]) {
        const result = await withHandlerTimeout(
          (cliConnectorService as any).handleBatchAnalyze({
            operations: [analyzeFileOperation()],
            parallel: false,
            timeout,
          }),
          `timeout ${String(timeout)} was not rejected`,
        );

        expect(result.success).toBe(false);
        expect(result.error.message).toMatch(/timeout/i);
      }
    });

    it('should reject a timeout above the setTimeout ceiling instead of faking a timeout failure', async () => {
      // A finite value is not enough: Node clamps a delay above 2147483647ms to
      // 1ms, so `3e9` passes an "is it a positive finite number" check and still
      // arms an immediate timer — the same fabricated timeout failure the
      // validator exists to prevent.
      mockTerminalApiService.getSnapshotFileContent.mockResolvedValue(
        'test content',
      );

      const result = await withHandlerTimeout(
        (cliConnectorService as any).handleBatchAnalyze({
          operations: [analyzeFileOperation()],
          parallel: false,
          timeout: 3e9,
        }),
        'timeout 3e9 was not rejected',
      );

      expect(result.success).toBe(false);
      expect(result.error.message).toMatch(/timeout/i);
      // The message names the ceiling, so the caller learns what the limit is.
      expect(result.error.message).toContain('2147483647');
      // Rejected before any work: an accepted value reaches the operation.
      expect(
        mockTerminalApiService.getSnapshotFileContent,
      ).not.toHaveBeenCalled();
    });

    it('should still process a positive finite timeout', async () => {
      mockTerminalApiService.getSnapshotFileContent.mockResolvedValue(
        'test content',
      );

      const result = await withHandlerTimeout(
        (cliConnectorService as any).handleBatchAnalyze({
          operations: [analyzeFileOperation()],
          parallel: false,
          timeout: 50,
        }),
        'valid timeout 50 never returned',
      );

      expect(result.success).toBe(true);
      expect(result.metadata.timeout).toBe(50);
      expect(result.results[0].success).toBe(true);
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

      // The only recorded operation failed and the loop stopped, so the batch
      // is a failure: "1 of 1 failed" must not read as success just because two
      // were requested.
      expect(result.success).toBe(false);
      expect(result.totalOperations).toBe(2);
      expect(result.results).toHaveLength(1); // Should stop after first failure
      expect(result.results[0].success).toBe(false);
    });

    it('should stop on a handler-level failure when continueOnError=false in the parallel path', async () => {
      // The parallel twin of the test above. These operations reject at the
      // handler, but the parallel branch wraps each one in a try/catch and
      // answers a fulfilled `{ success: false }` instead — so the failure lives
      // in the settled *value*, not in the settlement. Tracking failures through
      // `Promise.allSettled`'s rejected branch alone therefore misses every
      // handler-level failure, and `continueOnError: false` must stop on it
      // exactly as the sequential branch does.
      mockTerminalApiService.getSnapshotFileContent
        .mockRejectedValueOnce(new Error('File not found'))
        .mockResolvedValue('test content');

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
          {
            id: 'op3',
            type: 'analyzeFile',
            data: { filePath: 'test3.ts', snapshotId: 'snap1' },
          },
        ],
        continueOnError: false,
        parallel: true,
        // One operation per chunk: the flag is honoured between chunks, so a
        // single chunk would run every operation regardless of this change.
        maxConcurrency: 1,
      };

      const result = await batchAnalyzeHandler(cliConnectorService)(data);

      // Stopped after the first failure, and the batch reads as a failure:
      // "1 of 1 failed" must not be dressed up with the successes it never ran.
      expect(result.results).toHaveLength(1);
      expect(result.results[0].success).toBe(false);
      expect(result.success).toBe(false);
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
      // See the note on processingTime below: a duration can be 0.
      expect(typeof result.performance.totalTime).toBe('number');
      expect(Number.isFinite(result.performance.totalTime)).toBe(true);
      expect(result.performance.totalTime).toBeGreaterThanOrEqual(0);
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

      // The single operation timed out, so the batch is a failure.
      expect(result.success).toBe(false);
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

    it('should reject maxConcurrency 0 instead of looping forever', async () => {
      // `deduplicateQueries` rebuilds the array before chunking, so the cap has
      // to be applied to the array the handler actually walks: dedup is off.
      const data = {
        queries: capChunkingIterations(
          [{ id: 'q1', query: 'test query 1' }],
          1,
        ),
        parallel: true,
        maxConcurrency: 0,
        deduplicateQueries: false,
      };

      const result = await withHandlerTimeout(
        (cliConnectorService as any).handleBatchSearch(data),
        'maxConcurrency 0 was not rejected',
      );

      expect(result.success).toBe(false);
      expect(result.error.message).toMatch(/maxConcurrency/i);
      expect(result.error.message).toContain('0');
    });

    it('should reject a non-finite maxRetries instead of retrying forever', async () => {
      // Same wedge as the analyze handler: `retryFailedQueries`'s
      // `while (retryCount < maxRetries && !success)` cannot terminate for
      // Infinity while the query keeps throwing, so the guard has to reject the
      // value before that loop is reached.
      const handleEnhancedSearch = jest
        .spyOn(cliConnectorService as any, 'handleEnhancedSearch')
        .mockRejectedValue(new Error('Temporary search failure'));

      jest.useFakeTimers();
      try {
        const outcome = await settleAfterRetryRounds(
          (cliConnectorService as any).handleBatchSearch({
            queries: [{ id: 'q1', query: 'test query' }],
            parallel: false,
            retryFailedQueries: true,
            maxRetries: Number.POSITIVE_INFINITY,
          }),
          8,
        );

        expect(outcome.settled).toBe(true);
        expect(outcome.result?.success).toBe(false);
        expect(String(outcome.result?.error?.message)).toMatch(/maxRetries/i);
        expect(handleEnhancedSearch).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('should reject an invalid timeout instead of faking a timeout failure', async () => {
      for (const timeout of [
        null,
        Number.NaN,
        0,
        -1,
        Number.POSITIVE_INFINITY,
        '300000',
      ]) {
        const result = await withHandlerTimeout(
          (cliConnectorService as any).handleBatchSearch({
            queries: [{ id: 'q1', query: 'test query' }],
            parallel: false,
            timeout,
          }),
          `timeout ${String(timeout)} was not rejected`,
        );

        expect(result.success).toBe(false);
        expect(result.error.message).toMatch(/timeout/i);
      }
    });

    it('should reject a timeout above the setTimeout ceiling instead of faking a timeout failure', async () => {
      // Same ceiling as the analyze handler: the value is finite and positive,
      // but Node clamps a delay above 2147483647ms to 1ms, so accepting it arms
      // an immediate timer and fabricates the timeout failure.
      const result = await withHandlerTimeout(
        (cliConnectorService as any).handleBatchSearch({
          queries: [{ id: 'q1', query: 'test query' }],
          parallel: false,
          timeout: 3e9,
        }),
        'timeout 3e9 was not rejected',
      );

      expect(result.success).toBe(false);
      expect(result.error.message).toMatch(/timeout/i);
      expect(result.error.message).toContain('2147483647');
      // Rejected before any search: an accepted value reaches the service.
      expect(
        mockSemanticSearchService.searchCodeEnhanced,
      ).not.toHaveBeenCalled();
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
      // See the note on processingTime below: a duration can be 0.
      expect(typeof result.performance.totalTime).toBe('number');
      expect(Number.isFinite(result.performance.totalTime)).toBe(true);
      expect(result.performance.totalTime).toBeGreaterThanOrEqual(0);
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

      // The single query timed out, so the batch is a failure.
      expect(result.success).toBe(false);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error.message).toContain('timeout');
    });
  });

  describe('timeout timer cleanup', () => {
    beforeEach(() => {
      mockTerminalApiService.getSnapshotFileContent.mockResolvedValue(
        'test content',
      );
      mockSemanticSearchService.searchCodeEnhanced.mockResolvedValue([]);
    });

    /**
     * Each of the four timeout races armed a timer and dropped the handle as
     * soon as the raced work won, so a batch of N operations left N timers
     * pending — the leak that kept the jest worker alive until it was force
     * exited. The fake clock makes the count observable: it has to be back to
     * zero after every call, in the parallel and the sequential path of both
     * handlers, with the operation resolving immediately (so the timeout never
     * fires and only the cleanup can retire the timer).
     */
    it('should clear the timeout timer once the raced operation settles', async () => {
      jest.useFakeTimers();
      try {
        await (cliConnectorService as any).handleBatchAnalyze({
          operations: [analyzeFileOperation()],
          parallel: true,
        });
        expect(jest.getTimerCount()).toBe(0);

        await (cliConnectorService as any).handleBatchAnalyze({
          operations: [analyzeFileOperation()],
          parallel: false,
        });
        expect(jest.getTimerCount()).toBe(0);

        await (cliConnectorService as any).handleBatchSearch({
          queries: [{ id: 'q1', query: 'test query' }],
          parallel: true,
        });
        expect(jest.getTimerCount()).toBe(0);

        await (cliConnectorService as any).handleBatchSearch({
          queries: [{ id: 'q1', query: 'test query' }],
          parallel: false,
        });
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
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

  describe('getStatus', () => {
    /**
     * `status.currentSnapshot` is the snapshot's *identity*: the standalone
     * client sends `getCurrentSnapshot()?.id`, and `cli/src/client.ts` types the
     * field `string | null`. The IPC payload has to send the same thing, or one
     * field of one command means two different things depending on whether an
     * extension happens to be connected. Descriptions are display text (empty or
     * duplicated is normal), so a caller cannot branch on them.
     */
    it('reports the snapshot id, not its description, over IPC', async () => {
      mockTerminalApiService.getWorkspaceInfo.mockResolvedValue({
        workspaceRoot: '/test/workspace',
        totalSnapshots: 3,
        currentSnapshotIndex: 2,
        currentSnapshot: {
          id: 'snapshot-123',
          description: 'before refactor',
          timestamp: 1,
          files: {},
        },
      });

      // Drive the request dispatcher, exactly as the CLI's IPC client does.
      const response = await (cliConnectorService as any).handleCliRequest({
        id: 'status-request',
        method: 'getStatus',
        data: {},
      });

      expect(response.success).toBe(true);
      expect(response.result.currentSnapshot).toBe('snapshot-123');
      expect(response.result.currentSnapshot).not.toBe('before refactor');
    });

    it('reports null when the workspace has no current snapshot', async () => {
      mockTerminalApiService.getWorkspaceInfo.mockResolvedValue({
        workspaceRoot: '/test/workspace',
        totalSnapshots: 0,
        currentSnapshotIndex: -1,
        currentSnapshot: undefined,
      });

      const response = await (cliConnectorService as any).handleCliRequest({
        id: 'status-request',
        method: 'getStatus',
        data: {},
      });

      expect(response.success).toBe(true);
      expect(response.result.currentSnapshot).toBeNull();
    });
  });
});
