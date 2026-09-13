/* eslint-disable @typescript-eslint/no-explicit-any */
import { VectorDatabaseService } from '../vectorDatabaseService';
import { SemanticSearchService } from '../semanticSearchService';

jest.mock('@pinecone-database/pinecone', () => ({
  Pinecone: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Pinecone } = require('@pinecone-database/pinecone') as {
  Pinecone: jest.Mock;
};

interface CredentialsDouble {
  getPineconeApiKey: jest.Mock;
  promptForCredentials: jest.Mock;
  hasCredentials: jest.Mock;
  getGeminiApiKey: jest.Mock;
}

function credentialsDouble(apiKey: string | undefined): CredentialsDouble {
  return {
    getPineconeApiKey: jest.fn().mockResolvedValue(apiKey),
    promptForCredentials: jest.fn(),
    hasCredentials: jest.fn().mockResolvedValue(apiKey !== undefined),
    getGeminiApiKey: jest.fn(),
  };
}

describe('deleteSnapshotVectors does not initialize', () => {
  beforeEach(() => {
    Pinecone.mockReset();
  });

  it('skips the purge instead of prompting when no key is stored', async () => {
    const credentials = credentialsDouble(undefined);
    const service = new VectorDatabaseService(credentials as never, 'ws-1');

    const outcome = await service.deleteSnapshotVectors('snap-a');

    // Before the fix this awaited ensureInitialized -> initialize, which raised
    // a modal credential prompt for a delete and, headlessly, never settled.
    expect(outcome).toEqual({
      purged: false,
      skippedReason: 'no-credentials',
    });
    expect(credentials.promptForCredentials).not.toHaveBeenCalled();
    expect(Pinecone).not.toHaveBeenCalled();
  });

  it('attaches to an existing index and deletes without creating anything', async () => {
    const deleteMany = jest.fn().mockResolvedValue(undefined);
    const listIndexes = jest.fn().mockResolvedValue({
      indexes: [{ name: 'codelapse-snapshots' }],
    });
    const createIndex = jest.fn();
    Pinecone.mockImplementation(() => ({
      listIndexes,
      createIndex,
      Index: jest.fn(() => ({ deleteMany })),
    }));
    const credentials = credentialsDouble('stored-key');
    const service = new VectorDatabaseService(credentials as never, 'ws-1');

    const outcome = await service.deleteSnapshotVectors('snap-a');

    expect(outcome).toEqual({ purged: true });
    expect(createIndex).not.toHaveBeenCalled();
    expect(listIndexes).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ snapshotId: { $eq: 'snap-a' } });
  });

  it('skips and reports when the index does not exist', async () => {
    const createIndex = jest.fn();
    Pinecone.mockImplementation(() => ({
      listIndexes: jest.fn().mockResolvedValue({ indexes: [] }),
      createIndex,
      Index: jest.fn(),
    }));
    const credentials = credentialsDouble('stored-key');
    const service = new VectorDatabaseService(credentials as never, 'ws-1');

    const outcome = await service.deleteSnapshotVectors('snap-a');

    // A stored key with no index means there is nothing to purge. Creating the
    // index here provisioned a cloud resource in order to delete.
    expect(outcome).toEqual({
      purged: false,
      skippedReason: 'index-not-found',
    });
    expect(createIndex).not.toHaveBeenCalled();
  });

  it('does not prompt on the purge a snapshot delete triggers', async () => {
    const credentials = credentialsDouble(undefined);
    const workspaceState = { get: jest.fn(() => []), update: jest.fn() };
    const service = new SemanticSearchService(
      { getSnapshots: () => [], onDidChangeSnapshots: jest.fn() } as never,
      credentials as never,
      { workspaceState } as never,
    );
    // The constructor kicks off initialize() without awaiting it; let it settle
    // before the private field is replaced.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The real store service, wired to the same credentials double: this is the
    // object the delete path actually calls.
    (service as any).vectorDatabaseService = new VectorDatabaseService(
      credentials as never,
      'ws-1',
    );

    await service.deleteSnapshotIndexing('snap-a');

    expect(credentials.promptForCredentials).not.toHaveBeenCalled();
    // Bookkeeping still proceeds: nothing was purged, and the log says so.
    expect(workspaceState.update).toHaveBeenCalledWith(
      'semanticSearch.indexedSnapshots',
      [],
    );
  });
});
