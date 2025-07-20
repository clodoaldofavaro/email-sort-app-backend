// const { Queue } = require('bullmq');
const Redis = require('ioredis');
const logger = require('../utils/logger');

// Log all Redis-related environment variables for debugging
logger.info('Redis Queue Environment Variables:', {
  REDIS_QUEUE_HOST: process.env.REDIS_QUEUE_HOST || 'Not set',
  REDIS_QUEUE_PORT: process.env.REDIS_QUEUE_PORT || 'Not set',
  REDIS_QUEUE_PASSWORD: process.env.REDIS_QUEUE_PASSWORD ? 'Set (hidden)' : 'Not set',
  REDIS_QUEUE_URL: process.env.REDIS_QUEUE_URL ? 'Set (hidden)' : 'Not set',
});

// Create Redis connection following same pattern as redisCache.js
let redisConnection;
let isConnected = false;

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

  logger.info('Creating Redis connection for BullMQ', {
    url: redisUrl.replace(/:([^:@]+)@/, ':****@'),
    host: redisHost,
    port: redisPort,
  });

  // Create connection using ioredis with family 6 option
  redisConnection = new Redis(redisUrl, { family: 6 });

  // Test the connection
  redisConnection.on('connect', () => {
    logger.info('Redis Queue connection established');
    isConnected = true;
  });

  redisConnection.on('ready', () => {
    logger.info('Redis Queue connection ready');
  });

  redisConnection.on('error', err => {
    logger.error('Redis Queue connection error:', err);
    isConnected = false;
  });

  redisConnection.on('close', () => {
    logger.warn('Redis Queue connection closed');
    isConnected = false;
  });

  redisConnection.on('reconnecting', () => {
    logger.info('Reconnecting to Redis Queue...');
  });

  logger.info('Redis Queue client created with ioredis and family: 6');
} catch (error) {
  logger.error('Failed to create Redis connection:');
  throw error;
}

// COMMENTING OUT QUEUE CREATION - TESTING REDIS CONNECTION ONLY
/*
logger.info('Creating BullMQ queues with explicit Redis connection...');

const unsubscribeQueue = new Queue('unsubscribe', {
  connection: redisConnection,
});

logger.info('BullMQ queues created successfully', {
  queues: ['email-processing', 'unsubscribe'],
});
*/

// Test the actual Redis connection
setTimeout(async () => {
  if (isConnected) {
    try {
      // Test with direct Redis commands using ioredis
      const testKey = 'queue-redis-test-key-hello';
      const testValue = 'Queue Redis Connected at ' + new Date().toISOString();

      logger.info('Testing Queue Redis connection with set/get...');
      await redisConnection.setex(testKey, 60, testValue); // 60 second TTL

      const retrievedValue = await redisConnection.get(testKey);
      if (retrievedValue === testValue) {
        logger.info('Queue Redis test successful!', {
          key: testKey,
          value: retrievedValue,
        });

        // Queue operations test disabled - testing Redis only
        /*
        logger.info('Testing BullMQ queue operations...');
        const jobCounts = await unsubscribeQueue.getJobCounts();
        logger.info('Queue job counts retrieved successfully', { counts: jobCounts });
        */
      } else {
        logger.error('Queue Redis test failed - value mismatch', {
          expected: testValue,
          received: retrievedValue,
        });
      }
    } catch (error) {
      logger.error('Queue Redis test failed:', {
        error: error.message,
        stack: error.stack,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        hostname: error.hostname,
      });
    }
  } else {
    logger.warn('Redis connection not ready for testing');
  }
}, 2000); // Wait 2 seconds for connection to establish

// QUEUE EVENT HANDLERS DISABLED
/*
unsubscribeQueue.on('error', error => {
  logger.error('Unsubscribe queue error:', error);
});

unsubscribeQueue.on('ready', () => {
  logger.info('Unsubscribe queue is ready and connected to Redis');
});

unsubscribeQueue.on('connect', () => {
  logger.info('Unsubscribe queue connected to Redis successfully');
});

unsubscribeQueue.on('disconnect', () => {
  logger.warn('Unsubscribe queue disconnected from Redis');
});

unsubscribeQueue.on('reconnecting', () => {
  logger.info('Unsubscribe queue reconnecting to Redis...');
});

unsubscribeQueue.on('stalled', job => {
  logger.warn('Unsubscribe job stalled', { jobId: job?.id });
});
*/

// Log successful module export
logger.info('Redis connection test module initialized');

// Export empty object - no queues
module.exports = {
  // unsubscribeQueue,
};
