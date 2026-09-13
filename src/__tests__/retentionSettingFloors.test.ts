import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getMaxSnapshots, getMaxSnapshotStoreBytes } from '../config';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Manifest {
  contributes: {
    configuration: {
      properties: Record<string, { minimum?: number }>;
    };
  };
}

function readManifest(): Manifest {
  const manifestPath = path.join(__dirname, '..', '..', 'package.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
}

function withInspectedSetting(value: unknown): void {
  (vscode.workspace as any).getConfiguration = jest.fn(() => ({
    get: (_key: string, fallback: unknown) => fallback,
    inspect: () => ({ workspaceValue: value, globalValue: undefined }),
  }));
}

/** No explicit VS Code value: the shared store or the caller's fallback wins. */
function withNoSettingFromSettings(): void {
  (vscode.workspace as any).getConfiguration = jest.fn(() => ({
    get: (_key: string, fallback: unknown) => fallback,
    inspect: () => ({ workspaceValue: undefined, globalValue: undefined }),
  }));
}

describe('getMaxSnapshots floor', () => {
  afterEach(() => {
    (vscode.workspace as any).workspaceFolders = [];
  });

  it('reads a configured 0 as 1 instead of "prune everything"', () => {
    // A hand-edited settings.json can hold 0. Passed through, the prune
    // guard's safety loop exits immediately and the snapshot just taken is
    // itself pruned.
    withInspectedSetting(0);

    expect(getMaxSnapshots()).toBe(1);
  });

  it('reads a configured negative value as 1', () => {
    withInspectedSetting(-4);

    expect(getMaxSnapshots()).toBe(1);
  });

  it('is the identity for values at or above the floor', () => {
    withInspectedSetting(7);

    expect(getMaxSnapshots()).toBe(7);
  });

  it('falls back to 50 for a value of the wrong type', () => {
    withInspectedSetting('many');

    expect(getMaxSnapshots()).toBe(50);
  });

  it('never resolves below 1 when codelapse.json carries 0', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-floor-'));
    // The shared loader rejects a 0 and quarantines the file, which logs.
    // Swallow the log: the spy is only here to keep the suite's output clean.
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
      fs.writeFileSync(
        path.join(root, '.vscode', 'codelapse.json'),
        JSON.stringify({ maxSnapshots: 0 }),
        'utf8',
      );
      (vscode.workspace as any).workspaceFolders = [
        { uri: vscode.Uri.file(root) },
      ];
      withNoSettingFromSettings();

      expect(getMaxSnapshots()).toBeGreaterThanOrEqual(1);
    } finally {
      errorSpy.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('getMaxSnapshotStoreBytes', () => {
  afterEach(() => {
    (vscode.workspace as any).workspaceFolders = [];
  });

  it('returns the configured byte limit', () => {
    withInspectedSetting(1048576);

    expect(getMaxSnapshotStoreBytes()).toBe(1048576);
  });

  it('reads 0 (disabled) as 0', () => {
    withInspectedSetting(0);

    expect(getMaxSnapshotStoreBytes()).toBe(0);
  });

  it('reads a wrong-typed value as disabled', () => {
    withInspectedSetting('1GB');

    expect(getMaxSnapshotStoreBytes()).toBe(0);
  });

  it('reads a negative value as disabled', () => {
    withInspectedSetting(-1);

    expect(getMaxSnapshotStoreBytes()).toBe(0);
  });

  it('reads an unset value as disabled', () => {
    withNoSettingFromSettings();
    (vscode.workspace as any).workspaceFolders = [];

    expect(getMaxSnapshotStoreBytes()).toBe(0);
  });
});

describe('the manifest declares the retention floors', () => {
  it('declares a minimum of 1 for maxSnapshots', () => {
    const properties = readManifest().contributes.configuration.properties;

    expect(properties['vscode-snapshots.maxSnapshots'].minimum).toBe(1);
  });

  it('declares a minimum of 0 for maxSnapshotStoreBytes', () => {
    const properties = readManifest().contributes.configuration.properties;

    expect(properties['vscode-snapshots.maxSnapshotStoreBytes'].minimum).toBe(
      0,
    );
  });
});
