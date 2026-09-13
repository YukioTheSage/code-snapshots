import { CliConnectorService } from '../cliConnectorService';
import { TerminalApiService } from '../terminalApiService';
import * as vscode from 'vscode';

jest.mock('vscode');
jest.mock('../terminalApiService');
jest.mock('../semanticSearchService');
jest.mock('../enhancedCodeChunker', () => ({
  EnhancedCodeChunker: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../queryProcessor');
jest.mock('../resultManager');
jest.mock('../qualityMetricsCalculator');

/**
 * The IPC dispatcher is the last place `skipConfirm` can be lost on its way
 * from the CLI to the modal dialog in `SnapshotManager.deleteSnapshot`.
 *
 * The dispatcher read only `data.id` (`deleteSnapshot(data.id)`), so even a
 * correctly built CLI payload arrived at the manager with the flag stripped --
 * and `!options?.skipConfirm` then had no choice but to raise the modal. The
 * sibling `restoreSnapshot` case above it already forwarded `data.options`,
 * which is what makes this an omission rather than a design.
 *
 * The strict-boolean test matters because this flag suppresses a *destructive*
 * confirmation on an untrusted IPC payload: anything that is not a real
 * `true` must leave the dialog in place. A truthy string such as "false" would
 * otherwise silence the prompt and delete without asking.
 */
describe('CliConnectorService - deleteSnapshot confirmation flag', () => {
  let cliConnectorService: CliConnectorService;
  let mockTerminalApiService: jest.Mocked<TerminalApiService>;

  /** Drive the request dispatcher exactly as the CLI's IPC client does. */
  function dispatchDelete(data: Record<string, unknown>): Promise<any> {
    return (cliConnectorService as any).handleCliRequest({
      id: 'rm-request',
      method: 'deleteSnapshot',
      data,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();

    mockTerminalApiService = {
      deleteSnapshot: jest.fn().mockResolvedValue(true),
    } as any;

    (vscode.workspace as any) = {
      workspaceFolders: [{ uri: { fsPath: '/test/workspace' } }],
    };

    cliConnectorService = new CliConnectorService(mockTerminalApiService, {
      extension: { packageJSON: { version: '1.0.0' } },
    } as any);
  });

  afterEach(() => {
    cliConnectorService.dispose();
    jest.clearAllMocks();
  });

  it('forwards skipConfirm so the manager can skip the modal', async () => {
    const response = await dispatchDelete({ id: 'snap-1', skipConfirm: true });

    expect(response.success).toBe(true);
    expect(response.result).toBe(true);
    expect(mockTerminalApiService.deleteSnapshot).toHaveBeenCalledWith(
      'snap-1',
      { skipConfirm: true, force: false },
    );
  });

  it('keeps the modal when the caller did not ask to skip it', async () => {
    await dispatchDelete({ id: 'snap-1' });

    expect(mockTerminalApiService.deleteSnapshot).toHaveBeenCalledWith(
      'snap-1',
      { skipConfirm: false, force: false },
    );
  });

  it('fails closed when skipConfirm is present but not a boolean', async () => {
    await dispatchDelete({ id: 'snap-1', skipConfirm: 'false' });

    expect(mockTerminalApiService.deleteSnapshot).toHaveBeenCalledWith(
      'snap-1',
      { skipConfirm: false, force: false },
    );
  });

  it('forwards force only when it is a real boolean true', async () => {
    await dispatchDelete({ id: 'snap-1', force: true });

    expect(mockTerminalApiService.deleteSnapshot).toHaveBeenCalledWith(
      'snap-1',
      { skipConfirm: false, force: true },
    );

    mockTerminalApiService.deleteSnapshot.mockClear();
    await dispatchDelete({ id: 'snap-1', force: 'true' });

    expect(mockTerminalApiService.deleteSnapshot).toHaveBeenCalledWith(
      'snap-1',
      { skipConfirm: false, force: false },
    );
  });
});
