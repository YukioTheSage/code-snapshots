import { listSelectableFiles } from '../ui/snapshotContextInput';
import { registerCommands } from '../commands';
import * as vscode from 'vscode';
import * as path from 'path';

jest.mock('codelapse-core', () => ({
  GitignoreParser: jest.fn().mockImplementation(() => ({
    getExcludeGlobPattern: () => '**/out/**,**/node_modules/**',
    getNegatedGlobs: () => [],
    // The real parser normalises separators internally, so the mock must too:
    // these called with the platform's native path separator.
    shouldIgnore: (relativePath: string) => {
      const normalized = relativePath.replace(/\\/g, '/');
      return (
        normalized.startsWith('out/') || normalized.startsWith('node_modules/')
      );
    },
  })),
}));

const ROOT = process.platform === 'win32' ? 'C:\\ws' : '/ws';

describe('listSelectableFiles', () => {
  it('excludes paths the snapshot engine would refuse to include', async () => {
    (vscode.workspace as any).findFiles = jest
      .fn()
      .mockResolvedValue([
        vscode.Uri.file(`${ROOT}/src/a.ts`),
        vscode.Uri.file(`${ROOT}/out/a.js`),
        vscode.Uri.file(`${ROOT}/node_modules/pkg/index.js`),
        vscode.Uri.file(`${ROOT}/README.md`),
      ]);

    const files = await listSelectableFiles(ROOT);

    // The bug: the picker offered out/ and node_modules/ files, which
    // takeSnapshotInternal then filtered out, producing a snapshot that
    // contained none of the user's selections.
    expect(files).toEqual(['README.md', path.join('src', 'a.ts')]);
  });

  it('returns paths in the separator the engine matches against', async () => {
    (vscode.workspace as any).findFiles = jest
      .fn()
      .mockResolvedValue([vscode.Uri.file(`${ROOT}/src/deep/b.ts`)]);

    const files = await listSelectableFiles(ROOT);

    // The engine matches the selection set against `path.relative(...)`, which
    // uses the platform separator. Returning forward slashes here looks tidier
    // and drops every selection on Windows, emptying the snapshot.
    expect(files).toEqual([path.join('src', 'deep', 'b.ts')]);
    expect(files).toEqual([path.relative(ROOT, `${ROOT}/src/deep/b.ts`)]);
  });

  it('returns an empty list when nothing is selectable', async () => {
    (vscode.workspace as any).findFiles = jest
      .fn()
      .mockResolvedValue([vscode.Uri.file(`${ROOT}/out/a.js`)]);

    expect(await listSelectableFiles(ROOT)).toEqual([]);
  });

  it('produces keys the engine lookup will find', () => {
    // The engine's selective filter is
    // `selectedPathsSet.has(path.relative(workspaceRoot, fileUri.fsPath))`.
    // Reproducing that lookup here is the only thing that catches a separator
    // contract mismatch, which is invisible on POSIX and fatal on Windows.
    const workspaceRoot = ROOT;
    const fileUri = vscode.Uri.file(`${ROOT}/src/a.ts`);
    (vscode.workspace as any).findFiles = jest
      .fn()
      .mockResolvedValue([fileUri]);
    const engineKey = path.relative(workspaceRoot, fileUri.fsPath);

    return listSelectableFiles(workspaceRoot).then((files) => {
      expect(new Set(files).has(engineKey)).toBe(true);
    });
  });
});

/**
 * The conflict dialog exists to protect unsaved work, so the two branches that
 * matter are "no snapshot was taken" and "a snapshot was taken". Both are
 * driven through the registered command handler with stubs, because the value
 * of the guard is entirely in whether the restore runs afterwards.
 */
