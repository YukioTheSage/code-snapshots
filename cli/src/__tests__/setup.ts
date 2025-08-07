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
    executeCommand: jest.fn()
  };
};

// Mock fs module for file operations in tests
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  unlinkSync: jest.fn(),
  mkdirSync: jest.fn()
}));

// Increase timeout for integration tests
jest.setTimeout(30000);