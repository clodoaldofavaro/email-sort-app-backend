const request = require('supertest');
const express = require('express');
const emailsRouter = require('../emails');
const db = require('../../config/database');
const redis = require('../../config/redisCache');
const { authenticateToken } = require('../../middleware/auth');

jest.mock('../../config/database');
jest.mock('../../config/redisCache');
jest.mock('../../middleware/auth');
jest.mock('../../services/gmail');
jest.mock('../../utils/logger');

describe('Emails Routes - Smoke Tests', () => {
  let app;
  let mockUser;

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

    // Mock Redis methods
    redis.get = jest.fn();
    redis.set = jest.fn();
    redis.del = jest.fn();
    redis.setEx = jest.fn();
    redis.isAvailable = jest.fn().mockReturnValue(true);

    // Mock db.connect for bulk move test
    db.connect = jest.fn();

    jest.clearAllMocks();
  });

  describe('GET /emails/category/:categoryId', () => {
    it('should return emails for a valid category', async () => {
      // Mock category exists
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // Category exists
        .mockResolvedValueOnce({ // Emails
          rows: [
            { id: '1', subject: 'Email 1', category_name: 'Work' },
            { id: '2', subject: 'Email 2', category_name: 'Work' }
          ]
        })
        .mockResolvedValueOnce({ rows: [{ count: '2' }] }); // Count

      const response = await request(app)
        .get('/emails/category/1')
        .expect(200);

      expect(response.body).toHaveProperty('emails');
      expect(response.body.emails).toHaveLength(2);
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1
      });
    });

    it('should return 404 for non-existent category', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/emails/category/999')
        .expect(404);
    });
  });

  describe('GET /emails/:id', () => {
    it('should return email details', async () => {
      db.query.mockResolvedValue({
        rows: [{
          id: '550e8400-e29b-41d4-a716-446655440001',
          subject: 'Test Email',
          sender: 'test@example.com'
        }]
      });

      const response = await request(app)
        .get('/emails/550e8400-e29b-41d4-a716-446655440001')
        .expect(200);

      expect(response.body.subject).toBe('Test Email');
    });
  });

  describe('GET /emails/:id/content', () => {
    it('should return email content from cache', async () => {
      db.query.mockResolvedValue({
        rows: [{
          id: 123,
          gmail_id: 'gmail123',
          subject: 'Test Email',
          sender: 'test@example.com',
          account_id: 1,
          account_email: 'test@gmail.com',
          refresh_token: 'refresh-token'
        }]
      });
      
      const cachedContent = {
        body: 'This is the email body',
        html: '<p>This is the email body</p>',
        attachments: []
      };
      
      redis.get.mockResolvedValue(JSON.stringify(cachedContent));

      const response = await request(app)
        .get('/emails/123/content')
        .expect(200);

      expect(response.body).toHaveProperty('content');
      expect(response.body.content).toEqual(cachedContent);
      expect(response.body.cached).toBe(true);
    });
  });

  describe('DELETE /emails/bulk', () => {
    it('should delete multiple emails', async () => {
      db.query.mockResolvedValue({ 
        rows: [{ id: 'id1' }, { id: 'id2' }],
        rowCount: 2 
      });

      const response = await request(app)
        .delete('/emails/bulk')
        .send({ emailIds: ['id1', 'id2'] })
        .expect(200);

      expect(response.body.message).toBe('Successfully deleted 2 emails');
      expect(response.body.deletedIds).toEqual(['id1', 'id2']);
    });
  });

  describe('PUT /emails/:id/category', () => {
    it('should update email category', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 2 }] }) // Category exists
        .mockResolvedValueOnce({ // Update result
          rows: [{
            id: '550e8400-e29b-41d4-a716-446655440001',
            category_id: 2
          }]
        });

      const response = await request(app)
        .put('/emails/550e8400-e29b-41d4-a716-446655440001/category')
        .send({ categoryId: 2 })
        .expect(200);

      expect(response.body.category_id).toBe(2);
    });
  });

  describe('PUT /emails/bulk/move', () => {
    it('should bulk move emails', async () => {
      // Mock db.connect
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ id: 2, name: 'Personal' }] }) // Category exists
          .mockResolvedValueOnce(undefined) // BEGIN transaction
          .mockResolvedValueOnce({ // Email details
            rows: [
              { id: 'id1', category_id: 1, sender: 'test1@example.com', from_category_name: 'Work' },
              { id: 'id2', category_id: 1, sender: 'test2@example.com', from_category_name: 'Work' },
              { id: 'id3', category_id: 1, sender: 'test3@example.com', from_category_name: 'Work' }
            ]
          })
          .mockResolvedValueOnce({ rows: [{ id: 'id1' }, { id: 'id2' }, { id: 'id3' }] }) // Update result
          .mockResolvedValueOnce({ rows: [] }) // Movement tracking
          .mockResolvedValueOnce(undefined), // COMMIT transaction
        release: jest.fn()
      };
      
      db.connect.mockResolvedValue(mockClient);

      const response = await request(app)
        .put('/emails/bulk/move')
        .send({
          emailIds: ['id1', 'id2', 'id3'],
          toCategoryId: 2
        })
        .expect(200);

      expect(response.body.message).toBe('Successfully moved 3 emails to Personal');
      expect(response.body.toCategoryName).toBe('Personal');
      expect(response.body.movedCount).toBe(3);
      expect(response.body.movedIds).toHaveLength(3);
    });
  });

  describe('POST /emails/process', () => {
    it('should trigger email processing', async () => {
      // Mock getting user accounts
      db.query.mockResolvedValue({
        rows: [
          { email: 'test1@gmail.com' },
          { email: 'test2@gmail.com' }
        ]
      });

      // Mock processNewEmails from gmail service
      const { processNewEmails } = require('../../services/gmail');
      processNewEmails.mockResolvedValue(5); // Processed 5 emails

      const response = await request(app)
        .post('/emails/process')
        .expect(200);

      expect(response.body.message).toBe('Email processing completed');
      expect(response.body.accounts).toHaveLength(2);
    });
  });

  describe('GET /emails/stats/overview', () => {
    it('should return email statistics', async () => {
      db.query
        .mockResolvedValueOnce({ // Overall stats
          rows: [{
            total_emails: '100',
            unsubscribed_count: '15',
            unique_senders: '45',
            last_7_days: '25',
            with_unsubscribe_link: '30',
            categories_used: '5'
          }]
        })
        .mockResolvedValueOnce({ // Category breakdown
          rows: [
            { category_name: 'Work', category_id: 1, category_count: '50' },
            { category_name: 'Personal', category_id: 2, category_count: '50' }
          ]
        });

      const response = await request(app)
        .get('/emails/stats/overview')
        .expect(200);

      expect(response.body).toHaveProperty('overview');
      expect(response.body.overview.total_emails).toBe(100);
      expect(response.body.overview.last_7_days).toBe(25);
      expect(response.body.overview.unsubscribed_count).toBe(15);
      expect(response.body).toHaveProperty('byCategory');
      expect(response.body.byCategory).toHaveLength(2);
    });
  });

  describe('Authentication', () => {
    it('should require authentication for all routes', async () => {
      authenticateToken.mockImplementation((req, res, next) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      await request(app).get('/emails/category/1').expect(401);
      await request(app).get('/emails/123').expect(401);
      await request(app).get('/emails/123/content').expect(401);
      await request(app).delete('/emails/bulk').expect(401);
      await request(app).put('/emails/123/category').expect(401);
      await request(app).put('/emails/bulk/move').expect(401);
      await request(app).post('/emails/process').expect(401);
      await request(app).get('/emails/stats/overview').expect(401);
    });
  });
});