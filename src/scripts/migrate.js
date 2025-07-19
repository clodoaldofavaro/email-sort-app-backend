const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigrations() {
  try {
    logger.info('Running database migrations...');
    
    const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
    logger.info('Looking for schema file at:', schemaPath);
    
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found at: ${schemaPath}`);
    }
    
    const schema = fs.readFileSync(schemaPath, 'utf8');
    logger.info('Schema file loaded successfully');
    
    await pool.query(schema);
    logger.info('Database migrations completed successfully!');
    
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    logger.error('Error details:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };