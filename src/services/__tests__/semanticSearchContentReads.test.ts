/* eslint-disable @typescript-eslint/no-explicit-any */
import { SemanticSearchService } from '../semanticSearchService';

function makeMatch(index: number) {
  const filePath = `src/file${index}.ts`;
  return {
    chunkId: `chunk-${index}`,
    filePath,
    snapshotId: 'snap-1',
    score: 0.9 - index * 0.001,
    metadata: {
      filePath,
      snapshotId: 'snap-1',
      language: 'typescript',
      startLine: 0,
      endLine: 1,
      timestamp: 1,
      workspaceId: 'ws-1',
    },
  };
}

function buildService(matches: unknown[]) {
  const snapshotManager = {
    getSnapshots: () => [{ id: 'snap-1', timestamp: 1 }],
    getSnapshotById: () => ({
      id: 'snap-1',
      timestamp: 1,
      description: 's',
      files: {},
    }),
    getSnapshotFileContentPublic: jest.fn(),
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
  (service as any).embeddingService = {
    embedSearchQuery: jest.fn().mockResolvedValue([0.1, 0.2]),
  };
  (service as any).vectorDatabaseService = {
    searchSimilarCode: jest.fn().mockResolvedValue(matches),
  };
  // Quality metrics are an enhancement on this path; an empty chunk list makes
  // `attachQualityMetrics` a no-op without touching the real chunker.
  (service as any).enhancedCodeChunker = {
    chunkFileEnhanced: jest.fn().mockResolvedValue([]),
  };
  return { service, snapshotManager };
}

describe('SemanticSearchService content reads', () => {
  it('reads with bounded concurrency instead of one at a time', async () => {
    const matches = Array.from({ length: 8 }, (_, index) => makeMatch(index));
    const { service, snapshotManager } = buildService(matches);
    const lines = Array.from({ length: 40 }, (_, line) => `line ${line}`);

    let inFlight = 0;
    let maxInFlight = 0;
    snapshotManager.getSnapshotFileContentPublic.mockImplementation(
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
        return lines.join('\n');
      },
    );

    const results = await service.searchCode({ query: 'anything', limit: 20 });

    expect(results).toHaveLength(8);
    // The bug: the loop awaited each read before starting the next, so the
    // maximum number of reads in flight was always exactly 1.
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it('preserves the ranking order when reads finish out of order', async () => {
    const matches = Array.from({ length: 8 }, (_, index) => makeMatch(index));
    const { service, snapshotManager } = buildService(matches);

    snapshotManager.getSnapshotFileContentPublic.mockImplementation(
      async (_snapshotId: string, filePath: string) => {
        const index = Number(filePath.replace(/\D/g, ''));
        // The highest-scored result is the slowest to read.
        await new Promise((resolve) =>
          setTimeout(resolve, index === 0 ? 25 : 0),
        );
        return `export const file${index} = ${index};\nexport const more${index} = 1;`;
      },
    );

    const results = await service.searchCode({ query: 'anything', limit: 20 });

    expect(results.map((result) => result.filePath)).toEqual([
      'src/file0.ts',
      'src/file1.ts',
      'src/file2.ts',
      'src/file3.ts',
      'src/file4.ts',
      'src/file5.ts',
      'src/file6.ts',
      'src/file7.ts',
    ]);
  });
});
