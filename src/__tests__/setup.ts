// Jest setup file for global test configuration

// Mock console methods to reduce noise during testing
global.console = {
  ...console,
  // Uncomment to ignore specific console methods during tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Set up any global test utilities or configurations here
beforeEach(() => {
  // Clear all mocks before each test
  jest.clearAllMocks();
});

// Add any global test helpers or utilities here
