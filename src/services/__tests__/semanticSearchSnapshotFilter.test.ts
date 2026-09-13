/* eslint-disable @typescript-eslint/no-explicit-any */
import { SemanticSearchService } from '../semanticSearchService';
import { VectorDatabaseService } from '../vectorDatabaseService';

function serviceWithStore() {
  const service = new SemanticSearchService(
    {
      getSnapshots: () => [
        { id: 'snap-a', timestamp: 1 },
        { id: 'snap-b', timestamp: 2 },
      ],
      getSnapshotById: () => ({ id: 'snap-a', timestamp: 1 }),
      getSnapshotFileContentPublic: jest.fn(),
      onDidChangeSnapshots: jest.fn(),
    } as never,
    {
      hasCredentials: jest.fn().mockResolvedValue(true),
      promptForCredentials: jest.fn(),
    } as never,
    { workspaceState: { get: jest.fn(() => []), update: jest.fn() } } as never,
  );
  const searchSimilarCode = jest.fn().mockResolvedValue([]);
  (service as any).vectorDatabaseService = { searchSimilarCode };
  (service as any).embeddingService = {
    embedSearchQuery: jest.fn().mockResolvedValue([0.1, 0.2]),
  };
  return { service, searchSimilarCode };
}

describe('SemanticSearchService snapshot scope', () => {
  it('does not turn "every snapshot" into a list of ids', async () => {
    const { service, searchSimilarCode } = serviceWithStore();

    await service.searchCode({ query: 'find auth' });

    // The bug: the caller selection was replaced by every snapshot id, so a
    // hundred-snapshot workspace sent a hundred-element $in on every query.
    expect(searchSimilarCode.mock.calls[0][1].snapshotIds).toBeUndefined();
  });

  it('passes an explicit selection through unchanged', async () => {
    const { service, searchSimilarCode } = serviceWithStore();

    await service.searchCode({ query: 'find auth', snapshotIds: ['snap-b'] });

    expect(searchSimilarCode.mock.calls[0][1].snapshotIds).toEqual(['snap-b']);
  });
});

describe('the store narrows by workspace when no snapshots were selected', () => {
  it('builds a filter with the workspace scope and no snapshotId clause', async () => {
    const query = jest.fn().mockResolvedValue({ matches: [] });
    const store = new VectorDatabaseService('ws-1');
    (store as any).pineconeClient = {};
    (store as any).index = { query };

    await store.searchSimilarCode([0.1, 0.2], {});

    const filter = query.mock.calls[0][0].filter;
    // The workspace scope is what makes "every snapshot" the same set as the
    // explicit id list, which is why the list can be dropped.
    expect(filter.workspaceId).toEqual({ $eq: 'ws-1' });
    expect(filter.snapshotId).toBeUndefined();
  });
});
