// Mock implementation of vscode module for testing

export const OutputChannel = {
  appendLine: jest.fn(),
  append: jest.fn(),
  show: jest.fn(),
  hide: jest.fn(),
  dispose: jest.fn(),
};

export const window = {
  createOutputChannel: jest.fn(() => OutputChannel),
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showErrorMessage: jest.fn(),
};

export const workspace = {
  getConfiguration: jest.fn(() => ({
    get: jest.fn(),
    update: jest.fn(),
  })),
  workspaceFolders: [],
};

export const Uri = {
  file: jest.fn((path: string) => ({ fsPath: path, path })),
  parse: jest.fn((uri: string) => ({ fsPath: uri, path: uri })),
};

export const Range = jest.fn();
export const Position = jest.fn();
export const Location = jest.fn();

// Export commonly used enums and constants
export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

export const ViewColumn = {
  One: 1,
  Two: 2,
  Three: 3,
};

// Mock any other vscode APIs that might be used
export const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn(),
};

export const languages = {
  createDiagnosticCollection: jest.fn(),
};

export const extensions = {
  getExtension: jest.fn(),
};
