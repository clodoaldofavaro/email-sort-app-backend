const express = require('express');
const Joi = require('joi');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { getGmailClient, processNewEmails } = require('../services/gmail');

const router = express.Router();

// Get emails for a category
router.get('/category/:categoryId', authenticateToken, async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { page = 1, limit = 20, accountId } = req.query;
    const offset = (page - 1) * limit;

    // Verify category belongs to user
    const categoryResult = await db.query(
      'SELECT id FROM categories WHERE id = $1 AND user_id = $2',
      [categoryId, req.user.id]
    );

    if (categoryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Build query with optional account filter
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
      
      whereClause += ' AND e.account_id = $3';
      queryParams.push(accountId);
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

    const countResult = await db.query(
      `SELECT COUNT(*) FROM emails e ${whereClause}`,
      queryParams
    );

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
    const accountsResult = await db.query(
      'SELECT email FROM email_accounts WHERE user_id = $1',
      [req.user.id]
    );

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
          processed: processed
        });
      } catch (error) {
        console.error(`Error processing emails for ${account.email}:`, error);
        results.push({
          account: account.email,
          status: 'error',
          error: error.message
        });
      }
    }

    res.json({
      message: 'Email processing completed',
      accounts: results
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
        with_unsubscribe_link: parseInt(overallResult.rows[0].with_unsubscribe_link)
      },
      byCategory: categoryResult.rows.map(row => ({
        category_name: row.category_name,
        category_id: row.category_id,
        count: parseInt(row.category_count)
      }))
    });
  } catch (error) {
    console.error('Error fetching email stats:', error);
    res.status(500).json({ error: 'Failed to fetch email stats' });
  }
});

module.exports = router;
