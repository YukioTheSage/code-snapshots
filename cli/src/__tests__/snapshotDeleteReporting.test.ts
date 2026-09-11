/* eslint-disable @typescript-eslint/no-explicit-any */
import { SnapshotCommands } from '../commands/snapshot';
import { UnifiedClient } from '../unifiedClient';
import { getFailure, resetFailure } from '../exitState';

jest.mock('../unifiedClient');

/**
 * `delete` printed a hardcoded `success: true` and the message "deleted
 * successfully" whatever the extension answered -- the payload was built from
 * a literal, not from `result`. `deleteSnapshot` reports a refusal by
 * *returning* `false` rather than throwing (`SnapshotManager.deleteSnapshot`
 * returns false for an unknown id and for a confirmation the user declined),
 * so a shell wrapper saw exit 0 and a success line for a snapshot that is
 * still there.
 *
 * Shape of `result`, verified against `CodeLapseClient.handleMessage`: the IPC
 * client unwraps the connector's envelope and resolves `message.result`, so a
 * refused delete arrives as the bare boolean `false`, and a server-side
 * failure (`{success: false, error}`) rejects and is handled by the catch.
 * Standalone mode returns nothing at all -- `UnifiedClient.deleteSnapshot` is
 * `Promise<void>` and the core throws for an unknown id.
 */
describe('SnapshotCommands.delete reporting', () => {
  let snapshotCommands: SnapshotCommands;
  let mockClient: jest.Mocked<UnifiedClient>;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    resetFailure();
    mockClient = new UnifiedClient() as unknown as jest.Mocked<UnifiedClient>;
    snapshotCommands = new SnapshotCommands(mockClient);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    resetFailure();
    jest.clearAllMocks();
  });

  function printedPayload(): any {
    const calls = consoleSpy.mock.calls;
    return JSON.parse(String(calls[calls.length - 1]?.[0] ?? '{}'));
  }

  it('reports failure when the snapshot was not deleted', async () => {
    mockClient.callApi = jest.fn().mockResolvedValue(false);

    await snapshotCommands.delete('snap-missing', { json: true });

    const payload = printedPayload();
    expect(payload.success).toBe(false);
    expect(payload.message).toBeUndefined();
    expect(payload.error).toMatch(/not deleted/i);
    expect(getFailure()).toBe(true);
  });

  it('reports success when the snapshot was deleted', async () => {
    mockClient.callApi = jest.fn().mockResolvedValue(true);

    await snapshotCommands.delete('snap-1', { json: true });

    const payload = printedPayload();
    expect(payload.success).toBe(true);
    expect(payload.message).toBe('Snapshot snap-1 deleted successfully');
    expect(getFailure()).toBe(false);
  });

  it('still reports success in standalone mode, which returns nothing', async () => {
    // Not a RED test: this pins behaviour the fix must not change. Standalone
    // `deleteSnapshot` resolves `undefined`, so a fix written as `if (!result)`
    // would report failure for every successful standalone delete.
    mockClient.callApi = jest.fn().mockResolvedValue(undefined);

    await snapshotCommands.delete('snap-1', { json: true });

    const payload = printedPayload();
    expect(payload.success).toBe(true);
    expect(getFailure()).toBe(false);
  });
});