describe('Take Snapshot & Restore', () => {
  function buildHarness(takeOutcome: unknown) {
    const handlers: Record<string, (arg?: unknown) => Promise<unknown>> = {};
    (
      vscode.commands as unknown as { registerCommand: jest.Mock }
    ).registerCommand = jest.fn((id: string, fn: never) => {
      handlers[id] = fn;
      return { dispose: jest.fn() };
    });

    (
      vscode.commands as unknown as { executeCommand: jest.Mock }
    ).executeCommand = jest.fn(async (id: string) =>
      id === 'vscode-snapshots.takeSnapshot' ? takeOutcome : undefined,
    );

    (vscode.window as unknown as { withProgress: jest.Mock }).withProgress =
      jest.fn(
        async (_options: unknown, task: (p: unknown, t: unknown) => unknown) =>
          task(
            { report: jest.fn() },
            {
              isCancellationRequested: false,
              onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
            },
          ),
      );

    // Both prompts are answered with the protective branch.
    (
      vscode.window as unknown as { showWarningMessage: jest.Mock }
    ).showWarningMessage = jest
      .fn()
      .mockResolvedValue('Take Snapshot & Restore');
    (vscode.window as unknown as { showQuickPick: jest.Mock }).showQuickPick =
      jest.fn().mockResolvedValue(undefined);
    (
      vscode.window as unknown as { showInformationMessage: jest.Mock }
    ).showInformationMessage = jest.fn();

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (key: string, fallback?: unknown) =>
        // Skip the routine confirmation; the data-loss prompt is not gated.
        key === 'ux.confirmRestoreOperations' ? false : fallback,
    });

    (vscode.workspace as any).workspaceFolders = [
      { uri: vscode.Uri.file(ROOT) },
    ];
    (
      vscode.window as unknown as { visibleTextEditors: unknown[] }
    ).visibleTextEditors = [
      {
        document: {
          isDirty: true,
          uri: vscode.Uri.file(path.join(ROOT, 'a.ts')),
        },
      },
    ];

    const applySnapshotRestore = jest.fn().mockResolvedValue({
      success: true,
      restored: ['a.ts'],
      skipped: [],
      refusedDeletions: [],
      deleted: [],
    });

    const snapshot = {
      id: 'snap-1',
      timestamp: 1000,
      description: 'one',
      files: { 'a.ts': { content: 'x' } },
    };

    const snapshotManager = {
      getSnapshotById: () => snapshot,
      getWorkspaceRoot: () => ROOT,
      calculateRestoreChanges: async () => [
        { label: 'a.ts', description: '', relativePath: 'a.ts', status: 'M' },
      ],
      getUnrecoverableFilesFor: () => [],
      applySnapshotRestore,
      getSnapshots: () => [snapshot],
      isSnapshotActive: () => false,
      getActiveSnapshot: () => undefined,
      getCurrentSnapshotIndex: () => -1,
      getNavigationTargetIndex: () => -1,
    };

    registerCommands({
      context: { subscriptions: [] },
      snapshotManager,
      snapshotQuickPick: {},
      snapshotTreeDataProvider: {},
      autoSnapshotTreeDataProvider: {},
      changeNotifier: { resetNotificationState: jest.fn() },
      semanticSearchService: {},
      gitApi: null,
      semanticSearchWebview: {},
    } as never);

    return {
      handlers,
      applySnapshotRestore,
      warning: vscode.window.showWarningMessage as jest.Mock,
    };
  }

  it('does not restore when the protective snapshot was not created', async () => {
    const { handlers, applySnapshotRestore, warning } = buildHarness({
      created: false,
      reason: 'no-changes',
    });

    await handlers['vscode-snapshots.jumpToSnapshot']('snap-1');

    // The previous code assumed success and restored anyway, overwriting the
    // unsaved changes this prompt exists to protect.
    expect(applySnapshotRestore).not.toHaveBeenCalled();
    expect(
      warning.mock.calls.some((call) =>
        String(call[0]).includes('No snapshot was taken'),
      ),
    ).toBe(true);
  });

  it('does not restore when the snapshot prompt was cancelled', async () => {
    const { handlers, applySnapshotRestore } = buildHarness(undefined);

    await handlers['vscode-snapshots.jumpToSnapshot']('snap-1');

    expect(applySnapshotRestore).not.toHaveBeenCalled();
  });

  it('restores once the protective snapshot exists', async () => {
    const { handlers, applySnapshotRestore } = buildHarness({
      created: true,
      snapshot: { id: 'snap-2' },
    });

    await handlers['vscode-snapshots.jumpToSnapshot']('snap-1');

    expect(applySnapshotRestore).toHaveBeenCalledWith('snap-1');
  });
});
