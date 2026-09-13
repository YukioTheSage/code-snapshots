import { SemanticSearchService } from '../semanticSearchService';
import * as vscode from 'vscode';

/** `indexAllSnapshots` reports progress; the test resolves it immediately. */
function stubProgress(): void {
  (vscode.window as unknown as { withProgress: jest.Mock }).withProgress =
    jest.fn(
      async (_options: unknown, task: (p: unknown, t: unknown) => unknown) =>
        task(
          { report: jest.fn() },
          {
            isCancellationRequested: false,
            onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
          },
        ),
    );
}

function buildService() {
  const workspaceState = { get: jest.fn(() => []), update: jest.fn() };
  const files: Record<string, { deleted: boolean; isBinary: boolean }> = {
    'src/a.ts': { deleted: false, isBinary: false },
    'src/b.ts': { deleted: false, isBinary: false },
  };
  const snapshot = { id: 'snap-1', timestamp: 1, description: 's', files };

  const snapshotManager = {
    getSnapshots: () => [{ id: 'snap-1', timestamp: 1 }],
    getSnapshotById: (id: string) => (id === 'snap-1' ? snapshot : undefined),
    getSnapshotFileContentPublic: jest.fn(
      async (_id: string, filePath: string) => {
        if (filePath === 'src/b.ts') {
          throw new Error('snapshot file unreadable');
        }
        return 'export const a = 1;';
      },
    ),
    onDidChangeSnapshots: jest.fn(),
  };

  const service = new SemanticSearchService(
    snapshotManager as never,
    {
      hasCredentials: jest.fn().mockResolvedValue(true),
      promptForCredentials: jest.fn(),
    } as never,
    { workspaceState } as never,
  );

  const upsertVectors = jest.fn().mockResolvedValue(undefined);
  (service as unknown as { codeChunker: unknown }).codeChunker = {
    chunkFile: jest.fn(async (filePath: string) => [
      {
        id: `chunk-${filePath}`,
        content: 'export const a = 1;',
        filePath,
        startLine: 0,
        endLine: 0,
        snapshotId: 'snap-1',
        metadata: { language: 'typescript' },
      },
    ]),
  };
  (service as unknown as { embeddingService: unknown }).embeddingService = {
    embedCodeChunks: jest.fn().mockResolvedValue(new Map()),
  };
  (
    service as unknown as { vectorDatabaseService: unknown }
  ).vectorDatabaseService = { upsertVectors };

  return { service, workspaceState, upsertVectors };
}

describe('indexing a snapshot where one file fails', () => {
  beforeEach(() => {
    stubProgress();
  });

  it('does not write vectors or mark the snapshot indexed', async () => {
    const { service, workspaceState, upsertVectors } = buildService();

    const outcome = await service.indexAllSnapshots({
      snapshotIds: ['snap-1'],
    });

    // `upsertVectors` deletes the snapshot's existing vectors before writing
    // the first batch (Task 11). Dropping the unreadable file and continuing
    // would leave the store holding only the readable file's chunks while the
    // caller recorded the snapshot as indexed.
    expect(upsertVectors).not.toHaveBeenCalled();
    expect(outcome.failed).toEqual([
      { snapshotId: 'snap-1', error: expect.stringContaining('src/b.ts') },
    ]);
    expect(
      (
        service as unknown as { indexedSnapshots: Set<string> }
      ).indexedSnapshots.has('snap-1'),
    ).toBe(false);

    const persisted = workspaceState.update.mock.calls.filter(
      (call: unknown[]) => call[0] === 'semanticSearch.indexedSnapshots',
    );
    for (const call of persisted) {
      expect(call[1]).not.toContain('snap-1');
    }
  });
});
