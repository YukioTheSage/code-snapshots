import {
  compareSearchResults,
  SemanticSearchResult,
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
