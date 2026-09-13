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
 * The IPC dispatcher is the last place the CLI's index options can be lost on
 * their way from `codelapse search index` to the API service.
 *
 * The default invocation used to send `snapshotIds: []`, which is truthy, so
 * the API service took its explicit-ids branch and answered "Individual
 * snapshot indexing not supported" -- the command could never succeed.
 * Forwarding `data.snapshotIds ?? []` again would reintroduce exactly that
 * shape, and dropping `force` or `purgeFirst` would silently turn a re-index
 * into a skip, so all three are pinned here rather than at either end of the
 * wire.
 *
 * The strict-boolean assertions matter because this is untrusted IPC payload:
 * anything that is not a real `true` must not force a re-index or delete a
 * snapshot's vectors.
 */
describe('CliConnectorService - indexSnapshots options', () => {
  let cliConnectorService: CliConnectorService;
  let mockTerminalApiService: jest.Mocked<TerminalApiService>;

  /** Drive the request dispatcher exactly as the CLI's IPC client does. */
  function dispatchIndex(data: Record<string, unknown>): Promise<unknown> {
    return (
      cliConnectorService as unknown as {
        handleCliRequest(message: unknown): Promise<unknown>;
      }
    ).handleCliRequest({
      id: 'index-request',
      method: 'indexSnapshots',
      data,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();

    mockTerminalApiService = {
      indexSnapshots: jest.fn().mockResolvedValue({
        success: true,
        snapshotsIndexed: 0,
        filesIndexed: 0,
        timeElapsed: 0,
      }),
    } as unknown as jest.Mocked<TerminalApiService>;

    (vscode as unknown as { workspace?: unknown }).workspace = {
      workspaceFolders: [{ uri: { fsPath: '/test/workspace' } }],
      // The constructor stores a chunker-settings listener; a wholesale
      // workspace replacement must expose the API it registers.
      onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
    };

    cliConnectorService = new CliConnectorService(mockTerminalApiService, {
      extension: { packageJSON: { version: '1.0.0' } },
    } as never);
  });

  afterEach(() => {
    cliConnectorService.dispose();
    jest.clearAllMocks();
  });

  it('forwards the ids, force and purge the CLI sent', async () => {
    await dispatchIndex({
      snapshotIds: ['a', 'b'],
      force: true,
      purgeFirst: true,
    });

    expect(mockTerminalApiService.indexSnapshots).toHaveBeenCalledWith({
      snapshotIds: ['a', 'b'],
      force: true,
      purgeFirst: true,
    });
  });

  it('sends no id list and nothing forced for a plain run', async () => {
    await dispatchIndex({});

    // Absent ids mean every snapshot. An empty array here is the regression:
    // [] is truthy and made the default invocation fail.
    expect(mockTerminalApiService.indexSnapshots).toHaveBeenCalledWith({
      snapshotIds: undefined,
      force: false,
      purgeFirst: false,
    });
  });

  it('does not honour truthy non-boolean force or purge values', async () => {
    await dispatchIndex({ snapshotIds: ['a'], force: 'true', purgeFirst: 1 });

    expect(mockTerminalApiService.indexSnapshots).toHaveBeenCalledWith({
      snapshotIds: ['a'],
      force: false,
      purgeFirst: false,
    });
  });
});
