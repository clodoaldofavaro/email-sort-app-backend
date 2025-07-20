const { unsubscribeQueue } = require('../config/queues');
const db = require('../config/database');
const unsubscribeService = require('../services/unsubscribe');
const logger = require('../utils/logger');

logger.info('Starting unsubscribe worker initialization...');

// Process unsubscribe jobs
try {
  logger.info('Attempting to register job processor for unsubscribe-email...');
  
  unsubscribeQueue.process('unsubscribe-email', async (job) => {
  const { batchJobId, userId, emailId, unsubscribeLink, subject, sender } = job.data;
  
  logger.info(`Processing unsubscribe job for email ${emailId} in batch ${batchJobId}`);
  
  try {
    // Update batch job status to processing if it's the first email
    await db.query(
      `UPDATE unsubscribe_jobs 
       SET status = 'processing', updated_at = NOW() 
       WHERE id = $1 AND status = 'pending'`,
      [batchJobId]
    );

    // Update email status to in progress
    await db.query(
      'UPDATE emails SET unsubscribe_status = $1, unsubscribe_attempted_at = NOW() WHERE id = $2',
      ['in_progress', emailId]
    );

    // Attempt to unsubscribe
    const unsubscribeResult = await unsubscribeService.unsubscribeFromEmail(unsubscribeLink);
    
    logger.info(`Unsubscribe result for email ${emailId}:`, {
      success: unsubscribeResult.success,
      message: unsubscribeResult.message
    });

    // Update email record with result
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
        emailId
      ]
    );

    // Record job result
    await db.query(
      `INSERT INTO unsubscribe_job_results (job_id, email_id, success, message)
       VALUES ($1, $2, $3, $4)`,
      [batchJobId, emailId, unsubscribeResult.success, unsubscribeResult.message]
    );

    // Update batch job counters
    const counterField = unsubscribeResult.success ? 'success_count' : 'failed_count';
    const result = await db.query(
      `UPDATE unsubscribe_jobs 
       SET processed_count = processed_count + 1,
           ${counterField} = ${counterField} + 1,
           updated_at = NOW()
       WHERE id = $1
       RETURNING processed_count, total_emails`,
      [batchJobId]
    );

    // Check if batch is complete
    if (result.rows.length > 0) {
      const { processed_count, total_emails } = result.rows[0];
      
      if (processed_count >= total_emails) {
        // Mark batch as completed
        await db.query(
          `UPDATE unsubscribe_jobs 
           SET status = 'completed', 
               completed_at = NOW(),
               updated_at = NOW()
           WHERE id = $1`,
          [batchJobId]
        );
        
        logger.info(`Batch ${batchJobId} completed. Processed ${processed_count} emails.`);
        
        // TODO: Send notification to user about batch completion
      }
    }

    // Update job progress
    job.progress(100);
    
    return {
      success: unsubscribeResult.success,
      emailId,
      message: unsubscribeResult.message
    };

  } catch (error) {
    logger.error(`Error processing unsubscribe job for email ${emailId}:`, {
      error: error.message,
      stack: error.stack
    });

    // Update email status to failed
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
          emailId
        ]
      );

      // Record job failure
      await db.query(
        `INSERT INTO unsubscribe_job_results (job_id, email_id, success, message)
         VALUES ($1, $2, FALSE, $3)`,
        [batchJobId, emailId, error.message]
      );

      // Update batch job counters
      const result = await db.query(
        `UPDATE unsubscribe_jobs 
         SET processed_count = processed_count + 1,
             failed_count = failed_count + 1,
             updated_at = NOW()
         WHERE id = $1
         RETURNING processed_count, total_emails`,
        [batchJobId]
      );

      // Check if batch is complete
      if (result.rows.length > 0) {
        const { processed_count, total_emails } = result.rows[0];
        
        if (processed_count >= total_emails) {
          await db.query(
            `UPDATE unsubscribe_jobs 
             SET status = 'completed', 
                 completed_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1`,
            [batchJobId]
          );
          
          logger.info(`Batch ${batchJobId} completed with errors. Processed ${processed_count} emails.`);
        }
      }
    } catch (updateError) {
      logger.error('Failed to update email status after error:', updateError);
    }

    // Throw error to trigger Bull retry mechanism
    throw error;
  }
  });

  logger.info('Job processor registered successfully for unsubscribe-email');
} catch (error) {
  logger.error('Failed to register unsubscribe job processor:', {
    error: error.message,
    stack: error.stack,
    code: error.code,
    errno: error.errno,
    syscall: error.syscall,
    hostname: error.hostname
  });
  throw error;
}

// Queue event handlers
unsubscribeQueue.on('completed', (job, result) => {
  logger.info(`Unsubscribe job ${job.id} completed:`, result);
});

unsubscribeQueue.on('failed', (job, err) => {
  logger.error(`Unsubscribe job ${job.id} failed:`, {
    error: err.message,
    stack: err.stack,
    data: job.data
  });
});

unsubscribeQueue.on('stalled', (job) => {
  logger.warn(`Unsubscribe job ${job.id} stalled`, job.data);
});

// Error handler for batch job failures
unsubscribeQueue.on('error', (error) => {
  logger.error('Unsubscribe queue error:', {
    message: error.message,
    stack: error.stack,
    code: error.code,
    errno: error.errno,
    syscall: error.syscall,
    hostname: error.hostname,
    fullError: error
  });
});

// Clean up completed jobs periodically
setInterval(async () => {
  try {
    const completed = await unsubscribeQueue.clean(24 * 60 * 60 * 1000); // 24 hours
    if (completed.length > 0) {
      logger.info(`Cleaned ${completed.length} completed unsubscribe jobs`);
    }
  } catch (error) {
    logger.error('Error cleaning unsubscribe queue:', error);
  }
}, 60 * 60 * 1000); // Run every hour

// Test Redis connection on startup
(async () => {
  try {
    logger.info('Testing Redis connection for unsubscribe queue...');
    const health = await unsubscribeQueue.isReady();
    logger.info('Unsubscribe queue Redis connection test:', { isReady: health });
    
    const counts = await unsubscribeQueue.getJobCounts();
    logger.info('Unsubscribe queue job counts:', counts);
  } catch (error) {
    logger.error('Failed to connect to Redis for unsubscribe queue:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
      hostname: error.hostname
    });
  }
})();

logger.info('Unsubscribe worker started and processing jobs');

module.exports = unsubscribeQueue;