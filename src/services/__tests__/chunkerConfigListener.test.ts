/* eslint-disable @typescript-eslint/no-explicit-any */
import { SemanticSearchService } from '../semanticSearchService';
import * as vscode from 'vscode';

interface ListenerHarness {
  handler: (event: unknown) => void;
  dispose: jest.Mock;
}

/** Captures the handler each service registers and the subscription it stores. */
function stubConfigurationListener(): ListenerHarness {
  const harness: ListenerHarness = {
    handler: () => undefined,
    dispose: jest.fn(),
  };
  (
    vscode.workspace as unknown as { onDidChangeConfiguration: jest.Mock }
  ).onDidChangeConfiguration = jest.fn((handler: (event: unknown) => void) => {
    harness.handler = handler;
    return { dispose: harness.dispose };
  });
  return harness;
}

function buildService(): SemanticSearchService {
  return new SemanticSearchService(
    { getSnapshots: () => [], onDidChangeSnapshots: jest.fn() } as never,
    {
      hasCredentials: jest.fn().mockResolvedValue(true),
      promptForCredentials: jest.fn(),
    } as never,
    { workspaceState: { get: jest.fn(() => []), update: jest.fn() } } as never,
  );
}

describe('SemanticSearchService chunker configuration listener', () => {
  it('refreshes both chunkers when a chunker setting changes', () => {
    const listener = stubConfigurationListener();
    const service = buildService();
    const refreshCodeChunker = jest.spyOn(
      (service as any).codeChunker,
      'refreshConfig',
    );
    const refreshEnhanced = jest.spyOn(
      (service as any).enhancedCodeChunker,
      'refreshConfig',
    );

    listener.handler({
      affectsConfiguration: (section: string) =>
        section === 'vscode-snapshots.semanticSearch.chunkSize',
    });

    // The subscription is the only reason a changed setting takes effect
    // without a window reload.
    expect(refreshCodeChunker).toHaveBeenCalledTimes(1);
    expect(refreshEnhanced).toHaveBeenCalledTimes(1);
  });

  it('refreshes on a chunk overlap change too', () => {
    const listener = stubConfigurationListener();
    const service = buildService();
    const refreshCodeChunker = jest.spyOn(
      (service as any).codeChunker,
      'refreshConfig',
    );

    listener.handler({
      affectsConfiguration: (section: string) =>
        section === 'vscode-snapshots.semanticSearch.chunkOverlap',
    });

    expect(refreshCodeChunker).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated configuration changes', () => {
    const listener = stubConfigurationListener();
    const service = buildService();
    const refreshCodeChunker = jest.spyOn(
      (service as any).codeChunker,
      'refreshConfig',
    );

    listener.handler({ affectsConfiguration: () => false });

    expect(refreshCodeChunker).not.toHaveBeenCalled();
  });

  it('releases the configuration subscription on dispose', () => {
    const listener = stubConfigurationListener();
    const service = buildService();

    service.dispose();

    expect(listener.dispose).toHaveBeenCalledTimes(1);
  });
});
