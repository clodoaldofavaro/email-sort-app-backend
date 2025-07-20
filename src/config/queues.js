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

// Create queues - Bull will handle the connection using ioredis internally
logger.info('Creating Bull queues...');
const emailProcessingQueue = new Bull('email-processing', redisUrl);
const unsubscribeQueue = new Bull('unsubscribe', redisUrl);
logger.info('Bull queues created successfully', {
  queues: ['email-processing', 'unsubscribe']
});

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
