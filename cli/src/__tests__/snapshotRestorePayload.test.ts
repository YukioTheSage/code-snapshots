/* eslint-disable @typescript-eslint/no-explicit-any */
import { SnapshotCommands } from '../commands/snapshot';
import { UnifiedClient } from '../unifiedClient';
import { resetFailure } from '../exitState';

jest.mock('../unifiedClient');

/**
 * `codelapse snapshot restore <id> --backup --files a,b -y` describes four
 * things to the extension: whether to snapshot the workspace first, what to
 * restore, that the extension should not print its own notification, and that
 * the caller has already answered the unsaved-changes refusal. All four travel
 * in one `options` object (`data.options`, `cliConnectorService.ts`);
 * dropping `options.yes` left the guard armed, so `-y` could not do what
 * `--help` promises.
 *
 * The wire shape itself -- that these options stay nested under `data.options`
 * -- is asserted in `snapshotWirePayload.test.ts`, which does not mock
 * `UnifiedClient`.
 */
describe('SnapshotCommands.restore payload', () => {
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

  it('carries -y/--yes into the payload as skipConfirm', async () => {
    mockClient.callApi = jest.fn().mockResolvedValue({ success: true });

    await snapshotCommands.restore('snap-1', { yes: true, json: true });

    expect(mockClient.callApi).toHaveBeenCalledWith('restoreSnapshot', {
      id: 'snap-1',
      options: {
        createBackupSnapshot: false,
        selectedFiles: undefined,
        silent: true,
        skipConfirm: true,
      },
    });
  });

  it('leaves the guard armed without -y/--yes', async () => {
    mockClient.callApi = jest.fn().mockResolvedValue({ success: true });

    await snapshotCommands.restore('snap-1', { json: true });

    expect(mockClient.callApi).toHaveBeenCalledWith('restoreSnapshot', {
      id: 'snap-1',
      options: {
        createBackupSnapshot: false,
        selectedFiles: undefined,
        silent: true,
        skipConfirm: false,
      },
    });
  });

  it('maps --backup and --files into the restore options', async () => {
    mockClient.callApi = jest.fn().mockResolvedValue({ success: true });

    await snapshotCommands.restore('snap-1', {
      backup: true,
      files: 'a.ts, b.ts',
      json: true,
    });

    expect(mockClient.callApi).toHaveBeenCalledWith('restoreSnapshot', {
      id: 'snap-1',
      options: {
        createBackupSnapshot: true,
        selectedFiles: ['a.ts', 'b.ts'],
        silent: true,
        skipConfirm: false,
      },
    });
  });
});
