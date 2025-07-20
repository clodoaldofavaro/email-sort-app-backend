const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const unsubscribeService = require('../services/unsubscribe');
const logger = require('../utils/logger');

// POST /api/unsubscribe
router.post('/unsubscribe', authenticateToken, async (req, res) => {
  try {
    const { emailId, unsubscribeLink } = req.body;

    // Validate input
    if (!emailId || !unsubscribeLink) {
      return res.status(400).json({ 
        error: 'emailId and unsubscribeLink are required' 
      });
    }

    // Validate URL format
    try {
      new URL(unsubscribeLink);
    } catch (urlError) {
      return res.status(400).json({ 
        error: 'Invalid unsubscribe link format' 
      });
    }

    logger.info(`Processing unsubscribe for email ${emailId} by user ${req.user.id}`);

    // Verify the email belongs to the user and has an unsubscribe link
    const emailCheck = await req.db.query(
      'SELECT id, subject, sender, unsubscribe_link FROM emails WHERE id = $1 AND user_id = $2 AND unsubscribe_link IS NOT NULL',
      [emailId, req.user.id]
    );

    if (emailCheck.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Email not found or does not belong to user' 
      });
    }

    const email = emailCheck.rows[0];

    // Verify the provided unsubscribe link matches what we have in DB
    if (email.unsubscribe_link !== unsubscribeLink) {
      return res.status(400).json({ 
        error: 'Unsubscribe link does not match email record' 
      });
    }

    // Update email status to indicate unsubscribe is in progress
    await req.db.query(
      'UPDATE emails SET unsubscribe_status = $1, unsubscribe_attempted_at = NOW() WHERE id = $2',
      ['in_progress', emailId]
    );

    // Attempt to unsubscribe using Stagehand
    logger.info(`Starting unsubscribe process for email ${emailId}`);
    const unsubscribeResult = await unsubscribeService.unsubscribeFromEmail(unsubscribeLink);
    logger.info('Unsubscribe service response:', { emailId, result: unsubscribeResult });

    // Update the email record with the result
    const finalStatus = unsubscribeResult.success ? 'completed' : 'failed';
    await req.db.query(
      `UPDATE emails 
       SET unsubscribe_status = $1, 
           unsubscribe_completed_at = $2,
           unsubscribe_result = $3
       WHERE id = $4`,
      [
        finalStatus,
        unsubscribeResult.success ? new Date() : null,
        JSON.stringify({
          message: unsubscribeResult.message,
          details: unsubscribeResult.details,
          timestamp: new Date().toISOString()
        }),
        emailId
      ]
    );

    // Log the final result
    logger.info(`Unsubscribe ${unsubscribeResult.success ? 'succeeded' : 'failed'} for email ${emailId}`, {
      emailId,
      success: unsubscribeResult.success,
      message: unsubscribeResult.message,
      details: unsubscribeResult.details
    });

    const response = {
      success: unsubscribeResult.success,
      message: unsubscribeResult.message,
      details: unsubscribeResult.details,
      emailId: emailId
    };
    logger.info('Sending unsubscribe response:', response);
    res.json(response);

  } catch (error) {
    logger.error('Unsubscribe endpoint error:', { error: error.message, stack: error.stack });

    // Update email status to failed if we have emailId
    if (req.body.emailId) {
      try {
        await db.query(
          `UPDATE emails 
           SET unsubscribe_status = 'failed',
               unsubscribe_result = $1
           WHERE id = $2`,
          [
            JSON.stringify({
              error: error.message,
              timestamp: new Date().toISOString()
            }),
            req.body.emailId
          ]
        );
      } catch (updateError) {
        logger.error('Failed to update email status:', { error: updateError.message });
      }
    }

    res.status(500).json({ 
      error: 'Internal server error during unsubscribe process',
      message: error.message 
    });
  }
});

// POST /api/unsubscribe/batch - Handle multiple emails at once
router.post('/unsubscribe/batch', authenticateToken, async (req, res) => {
  try {
    const { emailIds } = req.body;

    if (!Array.isArray(emailIds) || emailIds.length === 0) {
      return res.status(400).json({ 
        error: 'emailIds array is required and cannot be empty' 
      });
    }

    // Limit batch size to prevent overload
    if (emailIds.length > 10) {
      return res.status(400).json({ 
        error: 'Maximum 10 emails can be processed at once' 
      });
    }

    // Get emails with unsubscribe links
    const placeholders = emailIds.map((_, index) => `$${index + 2}`).join(',');
    const result = await req.db.query(
      `SELECT id, subject, sender, unsubscribe_link 
       FROM emails 
       WHERE id IN (${placeholders}) AND user_id = $1 AND unsubscribe_link IS NOT NULL`,
      [req.user.id, ...emailIds]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'No valid emails found with unsubscribe links' 
      });
    }

    logger.info(`Processing batch unsubscribe for ${result.rows.length} emails`);

    // Process each email (you might want to implement this with a queue for better performance)
    const results = [];
    
    for (const email of result.rows) {
      try {
        // Update status to in progress
        await req.db.query(
          'UPDATE emails SET unsubscribe_status = $1, unsubscribe_attempted_at = NOW() WHERE id = $2',
          ['in_progress', email.id]
        );

        logger.info(`Processing unsubscribe for email ${email.id} in batch`);
        const unsubscribeResult = await unsubscribeService.unsubscribeFromEmail(email.unsubscribe_link);
        logger.info('Batch unsubscribe result:', { emailId: email.id, result: unsubscribeResult });
        
        // Update with result
        const finalStatus = unsubscribeResult.success ? 'completed' : 'failed';
        await db.query(
          `UPDATE emails 
           SET unsubscribe_status = $1, 
               unsubscribe_completed_at = $2,
               unsubscribe_result = $3
           WHERE id = $4`,
          [
            finalStatus,
            unsubscribeResult.success ? new Date() : null,
            JSON.stringify({
              message: unsubscribeResult.message,
              details: unsubscribeResult.details,
              timestamp: new Date().toISOString()
            }),
            email.id
          ]
        );

        results.push({
          emailId: email.id,
          success: unsubscribeResult.success,
          message: unsubscribeResult.message
        });

      } catch (emailError) {
        logger.error(`Failed to unsubscribe from email ${email.id}:`, { error: emailError.message, stack: emailError.stack });
        
        await db.query(
          `UPDATE emails 
           SET unsubscribe_status = 'failed',
               unsubscribe_result = $1
           WHERE id = $2`,
          [
            JSON.stringify({
              error: emailError.message,
              timestamp: new Date().toISOString()
            }),
            email.id
          ]
        );

        results.push({
          emailId: email.id,
          success: false,
          message: emailError.message
        });
      }
    }

    const response = {
      message: `Processed ${results.length} emails`,
      results: results,
      summary: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      }
    };
    logger.info('Sending batch unsubscribe response:', response);
    res.json(response);

  } catch (error) {
    logger.error('Batch unsubscribe endpoint error:', { error: error.message, stack: error.stack });
    res.status(500).json({ 
      error: 'Internal server error during batch unsubscribe',
      message: error.message 
    });
  }
});

module.exports = router;