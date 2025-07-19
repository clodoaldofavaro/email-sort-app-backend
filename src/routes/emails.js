const express = require('express');
const Joi = require('joi');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { getGmailClient } = require('../services/gmail');
const { processUnsubscribe } = require('../services/browserbase');

const router = express.Router();

// Get emails for a category
router.get('/category/:categoryId', authenticateToken, async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    // Verify category belongs to user
    const categoryResult = await db.query(
      'SELECT id FROM categories WHERE id = $1 AND user_id = $2',
      [categoryId, req.user.id]
    );

    if (categoryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const result = await db.query(
      `SELECT e.*, c.name as category_name 
       FROM emails e
       JOIN categories c ON e.category_id = c.id
       WHERE e.category_id = $1 AND e.user_id = $2
       ORDER BY e.received_at DESC
       LIMIT $3 OFFSET $4`,
      [categoryId, req.user.id, limit, offset]
    );

    const countResult = await db.query(
      'SELECT COUNT(*) FROM emails WHERE category_id = $1 AND user_id = $2',
      [categoryId, req.user.id]
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

// Bulk unsubscribe from emails
router.post('/bulk/unsubscribe', authenticateToken, async (req, res) => {
  try {
    const { emailIds } = req.body;

    if (!Array.isArray(emailIds) || emailIds.length === 0) {
      return res.status(400).json({ error: 'Email IDs array is required' });
    }

    const placeholders = emailIds.map((_, index) => `$${index + 2}`).join(',');
    const result = await db.query(
      `SELECT id, subject, sender, unsubscribe_link 
       FROM emails 
       WHERE id IN (${placeholders}) AND user_id = $1 AND unsubscribe_link IS NOT NULL`,
      [req.user.id, ...emailIds]
    );

    const unsubscribeResults = [];

    for (const email of result.rows) {
      try {
        const success = await processUnsubscribe(email.unsubscribe_link);
        unsubscribeResults.push({
          emailId: email.id,
          subject: email.subject,
          sender: email.sender,
          success,
          link: email.unsubscribe_link,
        });

        if (success) {
          // Mark as unsubscribed
          await db.query(
            'UPDATE emails SET unsubscribed = true, unsubscribed_at = NOW() WHERE id = $1',
            [email.id]
          );
        }
      } catch (error) {
        console.error(`Error unsubscribing from email ${email.id}:`, error);
        unsubscribeResults.push({
          emailId: email.id,
          subject: email.subject,
          sender: email.sender,
          success: false,
          error: error.message,
          link: email.unsubscribe_link,
        });
      }
    }

    res.json({
      message: 'Unsubscribe process completed',
      results: unsubscribeResults,
      totalProcessed: result.rows.length,
      successful: unsubscribeResults.filter(r => r.success).length,
    });
  } catch (error) {
    console.error('Error processing unsubscribe:', error);
    res.status(500).json({ error: 'Failed to process unsubscribe requests' });
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

// Get user's email stats overview
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
        COUNT(*) as total_emails,
        COUNT(CASE WHEN unsubscribed = true THEN 1 END) as unsubscribed_count,
        COUNT(DISTINCT sender) as unique_senders,
        c.name as category_name,
        c.id as category_id,
        COUNT(e.id) as category_count
       FROM emails e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.user_id = $1
       GROUP BY c.id, c.name
       ORDER BY category_count DESC`,
      [req.user.id]
    );

    const totalResult = await db.query(
      `SELECT 
        COUNT(*) as total_emails,
        COUNT(CASE WHEN unsubscribed = true THEN 1 END) as unsubscribed_count,
        COUNT(DISTINCT sender) as unique_senders
       FROM emails WHERE user_id = $1`,
      [req.user.id]
    );

    res.json({
      overall: totalResult.rows[0],
      byCategory: result.rows.filter(row => row.category_name),
    });
  } catch (error) {
    console.error('Error fetching email stats:', error);
    res.status(500).json({ error: 'Failed to fetch email stats' });
  }
});

module.exports = router;
