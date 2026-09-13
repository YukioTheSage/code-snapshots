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
    // The storage layer answers null for its own error states -- resolution
    // depth or a cycle, a missing base, a failed patch, an unexpected state --
    // so this file is unreadable, not empty.
    'src/c.ts': { deleted: false, isBinary: false },
  };
  const snapshot = { id: 'snap-1', timestamp: 1, description: 's', files };

  const snapshotManager = {
    getSnapshots: () => [{ id: 'snap-1', timestamp: 1 }],
    getSnapshotById: (id: string) => (id === 'snap-1' ? snapshot : undefined),
    getSnapshotFileContentPublic: jest.fn(
      async (_id: string, filePath: string): Promise<string | null> => {
        if (filePath === 'src/b.ts') {
          throw new Error('snapshot file unreadable');
        }
        if (filePath === 'src/c.ts') {
          return null;
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
  const deleteSnapshotVectors = jest
    .fn()
    .mockResolvedValue({ purged: true, skippedReason: 'none' });
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
  ).vectorDatabaseService = { upsertVectors, deleteSnapshotVectors };

  return { service, workspaceState, upsertVectors, deleteSnapshotVectors };
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
    // the first batch (Task 11). Dropping the unreadable files and continuing
    // would leave the store holding only the readable file's chunks while the
    // caller recorded the snapshot as indexed.
    expect(upsertVectors).not.toHaveBeenCalled();
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0].error).toContain('src/b.ts');
    // A null answer from the storage layer is "could not reconstruct", not
    // "nothing to index": it must fail the snapshot like the throw does.
    expect(outcome.failed[0].error).toContain('src/c.ts');
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

  it('does not promise intact vectors when a purge-first run deleted them', async () => {
    const { service, deleteSnapshotVectors, upsertVectors } = buildService();

    const outcome = await service.indexAllSnapshots({
      snapshotIds: ['snap-1'],
      purgeFirst: true,
    });

    // The explicit purge runs before the files are read, so the previous
    // vectors are already gone by the time the refusal is built.
    expect(deleteSnapshotVectors).toHaveBeenCalledWith('snap-1');
    expect(upsertVectors).not.toHaveBeenCalled();
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0].error).not.toMatch(/vectors are intact/i);
    expect(outcome.failed[0].error).toMatch(/may already be gone/i);
  });
});
