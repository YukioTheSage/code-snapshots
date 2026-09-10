import { SemanticSearchWebview } from '../ui/semanticSearchWebview';
import * as vscode from 'vscode';

import * as path from 'path';

/**
 * A workspace root in the platform's own form.
 *
 * A POSIX-style root on Windows makes `path.resolve(root, relative)` resolve
 * against the current drive, so `ensureWithinDirectory` rejects a perfectly
 * valid relative path and every assertion below would pass or fail for the
 * wrong reason.
 */
const ROOT = process.platform === 'win32' ? 'C:\\ws' : '/ws';

interface Harness {
  webview: SemanticSearchWebview;
  panel: {
    webview: { onDidReceiveMessage: jest.Mock; postMessage: jest.Mock };
    reveal: jest.Mock;
    dispose: jest.Mock;
  };
  handler: (message: unknown) => Promise<void>;
  openTextDocument: jest.Mock;
  showTextDocument: jest.Mock;
  revealRange: jest.Mock;
}

function buildHarness(): Harness {
  const panel = {
    webview: {
      onDidReceiveMessage: jest.fn(),
      postMessage: jest.fn(),
      asWebviewUri: jest.fn((uri: unknown) => uri),
      cspSource: 'vscode-resource:',
    },
    onDidDispose: jest.fn(),
    reveal: jest.fn(),
    dispose: jest.fn(),
    iconPath: undefined as unknown,
    html: '',
  };
  (
    vscode.window as unknown as { createWebviewPanel: jest.Mock }
  ).createWebviewPanel = jest.fn(() => panel);
  (
    vscode.window as unknown as { showInformationMessage: jest.Mock }
  ).showInformationMessage = jest.fn();
  (vscode.window as unknown as { showQuickPick: jest.Mock }).showQuickPick =
    jest.fn().mockResolvedValue({ label: 'View in Current State' });

  const revealRange = jest.fn();
  const openTextDocument = jest
    .fn()
    .mockResolvedValue({ lineCount: 5, uri: vscode.Uri.file(ROOT) });
  const showTextDocument = jest.fn().mockResolvedValue({
    revealRange,
    selection: undefined,
  });
  (
    vscode.workspace as unknown as { openTextDocument: jest.Mock }
  ).openTextDocument = openTextDocument;
  (
    vscode.window as unknown as { showTextDocument: jest.Mock }
  ).showTextDocument = showTextDocument;

  (
    vscode.workspace as unknown as { workspaceFolders: unknown[] }
  ).workspaceFolders = [{ uri: vscode.Uri.file(ROOT), name: 'ws', index: 0 }];

  const webview = new SemanticSearchWebview(
    { subscriptions: [], extensionUri: vscode.Uri.file('/ext') } as never,
    {
      getWorkspaceRoot: () => ROOT,
      getSnapshotById: () => ({ id: 'snap1', timestamp: 1 }),
    } as never,
  );
  webview.show();

  const calls = panel.webview.onDidReceiveMessage.mock.calls;
  const handler = calls[0][0] as (message: unknown) => Promise<void>;
  return {
    webview,
    panel,
    handler,
    openTextDocument,
    showTextDocument,
    revealRange,
  };
}

describe('SemanticSearchWebview messaging', () => {
  it('does not notify the user for every inbound message', async () => {
    const { handler } = buildHarness();
    const show = (
      vscode.window as unknown as { showInformationMessage: jest.Mock }
    ).showInformationMessage;

    await handler({ command: 'debug', args: [] });

    // The bug: every inbound message produced an information toast. The
    // webview sends several per search, so the user got a stream of them.
    expect(show).not.toHaveBeenCalled();
  });

  it('does not toast on an unrecognised message', async () => {
    const { handler } = buildHarness();
    const show = (
      vscode.window as unknown as { showInformationMessage: jest.Mock }
    ).showInformationMessage;

    await handler({ command: 'somethingTheWebviewMadeUp' });

    expect(show).not.toHaveBeenCalled();
  });
});

describe('SemanticSearchWebview file requests', () => {
  it('refuses a path that escapes the workspace', async () => {
    const { handler, openTextDocument, panel } = buildHarness();

    await handler({
      command: 'openFile',
      filePath: '../../../../etc/passwd',
      snapshotId: 'snap1',
      line: 0,
    });

    // filePath comes from the webview and used to flow straight into
    // Uri.joinPath(workspaceRoot, filePath) with no containment check.
    expect(openTextDocument).not.toHaveBeenCalled();
    const posted = panel.webview.postMessage.mock.calls.map(
      (call) => call[0] as { command: string; message?: string },
    );
    expect(posted.some((m) => m.command === 'error')).toBe(true);
  });

  it('refuses an absolute path', async () => {
    const { handler, openTextDocument } = buildHarness();

    await handler({
      command: 'openFile',
      filePath: '/etc/passwd',
      snapshotId: 'snap1',
      line: 0,
    });

    expect(openTextDocument).not.toHaveBeenCalled();
  });

  it('refuses a non-string path', async () => {
    const { handler, openTextDocument } = buildHarness();

    await handler({
      command: 'openFile',
      filePath: { evil: true },
      snapshotId: 'snap1',
      line: 0,
    });

    expect(openTextDocument).not.toHaveBeenCalled();
  });

  it('opens a file inside the workspace', async () => {
    const { handler, openTextDocument } = buildHarness();

    await handler({
      command: 'openFile',
      filePath: 'src/a.ts',
      snapshotId: 'snap1',
      line: 2,
    });

    expect(openTextDocument).toHaveBeenCalledTimes(1);
    const uri = openTextDocument.mock.calls[0][0] as { fsPath: string };
    expect(uri.fsPath.replace(/\\/g, '/')).toBe(
      path.join(ROOT, 'src', 'a.ts').replace(/\\/g, '/'),
    );
  });

  it('does not throw when the line is missing', async () => {
    const { handler, revealRange } = buildHarness();

    // The webview sends parseInt(undefined, 10) when data-line is absent,
    // which is NaN; Math.max(0, Math.min(NaN, n)) is NaN and
    // new vscode.Position(NaN, 0) throws.
    await handler({
      command: 'openFile',
      filePath: 'src/a.ts',
      snapshotId: 'snap1',
      line: Number.NaN,
    });

    expect(revealRange).toHaveBeenCalledTimes(1);
    const range = revealRange.mock.calls[0][0] as {
      start: { line: number };
    };
    expect(range.start.line).toBe(0);
  });

  it('clamps a line past the end of the document', async () => {
    const { handler, revealRange } = buildHarness();

    await handler({
      command: 'openFile',
      filePath: 'src/a.ts',
      snapshotId: 'snap1',
      line: 999,
    });

    const range = revealRange.mock.calls[0][0] as {
      start: { line: number };
    };
    expect(range.start.line).toBe(4); // lineCount - 1
  });
});
