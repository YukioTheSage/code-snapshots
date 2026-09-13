/* eslint-disable @typescript-eslint/no-explicit-any */
import { SnapshotCommands } from '../commands/snapshot';
import { UnifiedClient } from '../unifiedClient';
import { getFailure, resetFailure } from '../exitState';

jest.mock('../unifiedClient');

describe('SnapshotCommands.create reporting', () => {
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

  it('reports a refusal instead of claiming a snapshot was created', async () => {
    mockClient.callApi = jest.fn().mockResolvedValue({
      success: false,
      noChanges: true,
      error:
        'Nothing to snapshot: the workspace is unchanged since the previous snapshot.',
    });

    // The bug: this printed `success: true` with a summary built from
    // `result.snapshot`, which is undefined when the extension refused.
    await snapshotCommands.create('no-op', { json: true });

    const payload = printedPayload();
    expect(payload.success).toBe(false);
    expect(payload.message).toBeUndefined();
    expect(payload.error).toMatch(/unchanged/i);
    expect(getFailure()).toBe(true);
  });

  it('reports success with the created snapshot', async () => {
    mockClient.callApi = jest.fn().mockResolvedValue({
      success: true,
      snapshot: { id: 'snap-1', description: 'first', timestamp: 5 },
    });

    await snapshotCommands.create('first', { json: true });

    const payload = printedPayload();
    expect(payload.success).toBe(true);
    expect(payload.snapshot.id).toBe('snap-1');
    expect(getFailure()).toBe(false);
  });
});
