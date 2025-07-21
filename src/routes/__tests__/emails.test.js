const request = require('supertest');
const express = require('express');
const emailsRouter = require('../emails');
const db = require('../../config/database');
const redis = require('../../config/redis');
const { authenticateToken } = require('../../middleware/auth');
const { getGmailClient } = require('../../services/gmail');

jest.mock('../../config/database');
jest.mock('../../config/redis');
jest.mock('../../middleware/auth');
jest.mock('../../services/gmail');
jest.mock('../../utils/logger');

describe('Emails Routes', () => {
  let app;
  let mockUser;
  let mockRedisClient;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/emails', emailsRouter);

    mockUser = { id: 123, email: 'test@example.com' };

    // Mock authenticateToken to always pass
    authenticateToken.mockImplementation((req, res, next) => {
      req.user = mockUser;
      next();
    });

    // Mock Redis client
    mockRedisClient = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn()
    };
    redis.getClient.mockReturnValue(mockRedisClient);

    jest.clearAllMocks();
  });

  describe('GET /emails', () => {
    it('should return paginated emails', async () => {
      const mockEmails = [
        {
          id: '550e8400-e29b-41d4-a716-446655440001',
          subject: 'Test Email 1',
          sender: 'sender1@example.com',
          ai_summary: 'Summary 1',
          received_at: new Date(),
          is_read: false,
          category_name: 'Work'
        },
        {
          id: '550e8400-e29b-41d4-a716-446655440002',
          subject: 'Test Email 2',
          sender: 'sender2@example.com',
          ai_summary: 'Summary 2',
          received_at: new Date(),
          is_read: true,
          category_name: 'Personal'
        }
      ];

      db.query
        .mockResolvedValueOnce({ rows: [{ total: '2' }] }) // Count query
        .mockResolvedValueOnce({ rows: mockEmails }); // Emails query

      const response = await request(app)
        .get('/emails')
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body).toEqual({
        emails: mockEmails,
        totalEmails: 2,
        currentPage: 1,
        totalPages: 1,
        hasMore: false
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(DISTINCT e.id)'),
        [mockUser.id]
      );
    });

    it('should filter emails by category', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/emails')
        .query({ category: '1' })
        .expect(200);

      expect(db.query.mock.calls[0][0]).toContain('AND e.category_id = $2');
      expect(db.query.mock.calls[0][1]).toEqual([mockUser.id, '1']);
    });

    it('should filter emails by read status', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '5' }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/emails')
        .query({ is_read: 'false' })
        .expect(200);

      expect(db.query.mock.calls[0][0]).toContain('AND e.is_read = $2');
      expect(db.query.mock.calls[0][1]).toEqual([mockUser.id, false]);
    });

    it('should filter emails by account', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '3' }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/emails')
        .query({ account: 'test@gmail.com' })
        .expect(200);

      expect(db.query.mock.calls[0][0]).toContain('AND ea.email = $2');
      expect(db.query.mock.calls[0][1]).toEqual([mockUser.id, 'test@gmail.com']);
    });

    it('should search emails by query', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '2' }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/emails')
        .query({ search: 'important' })
        .expect(200);

      expect(db.query.mock.calls[0][0]).toContain('AND (e.subject ILIKE $2 OR e.sender ILIKE $2)');
      expect(db.query.mock.calls[0][1]).toEqual([mockUser.id, '%important%']);
    });

    it('should handle pagination correctly', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: '50' }] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/emails')
        .query({ page: 3, limit: 10 })
        .expect(200);

      expect(response.body).toMatchObject({
        currentPage: 3,
        totalPages: 5,
        hasMore: true
      });

      expect(db.query.mock.calls[1][0]).toContain('OFFSET 20');
    });

    it('should handle database errors', async () => {
      db.query.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/emails')
        .expect(500);

      expect(response.body).toEqual({ error: 'Failed to fetch emails' });
    });
  });

  describe('GET /emails/stats', () => {
    it('should return email statistics', async () => {
      const mockStats = {
        totalEmails: '100',
        unreadEmails: '25',
        categoriesBreakdown: [
          { category_name: 'Work', count: '40' },
          { category_name: 'Personal', count: '30' },
          { category_name: 'Marketing', count: '30' }
        ],
        topSenders: [
          { sender: 'boss@company.com', count: '15' },
          { sender: 'newsletter@example.com', count: '10' }
        ]
      };

      db.query
        .mockResolvedValueOnce({ rows: [{ total: '100' }] }) // Total emails
        .mockResolvedValueOnce({ rows: [{ total: '25' }] }) // Unread emails
        .mockResolvedValueOnce({ rows: mockStats.categoriesBreakdown }) // Categories
        .mockResolvedValueOnce({ rows: mockStats.topSenders }); // Top senders

      const response = await request(app)
        .get('/emails/stats')
        .expect(200);

      expect(response.body).toEqual({
        totalEmails: 100,
        unreadEmails: 25,
        categoriesBreakdown: mockStats.categoriesBreakdown,
        topSenders: mockStats.topSenders
      });
    });

    it('should handle database errors in stats', async () => {
      db.query.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/emails/stats')
        .expect(500);

      expect(response.body).toEqual({ error: 'Failed to fetch email statistics' });
    });
  });

  describe('GET /emails/:id', () => {
    it('should return email with cached body', async () => {
      const mockEmail = {
        id: '550e8400-e29b-41d4-a716-446655440001',
        subject: 'Test Email',
        sender: 'sender@example.com',
        body: null, // Body not in DB
        ai_summary: 'Summary',
        category_name: 'Work'
      };

      db.query.mockResolvedValue({ rows: [mockEmail] });
      mockRedisClient.get.mockResolvedValue('Cached email body content');

      const response = await request(app)
        .get('/emails/550e8400-e29b-41d4-a716-446655440001')
        .expect(200);

      expect(response.body).toEqual({
        ...mockEmail,
        body: 'Cached email body content'
      });

      expect(mockRedisClient.get).toHaveBeenCalledWith(
        'email:body:550e8400-e29b-41d4-a716-446655440001'
      );
    });

    it('should fetch body from Gmail if not cached', async () => {
      const mockEmail = {
        id: '550e8400-e29b-41d4-a716-446655440001',
        gmail_id: 'gmail123',
        subject: 'Test Email',
        body: null
      };

      const mockGmailClient = {
        users: {
          messages: {
            get: jest.fn().mockResolvedValue({
              data: {
                payload: {
                  body: {
                    data: Buffer.from('Gmail email body').toString('base64')
                  }
                }
              }
            })
          }
        }
      };

      db.query.mockResolvedValue({ rows: [mockEmail] });
      mockRedisClient.get.mockResolvedValue(null);
      getGmailClient.mockResolvedValue({ gmail: mockGmailClient });

      const response = await request(app)
        .get('/emails/550e8400-e29b-41d4-a716-446655440001')
        .expect(200);

      expect(response.body.body).toBe('Gmail email body');
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'email:body:550e8400-e29b-41d4-a716-446655440001',
        'Gmail email body',
        'EX',
        3600
      );
    });

    it('should return 404 when email not found', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .get('/emails/550e8400-e29b-41d4-a716-446655440001')
        .expect(404);

      expect(response.body).toEqual({ error: 'Email not found' });
    });

    it('should validate UUID format', async () => {
      const response = await request(app)
        .get('/emails/invalid-uuid')
        .expect(400);

      expect(response.body).toEqual({ error: 'Invalid email ID format' });
    });
  });

  describe('PUT /emails/:id/read', () => {
    it('should mark email as read', async () => {
      db.query.mockResolvedValue({
        rows: [{
          id: '550e8400-e29b-41d4-a716-446655440001',
          is_read: true
        }]
      });

      const response = await request(app)
        .put('/emails/550e8400-e29b-41d4-a716-446655440001/read')
        .expect(200);

      expect(response.body.is_read).toBe(true);
      expect(db.query).toHaveBeenCalledWith(
        'UPDATE emails SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING *',
        ['550e8400-e29b-41d4-a716-446655440001', mockUser.id]
      );
    });

    it('should return 404 when email not found', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .put('/emails/550e8400-e29b-41d4-a716-446655440001/read')
        .expect(404);

      expect(response.body).toEqual({ error: 'Email not found' });
    });
  });

  describe('PUT /emails/:id/unread', () => {
    it('should mark email as unread', async () => {
      db.query.mockResolvedValue({
        rows: [{
          id: '550e8400-e29b-41d4-a716-446655440001',
          is_read: false
        }]
      });

      const response = await request(app)
        .put('/emails/550e8400-e29b-41d4-a716-446655440001/unread')
        .expect(200);

      expect(response.body.is_read).toBe(false);
      expect(db.query).toHaveBeenCalledWith(
        'UPDATE emails SET is_read = FALSE WHERE id = $1 AND user_id = $2 RETURNING *',
        ['550e8400-e29b-41d4-a716-446655440001', mockUser.id]
      );
    });
  });

  describe('PUT /emails/:id/category/:categoryId', () => {
    it('should update email category', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // Category exists check
        .mockResolvedValueOnce({ // Update email
          rows: [{
            id: '550e8400-e29b-41d4-a716-446655440001',
            category_id: 1
          }]
        });

      const response = await request(app)
        .put('/emails/550e8400-e29b-41d4-a716-446655440001/category/1')
        .expect(200);

      expect(response.body.category_id).toBe(1);
      expect(db.query).toHaveBeenCalledWith(
        'SELECT id FROM categories WHERE id = $1 AND user_id = $2',
        ['1', mockUser.id]
      );
    });

    it('should return 404 when category not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .put('/emails/550e8400-e29b-41d4-a716-446655440001/category/999')
        .expect(404);

      expect(response.body).toEqual({ error: 'Category not found' });
    });
  });

  describe('POST /emails/bulk-move', () => {
    it('should bulk move emails to category', async () => {
      const bulkMoveData = {
        emailIds: [
          '550e8400-e29b-41d4-a716-446655440001',
          '550e8400-e29b-41d4-a716-446655440002'
        ],
        categoryId: 2
      };

      db.query.mockResolvedValue({ rows: [{ id: 2 }] }); // Category exists
      db.begin.mockReturnValue({
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ user_id: mockUser.id }] }) // Email 1 ownership
          .mockResolvedValueOnce({ rows: [{ user_id: mockUser.id }] }) // Email 2 ownership
          .mockResolvedValueOnce({ rowCount: 2 }), // Update result
        commit: jest.fn(),
        rollback: jest.fn()
      });

      const response = await request(app)
        .post('/emails/bulk-move')
        .send(bulkMoveData)
        .expect(200);

      expect(response.body).toEqual({
        message: '2 emails moved successfully'
      });
    });

    it('should validate email IDs format', async () => {
      const invalidData = {
        emailIds: ['invalid-uuid'],
        categoryId: 1
      };

      const response = await request(app)
        .post('/emails/bulk-move')
        .send(invalidData)
        .expect(400);

      expect(response.body.error).toContain('uuid');
    });

    it('should handle unauthorized email access', async () => {
      const bulkMoveData = {
        emailIds: ['550e8400-e29b-41d4-a716-446655440001'],
        categoryId: 2
      };

      db.query.mockResolvedValue({ rows: [{ id: 2 }] });
      db.begin.mockReturnValue({
        query: jest.fn().mockResolvedValueOnce({ rows: [{ user_id: 999 }] }), // Different user
        rollback: jest.fn()
      });

      const response = await request(app)
        .post('/emails/bulk-move')
        .send(bulkMoveData)
        .expect(403);

      expect(response.body).toEqual({
        error: 'Unauthorized access to one or more emails'
      });
    });

    it('should rollback transaction on error', async () => {
      const bulkMoveData = {
        emailIds: ['550e8400-e29b-41d4-a716-446655440001'],
        categoryId: 2
      };

      const mockClient = {
        query: jest.fn().mockRejectedValue(new Error('Database error')),
        rollback: jest.fn()
      };

      db.query.mockResolvedValue({ rows: [{ id: 2 }] });
      db.begin.mockReturnValue(mockClient);

      const response = await request(app)
        .post('/emails/bulk-move')
        .send(bulkMoveData)
        .expect(500);

      expect(mockClient.rollback).toHaveBeenCalled();
      expect(response.body).toEqual({ error: 'Failed to move emails' });
    });
  });

  describe('DELETE /emails/:id', () => {
    it('should delete email and clear cache', async () => {
      db.query.mockResolvedValue({
        rows: [{
          id: '550e8400-e29b-41d4-a716-446655440001',
          subject: 'Deleted Email'
        }]
      });

      const response = await request(app)
        .delete('/emails/550e8400-e29b-41d4-a716-446655440001')
        .expect(200);

      expect(response.body).toEqual({ message: 'Email deleted successfully' });
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        'email:body:550e8400-e29b-41d4-a716-446655440001'
      );
    });

    it('should return 404 when email not found', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .delete('/emails/550e8400-e29b-41d4-a716-446655440001')
        .expect(404);

      expect(response.body).toEqual({ error: 'Email not found' });
    });

    it('should handle Redis errors gracefully', async () => {
      db.query.mockResolvedValue({ rows: [{ id: '1' }] });
      mockRedisClient.del.mockRejectedValue(new Error('Redis error'));

      const response = await request(app)
        .delete('/emails/550e8400-e29b-41d4-a716-446655440001')
        .expect(200);

      expect(response.body).toEqual({ message: 'Email deleted successfully' });
    });
  });

  describe('Authentication', () => {
    it('should require authentication for all routes', async () => {
      authenticateToken.mockImplementation((req, res, next) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      await request(app).get('/emails').expect(401);
      await request(app).get('/emails/stats').expect(401);
      await request(app).get('/emails/550e8400-e29b-41d4-a716-446655440001').expect(401);
      await request(app).put('/emails/550e8400-e29b-41d4-a716-446655440001/read').expect(401);
      await request(app).put('/emails/550e8400-e29b-41d4-a716-446655440001/unread').expect(401);
      await request(app).put('/emails/550e8400-e29b-41d4-a716-446655440001/category/1').expect(401);
      await request(app).post('/emails/bulk-move').expect(401);
      await request(app).delete('/emails/550e8400-e29b-41d4-a716-446655440001').expect(401);
    });
  });
});