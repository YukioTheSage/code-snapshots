import { VectorDatabaseService } from '../services/vectorDatabaseService';
import { SemanticSearchService } from '../services/semanticSearchService';

/**
 * Builds a service whose index is already resolved.
 *
 * `ensureInitialized()` requires *both* `pineconeClient` and `index`; setting
 * only `index` falls through to `initialize()`, which prompts for a real
 * Pinecone key. Both fields are therefore stubbed.
 */
function serviceWithIndex(index: unknown): VectorDatabaseService {
  const service = new VectorDatabaseService({} as never);
  (service as any).pineconeClient = {};
  (service as any).index = index;
  return service;
}

describe('VectorDatabaseService.deleteSnapshotVectors', () => {
  it('calls deleteMany with a snapshotId filter, not a nonexistent delete()', async () => {
    const index = {
      deleteMany: jest.fn().mockResolvedValue(undefined),
      namespace: jest.fn().mockReturnThis(),
    };
    const service = serviceWithIndex(index);

    await service.deleteSnapshotVectors('snap-a');

    // The whole argument IS the filter -- no { filter: ... } wrapper.
    // With the wrapper this call matches no vector, returns 200, and
    // deletes nothing while the test still passes.
    expect(index.deleteMany).toHaveBeenCalledWith({
      snapshotId: { $eq: 'snap-a' },
    });
  });

  it('throws a named error when the SDK has no usable delete API', async () => {
    const index = { namespace: jest.fn().mockReturnThis() };
    const service = serviceWithIndex(index);

    await expect(service.deleteSnapshotVectors('snap-a')).rejects.toThrow(
      /does not expose deleteMany/,
    );
  });

  it('propagates a store failure instead of swallowing it', async () => {
    const index = {
      deleteMany: jest.fn().mockRejectedValue(new Error('quota exceeded')),
      namespace: jest.fn().mockReturnThis(),
    };
    const service = serviceWithIndex(index);

    await expect(service.deleteSnapshotVectors('snap-a')).rejects.toThrow(
      'quota exceeded',
    );
  });
});

describe('SemanticSearchService.deleteSnapshotIndexing', () => {
  async function buildService(deleteImpl: jest.Mock) {
    const workspaceState = { get: jest.fn(() => []), update: jest.fn() };
    const service = new SemanticSearchService(
      {
        getSnapshots: () => [],
        onDidChangeSnapshots: jest.fn(),
      } as never,
      {
        hasCredentials: jest.fn().mockResolvedValue(true),
        promptForCredentials: jest.fn(),
      } as never,
      { workspaceState } as never,
    );

    // The constructor kicks off initialize() without awaiting it. Let it settle
    // so it cannot overwrite the state a test sets below.
    await new Promise((resolve) => setTimeout(resolve, 0));

    (service as any).vectorDatabaseService = {
      deleteSnapshotVectors: deleteImpl,
    };
    return { service, workspaceState };
  }

  it('keeps the snapshot marked as indexed when the store delete fails', async () => {
    const { service, workspaceState } = await buildService(
      jest.fn().mockRejectedValue(new Error('store down')),
    );
    (service as any).indexedSnapshots.add('snap-a');
    workspaceState.update.mockClear();

    await expect(service.deleteSnapshotIndexing('snap-a')).rejects.toThrow(
      'store down',
    );

    // The bug: the in-memory set was purged *before* the store call, so a
    // failed delete left the extension claiming the snapshot was de-indexed
    // while its vectors stayed searchable forever.
    expect((service as any).indexedSnapshots.has('snap-a')).toBe(true);
    expect(workspaceState.update).not.toHaveBeenCalled();
  });

  it('clears the snapshot only after the store confirms', async () => {
    const deleteVectors = jest.fn().mockResolvedValue({ purged: true });
    const { service, workspaceState } = await buildService(deleteVectors);
    (service as any).indexedSnapshots.add('snap-a');
    (service as any).processingQueue = ['snap-a', 'snap-b'];

    await service.deleteSnapshotIndexing('snap-a');

    expect(deleteVectors).toHaveBeenCalledWith('snap-a');
    expect((service as any).indexedSnapshots.has('snap-a')).toBe(false);
    expect((service as any).processingQueue).toEqual(['snap-b']);
    expect(workspaceState.update).toHaveBeenCalledWith(
      'semanticSearch.indexedSnapshots',
      [],
    );
  });
});
