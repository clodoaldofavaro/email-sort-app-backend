const redis = require('redis');
const logger = require('../utils/logger');

let client = null;
let isConnected = false;

// Create Redis client
try {
  // Build Redis URL from host and port if not explicitly provided
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = process.env.REDIS_PORT || '6379';
  const redisUrl = process.env.REDIS_URL || `redis://${redisHost}:${redisPort}`;
  
  client = redis.createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          logger.error('Too many Redis reconnection attempts');
          return new Error('Too many retries');
        }
        return Math.min(retries * 100, 3000);
      }
    }
  });

  client.on('error', err => {
    logger.error('Redis Client Error:', err);
    isConnected = false;
  });

  client.on('connect', () => {
    logger.info('Connected to Redis');
    isConnected = true;
  });

  client.on('disconnect', () => {
    logger.warn('Disconnected from Redis');
    isConnected = false;
  });

  // Connect to Redis
  (async () => {
    try {
      await client.connect();
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      isConnected = false;
    }
  })();
} catch (error) {
  logger.error('Failed to create Redis client:', error);
}

// Wrapper functions with error handling
const redisWrapper = {
  async get(key) {
    if (!client || !isConnected) {
      logger.warn('Redis not available, skipping cache get');
      return null;
    }
    
    try {
      return await client.get(key);
    } catch (error) {
      logger.error('Redis get error:', error);
      return null;
    }
  },

  async setEx(key, ttl, value) {
    if (!client || !isConnected) {
      logger.warn('Redis not available, skipping cache set');
      return false;
    }
    
    try {
      await client.setEx(key, ttl, value);
      return true;
    } catch (error) {
      logger.error('Redis setEx error:', error);
      return false;
    }
  },

  async del(key) {
    if (!client || !isConnected) {
      logger.warn('Redis not available, skipping cache delete');
      return false;
    }
    
    try {
      await client.del(key);
      return true;
    } catch (error) {
      logger.error('Redis del error:', error);
      return false;
    }
  },

  isAvailable() {
    return client && isConnected;
  }
};

module.exports = redisWrapper;