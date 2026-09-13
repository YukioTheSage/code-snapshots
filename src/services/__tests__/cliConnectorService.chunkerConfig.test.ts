/* eslint-disable @typescript-eslint/no-explicit-any */
import { CliConnectorService } from '../cliConnectorService';
import * as vscode from 'vscode';

const mockChunkerRefresh = jest.fn();

jest.mock('../terminalApiService');
jest.mock('../semanticSearchService');
jest.mock('../queryProcessor');
jest.mock('../resultManager');
jest.mock('../qualityMetricsCalculator');
// No `jest.mock('../relationshipAnalyzer')`: Task 1 deleted that module, and
// mocking a module jest cannot resolve fails the whole file.

// The chunker is doubled here on purpose: the observable-splitting proof lives
// in `chunkerConfigRefresh.test.ts`, and this test is about the connector
// holding the subscription. The factory is not evaluated until a chunker is
// constructed, so the `mock`-prefixed spy is initialised by then.
jest.mock('../enhancedCodeChunker', () => ({
  EnhancedCodeChunker: jest.fn().mockImplementation(() => ({
    refreshConfig: mockChunkerRefresh,
  })),
}));

describe('CliConnectorService chunker configuration listener', () => {
  let service: CliConnectorService;
  let dispose: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    dispose = jest.fn();
    (vscode.workspace as any) = {
      workspaceFolders: [{ uri: { fsPath: '/test/workspace' } }],
      onDidChangeConfiguration: jest.fn(() => ({ dispose })),
    };
    service = new CliConnectorService(
      { getSnapshots: jest.fn() } as any,
      { extension: { packageJSON: { version: '1.0.0' } } } as any,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('refreshes its chunker when a chunker setting changes', () => {
    const handler = (
      (vscode.workspace as any).onDidChangeConfiguration as jest.Mock
    ).mock.calls[0][0] as (event: unknown) => void;

    handler({
      affectsConfiguration: (section: string) =>
        section === 'vscode-snapshots.semanticSearch.chunkSize',
    });

    expect(mockChunkerRefresh).toHaveBeenCalledTimes(1);
  });

  it('releases the configuration subscription on dispose', () => {
    service.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
