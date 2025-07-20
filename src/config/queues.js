const Bull = require('bull');
const logger = require('../utils/logger');

// Log all Redis-related environment variables for debugging
logger.info('Redis Queue Environment Variables:', {
  REDIS_QUEUE_URL: process.env.REDIS_QUEUE_URL ? 'Set (hidden)' : 'Not set',
  REDIS_QUEUE_HOST: process.env.REDIS_QUEUE_HOST || 'Not set',
  REDIS_QUEUE_PORT: process.env.REDIS_QUEUE_PORT || 'Not set'
});

// Get Redis URL for queues
const redisUrl = process.env.REDIS_QUEUE_URL || process.env.REDIS_URL;

if (!redisUrl) {
  logger.error('No Redis URL configured for queues!');
  throw new Error('REDIS_QUEUE_URL or REDIS_URL must be set');
}

logger.info('Initializing Bull queues with Redis URL', {
  url: redisUrl.replace(/:([^:@]+)@/, ':****@'),
  fullUrl: redisUrl // Show full URL for debugging
});

// Parse the Redis URL to create Upstash-compatible configuration
const url = new URL(redisUrl);
const redisConfig = {
  redis: {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password,
    // Upstash specific settings
    tls: {
      rejectUnauthorized: false
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: (times) => {
      if (times > 3) {
        logger.error('Redis connection failed after 3 retries');
        return null;
      }
      const delay = Math.min(times * 1000, 3000);
      logger.info(`Retrying Redis connection, attempt ${times}, delay ${delay}ms`);
      return delay;
    }
  }
};

logger.info('Creating Bull queues with Upstash configuration...', {
  host: url.hostname,
  port: url.port || 6379,
  hasTLS: true
});

// Create queues with the parsed configuration
const emailProcessingQueue = new Bull('email-processing', redisConfig);
const unsubscribeQueue = new Bull('unsubscribe', redisConfig);
logger.info('Bull queues created successfully', {
  queues: ['email-processing', 'unsubscribe']
});

// Test the actual Redis connection
(async () => {
  try {
    // Try to get queue status - this will force a connection
    const emailQueueStatus = await emailProcessingQueue.getJobCounts();
    logger.info('Email processing queue connected to Redis successfully', { 
      status: emailQueueStatus 
    });
    
    const unsubscribeQueueStatus = await unsubscribeQueue.getJobCounts();
    logger.info('Unsubscribe queue connected to Redis successfully', { 
      status: unsubscribeQueueStatus 
    });
  } catch (error) {
    logger.error('Failed to connect Bull queues to Redis', {
      error: error.message,
      stack: error.stack
    });
  }
})();

// Queue event handlers
emailProcessingQueue.on('error', error => {
  logger.error('Email processing queue error:', error);
});

emailProcessingQueue.on('ready', () => {
  logger.info('Email processing queue is ready and connected to Redis');
});

emailProcessingQueue.on('connect', () => {
  logger.info('Email processing queue connected to Redis successfully');
});

emailProcessingQueue.on('disconnect', () => {
  logger.warn('Email processing queue disconnected from Redis');
});

emailProcessingQueue.on('reconnecting', () => {
  logger.info('Email processing queue reconnecting to Redis...');
});

emailProcessingQueue.on('stalled', job => {
  logger.warn('Email processing job stalled', { jobId: job?.id });
});

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

// Log successful module export
logger.info('Bull queues module initialized and exported');

module.exports = {
  emailProcessingQueue,
  unsubscribeQueue,
};
