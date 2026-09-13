/* eslint-disable @typescript-eslint/no-explicit-any */
import { VectorDatabaseService } from '../vectorDatabaseService';
import { SemanticSearchService } from '../semanticSearchService';
import { CodeChunk } from '../codeChunker';

function makeChunk(id: string): CodeChunk {
  return {
    id,
    content: `export const value = '${id}';`,
    filePath: 'src/a.ts',
    startLine: 0,
    endLine: 1,
    snapshotId: 'snap-1',
    metadata: { language: 'typescript', symbols: ['value'] },
  };
}

/**
 * `ensureInitialized` is satisfied by setting both fields, exactly as
 * `src/__tests__/vectorDelete.test.ts` does: setting only `index` would fall
 * through to `initialize` and prompt for a real key.
 */
function serviceWithIndex(index: unknown): VectorDatabaseService {
  const service = new VectorDatabaseService({} as never);
  (service as any).pineconeClient = {};
  (service as any).index = index;
  return service;
}

describe('VectorDatabaseService.upsertVectors idempotency', () => {
  it('purges the snapshot vectors before writing the new ones', async () => {
    const index = {
      deleteMany: jest.fn().mockResolvedValue(undefined),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    const service = serviceWithIndex(index);
    const first = makeChunk('snap-1_src_a.ts_0-1_aaaaaaaaaaaa');
    const second = makeChunk('snap-1_src_a.ts_0-1_bbbbbbbbbbbb');

    await service.upsertVectors(
      'snap-1',
      [first],
      new Map([[first.id, [0.1, 0.2]]]),
    );
    index.deleteMany.mockClear();
    index.upsert.mockClear();

    await service.upsertVectors(
      'snap-1',
      [second],
      new Map([[second.id, [0.3, 0.4]]]),
    );

    // The bug: a retry wrote the new chunk ids beside the old ones, so the
    // same code stayed searchable under two ids and the stale copy ranked too.
    expect(index.deleteMany).toHaveBeenCalledWith({
      snapshotId: { $eq: 'snap-1' },
    });
    expect(index.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      index.upsert.mock.invocationCallOrder[0],
    );
    const upsertedIds = index.upsert.mock.calls.flatMap((call) =>
      (call[0] as Array<{ id: string }>).map((vector) => vector.id),
    );
    expect(upsertedIds).toEqual([second.id]);
  });
});

describe('SemanticSearchService marks a snapshot indexed only after success', () => {
  it('leaves the snapshot unmarked when indexing throws', async () => {
    const workspaceState = { get: jest.fn(() => []), update: jest.fn() };
    const service = new SemanticSearchService(
      { getSnapshots: () => [], onDidChangeSnapshots: jest.fn() } as never,
      {
        hasCredentials: jest.fn().mockResolvedValue(true),
        promptForCredentials: jest.fn(),
      } as never,
      { workspaceState } as never,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    (service as any).indexSnapshot = jest
      .fn()
      .mockRejectedValue(new Error('upsert failed'));
    (service as any).processingQueue = ['snap-a'];

    await (service as any).processNextSnapshot();

    expect((service as any).indexedSnapshots.has('snap-a')).toBe(false);
    expect(workspaceState.update).not.toHaveBeenCalled();
  });
});
