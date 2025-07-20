const redis = require('redis');
const logger = require('../utils/logger');

let client = null;
let isConnected = false;

// Create Redis Cache client
try {
  // Build Redis URL from host and port if not explicitly provided
  const redisHost = process.env.REDIS_CACHE_HOST || process.env.REDIS_HOST || 'localhost';
  const redisPort = process.env.REDIS_CACHE_PORT || process.env.REDIS_PORT || '6379';
  const redisUrl = process.env.REDIS_CACHE_URL || process.env.REDIS_URL || `redis://${redisHost}:${redisPort}`;
  
  // Log Redis configuration (without sensitive data)
  const sanitizedUrl = redisUrl.replace(/:([^:@]+)@/, ':****@');
  logger.info('Initializing Redis Cache client', { url: sanitizedUrl });
  
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
    logger.info('Connected to Redis Cache successfully');
    isConnected = true;
  });

  client.on('ready', () => {
    logger.info('Redis Cache client is ready to accept commands');
  });

  client.on('reconnecting', () => {
    logger.info('Reconnecting to Redis Cache...');
  });

  client.on('disconnect', () => {
    logger.warn('Disconnected from Redis Cache');
    isConnected = false;
  });

  // Connect to Redis
  (async () => {
    try {
      await client.connect();
      
      // Test Redis connection with set/get
      setTimeout(async () => {
        if (isConnected) {
          try {
            const testKey = 'redis-cache-test-key';
            const testValue = 'Redis Cache Connected at ' + new Date().toISOString();
            
            logger.info('Testing Redis Cache connection with set/get...');
            await client.setEx(testKey, 60, testValue); // 60 second TTL
            
            const retrievedValue = await client.get(testKey);
            if (retrievedValue === testValue) {
              logger.info('Redis Cache test successful!', { 
                key: testKey, 
                value: retrievedValue 
              });
            } else {
              logger.error('Redis Cache test failed - value mismatch', {
                expected: testValue,
                received: retrievedValue
              });
            }
          } catch (testError) {
            logger.error('Redis Cache test failed:', testError);
          }
        }
      }, 2000); // Wait 2 seconds for connection to establish
    } catch (error) {
      logger.error('Failed to connect to Redis Cache:', error);
      isConnected = false;
    }
  })();
  logger.info('Redis Cache client created, attempting to connect...');
} catch (error) {
  logger.error('Failed to create Redis Cache client:', error);
}

// Wrapper functions with error handling
const redisWrapper = {
  async get(key) {
    if (!client || !isConnected) {
      logger.warn('Redis Cache not available, skipping cache get');
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
      logger.warn('Redis Cache not available, skipping cache set');
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
      logger.warn('Redis Cache not available, skipping cache delete');
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