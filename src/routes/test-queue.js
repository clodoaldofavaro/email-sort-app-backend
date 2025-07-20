const express = require('express');
const router = express.Router();
const { unsubscribeQueue } = require('../config/queues');
const logger = require('../utils/logger');

// Test endpoint to add a job to the queue (PUBLIC - NO AUTH)
router.post('/test-queue', async (req, res) => {
  try {
    logger.info('Test queue endpoint called');
    
    // Add a test job to the unsubscribe queue
    const job = await unsubscribeQueue.add(
      'test-job',
      {
        batchJobId: 'test-batch-' + Date.now(),
        userId: 'test-user',
        emailId: 'test-email-' + Date.now(),
        unsubscribeLink: 'https://example.com/unsubscribe',
        subject: 'Test Email Subject',
        sender: 'test@example.com',
        isTest: true, // Flag to identify test jobs
      },
      {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      }
    );
    
    logger.info('Test job added to queue', {
      jobId: job.id,
      jobName: job.name,
    });
    
    // Get queue status
    const counts = await unsubscribeQueue.getJobCounts();
    
    res.json({
      success: true,
      message: 'Test job added successfully',
      jobId: job.id,
      jobName: job.name,
      queueCounts: counts,
    });
  } catch (error) {
    logger.error('Failed to add test job:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get queue status
router.get('/queue-status', async (req, res) => {
  try {
    const counts = await unsubscribeQueue.getJobCounts();
    const isPaused = await unsubscribeQueue.isPaused();
    
    res.json({
      success: true,
      queueName: 'unsubscribe',
      isPaused,
      counts,
    });
  } catch (error) {
    logger.error('Failed to get queue status:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;