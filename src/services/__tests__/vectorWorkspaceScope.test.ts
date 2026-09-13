/* eslint-disable @typescript-eslint/no-explicit-any */
import { VectorDatabaseService } from '../vectorDatabaseService';
import type { CodeChunk } from '../codeChunker';

const chunk: CodeChunk = {
  id: 'chunk-1',
  content: 'const a = 1;',
  filePath: 'src/a.ts',
  snapshotId: 'snapshot-1',
  startLine: 0,
  endLine: 1,
  metadata: { language: 'typescript' },
};

describe('vector workspace scoping', () => {
  it('stamps the workspace id on every vector', async () => {
    const service = new VectorDatabaseService('ws-abc');
    (service as any).ensureInitialized = jest.fn().mockResolvedValue(undefined);
    const upserts: any[] = [];
    (service as any).getIndex = () => ({
      upsert: jest.fn(async (records: any[]) => {
        upserts.push(...records);
      }),
    });

    await service.upsertVectors(
      'snapshot-1',
      [chunk],
      new Map([[chunk.id, [0.1, 0.2]]]),
    );

    expect(upserts[0].metadata.workspaceId).toBe('ws-abc');
  });

  it('scopes every query to this workspace', async () => {
    const service = new VectorDatabaseService('ws-abc');
    const query = jest.fn().mockResolvedValue({ matches: [] });
    (service as any).getIndex = () => ({ query });
    (service as any).ensureInitialized = jest.fn().mockResolvedValue(undefined);

    await service.searchSimilarCode([0.1, 0.2], { limit: 5 });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          workspaceId: { $eq: 'ws-abc' },
        }),
      }),
    );
  });

  it('does not let caller options escape the workspace scope', async () => {
    const service = new VectorDatabaseService('ws-abc');
    const query = jest.fn().mockResolvedValue({ matches: [] });
    (service as any).getIndex = () => ({ query });
    (service as any).ensureInitialized = jest.fn().mockResolvedValue(undefined);

    await service.searchSimilarCode([0.1], {
      limit: 5,
      snapshotIds: ['snapshot-other'],
      languages: ['typescript'],
    });

    const filter = query.mock.calls[0][0].filter;
    expect(filter.workspaceId.$eq).toBe('ws-abc');
    expect(filter.snapshotId).toEqual({ $in: ['snapshot-other'] });
  });
});
