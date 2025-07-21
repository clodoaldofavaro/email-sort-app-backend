const { authenticateToken } = require('../auth');
const jwt = require('jsonwebtoken');
const db = require('../../config/database');

jest.mock('jsonwebtoken');
jest.mock('../../config/database');
jest.mock('../../utils/logger');

describe('Auth Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
    process.env.JWT_SECRET = 'test-secret';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('authenticateToken', () => {
    it('should return 401 if no authorization header is provided', async () => {
      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 if no token is provided in authorization header', async () => {
      req.headers.authorization = 'Bearer ';

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 if user is not found in database', async () => {
      req.headers.authorization = 'Bearer valid-token';
      jwt.verify.mockReturnValue({ userId: 123 });
      db.query.mockResolvedValue({ rows: [] });

      await authenticateToken(req, res, next);

      expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'test-secret');
      expect(db.query).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [123]);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next() with user in request if token is valid', async () => {
      const mockUser = { id: 123, email: 'test@example.com' };
      req.headers.authorization = 'Bearer valid-token';
      jwt.verify.mockReturnValue({ userId: 123 });
      db.query.mockResolvedValue({ rows: [mockUser] });

      await authenticateToken(req, res, next);

      expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'test-secret');
      expect(db.query).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [123]);
      expect(req.user).toEqual(mockUser);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 401 if token is expired', async () => {
      req.headers.authorization = 'Bearer expired-token';
      const expiredError = new Error('Token expired');
      expiredError.name = 'TokenExpiredError';
      jwt.verify.mockImplementation(() => {
        throw expiredError;
      });

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Token expired' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 if token is invalid', async () => {
      req.headers.authorization = 'Bearer invalid-token';
      jwt.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle different authorization header formats', async () => {
      const mockUser = { id: 123, email: 'test@example.com' };
      req.headers.authorization = 'Bearer valid-token';
      jwt.verify.mockReturnValue({ userId: 123 });
      db.query.mockResolvedValue({ rows: [mockUser] });

      await authenticateToken(req, res, next);

      expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'test-secret');
      expect(req.user).toEqual(mockUser);
      expect(next).toHaveBeenCalled();
    });
  });
});