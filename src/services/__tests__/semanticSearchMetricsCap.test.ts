/* eslint-disable @typescript-eslint/no-explicit-any */
import { SemanticSearchService } from '../semanticSearchService';
import {
  EnhancedSemanticSearchOptions,
  PerformanceMetrics,
} from '../../types/enhancedSearch';

function buildService(): SemanticSearchService {
  return new SemanticSearchService(
    { getSnapshots: () => [], onDidChangeSnapshots: jest.fn() } as never,
    {
      hasCredentials: jest.fn().mockResolvedValue(true),
      promptForCredentials: jest.fn(),
    } as never,
    { workspaceState: { get: jest.fn(() => []), update: jest.fn() } } as never,
  );
}

function metrics(totalTime: number): PerformanceMetrics {
  return {
    queryProcessingTime: 1,
    searchTime: 1,
    resultProcessingTime: 1,
    totalTime,
    memoryUsage: 1,
    cacheHitRate: 0,
    chunksSearched: 1,
    vectorOperations: 1,
  };
}

function recordedQueries(service: SemanticSearchService): string[] {
  return Array.from(
    ((service as any).performanceMetrics as Map<string, unknown>).keys(),
  );
}

describe('SemanticSearchService performance metrics map', () => {
  it('keeps at most the configured number of queries, evicting the least recently written', () => {
    const service = buildService();
    (service as any).PERFORMANCE_METRICS_LIMIT = 2;

    (service as any).recordPerformanceMetrics('q1', metrics(1));
    (service as any).recordPerformanceMetrics('q2', metrics(2));
    (service as any).recordPerformanceMetrics('q1', metrics(3));
    (service as any).recordPerformanceMetrics('q3', metrics(4));

    // The bug: every distinct query ever searched stayed in the map until
    // dispose(), because the only removal was the clear() in dispose().
    expect(recordedQueries(service)).toEqual(['q1', 'q3']);
    expect(
      ((service as any).performanceMetrics as Map<string, unknown>).size,
    ).toBe(2);
  });

  it('routes an enhanced search through the capped recorder', async () => {
    const service = buildService();
    const record = jest.spyOn(service as any, 'recordPerformanceMetrics');
    (service as any).processQuery = jest.fn().mockResolvedValue({} as never);
    (service as any).executeEnhancedSearch = jest.fn().mockResolvedValue([]);
    (service as any).processAndEnhanceResults = jest.fn().mockResolvedValue([]);

    await service.searchCodeEnhanced({
      query: 'cap me',
    } as EnhancedSemanticSearchOptions);

    expect(record).toHaveBeenCalledWith(
      'cap me',
      expect.objectContaining({ totalTime: expect.any(Number) }),
    );
    expect(recordedQueries(service)).toContain('cap me');
  });
});
