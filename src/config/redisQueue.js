const redis = require('redis');
const logger = require('../utils/logger');

let client = null;
let isConnected = false;

// Create Redis Queue client
try {
  // Build Redis URL from host and port if not explicitly provided
  const redisHost = process.env.REDIS_QUEUE_HOST || process.env.REDIS_HOST || 'localhost';
  const redisPort = process.env.REDIS_QUEUE_PORT || process.env.REDIS_PORT || '6379';
  const redisUrl = process.env.REDIS_QUEUE_URL || process.env.REDIS_URL || `redis://${redisHost}:${redisPort}`;
  
  // Log Redis configuration (without sensitive data)
  const sanitizedUrl = redisUrl.replace(/:([^:@]+)@/, ':****@');
  logger.info('Initializing Redis Queue client', { url: sanitizedUrl });
  
  client = redis.createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          logger.error('Too many Redis Queue reconnection attempts');
          return new Error('Too many retries');
        }
        return Math.min(retries * 100, 3000);
      },
      // Force IPv4 for Upstash Redis on Fly.io
      family: 4
    }
  });

  client.on('error', err => {
    logger.error('Redis Queue Client Error:', err);
    isConnected = false;
  });

  client.on('connect', () => {
    logger.info('Connected to Redis Queue successfully');
    isConnected = true;
  });

  client.on('ready', () => {
    logger.info('Redis Queue client is ready to accept commands');
  });

  client.on('reconnecting', () => {
    logger.info('Reconnecting to Redis Queue...');
  });

  client.on('disconnect', () => {
    logger.warn('Disconnected from Redis Queue');
    isConnected = false;
  });

  // Connect to Redis
  (async () => {
    try {
      await client.connect();
    } catch (error) {
      logger.error('Failed to connect to Redis Queue:', error);
      isConnected = false;
    }
  })();
  logger.info('Redis Queue client created, attempting to connect...');
} catch (error) {
  logger.error('Failed to create Redis Queue client:', error);
}

// Log export status
if (client) {
  logger.info('Redis Queue client exported for Bull queue usage');
} else {
  logger.error('Redis Queue client is null, Bull queues may not function properly');
}

// Export the client directly for Bull to use
module.exports = client;