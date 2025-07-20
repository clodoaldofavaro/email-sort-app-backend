const express = require('express');
const Joi = require('joi');
const db = require('../config/database');
const redis = require('../config/redisCache');
const { authenticateToken } = require('../middleware/auth');
const { getGmailClient, processNewEmails } = require('../services/gmail');
const logger = require('../utils/logger');

const router = express.Router();

// Get emails for a category
router.get('/category/:categoryId', authenticateToken, async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { page = 1, limit = 20, accountId, hasUnsubscribe } = req.query;
    const offset = (page - 1) * limit;

    // Verify category belongs to user
    const categoryResult = await db.query(
      'SELECT id FROM categories WHERE id = $1 AND user_id = $2',
      [categoryId, req.user.id]
    );

    if (categoryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Build query with optional filters
    let whereClause = 'WHERE e.category_id = $1 AND e.user_id = $2';
    const queryParams = [categoryId, req.user.id];

    if (accountId) {
      // Verify account belongs to user
      const accountResult = await db.query(
        'SELECT id FROM email_accounts WHERE id = $1 AND user_id = $2',
        [accountId, req.user.id]
      );

      if (accountResult.rows.length === 0) {
        return res.status(404).json({ error: 'Account not found' });
      }

      whereClause += ` AND e.account_id = $${queryParams.length + 1}`;
      queryParams.push(accountId);
    }

    // Add unsubscribe filter
    if (hasUnsubscribe === 'true') {
      whereClause += ' AND e.unsubscribe_link IS NOT NULL';
    } else if (hasUnsubscribe === 'false') {
      whereClause += ' AND e.unsubscribe_link IS NULL';
    }

    const result = await db.query(
      `SELECT e.*, c.name as category_name, ea.email as account_email
       FROM emails e
       JOIN categories c ON e.category_id = c.id
       LEFT JOIN email_accounts ea ON e.account_id = ea.id
       ${whereClause}
       ORDER BY e.received_at DESC
       LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`,
      [...queryParams, limit, offset]
    );

    const countResult = await db.query(`SELECT COUNT(*) FROM emails e ${whereClause}`, queryParams);

    res.json({
      emails: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        totalPages: Math.ceil(countResult.rows[0].count / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching emails:', error);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// Get single email
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT e.*, c.name as category_name 
       FROM emails e
       JOIN categories c ON e.category_id = c.id
       WHERE e.id = $1 AND e.user_id = $2`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching email:', error);
    res.status(500).json({ error: 'Failed to fetch email' });
  }
});

// Get email content from Gmail (on-demand fetch with caching)
router.get('/:id/content', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    logger.info(`Fetching email content for ID: ${id}, User: ${req.user.id}`);
    
    // Validate that id is a number
    if (!/^\d+$/.test(id)) {
      logger.warn(`Invalid email ID format received: ${id}`);
      return res.status(400).json({ error: 'Invalid email ID format' });
    }

    // First, get email metadata to get gmail_id and account info
    logger.info(`Querying database for email metadata: ID=${id}, UserID=${req.user.id}`);
    const emailResult = await db.query(
      `SELECT e.id, e.gmail_id, e.subject, e.sender, e.account_id, ea.email as account_email, ea.refresh_token
       FROM emails e
       JOIN email_accounts ea ON e.account_id = ea.id
       WHERE e.id = $1 AND e.user_id = $2`,
      [id, req.user.id]
    );

    if (emailResult.rows.length === 0) {
      logger.warn(`Email not found: ID=${id}, UserID=${req.user.id}`);
      return res.status(404).json({ error: 'Email not found' });
    }

    const email = emailResult.rows[0];
    logger.info(`Found email: ID=${email.id}, GmailID=${email.gmail_id}, AccountID=${email.account_id}, AccountEmail=${email.account_email}`);

    if (!email.gmail_id) {
      logger.error(`Email missing Gmail ID: EmailID=${email.id}`);
      return res.status(400).json({ error: 'Email does not have a Gmail ID' });
    }

    // Check Redis cache first
    const cacheKey = `email:${email.account_id}:${email.gmail_id}`;
    logger.info(`Checking Redis cache with key: ${cacheKey}`);
    const cachedContent = await redis.get(cacheKey);

    if (cachedContent) {
      logger.info(`Cache hit for email ${id} (Gmail ID: ${email.gmail_id})`);
      return res.json({
        id: email.id,
        gmail_id: email.gmail_id,
        subject: email.subject,
        sender: email.sender,
        content: JSON.parse(cachedContent),
        cached: true,
      });
    }

    // Cache miss - fetch from Gmail
    logger.info(`Cache miss for email ${id} (Gmail ID: ${email.gmail_id}), fetching from Gmail`);
    logger.info(`Using account: ${email.account_email}`);

    try {
      // Get Gmail client for the account
      logger.info(`Getting Gmail client for account: ${email.account_email}`);
      const gmail = await getGmailClient(email.account_email, email.refresh_token);
      logger.info('Gmail client obtained successfully');

      // Fetch the email from Gmail
      logger.info(`Fetching email from Gmail API: GmailID=${email.gmail_id}`);
      const gmailResponse = await gmail.users.messages.get({
        userId: 'me',
        id: email.gmail_id,
        format: 'full',
      });
      logger.info('Gmail API response received successfully');

      // Extract email content
      const emailContent = {
        body: '',
        html: '',
        attachments: [],
      };

      // Helper function to decode base64url
      const decodeBase64 = data => {
        if (!data) return '';
        // Replace URL-safe characters and add padding if needed
        const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
        const padding = '='.repeat((4 - (base64.length % 4)) % 4);
        return Buffer.from(base64 + padding, 'base64').toString('utf-8');
      };

      // Extract body from parts
      const extractBody = parts => {
        for (const part of parts) {
          if (part.mimeType === 'text/html' && part.body.data) {
            emailContent.html = decodeBase64(part.body.data);
          } else if (part.mimeType === 'text/plain' && part.body.data) {
            emailContent.body = decodeBase64(part.body.data);
          } else if (part.parts) {
            extractBody(part.parts);
          }

          // Check for attachments
          if (part.filename) {
            emailContent.attachments.push({
              filename: part.filename,
              mimeType: part.mimeType,
              size: part.body.size,
              attachmentId: part.body.attachmentId,
            });
          }
        }
      };

      if (gmailResponse.data.payload.parts) {
        extractBody(gmailResponse.data.payload.parts);
      } else if (gmailResponse.data.payload.body.data) {
        // Single part message
        emailContent.body = decodeBase64(gmailResponse.data.payload.body.data);
      }

      // Use HTML content if available, otherwise use plain text
      const content = {
        body: emailContent.html || emailContent.body,
        isHtml: !!emailContent.html,
        attachments: emailContent.attachments,
        fetchedAt: new Date().toISOString(),
      };

      // Cache the content in Redis with 24-hour TTL
      const ttl = 24 * 60 * 60; // 24 hours in seconds
      logger.info(`Caching email content in Redis: key=${cacheKey}, ttl=${ttl}s`);
      const cacheSuccess = await redis.setEx(cacheKey, ttl, JSON.stringify(content));

      if (!cacheSuccess) {
        logger.warn(`Failed to cache email content for email ${id}, continuing without cache`);
      } else {
        logger.info('Email content cached successfully');
      }

      logger.info(`Returning email content: EmailID=${email.id}, ContentSize=${content.body.length} chars, Attachments=${content.attachments.length}`);
      res.json({
        id: email.id,
        gmail_id: email.gmail_id,
        subject: email.subject,
        sender: email.sender,
        content: content,
        cached: false,
      });
    } catch (gmailError) {
      logger.error(`Error fetching from Gmail for EmailID=${id}, GmailID=${email.gmail_id}:`, gmailError);
      logger.error(`Gmail error code: ${gmailError.code}, message: ${gmailError.message}`);

      // Handle specific Gmail errors
      if (gmailError.code === 404) {
        return res.status(404).json({
          error: 'Email not found in Gmail',
          message: 'This email may have been deleted from Gmail',
        });
      } else if (gmailError.code === 401) {
        return res.status(401).json({
          error: 'Gmail authentication failed',
          message: 'Please reconnect your Gmail account',
        });
      } else if (gmailError.code === 429) {
        return res.status(429).json({
          error: 'Gmail rate limit exceeded',
          message: 'Too many requests. Please try again later',
        });
      }

      return res.status(500).json({
        error: 'Failed to fetch email content',
        message: gmailError.message,
      });
    }
  } catch (error) {
    logger.error(`Error in email content endpoint for ID=${req.params.id}:`, error);
    logger.error(`Error stack: ${error.stack}`);
    res.status(500).json({ error: 'Failed to retrieve email content' });
  }
});

// Bulk delete emails
router.delete('/bulk', authenticateToken, async (req, res) => {
  try {
    const { emailIds } = req.body;

    if (!Array.isArray(emailIds) || emailIds.length === 0) {
      return res.status(400).json({ error: 'Email IDs array is required' });
    }

    const placeholders = emailIds.map((_, index) => `$${index + 2}`).join(',');
    const result = await db.query(
      `DELETE FROM emails WHERE id IN (${placeholders}) AND user_id = $1 RETURNING id`,
      [req.user.id, ...emailIds]
    );

    res.json({
      message: `Successfully deleted ${result.rows.length} emails`,
      deletedIds: result.rows.map(row => row.id),
    });
  } catch (error) {
    console.error('Error deleting emails:', error);
    res.status(500).json({ error: 'Failed to delete emails' });
  }
});

// Move email to different category
router.put('/:id/category', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { categoryId } = req.body;

    // Verify category belongs to user
    const categoryResult = await db.query(
      'SELECT id FROM categories WHERE id = $1 AND user_id = $2',
      [categoryId, req.user.id]
    );

    if (categoryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const result = await db.query(
      'UPDATE emails SET category_id = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [categoryId, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error moving email:', error);
    res.status(500).json({ error: 'Failed to move email' });
  }
});

// Process emails for all user's accounts
router.post('/process', authenticateToken, async (req, res) => {
  try {
    // Get all user's email accounts
    const accountsResult = await db.query('SELECT email FROM email_accounts WHERE user_id = $1', [
      req.user.id,
    ]);

    if (accountsResult.rows.length === 0) {
      return res.status(404).json({ error: 'No email accounts found' });
    }

    // Process emails for all accounts
    const results = [];
    for (const account of accountsResult.rows) {
      try {
        const processed = await processNewEmails(req.user.id, account.email);
        results.push({
          account: account.email,
          status: 'success',
          processed: processed,
        });
      } catch (error) {
        console.error(`Error processing emails for ${account.email}:`, error);
        results.push({
          account: account.email,
          status: 'error',
          error: error.message,
        });
      }
    }

    res.json({
      message: 'Email processing completed',
      accounts: results,
    });
  } catch (error) {
    console.error('Error processing emails:', error);
    res.status(500).json({ error: 'Failed to process emails' });
  }
});

// Get user's email stats overview
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    // Get overall stats including last 7 days
    const overallResult = await db.query(
      `SELECT 
        COUNT(*) as total_emails,
        COUNT(CASE WHEN unsubscribe_status = 'completed' THEN 1 END) as unsubscribed_count,
        COUNT(DISTINCT sender) as unique_senders,
        COUNT(CASE WHEN received_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as last_7_days,
        COUNT(CASE WHEN unsubscribe_link IS NOT NULL THEN 1 END) as with_unsubscribe_link,
        COUNT(DISTINCT category_id) as categories_used
       FROM emails WHERE user_id = $1`,
      [req.user.id]
    );

    // Get category breakdown
    const categoryResult = await db.query(
      `SELECT 
        c.name as category_name,
        c.id as category_id,
        COUNT(e.id) as category_count
       FROM categories c
       LEFT JOIN emails e ON e.category_id = c.id AND e.user_id = $1
       WHERE c.user_id = $1
       GROUP BY c.id, c.name
       ORDER BY category_count DESC`,
      [req.user.id]
    );

    res.json({
      overview: {
        total_emails: parseInt(overallResult.rows[0].total_emails),
        last_7_days: parseInt(overallResult.rows[0].last_7_days),
        categories_used: parseInt(overallResult.rows[0].categories_used),
        unique_senders: parseInt(overallResult.rows[0].unique_senders),
        unsubscribed_count: parseInt(overallResult.rows[0].unsubscribed_count),
        with_unsubscribe_link: parseInt(overallResult.rows[0].with_unsubscribe_link),
      },
      byCategory: categoryResult.rows.map(row => ({
        category_name: row.category_name,
        category_id: row.category_id,
        count: parseInt(row.category_count),
      })),
    });
  } catch (error) {
    console.error('Error fetching email stats:', error);
    res.status(500).json({ error: 'Failed to fetch email stats' });
  }
});

module.exports = router;
