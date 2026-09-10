import { SemanticSearchService } from '../services/semanticSearchService';
import { TerminalApiService } from '../services/terminalApiService';
import { CancellationError } from '../utils/cancellation';
import * as vscode from 'vscode';

function stubProgress(options: { cancelled?: boolean } = {}) {
  (vscode.window as unknown as { withProgress: jest.Mock }).withProgress =
    jest.fn(
      async (_options: unknown, task: (p: unknown, t: unknown) => unknown) =>
        task(
          { report: jest.fn() },
          {
            isCancellationRequested: options.cancelled === true,
            onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
          },
        ),
    );
}

describe('indexAllSnapshots reporting', () => {
  function buildService(snapshots: Array<{ id: string }>, failures: string[]) {
    const workspaceState = { get: jest.fn(() => []), update: jest.fn() };
    const service = new SemanticSearchService(
      {
        getSnapshots: () => snapshots,
        onDidChangeSnapshots: jest.fn(),
      } as never,
      {
        hasCredentials: jest.fn().mockResolvedValue(true),
        promptForCredentials: jest.fn(),
      } as never,
      { workspaceState } as never,
    );

    (service as unknown as { indexSnapshot: jest.Mock }).indexSnapshot =
      jest.fn(async (id: string) => {
        if (failures.includes(id)) {
          throw new Error(`boom ${id}`);
        }
      });
    return { service, workspaceState };
  }

  beforeEach(() => {
    (
      vscode.window as unknown as { showInformationMessage: jest.Mock }
    ).showInformationMessage = jest.fn();
    (
      vscode.window as unknown as { showWarningMessage: jest.Mock }
    ).showWarningMessage = jest.fn();
    (
      vscode.window as unknown as { showErrorMessage: jest.Mock }
    ).showErrorMessage = jest.fn();
    stubProgress();
  });

  it('reports only the snapshots that actually succeeded', async () => {
    const { service } = buildService(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      ['b'],
    );

    const outcome = await service.indexAllSnapshots();

    // The bug: `current` counted attempts, so the message claimed 3.
    expect(outcome.attempted).toBe(3);
    expect(outcome.succeeded).toBe(2);
    expect(outcome.failed).toEqual([
      { snapshotId: 'b', error: expect.stringContaining('boom b') },
    ]);
  });

  it('tells the user how many failed', async () => {
    const { service } = buildService([{ id: 'a' }, { id: 'b' }], ['b']);
    const show = (vscode.window as unknown as { showWarningMessage: jest.Mock })
      .showWarningMessage;

    await service.indexAllSnapshots();

    const calls = show.mock.calls;
    const message = String(calls[calls.length - 1]?.[0] ?? '');
    expect(message).toMatch(/1 of 2/);
    expect(message).not.toMatch(/Successfully indexed 2/);
  });

  it('reports an all-failed run as an error, not a success', async () => {
    const { service } = buildService([{ id: 'a' }, { id: 'b' }], ['a', 'b']);
    const showError = (
      vscode.window as unknown as { showErrorMessage: jest.Mock }
    ).showErrorMessage;
    const showInfo = (
      vscode.window as unknown as { showInformationMessage: jest.Mock }
    ).showInformationMessage;

    const outcome = await service.indexAllSnapshots();

    expect(outcome.succeeded).toBe(0);
    expect(outcome.failed).toHaveLength(2);
    expect(showError).toHaveBeenCalled();
    expect(showInfo).not.toHaveBeenCalled();
  });

  it('persists only the snapshots that succeeded', async () => {
    const { service, workspaceState } = buildService(
      [{ id: 'a' }, { id: 'b' }],
      ['b'],
    );

    await service.indexAllSnapshots();

    const calls = workspaceState.update.mock.calls;
    const persisted = calls[calls.length - 1]?.[1] as string[];
    expect(persisted).toEqual(['a']);
  });

  it('reports an empty outcome when there are no snapshots', async () => {
    const { service } = buildService([], []);

    const outcome = await service.indexAllSnapshots();

    expect(outcome).toEqual({ attempted: 0, succeeded: 0, failed: [] });
  });

  it('stops when the token is cancelled instead of indexing everything', async () => {
    const { service } = buildService(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [],
    );
    stubProgress({ cancelled: true });

    // The old code registered a listener that showed a toast but could not
    // stop the loop, so a cancelled run still ran to completion.
    await expect(service.indexAllSnapshots()).rejects.toBeInstanceOf(
      CancellationError,
    );
    expect(
      (service as unknown as { indexSnapshot: jest.Mock }).indexSnapshot,
    ).not.toHaveBeenCalled();
  });
});

describe('TerminalApiService.indexSnapshots reporting', () => {
  function apiWithOutcome(outcome: unknown) {
    const api = new TerminalApiService({
      getSnapshots: () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    } as never);
    (
      api as unknown as { semanticSearchService: unknown }
    ).semanticSearchService = {
      indexAllSnapshots: jest.fn().mockResolvedValue(outcome),
    };
    return api;
  }

  it('reports the number that actually indexed, not the total', async () => {
    const api = apiWithOutcome({
      attempted: 3,
      succeeded: 1,
      failed: [
        { snapshotId: 'b', error: 'boom b' },
        { snapshotId: 'c', error: 'boom c' },
      ],
    });

    const result = await api.indexSnapshots();

    // The bug: success true and snapshotsIndexed = total snapshots (3),
    // regardless of how many failed.
    expect(result.success).toBe(false);
    expect(result.snapshotsIndexed).toBe(1);
    expect(result.error).toMatch(/2 of 3/);
    expect(result.error).toMatch(/boom b/);
  });

  it('reports success with the indexed count when nothing failed', async () => {
    const api = apiWithOutcome({ attempted: 3, succeeded: 3, failed: [] });

    const result = await api.indexSnapshots();

    expect(result.success).toBe(true);
    expect(result.snapshotsIndexed).toBe(3);
    expect(result.error).toBeUndefined();
  });
});
