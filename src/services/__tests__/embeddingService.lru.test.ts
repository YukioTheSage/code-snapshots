import { EmbeddingService } from '../embeddingService';
import { CodeChunk } from '../codeChunker';

describe('EmbeddingService LRU cache', () => {
  const createChunk = (id: string): CodeChunk => ({
    id,
    content: `const ${id} = true;`,
    filePath: `src/${id}.ts`,
    startLine: 0,
    endLine: 1,
    snapshotId: 'snapshot-1',
    metadata: { language: 'typescript' },
  });

  it('refreshes recency on read and evicts least recently used entry', async () => {
    const credentialsManager = {
      getGeminiApiKey: jest.fn(),
      promptForCredentials: jest.fn(),
    } as any;

    const service = new EmbeddingService(credentialsManager);
    (service as any).EMBEDDING_CACHE_LIMIT = 2;
    (service as any).delay = jest.fn().mockResolvedValue(undefined);

    let embedCallCount = 0;
    (service as any).aiClient = {
      models: {
        embedContent: jest.fn().mockImplementation(async () => {
          embedCallCount += 1;
          return { embeddings: [{ values: [embedCallCount] }] };
        }),
      },
    };

    const chunkA = createChunk('a');
    const chunkB = createChunk('b');
    const chunkC = createChunk('c');

    await service.embedCodeChunk(chunkA); // cache: a
    await service.embedCodeChunk(chunkB); // cache: a, b
    expect(embedCallCount).toBe(2);

    await service.embedCodeChunk(chunkA); // refresh a => cache order b, a
    expect(embedCallCount).toBe(2);

    await service.embedCodeChunk(chunkC); // evict b => cache a, c
    expect(embedCallCount).toBe(3);

    await service.embedCodeChunk(chunkB); // b was evicted, must recompute
    expect(embedCallCount).toBe(4);
  });
});
