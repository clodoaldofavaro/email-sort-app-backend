const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Test connection
pool.on('connect', () => {
  logger.info('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  logger.error('Database connection error:', err);
});

// Test the connection on startup
const testConnection = async () => {
  try {
    await pool.query('SELECT 1');
    logger.info('Database connection test successful');
  } catch (error) {
    logger.error('Database connection test failed:', error);
    // Don't exit - let the app start anyway for health checks
  }
};

// Test connection but don't block startup
if (process.env.DATABASE_URL) {
  testConnection();
} else {
  logger.warn('DATABASE_URL not set - database operations will fail');
}

module.exports = pool;