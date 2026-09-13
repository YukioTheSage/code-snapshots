/* eslint-disable @typescript-eslint/no-explicit-any */
import { SearchCommands } from '../commands/search';
import { UnifiedClient } from '../unifiedClient';
import { getFailure, resetFailure } from '../exitState';

jest.mock('../unifiedClient');

describe('SearchCommands.index reporting', () => {
  let searchCommands: SearchCommands;
  let mockClient: jest.Mocked<UnifiedClient>;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    resetFailure();
    mockClient = new UnifiedClient() as unknown as jest.Mocked<UnifiedClient>;
    searchCommands = new SearchCommands(mockClient);
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

  it('propagates a failed indexing result instead of claiming success', async () => {
    mockClient.callApi = jest.fn().mockResolvedValue({
      success: false,
      snapshotsIndexed: 1,
      filesIndexed: 0,
      error: 'Failed to index 2 of 3 snapshot(s): b (boom b); c (boom c)',
      timeElapsed: 12,
    });

    // The bug: success was hardcoded true here, so a run that indexed nothing
    // still printed "Snapshots indexed successfully" and exited 0.
    await searchCommands.index({ all: true, json: true });

    const payload = printedPayload();
    expect(payload.success).toBe(false);
    expect(payload.message).toBeUndefined();
    expect(payload.error).toMatch(/2 of 3/);
    expect(getFailure()).toBe(true);
  });

  it('reports success when the extension reports success', async () => {
    mockClient.callApi = jest.fn().mockResolvedValue({
      success: true,
      snapshotsIndexed: 3,
      filesIndexed: 0,
      timeElapsed: 12,
    });

    await searchCommands.index({ all: true, json: true });

    const payload = printedPayload();
    expect(payload.success).toBe(true);
    expect(payload.message).toBe('Snapshots indexed successfully');
    expect(payload.indexing.snapshotsIndexed).toBe(3);
    expect(getFailure()).toBe(false);
  });

  it('sends no id list for a default run, so the handler indexes everything', async () => {
    mockClient.callApi = jest.fn().mockResolvedValue({
      success: true,
      snapshotsIndexed: 3,
      filesIndexed: 0,
      timeElapsed: 12,
    });

    await searchCommands.index({ json: true });

    // The default invocation used to send snapshotIds: [], which is truthy:
    // the handler took the explicit-ids branch and answered "Individual
    // snapshot indexing not supported".
    expect(mockClient.callApi).toHaveBeenCalledWith('indexSnapshots', {
      force: false,
      purgeFirst: false,
    });
    expect(printedPayload().success).toBe(true);
  });

  it('sends the ids, force and purge options it was given', async () => {
    mockClient.callApi = jest.fn().mockResolvedValue({
      success: true,
      snapshotsIndexed: 2,
      filesIndexed: 0,
      timeElapsed: 12,
    });

    await searchCommands.index({
      snapshots: 'a, b',
      force: true,
      purge: true,
      json: true,
    });

    expect(mockClient.callApi).toHaveBeenCalledWith('indexSnapshots', {
      snapshotIds: ['a', 'b'],
      force: true,
      purgeFirst: true,
    });
  });

  it('refuses --all combined with --snapshots instead of picking one silently', async () => {
    mockClient.callApi = jest.fn();

    await searchCommands.index({ all: true, snapshots: 'a', json: true });

    expect(mockClient.callApi).not.toHaveBeenCalled();
    const payload = printedPayload();
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/--all.*--snapshots|--snapshots.*--all/);
    expect(getFailure()).toBe(true);
  });
});
