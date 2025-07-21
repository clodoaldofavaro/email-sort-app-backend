# Email Sort App Backend - Test Suite Documentation

## Overview

This test suite provides comprehensive coverage for the Email Sort App Backend, including unit tests for services and utilities, and integration tests for API routes.

## Test Structure

```
src/
├── __tests__/                    # Unit tests for individual modules
│   ├── middleware/
│   │   └── auth.test.js         # Auth middleware tests
│   ├── services/
│   │   ├── gmail.test.js        # Gmail service tests
│   │   └── openai.test.js       # OpenAI service tests
│   ├── utils/
│   │   ├── validation.test.js   # Validation utilities tests
│   │   └── emailParser.test.js  # Email parser tests
│   └── routes/
│       ├── categories.test.js   # Categories route tests
│       └── emails.test.js       # Emails route tests
└── tests/
    ├── setup.js                  # Jest setup file
    └── integration/
        └── auth.test.js          # Auth integration tests

```

## Running Tests

### All Tests
```bash
npm test
```

### Watch Mode (for development)
```bash
npm run test:watch
```

### With Coverage Report
```bash
npm run test:coverage
```

### Specific Test File
```bash
npm test -- auth.test.js
```

## Test Configuration

### Environment Variables

Tests use `.env.test` for configuration. Key variables include:
- `NODE_ENV=test`
- `DATABASE_URL` - Test database connection
- `REDIS_URL` - Test Redis connection
- `JWT_SECRET` - Test JWT secret
- Mock credentials for external services

### Jest Configuration

Located in `jest.config.js`:
- Test environment: Node.js
- Coverage threshold: 70% for all metrics
- Auto-mocking disabled for better control
- Clear mocks between tests

## Test Coverage

### 1. **Authentication Middleware** (`src/middleware/__tests__/auth.test.js`)
- Token validation
- User lookup
- Error handling (expired tokens, invalid tokens)
- Missing authorization headers

### 2. **Gmail Service** (`src/services/__tests__/gmail.test.js`)
- Gmail client initialization
- Token refresh handling
- Email processing with multipart messages
- Unsubscribe link extraction
- Error recovery and continuation

### 3. **OpenAI Service** (`src/services/__tests__/openai.test.js`)
- Email categorization with AI
- Email summarization
- Fallback behavior without API key
- Error handling and graceful degradation

### 4. **Validation Utilities** (`src/utils/__tests__/validation.test.js`)
- Schema validation for all endpoints
- Input sanitization (trimming, type coercion)
- Error message formatting
- Query parameter validation

### 5. **Email Parser** (`src/utils/__tests__/emailParser.test.js`)
- Plain text extraction
- HTML parsing and cleaning
- Multipart message handling
- Attachment tracking
- Unsubscribe link detection

### 6. **Categories Routes** (`src/routes/__tests__/categories.test.js`)
- CRUD operations
- Duplicate name prevention
- Category deletion with email check
- Authentication requirements
- Input validation

### 7. **Emails Routes** (`src/routes/__tests__/emails.test.js`)
- Pagination and filtering
- Email statistics
- Redis caching integration
- Bulk operations with transactions
- Gmail API integration
- Error handling and rollbacks

## Mocking Strategy

### External Services
- **Database**: Mocked with `jest.mock('../../config/database')`
- **Redis**: Mocked client with get/set/del methods
- **Gmail API**: Mocked Google APIs client
- **OpenAI**: Mocked API responses

### Authentication
- `authenticateToken` middleware mocked to inject test user
- Can be configured to test authentication failures

### Example Mock Setup
```javascript
// Mock database query
db.query.mockResolvedValue({ rows: [mockData] });

// Mock Redis client
const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn()
};
redis.getClient.mockReturnValue(mockRedisClient);
```

## Common Test Patterns

### 1. Route Testing
```javascript
const response = await request(app)
  .get('/endpoint')
  .set('Authorization', 'Bearer token')
  .query({ param: 'value' })
  .expect(200);

expect(response.body).toMatchObject({ expected: 'data' });
```

### 2. Error Scenarios
```javascript
db.query.mockRejectedValue(new Error('Database error'));

const response = await request(app)
  .post('/endpoint')
  .send(data)
  .expect(500);

expect(response.body).toEqual({ error: 'Expected error message' });
```

### 3. Transaction Testing
```javascript
const mockClient = {
  query: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn()
};
db.begin.mockReturnValue(mockClient);
```

## Best Practices

1. **Isolation**: Each test should be independent
2. **Clear Mocks**: Use `jest.clearAllMocks()` in `beforeEach`
3. **Descriptive Names**: Use clear test descriptions
4. **AAA Pattern**: Arrange, Act, Assert
5. **Error Testing**: Always test error scenarios
6. **Edge Cases**: Test boundary conditions

## Debugging Tests

### Verbose Output
```bash
npm test -- --verbose
```

### Single Test
```javascript
it.only('should test specific scenario', () => {
  // Test code
});
```

### Console Logs
```javascript
console.log(JSON.stringify(response.body, null, 2));
```

## Adding New Tests

1. Create test file in appropriate `__tests__` directory
2. Import module to test and mock dependencies
3. Set up `describe` blocks for logical grouping
4. Write tests covering:
   - Success cases
   - Error cases
   - Edge cases
   - Authentication/authorization

## Continuous Integration

Tests are configured to run with:
- `--runInBand`: Run tests serially (important for database tests)
- `--forceExit`: Ensure Jest exits after tests complete

Perfect for CI/CD pipelines!