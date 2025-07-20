const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { unsubscribeQueue } = require('../config/queues');
const db = require('../config/database');
const unsubscribeService = require('../services/unsubscribe');
const logger = require('../utils/logger');

logger.info('Redis connection test for worker file...');
let redisConnection;

try {
  // Build Redis URL from components if not explicitly provided
  const redisHost = process.env.REDIS_QUEUE_HOST || process.env.REDIS_HOST || 'localhost';
  const redisPort = process.env.REDIS_QUEUE_PORT || process.env.REDIS_PORT || '6379';
  const redisPassword = process.env.REDIS_QUEUE_PASSWORD || process.env.REDIS_PASSWORD;

  // Construct URL with auth if password exists
  let redisUrl;
  if (redisPassword) {
    redisUrl = `redis://default:${redisPassword}@${redisHost}:${redisPort}`;
  } else {
    redisUrl = `redis://${redisHost}:${redisPort}`;
  }

  // Override with explicit URL if provided
  if (process.env.REDIS_QUEUE_URL) {
    redisUrl = process.env.REDIS_QUEUE_URL;
  } else if (process.env.REDIS_URL) {
    redisUrl = process.env.REDIS_URL;
  }

  logger.info('Creating Redis connection for worker', {
    url: redisUrl.replace(/:([^:@]+)@/, ':****@'),
    host: redisHost,
    port: redisPort,
  });

  redisConnection = new Redis(redisUrl, { family: 6, maxRetriesPerRequest: null });
} catch (error) {
  logger.error('Error connecting worker to Redis', error);
  throw error;
}

// Connection event handlers for debugging
redisConnection.on('connect', () => {
  logger.info('Worker Redis connection established');
});

redisConnection.on('ready', () => {
  logger.info('Worker Redis connection ready');
});

redisConnection.on('error', err => {
  logger.error('Worker Redis connection error:', err);
});

redisConnection.on('close', () => {
  logger.warn('Worker Redis connection closed');
});

// ioredis connects automatically, no need for manual connect
logger.info('Worker Redis client created with ioredis');

let unsubscribeWorker;
try {
  logger.info('Creating BullMQ Worker for unsubscribe queue...');

  // Create Worker with the same connection as the queue
  unsubscribeWorker = new Worker(
    'unsubscribe',
    async job => {
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
          message: unsubscribeResult.message,
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
              timestamp: new Date().toISOString(),
            }),
            emailId,
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
          message: unsubscribeResult.message,
        };
      } catch (error) {
        logger.error(`Error processing unsubscribe job for email ${emailId}:`, {
          error: error.message,
          stack: error.stack,
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
                timestamp: new Date().toISOString(),
              }),
              emailId,
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

              logger.info(
                `Batch ${batchJobId} completed with errors. Processed ${processed_count} emails.`
              );
            }
          }
        } catch (updateError) {
          logger.error('Failed to update email status after error:', updateError);
        }

        // Throw error to trigger BullMQ retry mechanism
        throw error;
      }
    },
    {
      // Use the same connection as the queue
      connection: redisConnection,
      // Configure worker settings
      concurrency: 5,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );

  logger.info('BullMQ Worker created successfully for unsubscribe queue');
} catch (error) {
  logger.error('Failed to create BullMQ Worker:', {
    error: error.message,
    stack: error.stack,
    code: error.code,
    errno: error.errno,
    syscall: error.syscall,
    hostname: error.hostname,
  });
  throw error;
}

unsubscribeWorker.on('completed', (job, result) => {
  logger.info(`Unsubscribe job ${job.id} completed:`, result);
});

unsubscribeWorker.on('failed', (job, err) => {
  logger.error(`Unsubscribe job ${job.id} failed:`, {
    error: err.message,
    stack: err.stack,
    data: job.data,
  });
});

unsubscribeWorker.on('stalled', jobId => {
  logger.warn(`Unsubscribe job ${jobId} stalled`);
});

// Error handler for worker failures
unsubscribeWorker.on('error', error => {
  logger.error('Unsubscribe worker error:', {
    message: error.message,
    stack: error.stack,
    code: error.code,
    errno: error.errno,
    syscall: error.syscall,
    hostname: error.hostname,
    fullError: error,
  });
});

// Clean up completed jobs periodically - DISABLED

setInterval(
  async () => {
    try {
      const completed = await unsubscribeQueue.clean(24 * 60 * 60 * 1000); // 24 hours
      if (completed.length > 0) {
        logger.info(`Cleaned ${completed.length} completed unsubscribe jobs`);
      }
    } catch (error) {
      logger.error('Error cleaning unsubscribe queue:', error);
    }
  },
  60 * 60 * 1000
); // Run every hour

// Test Redis connection on startup
setTimeout(async () => {
  try {
    logger.info('Testing Redis connection for unsubscribe worker...');

    // Test with direct Redis commands
    const testKey = 'worker-redis-test-key';
    const testValue = 'Worker Redis Connected at ' + new Date().toISOString();

    logger.info('Testing Worker Redis connection with set/get...');
    await redisConnection.setex(testKey, 60, testValue); // 60 second TTL

    const retrievedValue = await redisConnection.get(testKey);
    if (retrievedValue === testValue) {
      logger.info('Worker Redis test successful!', {
        key: testKey,
        value: retrievedValue,
      });

      const counts = await unsubscribeQueue.getJobCounts();
      logger.info('Unsubscribe queue job counts (WORKER FILE):', counts);

      const waitingJobs = await unsubscribeQueue.getWaitingCount();
      logger.info('Unsubscribe queue waiting jobs (WORKER FILE):', waitingJobs);
    } else {
      logger.error('Worker Redis test failed - value mismatch', {
        expected: testValue,
        received: retrievedValue,
      });
    }
  } catch (error) {
    logger.error('Worker Redis test failed:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
      hostname: error.hostname,
      stack: error.stack,
    });
  }
}, 2000); // Wait 2 seconds for connection to establish

logger.info('Redis connection test complete');

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing worker...');

  if (unsubscribeWorker) {
    await unsubscribeWorker.close();
  }

  if (redisConnection) {
    redisConnection.disconnect();
  }
  process.exit(0);
});

// No exports - just testing Redis connection
module.exports = { unsubscribeWorker };
