// Test setup file
require('dotenv').config();

// Prevent server from starting in test environment
process.env.NODE_ENV = 'test';

// Mock database
jest.mock('../config/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  end: jest.fn().mockResolvedValue(undefined),
  connect: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn()
  }),
  begin: jest.fn().mockReturnValue({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    commit: jest.fn(),
    rollback: jest.fn()
  })
}));

// Mock Redis if not available
jest.mock('../config/redisCache', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  setEx: jest.fn(),
  isAvailable: jest.fn().mockReturnValue(false)
}));

// Mock queues
jest.mock('../config/queues', () => ({
  emailQueue: {
    add: jest.fn(),
    process: jest.fn()
  },
  unsubscribeQueue: {
    add: jest.fn(),
    process: jest.fn()
  }
}));

// Mock external services for testing
// Note: OpenAI service is mocked individually in each test file to allow proper control

// Mock websocket to prevent server initialization
jest.mock('../websocket/notificationSocket', () => ({
  initializeWebSocket: jest.fn(),
  sendNotification: jest.fn()
}));

// Mock worker initialization
jest.mock('../workers', () => ({
  initializeWorkers: jest.fn()
}));

// Suppress console logs in tests
if (process.env.NODE_ENV === 'test') {
  global.console = {
    ...console,
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  };
}

module.exports = {};
