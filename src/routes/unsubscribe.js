const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const unsubscribeService = require('../services/unsubscribe');
const logger = require('../utils/logger');
const { unsubscribeQueue } = require('../config/queues');
const { v4: uuidv4 } = require('uuid');

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
    const result = await db.query(
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

// POST /api/unsubscribe/async/batch - Handle multiple emails asynchronously via queue
router.post('/unsubscribe/async/batch', authenticateToken, async (req, res) => {
  try {
    const { emailIds } = req.body;

    if (!Array.isArray(emailIds) || emailIds.length === 0) {
      return res.status(400).json({ 
        error: 'emailIds array is required and cannot be empty' 
      });
    }

    // No limit on batch size for async processing
    logger.info(`Received async batch unsubscribe request for ${emailIds.length} emails`);

    // Verify all emails belong to user and have unsubscribe links
    const placeholders = emailIds.map((_, index) => `$${index + 2}`).join(',');
    const result = await db.query(
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

    // Create a batch job ID
    const batchJobId = uuidv4();
    const timestamp = new Date();

    // Store batch job metadata in database
    await db.query(
      `INSERT INTO unsubscribe_jobs 
       (id, user_id, total_emails, processed_count, success_count, failed_count, status, created_at, updated_at)
       VALUES ($1, $2, $3, 0, 0, 0, 'pending', $4, $4)`,
      [batchJobId, req.user.id, result.rows.length, timestamp]
    );

    // Add jobs to the queue for each email
    const jobPromises = result.rows.map(email => 
      unsubscribeQueue.add('unsubscribe-email', {
        batchJobId,
        userId: req.user.id,
        emailId: email.id,
        unsubscribeLink: email.unsubscribe_link,
        subject: email.subject,
        sender: email.sender
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: true,
        removeOnFail: false
      })
    );

    await Promise.all(jobPromises);

    logger.info(`Created ${result.rows.length} unsubscribe jobs for batch ${batchJobId}`);

    res.json({
      success: true,
      message: `Batch unsubscribe job created for ${result.rows.length} emails`,
      batchJobId,
      totalEmails: result.rows.length,
      status: 'pending',
      createdAt: timestamp
    });

  } catch (error) {
    logger.error('Async batch unsubscribe endpoint error:', { error: error.message, stack: error.stack });
    res.status(500).json({ 
      error: 'Internal server error creating async batch unsubscribe job',
      message: error.message 
    });
  }
});

// GET /api/unsubscribe/async/status/:jobId - Check status of async batch job
router.get('/unsubscribe/async/status/:jobId', authenticateToken, async (req, res) => {
  try {
    const { jobId } = req.params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    // Get job status from database
    const result = await db.query(
      'SELECT * FROM unsubscribe_jobs WHERE id = $1 AND user_id = $2',
      [jobId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = result.rows[0];

    // Calculate progress percentage
    const progressPercentage = job.total_emails > 0 
      ? Math.round((job.processed_count / job.total_emails) * 100) 
      : 0;

    res.json({
      jobId: job.id,
      status: job.status,
      totalEmails: job.total_emails,
      processedCount: job.processed_count,
      successCount: job.success_count,
      failedCount: job.failed_count,
      progressPercentage,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      completedAt: job.completed_at
    });

  } catch (error) {
    logger.error('Job status endpoint error:', { error: error.message, stack: error.stack });
    res.status(500).json({ 
      error: 'Internal server error checking job status',
      message: error.message 
    });
  }
});

module.exports = router;