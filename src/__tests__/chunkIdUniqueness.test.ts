import { buildChunkId } from '../services/codeChunker';
import { EmbeddingService } from '../services/embeddingService';
import * as vscode from 'vscode';

function withConfig(values: Record<string, unknown>) {
  (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
    update: jest.fn(),
  });
}

describe('buildChunkId', () => {
  it('distinguishes same-named files in different directories', () => {
    const a = buildChunkId('snap1', 'src/a/util.js', 0, 2, 'function a() {}');
    const b = buildChunkId('snap1', 'src/b/util.js', 0, 2, 'function b() {}');
    expect(a).not.toBe(b);
  });

  it('distinguishes different content at the same location', () => {
    const before = buildChunkId('snap1', 'src/a.js', 0, 2, 'let x = 1;');
    const after = buildChunkId('snap1', 'src/a.js', 0, 2, 'let x = 2;');
    expect(before).not.toBe(after);
  });

  it('is stable for identical inputs', () => {
    const one = buildChunkId('snap1', 'src/a.js', 0, 2, 'let x = 1;');
    const two = buildChunkId('snap1', 'src/a.js', 0, 2, 'let x = 1;');
    expect(one).toBe(two);
  });

  it('distinguishes the same file across snapshots', () => {
    const s1 = buildChunkId('snap1', 'src/a.js', 0, 2, 'let x = 1;');
    const s2 = buildChunkId('snap2', 'src/a.js', 0, 2, 'let x = 1;');
    expect(s1).not.toBe(s2);
  });

  it('produces an id safe for a vector store record key', () => {
    const id = buildChunkId('snap1', 'src/deep/path/file name.ts', 0, 2, 'x');
    expect(id).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it('normalizes Windows separators so ids match across platforms', () => {
    // Without this a chunk indexed on Windows and the same chunk on Linux
    // produce different record keys for identical content.
    const posix = buildChunkId('snap1', 'src/a/util.js', 0, 2, 'let x = 1;');
    const windows = buildChunkId(
      'snap1',
      'src\\a\\util.js',
      0,
      2,
      'let x = 1;',
    );
    expect(windows).toBe(posix);
  });
});

describe('EmbeddingService cache keying', () => {
  const baseChunk = {
    id: 'same-id',
    filePath: 'src/a.js',
    startLine: 0,
    endLine: 1,
    content: 'one',
    snapshotId: 'snap1',
    metadata: { language: 'javascript' },
  };

  function buildService(embedContent: jest.Mock): EmbeddingService {
    const service = new EmbeddingService({} as never);
    (service as any).aiClient = { models: { embedContent } };
    (service as any).delay = jest.fn().mockResolvedValue(undefined);
    return service;
  }

  function stubEmbeddings(): jest.Mock {
    return jest.fn().mockResolvedValue({ embeddings: [{ values: [1, 2, 3] }] });
  }

  beforeEach(() => withConfig({}));

  it('keys on content, so changed content is re-embedded', async () => {
    const embedContent = stubEmbeddings();
    const service = buildService(embedContent);

    await service.embedCodeChunk(baseChunk as never);
    await service.embedCodeChunk({ ...baseChunk, content: 'two' } as never);

    // The bug: both calls shared a cache entry keyed on chunk.id, so the
    // second returned the first chunk's vector and only one call was made.
    expect(embedContent).toHaveBeenCalledTimes(2);
  });

  it('still serves the cache for identical content', async () => {
    const embedContent = stubEmbeddings();
    const service = buildService(embedContent);

    await service.embedCodeChunk(baseChunk as never);
    await service.embedCodeChunk({ ...baseChunk } as never);

    expect(embedContent).toHaveBeenCalledTimes(1);
  });

  it('distinguishes chunks whose content is identical but whose context differs', async () => {
    // formatChunkForEmbedding embeds the file basename and the language, so
    // two chunks with the same body are two different API requests. Keying on
    // content alone would hand the second one the first one's vector.
    const embedContent = stubEmbeddings();
    const service = buildService(embedContent);

    await service.embedCodeChunk(baseChunk as never);
    await service.embedCodeChunk({
      ...baseChunk,
      filePath: 'src/b.js',
    } as never);

    expect(embedContent).toHaveBeenCalledTimes(2);
  });

  it('re-embeds when the configured model changes', async () => {
    // The model is read per call, so a settings change takes effect without a
    // reload. If the cache key did not carry the model id, the change would
    // silently keep serving vectors produced by the previous model.
    const embedContent = stubEmbeddings();
    withConfig({ 'embedding.model': 'embedding-model-a' });
    const service = buildService(embedContent);

    await service.embedCodeChunk(baseChunk as never);
    withConfig({ 'embedding.model': 'embedding-model-b' });
    await service.embedCodeChunk(baseChunk as never);

    expect(embedContent).toHaveBeenCalledTimes(2);
  });

  it('re-embeds when the configured dimension changes', async () => {
    const embedContent = stubEmbeddings();
    withConfig({ 'embedding.dimension': 3072 });
    const service = buildService(embedContent);

    await service.embedCodeChunk(baseChunk as never);
    withConfig({ 'embedding.dimension': 1536 });
    await service.embedCodeChunk(baseChunk as never);

    expect(embedContent).toHaveBeenCalledTimes(2);
  });

  it('requests the configured model and dimension', async () => {
    const embedContent = stubEmbeddings();
    withConfig({
      'embedding.model': 'embedding-model-c',
      'embedding.dimension': 1536,
    });
    const service = buildService(embedContent);

    await service.embedCodeChunk(baseChunk as never);

    expect(embedContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'embedding-model-c',
        config: { outputDimensionality: 1536 },
      }),
    );
  });
});
