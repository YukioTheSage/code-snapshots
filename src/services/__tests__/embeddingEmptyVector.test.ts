/* eslint-disable @typescript-eslint/no-explicit-any */
import { EmbeddingService } from '../embeddingService';
import { SemanticSearchService } from '../semanticSearchService';
import { CodeChunk } from '../codeChunker';

const chunk: CodeChunk = {
  id: 'chunk-a',
  content: 'export const x = 1;',
  filePath: 'src/a.ts',
  startLine: 0,
  endLine: 1,
  snapshotId: 'snap-1',
  metadata: { language: 'typescript' },
};

function embeddingServiceWith(response: unknown): {
  service: EmbeddingService;
  embedContent: jest.Mock;
} {
  const credentials = {
    getGeminiApiKey: jest.fn().mockResolvedValue('key'),
    promptForCredentials: jest.fn(),
  } as never;
  const service = new EmbeddingService(credentials);
  const embedContent = jest.fn().mockResolvedValue(response);
  (service as any).aiClient = { models: { embedContent } };
  return { service, embedContent };
}

describe('EmbeddingService empty responses', () => {
  it('fails instead of caching an empty vector for a chunk', async () => {
    const { service, embedContent } = embeddingServiceWith({ embeddings: [] });

    await expect(service.embedCodeChunk(chunk)).rejects.toThrow(/empty vector/);

    // The bug: `?? []` was cached, and `getCachedEmbedding` returned it because
    // an empty array is truthy, so every later attempt for this chunk was
    // served the empty vector and `upsertVectors` threw "Embedding not found"
    // for it forever.
    expect((service as any).embeddingCache.size).toBe(0);

    await expect(service.embedCodeChunk(chunk)).rejects.toThrow(/empty vector/);
    expect(embedContent).toHaveBeenCalledTimes(2);
  });

  it('fails instead of returning an empty query vector', async () => {
    const { service } = embeddingServiceWith({ embeddings: [{ values: [] }] });

    await expect(service.embedSearchQuery('find auth')).rejects.toThrow(
      /empty vector/,
    );
  });

  it('recomputes instead of serving an empty vector that is already cached', async () => {
    const { service, embedContent } = embeddingServiceWith({
      embeddings: [{ values: [0.5, 0.25] }],
    });
    const key = (service as any).embeddingCacheKey(
      (service as any).formatChunkForEmbedding(chunk),
    );
    (service as any).embeddingCache.set(key, []);

    // An empty array is truthy, so the truthiness read served this entry to
    // every later attempt. A write-side-only fix cannot reach an entry that is
    // already in the cache; the read guard drops it and recomputes.
    await expect(service.embedCodeChunk(chunk)).resolves.toEqual([0.5, 0.25]);
    expect(embedContent).toHaveBeenCalledTimes(1);
  });
});

describe('SemanticSearchService purge clears the embedding cache', () => {
  it('clears the cache when a snapshot is purged', async () => {
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

    const clearCache = jest.fn();
    (service as any).embeddingService = { clearCache };
    (service as any).vectorDatabaseService = {
      deleteSnapshotVectors: jest.fn().mockResolvedValue({ purged: true }),
    };

    await service.deleteSnapshotIndexing('snap-a');

    // `clearCache` had no caller at all, so a purged snapshot content stayed in
    // the cache until the window closed.
    expect(clearCache).toHaveBeenCalledTimes(1);
  });
});
