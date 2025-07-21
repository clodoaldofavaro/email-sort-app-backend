const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../server');
const db = require('../../config/database');
const redis = require('../../config/redisCache');

// Mock external services
jest.mock('../../services/gmail', () => ({
  getGmailClient: jest.fn(),
  processNewEmails: jest.fn()
}));

const { getGmailClient, processNewEmails } = require('../../services/gmail');

describe('Emails Route Integration Tests', () => {
  let authToken;
  let userId;
  let categoryId;
  let accountId;
  let emailId;
  let client;

  // Helper function to create auth token
  const createAuthToken = (id) => {
    return jwt.sign({ userId: id }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' });
  };

  beforeAll(async () => {
    // Get a database connection for test setup
    client = await db.connect();
    
    // Start transaction
    await client.query('BEGIN');
    
    try {
      // Create test user
      const userResult = await client.query(
        `INSERT INTO users (email, name, google_id, picture, created_at, updated_at) 
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
         RETURNING id`,
        ['test-emails@example.com', 'Test User', 'google-test-id-emails', 'https://example.com/pic.jpg']
      );
      userId = userResult.rows[0].id;
      authToken = createAuthToken(userId);

      // Create test email account
      const accountResult = await client.query(
        `INSERT INTO email_accounts (user_id, email, refresh_token, created_at, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id`,
        [userId, 'test-account@gmail.com', 'test-refresh-token']
      );
      accountId = accountResult.rows[0].id;

      // Create test category
      const categoryResult = await client.query(
        `INSERT INTO categories (user_id, name, description, created_at, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id`,
        [userId, 'Test Category', 'Test category for emails', 'CURRENT_TIMESTAMP', 'CURRENT_TIMESTAMP']
      );
      categoryId = categoryResult.rows[0].id;

      // Create test emails
      const emailsToInsert = [
        {
          gmail_id: 'gmail-id-1',
          subject: 'Test Email 1',
          sender: 'sender1@example.com',
          snippet: 'This is test email 1',
          unsubscribe_link: 'https://example.com/unsubscribe1',
          unsubscribe_status: 'pending',
          ai_summary: 'Summary of test email 1'
        },
        {
          gmail_id: 'gmail-id-2',
          subject: 'Test Email 2',
          sender: 'sender2@example.com',
          snippet: 'This is test email 2',
          unsubscribe_link: null,
          unsubscribe_status: null,
          ai_summary: 'Summary of test email 2'
        },
        {
          gmail_id: 'gmail-id-3',
          subject: 'Test Email 3',
          sender: 'sender3@example.com',
          snippet: 'This is test email 3',
          unsubscribe_link: 'https://example.com/unsubscribe3',
          unsubscribe_status: 'completed',
          unsubscribe_completed_at: new Date(),
          ai_summary: 'Summary of test email 3'
        }
      ];

      for (const email of emailsToInsert) {
        const result = await client.query(
          `INSERT INTO emails (
            user_id, account_id, category_id, gmail_id, subject, sender, 
            snippet, received_at, unsubscribe_link, unsubscribe_status, 
            unsubscribe_completed_at, ai_summary, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING id`,
          [
            userId, accountId, categoryId, email.gmail_id, email.subject, 
            email.sender, email.snippet, new Date(), email.unsubscribe_link,
            email.unsubscribe_status, email.unsubscribe_completed_at || null,
            email.ai_summary
          ]
        );
        if (!emailId) {
          emailId = result.rows[0].id;
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    // Clean up test data
    await db.query('DELETE FROM emails WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM categories WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM email_accounts WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    await db.end();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/emails/category/:categoryId', () => {
    it('should fetch emails for a category with pagination', async () => {
      const response = await request(app)
        .get(`/api/emails/category/${categoryId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body).toHaveProperty('emails');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.emails).toBeInstanceOf(Array);
      expect(response.body.emails.length).toBeGreaterThan(0);
      expect(response.body.pagination).toMatchObject({
        page: 1,
        limit: 10,
        total: expect.any(Number),
        totalPages: expect.any(Number)
      });
      
      // Verify email structure
      const firstEmail = response.body.emails[0];
      expect(firstEmail).toHaveProperty('id');
      expect(firstEmail).toHaveProperty('subject');
      expect(firstEmail).toHaveProperty('sender');
      expect(firstEmail).toHaveProperty('category_name');
      expect(firstEmail).toHaveProperty('account_email');
    });

    it('should filter emails by account', async () => {
      const response = await request(app)
        .get(`/api/emails/category/${categoryId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({ accountId })
        .expect(200);

      expect(response.body.emails).toBeInstanceOf(Array);
      response.body.emails.forEach(email => {
        expect(email.account_id).toBe(accountId);
      });
    });

    it('should filter emails by unsubscribe link presence', async () => {
      const response = await request(app)
        .get(`/api/emails/category/${categoryId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({ hasUnsubscribe: 'true' })
        .expect(200);

      expect(response.body.emails).toBeInstanceOf(Array);
      response.body.emails.forEach(email => {
        expect(email.unsubscribe_link).not.toBeNull();
      });
    });

    it('should filter emails by unsubscribe status', async () => {
      const response = await request(app)
        .get(`/api/emails/category/${categoryId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({ unsubscribeStatus: 'completed' })
        .expect(200);

      expect(response.body.emails).toBeInstanceOf(Array);
      response.body.emails.forEach(email => {
        expect(email.unsubscribe_status).toBe('completed');
      });
    });

    it('should return 404 for non-existent category', async () => {
      const response = await request(app)
        .get('/api/emails/category/99999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Category not found');
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get(`/api/emails/category/${categoryId}`)
        .expect(401);

      expect(response.body.error).toBe('Access token required');
    });
  });

  describe('GET /api/emails/:id', () => {
    it('should fetch a single email', async () => {
      const response = await request(app)
        .get(`/api/emails/${emailId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', emailId);
      expect(response.body).toHaveProperty('subject');
      expect(response.body).toHaveProperty('sender');
      expect(response.body).toHaveProperty('category_name');
    });

    it('should return 404 for non-existent email', async () => {
      const response = await request(app)
        .get('/api/emails/99999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Email not found');
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get(`/api/emails/${emailId}`)
        .expect(401);

      expect(response.body.error).toBe('Access token required');
    });
  });

  describe('GET /api/emails/:id/content', () => {
    beforeEach(() => {
      // Mock Gmail client
      const mockGmail = {
        users: {
          messages: {
            get: jest.fn().mockResolvedValue({
              data: {
                payload: {
                  parts: [
                    {
                      mimeType: 'text/html',
                      body: {
                        data: Buffer.from('Test email content').toString('base64')
                      }
                    }
                  ]
                }
              }
            })
          }
        }
      };
      
      getGmailClient.mockResolvedValue({ gmail: mockGmail });
    });

    it('should fetch email content from Gmail', async () => {
      const response = await request(app)
        .get(`/api/emails/${emailId}/content`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', emailId);
      expect(response.body).toHaveProperty('gmail_id');
      expect(response.body).toHaveProperty('subject');
      expect(response.body).toHaveProperty('content');
      expect(response.body.content).toHaveProperty('body');
      expect(response.body.content).toHaveProperty('isHtml');
      expect(response.body.content).toHaveProperty('attachments');
      expect(response.body.cached).toBe(false);
    });

    it('should return cached content on second request', async () => {
      // First request - cache miss
      await request(app)
        .get(`/api/emails/${emailId}/content`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Mock Redis to return cached content
      redis.get = jest.fn().mockResolvedValue(JSON.stringify({
        body: 'Cached email content',
        isHtml: true,
        attachments: [],
        fetchedAt: new Date().toISOString()
      }));

      // Second request - cache hit
      const response = await request(app)
        .get(`/api/emails/${emailId}/content`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.cached).toBe(true);
      expect(response.body.content.body).toBe('Cached email content');
    });

    it('should handle invalid email ID format', async () => {
      const response = await request(app)
        .get('/api/emails/invalid-id/content')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body.error).toBe('Invalid email ID format');
    });

    it('should handle Gmail API errors', async () => {
      getGmailClient.mockResolvedValue({
        gmail: {
          users: {
            messages: {
              get: jest.fn().mockRejectedValue({ code: 404, message: 'Not found' })
            }
          }
        }
      });

      const response = await request(app)
        .get(`/api/emails/${emailId}/content`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Email not found in Gmail');
    });
  });

  describe('DELETE /api/emails/bulk', () => {
    it('should delete multiple emails', async () => {
      // Create additional emails to delete
      const emailsToDelete = [];
      for (let i = 0; i < 3; i++) {
        const result = await db.query(
          `INSERT INTO emails (
            user_id, account_id, category_id, gmail_id, subject, sender, snippet, received_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id`,
          [
            userId, accountId, categoryId, `delete-gmail-id-${i}`,
            `Delete Test Email ${i}`, `delete${i}@example.com`,
            `Delete test snippet ${i}`, new Date()
          ]
        );
        emailsToDelete.push(result.rows[0].id);
      }

      const response = await request(app)
        .delete('/api/emails/bulk')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ emailIds: emailsToDelete })
        .expect(200);

      expect(response.body.message).toContain('Successfully deleted');
      expect(response.body.deletedIds).toHaveLength(emailsToDelete.length);
      expect(response.body.deletedIds).toEqual(expect.arrayContaining(emailsToDelete));

      // Verify emails were deleted
      const checkResult = await db.query(
        'SELECT id FROM emails WHERE id = ANY($1)',
        [emailsToDelete]
      );
      expect(checkResult.rows).toHaveLength(0);
    });

    it('should reject invalid email IDs array', async () => {
      const response = await request(app)
        .delete('/api/emails/bulk')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ emailIds: 'not-an-array' })
        .expect(400);

      expect(response.body.error).toBe('Email IDs array is required');
    });

    it('should reject empty email IDs array', async () => {
      const response = await request(app)
        .delete('/api/emails/bulk')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ emailIds: [] })
        .expect(400);

      expect(response.body.error).toBe('Email IDs array is required');
    });
  });

  describe('PUT /api/emails/:id/category', () => {
    let targetCategoryId;

    beforeAll(async () => {
      // Create target category
      const result = await db.query(
        `INSERT INTO categories (user_id, name, description)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [userId, 'Target Category', 'Target category for moving emails']
      );
      targetCategoryId = result.rows[0].id;
    });

    it('should move email to different category', async () => {
      const response = await request(app)
        .put(`/api/emails/${emailId}/category`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ categoryId: targetCategoryId })
        .expect(200);

      expect(response.body).toHaveProperty('id', emailId);
      expect(response.body).toHaveProperty('category_id', targetCategoryId);

      // Verify in database
      const result = await db.query(
        'SELECT category_id FROM emails WHERE id = $1',
        [emailId]
      );
      expect(result.rows[0].category_id).toBe(targetCategoryId);

      // Move it back for other tests
      await db.query(
        'UPDATE emails SET category_id = $1 WHERE id = $2',
        [categoryId, emailId]
      );
    });

    it('should return 404 for non-existent category', async () => {
      const response = await request(app)
        .put(`/api/emails/${emailId}/category`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ categoryId: 99999 })
        .expect(404);

      expect(response.body.error).toBe('Category not found');
    });

    it('should return 404 for non-existent email', async () => {
      const response = await request(app)
        .put('/api/emails/99999/category')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ categoryId: targetCategoryId })
        .expect(404);

      expect(response.body.error).toBe('Email not found');
    });
  });

  describe('PUT /api/emails/bulk/move', () => {
    let targetCategoryId;
    let emailsToMove;

    beforeAll(async () => {
      // Create target category
      const categoryResult = await db.query(
        `INSERT INTO categories (user_id, name, description)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [userId, 'Bulk Move Target', 'Target category for bulk moves']
      );
      targetCategoryId = categoryResult.rows[0].id;

      // Create emails to move
      emailsToMove = [];
      for (let i = 0; i < 3; i++) {
        const result = await db.query(
          `INSERT INTO emails (
            user_id, account_id, category_id, gmail_id, subject, sender, snippet, received_at, ai_summary
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id`,
          [
            userId, accountId, categoryId, `bulk-move-gmail-id-${i}`,
            `Bulk Move Email ${i}`, `bulkmove${i}@example.com`,
            `Bulk move snippet ${i}`, new Date(), `Summary for bulk move ${i}`
          ]
        );
        emailsToMove.push(result.rows[0].id);
      }
    });

    it('should bulk move emails to different category', async () => {
      const response = await request(app)
        .put('/api/emails/bulk/move')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ emailIds: emailsToMove, toCategoryId: targetCategoryId })
        .expect(200);

      expect(response.body.message).toContain('Successfully moved');
      expect(response.body.movedCount).toBe(emailsToMove.length);
      expect(response.body.movedIds).toEqual(expect.arrayContaining(emailsToMove));
      expect(response.body.toCategoryName).toBe('Bulk Move Target');

      // Verify in database
      const result = await db.query(
        'SELECT id, category_id FROM emails WHERE id = ANY($1)',
        [emailsToMove]
      );
      result.rows.forEach(row => {
        expect(row.category_id).toBe(targetCategoryId);
      });

      // Verify movements were tracked
      const movementsResult = await db.query(
        'SELECT * FROM category_movements WHERE email_id = ANY($1)',
        [emailsToMove]
      );
      expect(movementsResult.rows.length).toBe(emailsToMove.length);
    });

    it('should reject missing email IDs', async () => {
      const response = await request(app)
        .put('/api/emails/bulk/move')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ toCategoryId: targetCategoryId })
        .expect(400);

      expect(response.body.error).toBe('Email IDs array is required');
    });

    it('should reject missing target category ID', async () => {
      const response = await request(app)
        .put('/api/emails/bulk/move')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ emailIds: emailsToMove })
        .expect(400);

      expect(response.body.error).toBe('Target category ID is required');
    });

    it('should return 404 for non-existent target category', async () => {
      const response = await request(app)
        .put('/api/emails/bulk/move')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ emailIds: emailsToMove, toCategoryId: 99999 })
        .expect(404);

      expect(response.body.error).toBe('Target category not found');
    });
  });

  describe('POST /api/emails/process', () => {
    beforeEach(() => {
      processNewEmails.mockResolvedValue(5);
    });

    it('should process emails for all user accounts', async () => {
      const response = await request(app)
        .post('/api/emails/process')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.message).toBe('Email processing completed');
      expect(response.body.accounts).toBeInstanceOf(Array);
      expect(response.body.accounts).toHaveLength(1);
      expect(response.body.accounts[0]).toMatchObject({
        account: 'test-account@gmail.com',
        status: 'success',
        processed: 5
      });

      expect(processNewEmails).toHaveBeenCalledWith(userId, 'test-account@gmail.com');
    });

    it('should handle processing errors gracefully', async () => {
      processNewEmails.mockRejectedValue(new Error('Gmail API error'));

      const response = await request(app)
        .post('/api/emails/process')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.message).toBe('Email processing completed');
      expect(response.body.accounts[0]).toMatchObject({
        account: 'test-account@gmail.com',
        status: 'error',
        error: 'Gmail API error'
      });
    });

    it('should return 404 if no email accounts exist', async () => {
      // Create user without email accounts
      const userResult = await db.query(
        `INSERT INTO users (email, name, google_id, picture)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        ['no-accounts@example.com', 'No Accounts User', 'google-no-accounts', 'pic.jpg']
      );
      const noAccountUserId = userResult.rows[0].id;
      const noAccountToken = createAuthToken(noAccountUserId);

      const response = await request(app)
        .post('/api/emails/process')
        .set('Authorization', `Bearer ${noAccountToken}`)
        .expect(404);

      expect(response.body.error).toBe('No email accounts found');

      // Clean up
      await db.query('DELETE FROM users WHERE id = $1', [noAccountUserId]);
    });
  });

  describe('GET /api/emails/stats/overview', () => {
    it('should return email statistics overview', async () => {
      const response = await request(app)
        .get('/api/emails/stats/overview')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('overview');
      expect(response.body).toHaveProperty('byCategory');

      expect(response.body.overview).toMatchObject({
        total_emails: expect.any(Number),
        last_7_days: expect.any(Number),
        categories_used: expect.any(Number),
        unique_senders: expect.any(Number),
        unsubscribed_count: expect.any(Number),
        with_unsubscribe_link: expect.any(Number)
      });

      expect(response.body.byCategory).toBeInstanceOf(Array);
      response.body.byCategory.forEach(category => {
        expect(category).toHaveProperty('category_name');
        expect(category).toHaveProperty('category_id');
        expect(category).toHaveProperty('count');
      });
    });

    it('should return stats only for authenticated user', async () => {
      // Create another user with emails
      const otherUserResult = await db.query(
        `INSERT INTO users (email, name, google_id, picture)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        ['other-user@example.com', 'Other User', 'google-other', 'pic.jpg']
      );
      const otherUserId = otherUserResult.rows[0].id;

      // Create category and email for other user
      const otherCategoryResult = await db.query(
        `INSERT INTO categories (user_id, name, description)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [otherUserId, 'Other Category', 'Other user category']
      );

      await db.query(
        `INSERT INTO emails (
          user_id, account_id, category_id, gmail_id, subject, sender, snippet, received_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          otherUserId, accountId, otherCategoryResult.rows[0].id,
          'other-gmail-id', 'Other Email', 'other@example.com',
          'Other snippet', new Date()
        ]
      );

      // Get stats should only show current user's data
      const response = await request(app)
        .get('/api/emails/stats/overview')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify no data from other user is included
      const otherCategory = response.body.byCategory.find(
        cat => cat.category_name === 'Other Category'
      );
      expect(otherCategory).toBeUndefined();

      // Clean up
      await db.query('DELETE FROM emails WHERE user_id = $1', [otherUserId]);
      await db.query('DELETE FROM categories WHERE user_id = $1', [otherUserId]);
      await db.query('DELETE FROM users WHERE id = $1', [otherUserId]);
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/emails/stats/overview')
        .expect(401);

      expect(response.body.error).toBe('Access token required');
    });
  });
});