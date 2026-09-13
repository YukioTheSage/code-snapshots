/* eslint-disable @typescript-eslint/no-explicit-any */
// Jest setup file for CLI tests

// Mock console methods to avoid noise in test output
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

beforeEach(() => {
  // Reset console mocks before each test
  console.log = jest.fn();
  console.error = jest.fn();
});

afterEach(() => {
  // Restore original console methods after each test
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});

// Global test utilities
(global as any).createMockClient = () => {
  return {
    callApi: jest.fn(),
    getStatus: jest.fn(),
    disconnect: jest.fn(),
    watchEvents: jest.fn(),
    executeCommand: jest.fn(),
  };
};

// Mock fs module for file operations in tests.
//
// `readFileSync` delegates to the real implementation unless a test stubs it.
// As a bare `jest.fn()` it returned `undefined` for every read, so any code
// path that genuinely needs to read a file (such as cli.ts reading its own
// package.json for `--version`) failed with a confusing
// `SyntaxError: "undefined" is not valid JSON` instead of a missing-file error.
// The remaining stubs stay no-ops to avoid changing existing suite behaviour.
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    readFileSync: jest.fn(actual.readFileSync),
    writeFileSync: jest.fn(),
    existsSync: jest.fn(),
    unlinkSync: jest.fn(),
    mkdirSync: jest.fn(),
  };
});

// Increase timeout for integration tests
jest.setTimeout(30000);
