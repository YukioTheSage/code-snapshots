import * as path from 'path';
import * as vscode from 'vscode';
import { CliConnectorService } from '../cliConnectorService';
import { TerminalApiService } from '../terminalApiService';

jest.mock('../semanticSearchService');
jest.mock('../enhancedCodeChunker', () => ({
  EnhancedCodeChunker: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../queryProcessor');
jest.mock('../resultManager');
jest.mock('../qualityMetricsCalculator');

const ROOT = process.platform === 'win32' ? 'C:\\ws' : '/ws';

/**
 * `snapshot restore`'s `-y, --yes` means "skip the confirmation", but the CLI
 * reaches VS Code over IPC, where the command's modal and quick pick can never
 * be answered -- a headless caller would hang. The flag's meaning on this path
 * is therefore the unsaved-changes guard in `TerminalApiService.restoreSnapshot`:
 * a dirty buffer the restore would overwrite makes the call refuse, and `-y`
 * is the caller's explicit answer that it accepts the loss.
 *
 * The flag must survive the dispatcher (it used to read only `data.options`,
 * which an older CLI never populated, and it must coerce strictly: a malformed
 * truthy value would otherwise disarm a data-loss guard), and the guard itself
 * must be able to see every visible editor, not just the active one.
 *
 * Only an explicit boolean `skipConfirm` arms the guard: it is the CLI restore
 * contract's answer to that question. A caller that never sends the key -- the
 * public API, or the git-commit flow's `{ silent: true }` -- never asked, so it
 * must keep the previous behaviour of restoring and reporting the conflicts.
 */
describe('CliConnectorService - restoreSnapshot options plumbing', () => {
  let cliConnectorService: CliConnectorService;
  let restoreSnapshot: jest.Mock;

  interface DispatchResponse {
    success: boolean;
    result?: unknown;
    error?: string;
  }

  /** Drive the request dispatcher exactly as the CLI's IPC client does. */
  function dispatchRestore(
    data: Record<string, unknown>,
  ): Promise<DispatchResponse> {
    return (
      cliConnectorService as unknown as {
        handleCliRequest: (message: unknown) => Promise<DispatchResponse>;
      }
    ).handleCliRequest({
      id: 'restore-request',
      method: 'restoreSnapshot',
      data,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();

    restoreSnapshot = jest.fn().mockResolvedValue({
      success: true,
      filesRestored: 1,
      filesSkipped: 0,
    });

    cliConnectorService = new CliConnectorService(
      { restoreSnapshot } as unknown as TerminalApiService,
      { extension: { packageJSON: { version: '1.0.0' } } } as never,
    );
  });

  afterEach(() => {
    cliConnectorService.dispose();
    jest.clearAllMocks();
  });

  it('forwards nested options to the terminal API', async () => {
    const options = {
      createBackupSnapshot: true,
      selectedFiles: [path.join('src', 'a.ts')],
      silent: true,
      skipConfirm: true,
    };

    const response = await dispatchRestore({ id: 'snap-1', options });

    expect(response.success).toBe(true);
    expect(response.result).toEqual({
      success: true,
      filesRestored: 1,
      filesSkipped: 0,
    });
    expect(restoreSnapshot).toHaveBeenCalledWith('snap-1', options);
  });

  it('tolerates the flattened payload an older CLI sends', async () => {
    // The CLI flattened its options to the top level of `data`, so
    // `data.options` was undefined and --backup/--files were dropped.
    await dispatchRestore({
      id: 'snap-1',
      createBackupSnapshot: true,
      selectedFiles: [path.join('src', 'a.ts')],
      silent: true,
    });

    expect(restoreSnapshot).toHaveBeenCalledWith(
      'snap-1',
      expect.objectContaining({
        createBackupSnapshot: true,
        selectedFiles: [path.join('src', 'a.ts')],
        silent: true,
        skipConfirm: false,
      }),
    );
  });

  const nonBooleanSkipConfirm: Array<[string, unknown]> = [
    ['a truthy string', 'true'],
    ['the number 1', 1],
    ['an empty object', {}],
  ];

  it.each(nonBooleanSkipConfirm)(
    'fails closed when skipConfirm is %s',
    async (_label, value) => {
      await dispatchRestore({
        id: 'snap-1',
        options: { createBackupSnapshot: true, skipConfirm: value },
      });

      expect(restoreSnapshot).toHaveBeenCalledWith('snap-1', {
        createBackupSnapshot: true,
        skipConfirm: false,
      });
    },
  );

  it('does not arm the guard when skipConfirm is absent', async () => {
    await dispatchRestore({ id: 'snap-1', options: { silent: true } });

    expect(restoreSnapshot).toHaveBeenCalledWith('snap-1', {
      silent: true,
      skipConfirm: false,
    });
  });
});

describe('TerminalApiService.restoreSnapshot - unsaved-changes guard', () => {
  interface GuardHarnessOptions {
    snapshotFiles?: Record<string, { content?: string }>;
    dirtyEditors?: Array<{ relPath: string; isDirty?: boolean }>;
    activeEditor?: { relPath: string; isDirty: boolean };
  }

  function setVisibleEditors(
    editors: Array<{ relPath: string; isDirty?: boolean }>,
  ): void {
    (
      vscode.window as unknown as { visibleTextEditors: unknown[] }
    ).visibleTextEditors = editors.map((editor) => ({
      document: {
        isDirty: editor.isDirty ?? true,
        uri: vscode.Uri.file(path.join(ROOT, editor.relPath)),
      },
    }));
  }

  function buildHarness(options: GuardHarnessOptions = {}) {
    const snapshot = {
      id: 'snap-1',
      description: 'Before refactor',
      files: options.snapshotFiles ?? {
        'a.ts': { content: 'a\n' },
        [path.join('src', 'b.ts')]: { content: 'b\n' },
      },
    };

    const applySnapshotRestore = jest.fn().mockResolvedValue({
      success: true,
      restored: ['a.ts'],
      skipped: [],
      refusedDeletions: [],
      deleted: [],
      divergentBuffers: [],
    });

    const takeSnapshot = jest.fn().mockResolvedValue({
      created: true,
      snapshot: { id: 'backup-1', description: 'backup', files: {} },
    });

    const manager = {
      getSnapshotById: jest.fn().mockReturnValue(snapshot),
      getWorkspaceRoot: jest.fn().mockReturnValue(ROOT),
      getSnapshotChangeSummary: jest.fn().mockReturnValue({
        added: 0,
        modified: 0,
        deleted: 0,
      }),
      takeSnapshot,
      applySnapshotRestore,
    };

    const api = new TerminalApiService(manager as never);

    setVisibleEditors(options.dirtyEditors ?? []);
    (
      vscode.window as unknown as { activeTextEditor: unknown }
    ).activeTextEditor = options.activeEditor
      ? {
          document: {
            isDirty: options.activeEditor.isDirty,
            uri: vscode.Uri.file(path.join(ROOT, options.activeEditor.relPath)),
          },
        }
      : undefined;

    return { api, applySnapshotRestore, takeSnapshot };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refuses to restore an affected dirty buffer instead of prompting', async () => {
    const { api, applySnapshotRestore } = buildHarness({
      dirtyEditors: [{ relPath: 'a.ts' }],
    });

    const response = await api.restoreSnapshot('snap-1', {
      skipConfirm: false,
    });

    expect(applySnapshotRestore).not.toHaveBeenCalled();
    expect(response.success).toBe(false);
    expect(response.filesRestored).toBe(0);
    expect(response.filesSkipped).toBe(0);
    expect(response.conflicts).toEqual(['a.ts']);
    expect(response.error).toContain('a.ts');
    expect(response.error).toContain('-y/--yes');

    // A prompt here would hang a headless CLI caller: the refusal IS the answer.
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('reports every affected dirty editor, not only the active one', async () => {
    const { api, applySnapshotRestore } = buildHarness({
      dirtyEditors: [
        { relPath: 'a.ts' },
        { relPath: path.join('src', 'b.ts') },
      ],
      // The active editor is clean; the scan must not stop at it.
      activeEditor: { relPath: 'a.ts', isDirty: false },
    });

    const response = await api.restoreSnapshot('snap-1', {
      skipConfirm: false,
    });

    expect(applySnapshotRestore).not.toHaveBeenCalled();
    expect(response.conflicts).toEqual(['a.ts', path.join('src', 'b.ts')]);
  });

  it('restores when the dirty editor is not part of the restore', async () => {
    const { api, applySnapshotRestore } = buildHarness({
      snapshotFiles: { 'a.ts': { content: 'a\n' } },
      dirtyEditors: [{ relPath: path.join('docs', 'notes.md') }],
    });

    const response = await api.restoreSnapshot('snap-1', {
      skipConfirm: false,
    });

    expect(applySnapshotRestore).toHaveBeenCalledWith('snap-1');
    expect(response.success).toBe(true);
    expect(response.conflicts).toEqual([]);
  });

  it('restores a clean workspace exactly as before', async () => {
    const { api, applySnapshotRestore } = buildHarness();

    const response = await api.restoreSnapshot('snap-1');

    expect(applySnapshotRestore).toHaveBeenCalledWith('snap-1');
    expect(response).toEqual({
      success: true,
      backupSnapshotId: undefined,
      filesRestored: 2,
      filesSkipped: 0,
      conflicts: [],
    });
  });

  it('restores anyway when the caller passed -y/--yes, still reporting conflicts', async () => {
    const { api, applySnapshotRestore } = buildHarness({
      dirtyEditors: [{ relPath: 'a.ts' }],
    });

    const response = await api.restoreSnapshot('snap-1', { skipConfirm: true });

    expect(applySnapshotRestore).toHaveBeenCalledWith('snap-1');
    expect(response.success).toBe(true);
    expect(response.conflicts).toEqual(['a.ts']);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('scopes the guard to selectedFiles when the restore is selective', async () => {
    const dirtyEditors = [{ relPath: path.join('src', 'b.ts') }];

    const untouched = buildHarness({ dirtyEditors });
    const untouchedResponse = await untouched.api.restoreSnapshot('snap-1', {
      selectedFiles: ['a.ts'],
      skipConfirm: false,
    });

    expect(untouched.applySnapshotRestore).toHaveBeenCalledWith('snap-1');
    expect(untouchedResponse.success).toBe(true);

    const touched = buildHarness({ dirtyEditors });
    const touchedResponse = await touched.api.restoreSnapshot('snap-1', {
      selectedFiles: [path.join('src', 'b.ts')],
      skipConfirm: false,
    });

    expect(touched.applySnapshotRestore).not.toHaveBeenCalled();
    expect(touchedResponse.success).toBe(false);
    expect(touchedResponse.conflicts).toEqual([path.join('src', 'b.ts')]);
  });

  it('keeps the success notification unless the caller asked for silence', async () => {
    const noisy = buildHarness();
    await noisy.api.restoreSnapshot('snap-1');
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();

    (vscode.window.showInformationMessage as jest.Mock).mockClear();

    const silent = buildHarness();
    await silent.api.restoreSnapshot('snap-1', { silent: true });
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('leaves a caller that never sent skipConfirm on the previous path', async () => {
    // The git-commit flow restores with `{ silent: true }`; it never asks the
    // guard's question, so a dirty buffer must not turn into advice that flow's
    // user cannot act on.
    const { api, applySnapshotRestore } = buildHarness({
      dirtyEditors: [{ relPath: 'a.ts' }],
    });

    const response = await api.restoreSnapshot('snap-1', { silent: true });

    expect(applySnapshotRestore).toHaveBeenCalledWith('snap-1');
    expect(response.success).toBe(true);
    expect(response.conflicts).toEqual(['a.ts']);
  });

  it('does not leave a stray backup snapshot behind when it refuses', async () => {
    const { api, applySnapshotRestore, takeSnapshot } = buildHarness({
      dirtyEditors: [{ relPath: 'a.ts' }],
    });

    const response = await api.restoreSnapshot('snap-1', {
      createBackupSnapshot: true,
      skipConfirm: false,
    });

    expect(takeSnapshot).not.toHaveBeenCalled();
    expect(applySnapshotRestore).not.toHaveBeenCalled();
    expect(response.success).toBe(false);
    expect(response.error).toContain('-y/--yes');
  });

  it('still takes the requested backup when the restore proceeds', async () => {
    const { api, applySnapshotRestore, takeSnapshot } = buildHarness({
      dirtyEditors: [{ relPath: 'a.ts' }],
    });

    const response = await api.restoreSnapshot('snap-1', {
      createBackupSnapshot: true,
      skipConfirm: true,
    });

    expect(takeSnapshot).toHaveBeenCalled();
    expect(applySnapshotRestore).toHaveBeenCalledWith('snap-1');
    expect(response.success).toBe(true);
    expect(response.backupSnapshotId).toBe('backup-1');
  });
});
