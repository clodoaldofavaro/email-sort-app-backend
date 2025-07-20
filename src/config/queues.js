const { Queue } = require('bullmq');
const Redis = require('ioredis');
const logger = require('../utils/logger');

// Log all Redis-related environment variables for debugging
logger.info('Redis Queue Environment Variables:', {
  REDIS_QUEUE_HOST: process.env.REDIS_QUEUE_HOST || 'Not set',
  REDIS_QUEUE_PORT: process.env.REDIS_QUEUE_PORT || 'Not set',
  REDIS_QUEUE_PASSWORD: process.env.REDIS_QUEUE_PASSWORD ? 'Set (hidden)' : 'Not set',
  REDIS_QUEUE_URL: process.env.REDIS_QUEUE_URL ? 'Set (hidden)' : 'Not set',
});

// Create Redis connection following Upstash BullMQ guide
let redisConnection;

try {
  // Upstash recommends using the URL directly with specific options
  const redisUrl = process.env.REDIS_QUEUE_URL || process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error('REDIS_QUEUE_URL must be set');
  }

  logger.info('Creating Redis connection for BullMQ (Upstash)', {
    url: redisUrl.replace(/:([^:@]+)@/, ':****@'),
    fullUrl: redisUrl,
  });

  // Following Upstash BullMQ documentation exactly
  redisConnection = new Redis({
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: {},
    family: 6,
    host: process.env.REDIS_QUEUE_HOST,
    port: process.env.REDIS_QUEUE_PORT,
    password: process.env.REDIS_QUEUE_PASSWORD,
  });

  // Test the connection
  redisConnection.on('connect', () => {
    logger.info('Redis Queue connection established');
  });

  redisConnection.on('ready', () => {
    logger.info('Redis Queue connection ready');
  });

  redisConnection.on('error', err => {
    logger.error('Redis Queue connection error');
  });

  redisConnection.on('close', () => {
    logger.warn('Redis Queue connection closed');
  });
} catch (error) {
  logger.error('Failed to create Redis connection:');
  throw error;
}

logger.info('Creating BullMQ queues with explicit Redis connection...');

const unsubscribeQueue = new Queue('unsubscribe', {
  connection: redisConnection,
});

logger.info('BullMQ queues created successfully', {
  queues: ['email-processing', 'unsubscribe'],
});

// Test the actual Redis connection
(async () => {
  try {
    // Try to get queue status - this will force a connection
    logger.info('trying to connect to queue');
    const unsubscribeQueueStatus = await unsubscribeQueue.getJobCounts();
    logger.info('Unsubscribe queue connected to Redis successfully', {
      status: unsubscribeQueueStatus,
    });
  } catch (error) {
    logger.error('Failed to connect Bull queues to Redis', {
      error: error.message,
      stack: error.stack,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
      hostname: error.hostname,
      fullError: JSON.stringify(error, null, 2),
    });
  }
})();

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
  unsubscribeQueue,
  redisConnection,
};
