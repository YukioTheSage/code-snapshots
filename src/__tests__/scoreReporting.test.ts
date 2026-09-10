import { ResultManager } from '../services/resultManager';
import {
  SemanticSearchService,
  resolveScoreThreshold,
} from '../services/semanticSearchService';
import { VectorDatabaseService } from '../services/vectorDatabaseService';

function rawResult(overrides: Record<string, unknown>) {
  return {
    id: 'c1',
    chunkId: 'c1',
    snapshotId: 'snap1',
    filePath: 'src/a.ts',
    content: 'alpha',
    startLine: 0,
    endLine: 1,
    score: 0.52,
    timestamp: 1,
    language: 'typescript',
    ...overrides,
  };
}

/**
 * A ProcessedQuery with no filters and no diversification, so every fixture
 * result reaches the score assertions.
 */
function processedQuery() {
  return {
    originalQuery: 'unrelated query',
    enhancedQuery: 'unrelated query',
    intent: {
      primary: 'find_implementation',
      secondary: [],
      confidence: 0.9,
      context: [],
      suggestedParameters: {},
    },
    searchStrategy: {
      mode: 'semantic',
      ranking: 'relevance',
      diversification: false,
      contextRadius: 5,
      boostFactors: [],
      penaltyFactors: [],
    },
    filters: undefined,
    expectedResultTypes: [],
    complexityScore: 0.5,
    processingMetadata: {
      processingTime: 0,
      enhancementsApplied: [],
      autoFiltersApplied: [],
      warnings: [],
      improvementSuggestions: [],
    },
  } as never;
}

function threeResults() {
  return [
    rawResult({ id: 'c1', chunkId: 'c1', score: 0.52, timestamp: 1 }),
    rawResult({
      id: 'c2',
      chunkId: 'c2',
      filePath: 'src/b.ts',
      content: 'beta',
      score: 0.51,
      timestamp: 2,
    }),
    rawResult({
      id: 'c3',
      chunkId: 'c3',
      filePath: 'src/c.ts',
      content: 'gamma',
      score: 0.5,
      timestamp: 3,
    }),
  ];
}

const options = {
  limit: 10,
  scoreThreshold: 0.1,
  includeExplanations: true,
} as never;

describe('score reporting', () => {
  it('preserves raw cosine similarity on the returned result', async () => {
    const manager = new ResultManager();

    const processed = await manager.processResults(
      threeResults() as never,
      processedQuery(),
      options,
    );

    expect(processed.results.length).toBeGreaterThan(0);

    // The bug: the top result was min-max rescaled to exactly 1.0 and written
    // back over `score`, so every query -- including nonsense -- reported the
    // top hit as a 100% match.
    expect(processed.results.every((r) => r.score <= 0.52)).toBe(true);
    expect(processed.results.every((r) => r.score >= 0.5)).toBe(true);
    expect(processed.results.some((r) => r.score === 1)).toBe(false);
  });

  it('keeps the normalized value for ranking, available as rankingScore', async () => {
    const manager = new ResultManager();

    const processed = await manager.processResults(
      threeResults() as never,
      processedQuery(),
      options,
    );

    // Normalization is a ranking device and must still happen -- it just must
    // not be what the user is shown as a similarity.
    const rankingScores = processed.results.map((r) => r.rankingScore);
    expect(rankingScores.every((s) => typeof s === 'number')).toBe(true);
    expect(Number.isFinite(Math.max(...(rankingScores as number[])))).toBe(
      true,
    );
  });

  it('orders by rankingScore, so the composite ranking survives', async () => {
    const manager = new ResultManager();

    const processed = await manager.processResults(
      threeResults() as never,
      processedQuery(),
      options,
    );

    // The returned order must still be driven by the ranking value. Sorting on
    // the raw similarity instead would silently discard the composite ranking
    // that ResultManager exists to compute.
    const ordering = processed.results.map((r) => r.rankingScore as number);
    const descending = [...ordering].sort((a, b) => b - a);
    expect(ordering).toEqual(descending);
  });

  it('ranks by composite while still reporting the raw similarity', async () => {
    const manager = new ResultManager();

    // 'boosted' has the worst cosine similarity but matches the hasTests boost
    // factor, so it takes the top rank. Verified: without `rankingScore` this
    // returns the 0.5-similarity result first while reporting its score as 1.0.
    const results = [
      rawResult({
        id: 'high',
        chunkId: 'high',
        filePath: 'src/plain.ts',
        content: 'const x = 1;',
        score: 0.9,
        timestamp: 1,
      }),
      rawResult({
        id: 'mid',
        chunkId: 'mid',
        filePath: 'src/middle.ts',
        content: 'const y = 2;',
        score: 0.7,
        timestamp: 2,
      }),
      rawResult({
        id: 'boosted',
        chunkId: 'boosted',
        filePath: 'src/thing.test.ts',
        content: 'function test() { /* test code */ }',
        score: 0.5,
        timestamp: 3,
      }),
    ];

    const boostedQuery = processedQuery() as {
      searchStrategy: { boostFactors: unknown[] };
    };
    boostedQuery.searchStrategy.boostFactors = [
      {
        condition: 'hasTests',
        multiplier: 3,
        description: 'boost tests',
        weight: 1,
      },
    ];

    const processed = await manager.processResults(
      results as never,
      boostedQuery as never,
      options,
    );

    const top = processed.results[0];
    expect(top.filePath).toBe('src/thing.test.ts');
    // The whole point: the top-ranked result reports its real similarity, not
    // the fact that it ranked first.
    expect(top.score).toBe(0.5);
    expect(top.rankingScore).toBeGreaterThan(0.9);
  });
});

