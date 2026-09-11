/* eslint-disable @typescript-eslint/no-explicit-any */
import { SnapshotCommands } from '../commands/snapshot';
import { UnifiedClient } from '../unifiedClient';
import { resetFailure } from '../exitState';

jest.mock('../unifiedClient');

/**
 * `codelapse snap rm <id> -y` promises, in `--help`, to skip the confirmation.
 *
 * It did not. `snapshotCmd.command('delete <id>')` declares `-y, --yes`, so
 * commander populated `options.yes`, but `SnapshotCommands.delete` built its
 * payload as `{ id }` and dropped the flag. The extension gates its modal
 * dialog on `options.skipConfirm` (`snapshotManager.deleteSnapshot`), so it
 * never learned the caller had already confirmed, and the popup appeared even
 * with `-y`.
 *
 * These tests assert the payload that crosses the process boundary, which is
 * where the flag was lost. `snapshotManager`'s side of the contract -- that
 * `skipConfirm: true` really does suppress the dialog -- is covered by the
 * integration suites (`test/suite/apiHooks.test.ts`, `treeViews.test.ts`),
 * which pass the flag through the real extension API.
 */
describe('SnapshotCommands.delete confirmation flag', () => {
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

  it('sends skipConfirm when -y/--yes is passed', async () => {
    mockClient.callApi = jest.fn().mockResolvedValue({ success: true });

    await snapshotCommands.delete('snap-1', { yes: true, json: true });

    expect(mockClient.callApi).toHaveBeenCalledWith('deleteSnapshot', {
      id: 'snap-1',
      skipConfirm: true,
      force: false,
    });
  });

  it('does not suppress the confirmation without -y/--yes', async () => {
    mockClient.callApi = jest.fn().mockResolvedValue({ success: true });

    await snapshotCommands.delete('snap-1', { json: true });

    expect(mockClient.callApi).toHaveBeenCalledWith('deleteSnapshot', {
      id: 'snap-1',
      skipConfirm: false,
      force: false,
    });
  });

  it('forwards explicit --force to the delete payload', async () => {
    mockClient.callApi = jest.fn().mockResolvedValue({ success: true });

    await snapshotCommands.delete('snap-1', {
      yes: true,
      force: true,
      json: true,
    });

    expect(mockClient.callApi).toHaveBeenCalledWith('deleteSnapshot', {
      id: 'snap-1',
      skipConfirm: true,
      force: true,
    });
  });
});
