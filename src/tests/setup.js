// Test setup file
require('dotenv').config();

// Mock database for tests
const mockDb = {
  query: jest.fn(),
  end: jest.fn(),
};

// Mock Redis if not available
if (!process.env.REDIS_URL && !process.env.REDIS_HOST && !process.env.REDIS_CACHE_URL && !process.env.REDIS_CACHE_HOST) {
  jest.mock('../config/redisCache', () => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    setEx: jest.fn(),
    isAvailable: jest.fn().mockReturnValue(false)
  }));
  
  jest.mock('../config/redisQueue', () => null);
}

// Mock external services for testing
jest.mock('../services/openai', () => ({
  categorizeEmail: jest.fn().mockResolvedValue('Test Category'),
  summarizeEmail: jest.fn().mockResolvedValue('Test summary'),
}));

module.exports = { mockDb };
