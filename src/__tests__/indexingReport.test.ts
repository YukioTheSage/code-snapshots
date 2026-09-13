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

  it('indexes every snapshot when the id list is empty', async () => {
    const { service } = buildService([{ id: 'a' }, { id: 'b' }], []);

    const outcome = await service.indexAllSnapshots({ snapshotIds: [] });

    // The CLI's default invocation sent [], which is truthy, so the handler
    // answered "Individual snapshot indexing not supported" and the command
    // could never succeed.
    expect(outcome.attempted).toBe(2);
    expect(outcome.succeeded).toBe(2);
    expect(
      (service as unknown as { indexSnapshot: jest.Mock }).indexSnapshot,
    ).toHaveBeenCalledTimes(2);
  });

  it('indexes exactly the requested ids', async () => {
    const { service } = buildService([{ id: 'a' }, { id: 'b' }], []);

    const outcome = await service.indexAllSnapshots({ snapshotIds: ['b'] });

    expect(outcome.attempted).toBe(1);
    expect(outcome.succeeded).toBe(1);
    expect(
      (service as unknown as { indexSnapshot: jest.Mock }).indexSnapshot,
    ).toHaveBeenCalledWith('b');
  });

  it('reports a requested id that does not exist instead of indexing nothing silently', async () => {
    const { service } = buildService([{ id: 'a' }], []);

    const outcome = await service.indexAllSnapshots({
      snapshotIds: ['missing'],
    });

    expect(outcome.succeeded).toBe(0);
    expect(outcome.failed).toEqual([
      {
        snapshotId: 'missing',
        error: expect.stringMatching(/not found/i),
      },
    ]);
  });

  it('re-indexes an already indexed snapshot when force is set', async () => {
    const { service } = buildService([{ id: 'a' }], []);
    (
      service as unknown as { indexedSnapshots: Set<string> }
    ).indexedSnapshots.add('a');

    const outcome = await service.indexAllSnapshots({ force: true });

    expect(outcome.succeeded).toBe(1);
    expect(
      (service as unknown as { indexSnapshot: jest.Mock }).indexSnapshot,
    ).toHaveBeenCalledWith('a');
  });

  it('purges a snapshot before re-indexing it when purgeFirst is set', async () => {
    const { service } = buildService([{ id: 'a' }], []);
    const order: string[] = [];
    const deleteSnapshotVectors = jest.fn(async () => {
      order.push('purge');
    });
    (
      service as unknown as { vectorDatabaseService: unknown }
    ).vectorDatabaseService = { deleteSnapshotVectors };
    (service as unknown as { indexSnapshot: jest.Mock }).indexSnapshot =
      jest.fn(async () => {
        order.push('index');
      });

    await service.indexAllSnapshots({ purgeFirst: true });

    // A re-index without the purge mixes the old and the new chunk id sets.
    expect(order).toEqual(['purge', 'index']);
    expect(deleteSnapshotVectors).toHaveBeenCalledWith('a');
  });

  it('forgets a purge-first snapshot whose re-index failed, so a later run retries it', async () => {
    const { service, workspaceState } = buildService([{ id: 'a' }], []);
    (
      service as unknown as { indexedSnapshots: Set<string> }
    ).indexedSnapshots.add('a');
    const deleteSnapshotVectors = jest.fn(async () => undefined);
    (
      service as unknown as { vectorDatabaseService: unknown }
    ).vectorDatabaseService = { deleteSnapshotVectors };
    (service as unknown as { indexSnapshot: jest.Mock }).indexSnapshot =
      jest.fn(async () => {
        throw new Error('boom a');
      });

    const first = await service.indexAllSnapshots({
      force: true,
      purgeFirst: true,
    });

    // The purge removed the vectors while the persisted set still claimed the
    // snapshot was indexed: every later selection would skip it and report
    // 'already indexed' over an empty store.
    expect(deleteSnapshotVectors).toHaveBeenCalledWith('a');
    expect(first.failed).toEqual([
      { snapshotId: 'a', error: expect.stringContaining('boom a') },
    ]);
    expect(workspaceState.update).toHaveBeenCalledWith(
      'semanticSearch.indexedSnapshots',
      [],
    );

    (service as unknown as { indexSnapshot: jest.Mock }).indexSnapshot =
      jest.fn(async () => undefined);
    const retried = await service.indexAllSnapshots();

    expect(retried.succeeded).toBe(1);
    expect(
      (service as unknown as { indexSnapshot: jest.Mock }).indexSnapshot,
    ).toHaveBeenCalledWith('a');
  });

  it('keeps the indexed mark when the purge itself failed', async () => {
    const { service } = buildService([{ id: 'a' }], []);
    (
      service as unknown as { indexedSnapshots: Set<string> }
    ).indexedSnapshots.add('a');
    (
      service as unknown as { vectorDatabaseService: unknown }
    ).vectorDatabaseService = {
      deleteSnapshotVectors: jest.fn(async () => {
        throw new Error('purge failed');
      }),
    };
    const indexSnapshot = jest.fn(async () => undefined);
    (service as unknown as { indexSnapshot: jest.Mock }).indexSnapshot =
      indexSnapshot;

    const outcome = await service.indexAllSnapshots({
      force: true,
      purgeFirst: true,
    });

    // The delete never completed, so the old vectors are still in the store:
    // the snapshot really is still indexed and the mark must survive.
    expect(outcome.failed).toEqual([
      { snapshotId: 'a', error: expect.stringContaining('purge failed') },
    ]);
    expect(
      (
        service as unknown as { indexedSnapshots: Set<string> }
      ).indexedSnapshots.has('a'),
    ).toBe(true);
    expect(indexSnapshot).not.toHaveBeenCalled();
  });

  it('numbers progress by processed snapshots, not by attempts including missing ids', async () => {
    const { service } = buildService([{ id: 'a' }], []);
    const messages: string[] = [];
    (vscode.window as unknown as { withProgress: jest.Mock }).withProgress =
      jest.fn(
        async (_options: unknown, task: (p: unknown, t: unknown) => unknown) =>
          task(
            {
              report: (value: { message?: string }) => {
                if (value?.message) {
                  messages.push(value.message);
                }
              },
            },
            {
              isCancellationRequested: false,
              onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
            },
          ),
      );

    const outcome = await service.indexAllSnapshots({
      snapshotIds: ['a', 'missing'],
    });

    // The missing id counts as attempted, but the toast must never claim to be
    // processing snapshot 2 of 1.
    expect(outcome.attempted).toBe(2);
    expect(outcome.failed).toEqual([
      { snapshotId: 'missing', error: expect.stringMatching(/not found/i) },
    ]);
    expect(messages).toEqual(['Processing snapshot 1 of 1']);
  });

  it('does not let a failing corrective persist abort the remaining snapshots', async () => {
    const { service, workspaceState } = buildService(
      [{ id: 'a' }, { id: 'b' }],
      ['a'],
    );
    (
      service as unknown as { vectorDatabaseService: unknown }
    ).vectorDatabaseService = {
      deleteSnapshotVectors: jest.fn(async () => undefined),
    };
    // With purgeFirst the purge resolves before the index fails, so the catch
    // rewrites the persisted set. That corrective write is the first update and
    // the success-path persist for 'b' is the second.
    workspaceState.update = jest
      .fn()
      .mockRejectedValueOnce(new Error('persist failed'))
      .mockResolvedValue(undefined);

    const outcome = await service.indexAllSnapshots({ purgeFirst: true });

    // A persist that cannot be corrected is a reason to log, not to abandon the
    // run: the throw used to escape the catch and abort every remaining
    // snapshot, losing the failure report for the ones that did run.
    expect(
      (service as unknown as { indexSnapshot: jest.Mock }).indexSnapshot,
    ).toHaveBeenCalledWith('b');
    expect(outcome.attempted).toBe(2);
    expect(outcome.succeeded).toBe(1);
    expect(outcome.failed).toEqual([
      { snapshotId: 'a', error: expect.stringContaining('boom a') },
    ]);
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

  it('treats an empty id list as every snapshot', async () => {
    const api = new TerminalApiService({
      getSnapshots: () => [{ id: 'a' }, { id: 'b' }],
    } as never);
    const indexAllSnapshots = jest.fn().mockResolvedValue({
      attempted: 2,
      succeeded: 2,
      failed: [],
    });
    (
      api as unknown as { semanticSearchService: unknown }
    ).semanticSearchService = { indexAllSnapshots };

    const result = await api.indexSnapshots({ snapshotIds: [] });

    // The regression: [] used to take the explicit-ids branch and answer
    // "Individual snapshot indexing not supported".
    expect(indexAllSnapshots).toHaveBeenCalledWith({
      snapshotIds: [],
      force: false,
      purgeFirst: false,
    });
    expect(result.success).toBe(true);
    expect(result.snapshotsIndexed).toBe(2);
  });

  it('forwards explicit ids, force and purgeFirst', async () => {
    const api = new TerminalApiService({
      getSnapshots: () => [{ id: 'a' }, { id: 'b' }],
    } as never);
    const indexAllSnapshots = jest.fn().mockResolvedValue({
      attempted: 1,
      succeeded: 1,
      failed: [],
    });
    (
      api as unknown as { semanticSearchService: unknown }
    ).semanticSearchService = { indexAllSnapshots };

    await api.indexSnapshots({
      snapshotIds: ['a'],
      force: true,
      purgeFirst: true,
    });

    expect(indexAllSnapshots).toHaveBeenCalledWith({
      snapshotIds: ['a'],
      force: true,
      purgeFirst: true,
    });
  });

  it.each([
    ['a string', 'a'],
    ['an object', { ids: ['a'] }],
    ['null', null],
    ['a non-string element', ['a', 5]],
    ['a blank string element', ['']],
    ['a whitespace-only element', ['  ']],
  ])(
    'refuses %s as snapshotIds with a clean error',
    async (_label, snapshotIds) => {
      const api = new TerminalApiService({} as never);
      const indexAllSnapshots = jest.fn();
      (
        api as unknown as { semanticSearchService: unknown }
      ).semanticSearchService = { indexAllSnapshots };

      const result = await api.indexSnapshots({
        snapshotIds: snapshotIds as unknown as string[],
      });

      // An untyped payload from 'codelapse api' must not surface an internal
      // expression, and must not degrade to 'every snapshot' either.
      expect(indexAllSnapshots).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toBe('snapshotIds must be an array of strings');
    },
  );

  it('reports the real elapsed time when the run throws', async () => {
    const api = new TerminalApiService({} as never);
    (
      api as unknown as { semanticSearchService: unknown }
    ).semanticSearchService = {
      indexAllSnapshots: jest
        .fn()
        .mockRejectedValue(new Error('no credentials')),
    };
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValueOnce(1000).mockReturnValueOnce(1420);

    const result = await api.indexSnapshots();

    now.mockRestore();
    expect(result.success).toBe(false);
    expect(result.error).toBe('no credentials');
    expect(result.timeElapsed).toBe(420);
  });
});
