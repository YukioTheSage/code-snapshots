import {
  compareSearchResults,
  SemanticSearchResult,
  SemanticSearchService,
} from '../semanticSearchService';

function result(
  overrides: Partial<SemanticSearchResult>,
): SemanticSearchResult {
  return {
    snapshotId: 'snap-1',
    snapshot: {} as never,
    filePath: 'src/a.ts',
    startLine: 0,
    endLine: 1,
    score: 0.5,
    content: 'x',
    timestamp: 1,
    ...overrides,
  };
}

function identities(results: SemanticSearchResult[]): string[] {
  return results.map((r) => `${r.snapshotId}:${r.filePath}:${r.startLine}`);
}

describe('compareSearchResults', () => {
  it('ranks strictly by score, without a recency band', () => {
    const near = [
      result({ score: 1.0, timestamp: 1, filePath: 'src/a.ts' }),
      result({ score: 0.96, timestamp: 3, filePath: 'src/b.ts' }),
      result({ score: 0.92, timestamp: 2, filePath: 'src/c.ts' }),
    ];

    // The old comparator scored pairs within 5% by timestamp first, so it
    // returned 0.96, 1.0, 0.92: the best result demoted below a worse, newer one.
    expect([...near].sort(compareSearchResults).map((r) => r.score)).toEqual([
      1.0, 0.96, 0.92,
    ]);
  });

  it('breaks a score tie by timestamp descending, then by identity ascending', () => {
    const tie = [
      result({ score: 0.9, timestamp: 3, snapshotId: 'b', filePath: 'b.ts' }),
      result({ score: 0.9, timestamp: 3, snapshotId: 'a', filePath: 'a.ts' }),
      result({ score: 0.9, timestamp: 2, snapshotId: 'c', filePath: 'c.ts' }),
    ];

    // The old comparator left an exact tie to Array#sort's input order and
    // returned b, a, c, so two calls with the same data could disagree.
    expect(identities([...tie].sort(compareSearchResults))).toEqual([
      'a:a.ts:0',
      'b:b.ts:0',
      'c:c.ts:0',
    ]);
  });

  it('orders any permutation of a set identically', () => {
    const set = [
      result({ score: 0.9, timestamp: 5, snapshotId: 's', filePath: 'a.ts' }),
      result({ score: 0.9, timestamp: 5, snapshotId: 's', filePath: 'b.ts' }),
      result({ score: 0.4, timestamp: 9, snapshotId: 's', filePath: 'c.ts' }),
    ];
    const permutations = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 2, 0],
      [0, 2, 1],
      [1, 0, 2],
      [2, 0, 1],
    ];

    const orders = permutations.map((order) =>
      identities(
        order.map((index) => set[index]).sort(compareSearchResults),
      ).join('|'),
    );

    expect(new Set(orders).size).toBe(1);
  });
});

function makeMatch(filePath: string, snapshotId: string, score: number) {
  return {
    chunkId: `chunk-${filePath}`,
    filePath,
    snapshotId,
    score,
    metadata: {
      filePath,
      snapshotId,
      language: 'typescript',
      startLine: 0,
      endLine: 1,
      timestamp: 1,
      workspaceId: 'ws-1',
    },
  };
}

/**
 * The fixture the comparator's own doc comment names: scores 1.00 / 0.96 / 0.92
 * with snapshot timestamps 1 / 3 / 2, so the old 5%-band comparator ranked the
 * 0.96 result first. The snapshots carry the timestamps because `searchCode`
 * stamps each result with its snapshot's timestamp.
 */
function buildSearchService(matches: unknown[]) {
  const snapshots: Record<
    string,
    { id: string; timestamp: number; description: string; files: object }
  > = {
    'snap-1': { id: 'snap-1', timestamp: 1, description: 's', files: {} },
    'snap-2': { id: 'snap-2', timestamp: 3, description: 's', files: {} },
    'snap-3': { id: 'snap-3', timestamp: 2, description: 's', files: {} },
  };
  const snapshotManager = {
    getSnapshots: () =>
      Object.values(snapshots).map(({ id, timestamp }) => ({ id, timestamp })),
    getSnapshotById: (id: string) => snapshots[id],
    getSnapshotFileContentPublic: jest
      .fn()
      .mockResolvedValue('export const x = 1;'),
    onDidChangeSnapshots: jest.fn(),
  };
  const service = new SemanticSearchService(
    snapshotManager as never,
    {
      hasCredentials: jest.fn().mockResolvedValue(true),
      promptForCredentials: jest.fn(),
    } as never,
    { workspaceState: { get: jest.fn(() => []), update: jest.fn() } } as never,
  );
  (service as unknown as { embeddingService: unknown }).embeddingService = {
    embedSearchQuery: jest.fn().mockResolvedValue([0.1, 0.2]),
  };
  (
    service as unknown as { vectorDatabaseService: unknown }
  ).vectorDatabaseService = {
    searchSimilarCode: jest.fn().mockResolvedValue(matches),
  };
  (service as unknown as { enhancedCodeChunker: unknown }).enhancedCodeChunker =
    {
      chunkFileEnhanced: jest.fn().mockResolvedValue([]),
    };
  return service;
}

describe('searchCode applies the total order at both of its sort sites', () => {
  const matches = [
    makeMatch('src/a.ts', 'snap-1', 1.0),
    makeMatch('src/b.ts', 'snap-2', 0.96),
    makeMatch('src/c.ts', 'snap-3', 0.92),
  ];

  it('ranks the 1.00/0.96/0.92 fixture by score at every limit', async () => {
    // The comparator is pinned directly above; this pins its use. At limit 1
    // the initial sort decides which single result survives the diversity
    // pass, and at limit 3 the final sort decides the order of the selected
    // set, so reverting either site fails one of the two calls.
    const service = buildSearchService(matches);

    const single = await service.searchCode({ query: 'anything', limit: 1 });
    expect(single.map((result) => result.score)).toEqual([1.0]);

    const all = await service.searchCode({ query: 'anything', limit: 3 });
    expect(all.map((result) => result.score)).toEqual([1.0, 0.96, 0.92]);
  });
});
