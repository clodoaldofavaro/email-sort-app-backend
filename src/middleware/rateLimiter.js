const rateLimit = require('express-rate-limit');
const redis = require('../config/redis');

// Create rate limiter with Redis store
const createRateLimiter = (options = {}) => {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000, // 15 minutes
    max: options.max || 100,
    message: options.message || 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    store: redis
      ? {
          incr: async key => {
            const current = await redis.incr(key);
            if (current === 1) {
              await redis.expire(key, Math.ceil(options.windowMs / 1000));
            }
            return { totalHits: current, resetTime: new Date(Date.now() + options.windowMs) };
          },
          decrement: async key => {
            await redis.decr(key);
          },
          resetKey: async key => {
            await redis.del(key);
          },
        }
      : undefined,
  });
};

// Different rate limiters for different endpoints
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 auth attempts per window
  message: 'Too many authentication attempts, please try again later.',
});

const apiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
});

const bulkActionLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 bulk actions per window
  message: 'Too many bulk actions, please try again later.',
});

module.exports = {
  authLimiter,
  apiLimiter,
  bulkActionLimiter,
};
