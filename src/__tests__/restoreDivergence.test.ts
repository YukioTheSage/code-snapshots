/* eslint-disable @typescript-eslint/no-explicit-any */
import { SnapshotManager } from '../snapshotManager';
import * as vscode from 'vscode';
import * as path from 'path';

const ROOT = process.platform === 'win32' ? 'C:\\ws' : '/tmp/ws';
const REL = path.join('src', 'app.ts');

jest.mock('codelapse-core', () => ({
  GitignoreParser: jest.fn().mockImplementation(() => ({
    getExcludeGlobPattern: () => '**/node_modules/**',
    getNegatedGlobs: () => [],
    shouldIgnore: () => false,
  })),
  runWithConcurrencyLimit: async (
    items: unknown[],
    _n: number,
    fn: (i: unknown) => Promise<void>,
  ) => {
    for (const item of items) await fn(item);
  },
}));

describe('restore divergence reporting', () => {
  it('names a restored file whose buffer is still dirty', async () => {
    const manager = new SnapshotManager(null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const storage: any = {
      getWorkspaceRoot: () => ROOT,
      getSnapshotDirectory: () => path.join(ROOT, '.snapshots'),
      getSnapshotFileContent: jest.fn().mockResolvedValue('restored'),
      writeFileContent: jest.fn().mockResolvedValue(undefined),
      readFileContent: jest.fn().mockResolvedValue('restored'),
      isBinaryFile: () => false,
      deleteWorkspaceFile: jest.fn().mockResolvedValue(undefined),
      deleteSnapshotData: jest.fn().mockResolvedValue(undefined),
      saveSnapshotIndex: jest.fn().mockResolvedValue(undefined),
    };
    (manager as any).storage = storage;
    (manager as any).snapshots = [
      {
        id: 'snapshot-a',
        timestamp: 1,
        description: 'a',
        files: { [REL]: { content: 'restored' } },
      },
    ];

    (vscode.workspace as any).findFiles = jest
      .fn()
      .mockResolvedValue([vscode.Uri.file(path.join(ROOT, REL))]);
    (vscode.window as any).visibleTextEditors = [
      {
        document: {
          uri: { scheme: 'file', fsPath: path.join(ROOT, REL) },
          isDirty: true,
          getText: () => 'unsaved typing',
          positionAt: () => ({}),
        },
        selection: {},
        visibleRanges: [],
      },
    ];

    const result = await manager.applySnapshotRestore('snapshot-a');

    expect(result.divergentBuffers).toEqual([REL]);
  });
});
