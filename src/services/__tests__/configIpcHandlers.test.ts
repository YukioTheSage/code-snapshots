/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

describe('CliConnectorService config methods', () => {
  let root: string;
  let service: CliConnectorService;

  function dispatch(
    method: string,
    data: Record<string, unknown>,
  ): Promise<any> {
    return (service as any).handleCliRequest({
      id: 'config-request',
      method,
      data,
    });
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-config-ipc-'));
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: root } }];
    // No explicitly-set VS Code values in this fixture.
    (vscode.workspace as any).getConfiguration = jest.fn(() => ({
      inspect: () => undefined,
    }));
    service = new CliConnectorService(
      {} as TerminalApiService,
      {
        extension: { packageJSON: { version: '0.9.5' } },
        subscriptions: [],
      } as any,
    );
  });

  afterEach(() => {
    service.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('sets and gets a shared config key over IPC', async () => {
    const setResponse = await dispatch('setConfig', {
      key: 'maxSnapshots',
      value: 7,
    });
    expect(setResponse.success).toBe(true);
    expect(setResponse.result.value).toBe(7);
    expect(fs.existsSync(path.join(root, '.vscode', 'codelapse.json'))).toBe(
      true,
    );

    const getResponse = await dispatch('getConfig', { key: 'maxSnapshots' });
    expect(getResponse.success).toBe(true);
    expect(getResponse.result.config).toBe(7);

    const schemaResponse = await dispatch('getConfigSchema', {});
    expect(schemaResponse.result.availableKeys).toContain('maxSnapshots');

    const validateResponse = await dispatch('validateConfig', {});
    expect(validateResponse.result.isValid).toBe(true);
  });

  it('exports and imports the shared config through IPC', async () => {
    await dispatch('setConfig', { key: 'maxSnapshots', value: 9 });

    const exportResponse = await dispatch('exportConfig', {
      filePath: 'config-export.json',
      format: 'json',
    });
    expect(exportResponse.success).toBe(true);
    expect(fs.existsSync(path.join(root, 'config-export.json'))).toBe(true);

    await dispatch('setConfig', { key: 'maxSnapshots', value: 3 });
    const importResponse = await dispatch('importConfig', {
      filePath: 'config-export.json',
      merge: true,
    });
    expect(importResponse.success).toBe(true);

    const getResponse = await dispatch('getConfig', { key: 'maxSnapshots' });
    expect(getResponse.result.config).toBe(9);
  });
});
