const Bull = require('bull');
const logger = require('../utils/logger');

// Redis connection for queues
const redisQueueConfig = {
  redis: {
    host: process.env.REDIS_QUEUE_HOST || process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_QUEUE_PORT || process.env.REDIS_PORT || '6380',
    password: process.env.REDIS_QUEUE_PASSWORD || process.env.REDIS_PASSWORD || undefined,
  },
};

// If REDIS_QUEUE_URL is provided, use it instead
if (process.env.REDIS_QUEUE_URL || process.env.REDIS_URL) {
  redisQueueConfig.redis = process.env.REDIS_QUEUE_URL || process.env.REDIS_URL;
}

// Create queues
const emailProcessingQueue = new Bull('email-processing', redisQueueConfig);
const unsubscribeQueue = new Bull('unsubscribe', redisQueueConfig);

// Queue event handlers
emailProcessingQueue.on('error', error => {
  logger.error('Email processing queue error:', error);
});

unsubscribeQueue.on('error', error => {
  logger.error('Unsubscribe queue error:', error);
});

module.exports = {
  emailProcessingQueue,
  unsubscribeQueue,
};
