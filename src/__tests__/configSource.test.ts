import { resolveSetting } from '../configSource';
import * as vscode from 'vscode';

jest.mock('codelapse-core', () => ({
  ConfigManager: jest.fn().mockImplementation(() => ({
    getNested: (key: string) => (key === 'maxSnapshots' ? 7 : undefined),
    getConfig: () => ({}),
    getConfigSchema: () => ({}),
    getAvailableKeyPaths: () => ['maxSnapshots'],
    exportConfig: () => '{}',
    validate: () => ({ valid: true, errors: [] }),
    isValidKeyPath: () => true,
  })),
}));

describe('resolveSetting', () => {
  beforeEach(() => {
    (vscode.workspace as any).workspaceFolders = [
      { uri: vscode.Uri.file('/tmp/ws') },
    ];
  });

  it('prefers a setting the user explicitly set in VS Code', () => {
    (vscode.workspace as any).getConfiguration = jest.fn(() => ({
      get: (_k: string, fallback: unknown) => fallback,
      inspect: () => ({ workspaceValue: 12, globalValue: undefined }),
    }));

    expect(resolveSetting('maxSnapshots', 50)).toEqual({
      value: 12,
      source: 'settings',
    });
  });

  it('falls back to codelapse.json when VS Code has no explicit value', () => {
    (vscode.workspace as any).getConfiguration = jest.fn(() => ({
      get: (_k: string, fallback: unknown) => fallback,
      inspect: () => ({ workspaceValue: undefined, globalValue: undefined }),
    }));

    expect(resolveSetting('maxSnapshots', 50)).toEqual({
      value: 7,
      source: 'codelapse.json',
    });
  });

  it('uses the caller fallback when neither store has the key', () => {
    (vscode.workspace as any).getConfiguration = jest.fn(() => ({
      get: (_k: string, fallback: unknown) => fallback,
      inspect: () => ({ workspaceValue: undefined, globalValue: undefined }),
    }));

    expect(resolveSetting('snapshotLocation', '.snapshots')).toEqual({
      value: '.snapshots',
      source: 'default',
    });
  });
});