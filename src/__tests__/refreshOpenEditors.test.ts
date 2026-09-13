import { SnapshotManager } from '../snapshotManager';
import * as vscode from 'vscode';
import { promises as fsPromises } from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The mock now provides `WorkspaceEdit` and `window.visibleTextEditors`, which
 * the plan audit (B-02d) noted it did not. Before that repair these tests would
 * have passed vacuously: the loop threw on the first VS Code API it touched and
 * the surrounding catch swallowed it, so "applyEdit was not called" was true
 * only because the code had crashed.
 */
describe('refreshOpenEditors', () => {
  let dir: string;
  let manager: SnapshotManager;
  let editors: any[];
  let applyEdit: jest.Mock;

  beforeEach(async () => {
    dir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'codelapse-refresh-'),
    );
    manager = new SnapshotManager(null);
    // The constructor's loadSnapshots() is not awaited; settle it so it cannot
    // clear state underneath the test.
    await new Promise((resolve) => setTimeout(resolve, 0));

    editors = [];
    (vscode.window as any).visibleTextEditors = editors;
    applyEdit = jest.fn().mockResolvedValue(true);
    (vscode.workspace as any).applyEdit = applyEdit;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fsPromises.rm(dir, { recursive: true, force: true });
  });

  function editorFor(
    fsPath: string,
    opts: { dirty?: boolean; ranges?: any[]; text?: string } = {},
  ) {
    const uri = vscode.Uri.file(fsPath);
    const editor = {
      document: {
        uri,
        isDirty: opts.dirty ?? false,
        getText: () => opts.text ?? 'current',
        positionAt: () => new (vscode.Position as any)(0, 0),
      },
      selection: { anchor: 1 },
      visibleRanges: opts.ranges ?? [{}],
      revealRange: jest.fn(),
    };
    editors.push(editor);
    return editor;
  }

  const refresh = () => (manager as any).refreshOpenEditors();

  it('skips a dirty document and leaves the buffer alone', async () => {
    const file = path.join(dir, 'dirty.ts');
    await fsPromises.writeFile(file, 'on disk');
    editorFor(file, { dirty: true });

    await refresh();

    expect(applyEdit).not.toHaveBeenCalled();
  });

  it('tolerates a file that no longer exists, without aborting the refresh', async () => {
    // A restore can delete a file that is still open in an editor.
    const gone = path.join(dir, 'gone.ts');
    const present = path.join(dir, 'present.ts');
    await fsPromises.writeFile(present, 'from disk');

    const goneEditor = editorFor(gone);
    const presentEditor = editorFor(present, { text: 'stale' });

    await expect(refresh()).resolves.toBeUndefined();

    // The deleted file is skipped, and the second editor is still refreshed --
    // which is the point of handling edits per document.
    expect(applyEdit).toHaveBeenCalledTimes(1);
    expect(presentEditor.revealRange).toHaveBeenCalled();
    expect(goneEditor.revealRange).not.toHaveBeenCalled();
  });

  it('ignores non-file schemes', async () => {
    const untitled = {
      document: {
        uri: { scheme: 'untitled', fsPath: 'Untitled-1' },
        isDirty: false,
        getText: () => '',
        positionAt: () => new (vscode.Position as any)(0, 0),
      },
      selection: {},
      visibleRanges: [{}],
      revealRange: jest.fn(),
    };
    editors.push(untitled);

    await refresh();

    expect(applyEdit).not.toHaveBeenCalled();
  });

  it('does not reveal when visibleRanges is empty', async () => {
    const file = path.join(dir, 'empty-ranges.ts');
    await fsPromises.writeFile(file, 'from disk');
    const editor = editorFor(file, { ranges: [], text: 'stale' });

    await refresh();

    expect(applyEdit).toHaveBeenCalledTimes(1);
    // `visibleRanges[0]` would be undefined here, which the old code passed
    // straight to revealRange.
    expect(editor.revealRange).not.toHaveBeenCalled();
  });

  it('does not touch a buffer whose content already matches disk', async () => {
    const file = path.join(dir, 'unchanged.ts');
    await fsPromises.writeFile(file, 'same');
    editorFor(file, { text: 'same' });

    await refresh();

    expect(applyEdit).not.toHaveBeenCalled();
  });

  it('refreshes a stale buffer and restores the selection', async () => {
    const file = path.join(dir, 'stale.ts');
    await fsPromises.writeFile(file, 'fresh content');
    const editor = editorFor(file, { text: 'old content' });

    await refresh();

    expect(applyEdit).toHaveBeenCalledTimes(1);
    expect(editor.selection).toEqual({ anchor: 1 });
    expect(editor.revealRange).toHaveBeenCalled();
  });

  it('keeps going when applyEdit rejects', async () => {
    const first = path.join(dir, 'a.ts');
    const second = path.join(dir, 'b.ts');
    await fsPromises.writeFile(first, 'a');
    await fsPromises.writeFile(second, 'b');
    editorFor(first, { text: 'stale-a' });
    editorFor(second, { text: 'stale-b' });

    applyEdit.mockRejectedValueOnce(new Error('editor closed'));

    await expect(refresh()).resolves.toBeUndefined();
    // The failure is contained to one document rather than aborting the loop.
    expect(applyEdit).toHaveBeenCalledTimes(2);
  });
});
