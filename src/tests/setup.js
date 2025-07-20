// Test setup file
require('dotenv').config();

// Mock database for tests
const mockDb = {
  query: jest.fn(),
  end: jest.fn(),
};

// Mock Redis if not available
if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
  jest.mock('../config/redis', () => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  }));
}

// Mock external services for testing
jest.mock('../services/openai', () => ({
  categorizeEmail: jest.fn().mockResolvedValue('Test Category'),
  summarizeEmail: jest.fn().mockResolvedValue('Test summary'),
}));

module.exports = { mockDb };
