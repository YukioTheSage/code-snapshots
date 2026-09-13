import { TerminalApiService } from '../terminalApiService';

describe('TerminalApiService error propagation', () => {
  it('throws when the snapshot store cannot list snapshots', async () => {
    const api = new TerminalApiService({
      getSnapshots: () => {
        throw new Error('snapshot store unavailable');
      },
    } as never);

    // The bug: any error became an empty array, which is the same value a
    // successful call with no matches returns.
    await expect(api.getSnapshots()).rejects.toThrow(
      'snapshot store unavailable',
    );
  });

  it('throws when the search backend fails', async () => {
    const api = new TerminalApiService({ getSnapshots: () => [] } as never);
    (
      api as unknown as { semanticSearchService: unknown }
    ).semanticSearchService = {
      searchCode: jest
        .fn()
        .mockRejectedValue(new Error('Pinecone unreachable')),
    };

    await expect(api.searchSnapshots('anything')).rejects.toThrow(
      'Pinecone unreachable',
    );
  });

  it('reports an unavailable search service instead of no matches', async () => {
    const api = new TerminalApiService({ getSnapshots: () => [] } as never);

    await expect(api.searchSnapshots('anything')).rejects.toThrow(
      /Semantic search service not available/,
    );
  });
});
