module.exports = {
  testEnvironment: 'node',
  rootDir: './src',
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
  coverageDirectory: '../coverage',
  collectCoverageFrom: [
    '**/*.js',
    '!**/node_modules/**',
    '!**/tests/**',
    '!**/database/migrations/**',
    '!**/coverage/**'
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 10000,
  clearMocks: true,
  restoreMocks: true,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1'
  },
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  }
};