describe('resolveScoreThreshold', () => {
  it('returns the requested threshold unchanged', () => {
    expect(resolveScoreThreshold(0.95)).toBe(0.95);
    expect(resolveScoreThreshold(0.6)).toBe(0.6);
    expect(resolveScoreThreshold(0)).toBe(0);
  });

  it('does not silently lower a high threshold', () => {
    // The bug: the effective floor was max(0.5, requested - 0.35), so a
    // slider at 0.95 admitted 0.60-similarity code.
    expect(resolveScoreThreshold(0.95)).toBeGreaterThanOrEqual(0.95);
  });

  it('clamps out-of-range and non-finite input rather than passing it on', () => {
    expect(resolveScoreThreshold(1.4)).toBe(1);
    expect(resolveScoreThreshold(-2)).toBe(0);
    expect(resolveScoreThreshold(Number.NaN)).toBe(0);
  });
});

describe('VectorDatabaseService.searchSimilarCode threshold', () => {
  function serviceWithMatches(matches: unknown[]): VectorDatabaseService {
    const index = {
      query: jest.fn().mockResolvedValue({ matches }),
    };
    const service = new VectorDatabaseService({} as never);
    (service as any).pineconeClient = {};
    (service as any).index = index;
    return service;
  }

  function match(id: string, score: number) {
    return {
      id,
      score,
      metadata: {
        filePath: 'src/a.ts',
        snapshotId: 'snap1',
        language: 'typescript',
        startLine: 0,
        endLine: 1,
        timestamp: 1,
      },
    };
  }

  it('honours the threshold it is given instead of lowering it', async () => {
    // 0.8 passes the old floor max(0.5, 0.95 - 0.2) = 0.75 but must not pass
    // a requested 0.95. This is the discriminating case.
    const service = serviceWithMatches([
      match('kept', 0.97),
      match('dropped', 0.8),
    ]);

    const results = await service.searchSimilarCode([0.1, 0.2], {
      limit: 10,
      scoreThreshold: 0.95,
    });

    expect(results.map((r) => r.chunkId)).toEqual(['kept']);
  });

  it('still returns everything above a low threshold', async () => {
    const service = serviceWithMatches([match('a', 0.3), match('b', 0.2)]);

    const results = await service.searchSimilarCode([0.1, 0.2], {
      limit: 10,
      scoreThreshold: 0.1,
    });

    expect(results.map((r) => r.chunkId).sort()).toEqual(['a', 'b']);
  });
});

describe('SemanticSearchService threshold plumbing', () => {
  it('passes the resolved threshold through to the vector store', async () => {
    const service = new SemanticSearchService(
      { getSnapshots: () => [], onDidChangeSnapshots: jest.fn() } as never,
      {
        hasCredentials: jest.fn().mockResolvedValue(true),
        promptForCredentials: jest.fn(),
      } as never,
      {
        workspaceState: { get: jest.fn(() => []), update: jest.fn() },
      } as never,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const searchSimilarCode = jest.fn().mockResolvedValue([]);
    (service as any).vectorDatabaseService = { searchSimilarCode };
    (service as any).embeddingService = {
      embedSearchQuery: jest.fn().mockResolvedValue([0.1, 0.2]),
    };

    await service.searchCode({ query: 'anything', scoreThreshold: 0.95 });

    expect(searchSimilarCode).toHaveBeenCalledTimes(1);
    expect(searchSimilarCode.mock.calls[0][1]).toMatchObject({
      scoreThreshold: 0.95,
    });
  });
});
