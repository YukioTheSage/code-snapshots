/**
 * Smoke test for the shared vscode mock.
 *
 * The mock stands in for the real API in every suite via moduleNameMapper, so
 * a gap in it looks like a bug in the code under test: "Class extends value
 * undefined" or "X is not a function" at construction time. Before this test
 * existed, no suite imported SnapshotManager or SnapshotStorage at all, so the
 * gaps went unnoticed and every plan's tests failed before their first
 * assertion (PLAN_AUDIT.md blocker B1).
 *
 * This asserts the mock is sufficient to construct the extension's most
 * important objects and that configuration defaults resolve to real numbers.
 */

import * as vscode from 'vscode';
import { SnapshotManager } from '../snapshotManager';
import { SnapshotStorage } from '../snapshotStorage';
import { CodeChunker } from '../services/codeChunker';
import { EditorDecorator } from '../editorDecorator';

describe('vscode mock sufficiency', () => {
  it('can construct SnapshotStorage', () => {
    expect(() => new SnapshotStorage()).not.toThrow();
  });

  it('can construct SnapshotManager', () => {
    expect(() => new SnapshotManager(null)).not.toThrow();
  });

  it('can construct EditorDecorator', () => {
    const manager = new SnapshotManager(null);
    expect(() => new EditorDecorator(manager)).not.toThrow();
  });

  it('can construct CodeChunker with numeric configuration, not NaN', () => {
    const chunker = new CodeChunker();
    // A mock whose config.get returned undefined made these NaN, silently
    // exercising a code path production never takes.
    expect((chunker as unknown as { chunkSize: number }).chunkSize).toBe(250);
    expect((chunker as unknown as { chunkOverlap: number }).chunkOverlap).toBe(
      100,
    );
  });

  it('honours an explicit configuration override', () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValueOnce({
      get: (key: string, fallback?: unknown) =>
        key === 'chunkSize' ? 40 : key === 'chunkOverlap' ? 10 : fallback,
      update: jest.fn(),
    });

    const chunker = new CodeChunker();
    expect((chunker as unknown as { chunkSize: number }).chunkSize).toBe(40);
    expect((chunker as unknown as { chunkOverlap: number }).chunkOverlap).toBe(
      10,
    );
  });
});

describe('vscode mock surface', () => {
  it('constructs an EventEmitter that fires to its listeners', () => {
    const emitter = new vscode.EventEmitter<number>();
    const seen: number[] = [];
    const sub = emitter.event((value) => seen.push(value));

    emitter.fire(7);

    expect(seen).toEqual([7]);
    expect(() => sub.dispose()).not.toThrow();
  });

  it('parses and joins Uris', () => {
    const joined = vscode.Uri.joinPath(vscode.Uri.file('/work'), 'src', 'a.ts');
    expect(joined.fsPath).toBe('/work/src/a.ts');

    const parsed = vscode.Uri.parse('snapshot-diff://snap-a/src/a.ts?nonce=1');
    expect(parsed.scheme).toBe('snapshot-diff');
    expect(parsed.authority).toBe('snap-a');
    expect(parsed.path).toBe('/src/a.ts');
  });

  it('reports the declared configuration default to the caller', () => {
    const config = vscode.workspace.getConfiguration('vscode-snapshots');
    expect(config.get('anything', 'fallback')).toBe('fallback');
    expect(config.get('aNumber', 42)).toBe(42);
  });

  it('provides a status bar item with the full disposable surface', () => {
    const item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    item.text = 'x';
    item.tooltip = 'y';
    item.command = 'z';
    expect(() => item.show()).not.toThrow();
    expect(() => item.hide()).not.toThrow();
    expect(() => item.dispose()).not.toThrow();
  });

  it('provides the TreeItem subclass surface treeView.ts relies on', () => {
    const item = new vscode.TreeItem(
      'label',
      vscode.TreeItemCollapsibleState.None,
    );
    item.contextValue = 'snapshotItem';
    item.iconPath = new vscode.ThemeIcon('history');
    expect(item.label).toBe('label');
    expect(item.contextValue).toBe('snapshotItem');
  });

  it('provides MarkdownString with theme-icon support', () => {
    const md = new vscode.MarkdownString('', true);
    md.appendMarkdown('### Title');
    expect(md.supportThemeIcons).toBe(true);
    expect(md.value).toContain('Title');
  });
});
