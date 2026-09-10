// Mock implementation of the vscode module for testing.
//
// This module is wired in through `moduleNameMapper` in jest.config.js, so it
// stands in for the real API in every suite. It must therefore export every
// symbol the code under test touches at import time or in a constructor —
// a missing class here surfaces as "X is not a constructor" or "Class extends
// value undefined", which reads like a bug in the code rather than the mock.
//
// Kept deliberately permissive: constructors accept anything and expose the
// properties production code assigns, so tests can assert on them.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const OutputChannel = {
  appendLine: jest.fn(),
  append: jest.fn(),
  show: jest.fn(),
  hide: jest.fn(),
  dispose: jest.fn(),
};

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];

  /**
   * Returns a subscription that actually unsubscribes.
   *
   * This previously returned `{ dispose: jest.fn() }`, which made the mock
   * convenient to assert against and useless for testing disposal: a test could
   * prove `dispose` was *called* but never that the listener stopped firing. So
   * a provider that leaked its listeners passed every test in this repo.
   *
   * Assertions should `jest.spyOn(subscription, 'dispose')` before disposing
   * rather than expecting a pre-made mock.
   */
  readonly event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index !== -1) {
          this.listeners.splice(index, 1);
        }
      },
    };
  };

  /** Current subscriber count, so tests can assert a listener was released. */
  get listenerCount(): number {
    return this.listeners.length;
  }

  fire(value?: T): void {
    for (const listener of [...this.listeners]) {
      listener(value as T);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

export class MarkdownString {
  public value: string;
  public supportThemeIcons: boolean;
  constructor(value = '', supportThemeIcons = false) {
    this.value = value;
    this.supportThemeIcons = supportThemeIcons;
  }
  appendMarkdown(text: string): MarkdownString {
    this.value += text;
    return this;
  }
  appendText(text: string): MarkdownString {
    this.value += text;
    return this;
  }
  toString(): string {
    return this.value;
  }
}

export class ThemeIcon {
  constructor(public readonly id: string, public readonly color?: unknown) {}
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class TreeItem {
  label?: unknown;
  description?: string;
  tooltip?: unknown;
  contextValue?: string;
  id?: string;
  command?: unknown;
  resourceUri?: unknown;
  iconPath?: unknown;
  collapsibleState?: number;
  accessibilityInformation?: unknown;

  constructor(label?: unknown, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class WorkspaceEdit {
  replace = jest.fn();
  insert = jest.fn();
  delete = jest.fn();
  createFile = jest.fn();
  renameFile = jest.fn();
}

export class RelativePattern {
  constructor(public readonly base: unknown, public readonly pattern: string) {}
}

export class Selection {
  constructor(
    public readonly anchor: unknown,
    public readonly active: unknown,
  ) {}
}

export class CancellationTokenSource {
  private cancelled = false;
  readonly token = {
    isCancellationRequested: false,
    onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
  };
  cancel(): void {
    this.cancelled = true;
    this.token.isCancellationRequested = true;
  }
  dispose(): void {
    void this.cancelled;
  }
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export enum ViewColumn {
  Active = -1,
  One = 1,
  Two = 2,
  Three = 3,
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export enum DecorationRangeBehavior {
  OpenOpen = 0,
  ClosedClosed = 1,
  OpenClosed = 2,
  ClosedOpen = 3,
}

export enum TextEditorRevealType {
  Default = 0,
  InCenter = 1,
  InCenterIfOutsideViewport = 2,
  AtTop = 3,
}

export const QuickPickItemKind = {
  Separator: -1,
  Default: 0,
};

export const StatusBarItem = {
  show: jest.fn(),
  hide: jest.fn(),
  dispose: jest.fn(),
};

export const window = {
  createOutputChannel: jest.fn(() => OutputChannel),
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showQuickPick: jest.fn(),
  showInputBox: jest.fn(),
  showTextDocument: jest.fn(),
  showSaveDialog: jest.fn(),
  showOpenDialog: jest.fn(),
  createStatusBarItem: jest.fn(() => ({
    text: '',
    tooltip: '' as unknown,
    command: undefined as unknown,
    accessibilityInformation: undefined as unknown,
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
  })),
  createTextEditorDecorationType: jest.fn(() => ({ dispose: jest.fn() })),
  createWebviewPanel: jest.fn(),
  createQuickPick: jest.fn(),
  createTreeView: jest.fn(),
  withProgress: jest.fn(),
  setStatusBarMessage: jest.fn(),
  visibleTextEditors: [] as unknown[],
  activeTextEditor: undefined as unknown,
  onDidChangeActiveTextEditor: jest.fn(() => ({ dispose: jest.fn() })),
  onDidChangeVisibleTextEditors: jest.fn(() => ({ dispose: jest.fn() })),
};

export const workspace = {
  // `get` returns the caller's own fallback, matching the real API's behaviour
  // for an unset key. Returning undefined here previously made every
  // config-reading constructor compute NaN (see AUDIT_REPORT.md section 15).
  getConfiguration: jest.fn(() => ({
    get: jest.fn((_key: string, fallback?: unknown) => fallback),
    has: jest.fn(() => false),
    update: jest.fn(),
    inspect: jest.fn(),
  })),
  workspaceFolders: [] as unknown[],
  name: undefined as string | undefined,
  rootPath: undefined as string | undefined,
  findFiles: jest.fn().mockResolvedValue([]),
  applyEdit: jest.fn().mockResolvedValue(true),
  openTextDocument: jest.fn(),
  asRelativePath: jest.fn((p: unknown) => String(p)),
  onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
  onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
  onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
  onDidSaveTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
  onDidCreateFiles: jest.fn(() => ({ dispose: jest.fn() })),
  onDidDeleteFiles: jest.fn(() => ({ dispose: jest.fn() })),
  registerTextDocumentContentProvider: jest.fn(() => ({ dispose: jest.fn() })),
  registerFileSystemProvider: jest.fn(() => ({ dispose: jest.fn() })),
  createFileSystemWatcher: jest.fn(() => ({
    onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
    onDidDelete: jest.fn(() => ({ dispose: jest.fn() })),
    dispose: jest.fn(),
  })),
  fs: {
    stat: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    delete: jest.fn(),
    createDirectory: jest.fn(),
    readDirectory: jest.fn().mockResolvedValue([]),
  },
};

export class Uri {
  constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query = '',
    public readonly fragment = '',
  ) {}

  get fsPath(): string {
    return this.path;
  }

  static file(p: string): Uri {
    return new Uri('file', '', p);
  }

  static parse(value: string): Uri {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/.exec(
      value,
    );
    if (!match) {
      return new Uri('file', '', value);
    }
    return new Uri(match[1], match[2], match[3] || '', '');
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    const joined = [base.path.replace(/\/+$/, ''), ...segments]
      .filter((s) => s.length > 0)
      .join('/');
    return new Uri(base.scheme, base.authority, joined, base.query);
  }

  with(change: {
    scheme?: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}${
      this.query ? `?${this.query}` : ''
    }`;
  }
}

export class Range {
  constructor(public readonly start: unknown, public readonly end: unknown) {}

  get startLine(): number {
    return (this.start as { line?: number })?.line ?? 0;
  }
  get endLine(): number {
    return (this.end as { line?: number })?.line ?? 0;
  }
  get isEmpty(): boolean {
    return this.start === this.end;
  }
  isEqual(other: Range): boolean {
    return this.start === other.start && this.end === other.end;
  }
}

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }
  translate(delta: { lineDelta?: number; characterDelta?: number }): Position {
    return new Position(
      this.line + (delta.lineDelta ?? 0),
      this.character + (delta.characterDelta ?? 0),
    );
  }
}

export class Location {
  constructor(public readonly uri: Uri, public readonly range: Range) {}
}

export class Diagnostic {
  constructor(
    public readonly range: Range,
    public readonly message: string,
    public readonly severity?: number,
  ) {}
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export const commands = {
  registerCommand: jest.fn(),
  registerTextEditorCommand: jest.fn(),
  executeCommand: jest.fn(),
  getCommands: jest.fn().mockResolvedValue([]),
};

export const languages = {
  createDiagnosticCollection: jest.fn(() => ({
    set: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    dispose: jest.fn(),
  })),
};

export const extensions = {
  getExtension: jest.fn(),
  all: [] as unknown[],
};

export const env = {
  openExternal: jest.fn(),
  clipboard: { writeText: jest.fn(), readText: jest.fn() },
  appName: 'Visual Studio Code',
  language: 'en',
};

export const Disposable = {
  from: jest.fn((...items: Array<{ dispose: () => void }>) => ({
    dispose: () => items.forEach((i) => i.dispose()),
  })),
};
