const Bull = require('bull');
const logger = require('../utils/logger');

// Log all Redis-related environment variables for debugging
logger.info('Redis Queue Environment Variables:', {
  REDIS_QUEUE_URL: process.env.REDIS_QUEUE_URL ? 'Set (hidden)' : 'Not set',
  REDIS_QUEUE_HOST: process.env.REDIS_QUEUE_HOST || 'Not set',
  REDIS_QUEUE_PORT: process.env.REDIS_QUEUE_PORT || 'Not set',
  REDIS_URL: process.env.REDIS_URL ? 'Set (hidden)' : 'Not set',
  REDIS_HOST: process.env.REDIS_HOST || 'Not set',
  REDIS_PORT: process.env.REDIS_PORT || 'Not set'
});

// Redis connection for queues
const redisQueueConfig = {
  redis: {
    host: process.env.REDIS_QUEUE_HOST || process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_QUEUE_PORT || process.env.REDIS_PORT || '6380',
    password: process.env.REDIS_QUEUE_PASSWORD || process.env.REDIS_PASSWORD || undefined,
    // Force IPv4 for Upstash Redis on Fly.io
    family: 4
  },
};

// If REDIS_QUEUE_URL is provided, parse it and add family: 4
if (process.env.REDIS_QUEUE_URL || process.env.REDIS_URL) {
  const redisUrl = process.env.REDIS_QUEUE_URL || process.env.REDIS_URL;
  const urlToLog = redisUrl || '';
  
  // Parse the URL to extract components
  const url = new URL(redisUrl);
  redisQueueConfig.redis = {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || undefined,
    // Force IPv4 for Upstash Redis on Fly.io
    family: 4
  };
  
  logger.info('Using Redis URL for Bull queues (parsed for IPv4)', { 
    url: urlToLog.replace(/:([^:@]+)@/, ':****@'),
    host: url.hostname,
    port: url.port || 6379
  });
} else {
  logger.info('Using Redis host/port configuration for Bull queues', {
    host: redisQueueConfig.redis.host,
    port: redisQueueConfig.redis.port,
    hasPassword: !!redisQueueConfig.redis.password
  });
}

// Create queues
logger.info('Creating Bull queues...');
const emailProcessingQueue = new Bull('email-processing', redisQueueConfig);
const unsubscribeQueue = new Bull('unsubscribe', redisQueueConfig);
logger.info('Bull queues created successfully', {
  queues: ['email-processing', 'unsubscribe']
});

// Queue event handlers
emailProcessingQueue.on('error', error => {
  logger.error('Email processing queue error:', error);
});

emailProcessingQueue.on('ready', () => {
  logger.info('Email processing queue is ready');
});

emailProcessingQueue.on('stalled', job => {
  logger.warn('Email processing job stalled', { jobId: job?.id });
});

unsubscribeQueue.on('error', error => {
  logger.error('Unsubscribe queue error:', error);
});

unsubscribeQueue.on('ready', () => {
  logger.info('Unsubscribe queue is ready');
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
