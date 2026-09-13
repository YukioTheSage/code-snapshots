/* eslint-disable @typescript-eslint/no-explicit-any */
import { SemanticSearchService } from '../semanticSearchService';
import * as vscode from 'vscode';

interface Harness {
  service: SemanticSearchService;
  workspaceState: { get: jest.Mock; update: jest.Mock };
  snapshotChangeDispose: jest.Mock;
}

function buildService(options: {
  hasCredentials: boolean;
  snapshots?: Array<{ id: string }>;
}): Harness {
  const workspaceState = { get: jest.fn(() => []), update: jest.fn() };
  const snapshotChangeDispose = jest.fn();
  const service = new SemanticSearchService(
    {
      getSnapshots: () => options.snapshots ?? [{ id: 'snap-a' }],
      onDidChangeSnapshots: jest.fn(() => ({ dispose: snapshotChangeDispose })),
    } as never,
    {
      hasCredentials: jest.fn().mockResolvedValue(options.hasCredentials),
      promptForCredentials: jest.fn(),
    } as never,
    { workspaceState } as never,
  );
  return { service, workspaceState, snapshotChangeDispose };
}

/** `handleSnapshotChanges` reads auto-index first and returns when it is off. */
function enableAutoIndex(): void {
  (
    vscode.workspace as unknown as { getConfiguration: jest.Mock }
  ).getConfiguration = jest.fn(() => ({
    get: (key: string, fallback?: unknown) =>
      key === 'semanticSearch.autoIndex' ? true : fallback,
  }));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SemanticSearchService indexing queue', () => {
  beforeEach(() => {
    enableAutoIndex();
  });

  it('keeps a snapshot in the queue when credentials are missing', async () => {
    const { service, workspaceState } = buildService({ hasCredentials: false });
    (service as any).processingQueue = ['snap-a'];

    await (service as any).processNextSnapshot();

    // The bug: the id was shifted off the queue and then dropped, so this
    // snapshot was never indexed in this session.
    expect((service as any).processingQueue).toEqual(['snap-a']);
    expect((service as any).isProcessing).toBe(false);
    expect(workspaceState.update).not.toHaveBeenCalled();
  });

  it('does not enqueue the same snapshot twice', async () => {
    const { service } = buildService({ hasCredentials: false });

    (service as any).handleSnapshotChanges();
    await flush();
    (service as any).handleSnapshotChanges();
    await flush();

    // Every change event re-lists the snapshots that are not indexed yet, so
    // an undeduplicated push put the same id in the queue once per save.
    expect((service as any).processingQueue).toEqual(['snap-a']);
  });

  it('does not enqueue a snapshot that is already being indexed', async () => {
    const { service } = buildService({ hasCredentials: true });
    const releaseIndex: Array<() => void> = [];
    const indexSnapshot = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseIndex.push(resolve);
        }),
    );
    (service as any).indexSnapshot = indexSnapshot;

    (service as any).handleSnapshotChanges();
    await flush();

    // A save lands while the snapshot is mid-index: it has left the queue but
    // is not in indexedSnapshots yet, so the dedupe must still know about it.
    (service as any).handleSnapshotChanges();
    releaseIndex.shift()?.();
    await flush();

    expect(indexSnapshot).toHaveBeenCalledTimes(1);
    expect((service as any).processingQueue).toEqual([]);
  });

  it('stops the chain and releases the subscription after dispose', async () => {
    const { service, workspaceState, snapshotChangeDispose } = buildService({
      hasCredentials: true,
    });
    const indexSnapshot = jest.fn().mockResolvedValue(undefined);
    (service as any).indexSnapshot = indexSnapshot;
    await flush();

    service.dispose();
    (service as any).processingQueue = ['snap-a'];
    await (service as any).processNextSnapshot();

    expect(indexSnapshot).not.toHaveBeenCalled();
    expect(workspaceState.update).not.toHaveBeenCalled();
    expect(snapshotChangeDispose).toHaveBeenCalled();
  });

  it('ignores snapshot changes after dispose', async () => {
    const { service } = buildService({ hasCredentials: true });
    await flush();

    service.dispose();
    (service as any).handleSnapshotChanges();

    expect((service as any).processingQueue).toEqual([]);
  });

  it('does not write workspace state from a delete after dispose', async () => {
    const { service, workspaceState } = buildService({ hasCredentials: true });
    (service as any).vectorDatabaseService = {
      deleteSnapshotVectors: jest
        .fn()
        .mockResolvedValue({ purged: false, skippedReason: 'no-credentials' }),
    };
    await flush();

    service.dispose();
    await service.deleteSnapshotIndexing('snap-a');

    expect(workspaceState.update).not.toHaveBeenCalled();
  });

  it('does not write workspace state from the purge-failure correction after dispose', async () => {
    const { service, workspaceState } = buildService({ hasCredentials: true });
    (service as any).vectorDatabaseService = {
      deleteSnapshotVectors: jest.fn().mockResolvedValue({ purged: true }),
    };
    (service as any).indexSnapshot = jest
      .fn()
      .mockRejectedValue(new Error('boom'));
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
    await flush();

    service.dispose();
    const outcome = await service.indexAllSnapshots({
      snapshotIds: ['snap-a'],
      force: true,
      purgeFirst: true,
    });

    // The purge really happened, so the correction path runs and forgets the
    // mark -- but a disposed service must not write that correction to state.
    expect(outcome.failed).toHaveLength(1);
    expect(workspaceState.update).not.toHaveBeenCalled();
  });
});
