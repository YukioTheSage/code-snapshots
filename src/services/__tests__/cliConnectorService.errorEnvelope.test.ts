/* eslint-disable @typescript-eslint/no-explicit-any */
import { CliConnectorService } from '../cliConnectorService';
import { TerminalApiService } from '../terminalApiService';
import * as vscode from 'vscode';

jest.mock('../terminalApiService');
jest.mock('../semanticSearchService');
jest.mock('../enhancedCodeChunker', () => ({
  EnhancedCodeChunker: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../queryProcessor');
jest.mock('../resultManager');
jest.mock('../qualityMetricsCalculator');
// No `jest.mock('../relationshipAnalyzer')` here: Task 1 deletes that module,
// and mocking a module jest cannot resolve fails the whole file.

describe('IPC envelope for a failing handler', () => {
  let service: CliConnectorService;

  beforeEach(() => {
    jest.clearAllMocks();
    const terminalApi = {
      getSnapshots: jest
        .fn()
        .mockRejectedValue(new Error('snapshot store unavailable')),
    } as unknown as TerminalApiService;
    (vscode.workspace as any) = {
      workspaceFolders: [{ uri: { fsPath: '/test/workspace' } }],
      // The constructor stores a chunker-settings listener; a wholesale
      // workspace replacement must expose the API it registers.
      onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
    };
    service = new CliConnectorService(terminalApi, {
      extension: { packageJSON: { version: '1.0.0' } },
    } as any);
  });

  afterEach(() => {
    service.dispose();
    jest.clearAllMocks();
  });

  it('reports failure with the handler error instead of an empty list', async () => {
    const response = await (service as any).handleCliRequest({
      id: 'req-1',
      method: 'getSnapshots',
      data: undefined,
    });

    expect(response.success).toBe(false);
    expect(response.id).toBe('req-1');
    expect(String(response.error)).toContain('snapshot store unavailable');
  });

  /**
   * The test above pins the dispatcher by handing it a handler that already
   * rejects, so it cannot see the defect this task fixes: the real handler used
   * to catch inside itself and resolve []. This variant wires the *real*
   * TerminalApiService (requireActual, because the module is automocked above)
   * behind the dispatcher, which is the only arrangement in which "the
   * dispatcher never sees an error while the handler resolves []" is true.
   * Before the fix the envelope was { success: true, result: [] } and the CLI
   * printed an empty list as success.
   */
  it('surfaces a real terminal API failure through the dispatcher', async () => {
    const { TerminalApiService: RealTerminalApiService } = jest.requireActual(
      '../terminalApiService',
    );
    (service as any).terminalApiService = new RealTerminalApiService({
      getSnapshots: () => {
        throw new Error('snapshot store unavailable');
      },
    } as any);

    const response = await (service as any).handleCliRequest({
      id: 'req-2',
      method: 'getSnapshots',
      data: undefined,
    });

    expect(response.success).toBe(false);
    expect(response.id).toBe('req-2');
    expect(String(response.error)).toContain('snapshot store unavailable');
  });
});
