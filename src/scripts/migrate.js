const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigrations() {
  try {
    console.log('Running database migrations...');
    
    const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
    console.log('Looking for schema file at:', schemaPath);
    
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found at: ${schemaPath}`);
    }
    
    const schema = fs.readFileSync(schemaPath, 'utf8');
    console.log('Schema file loaded successfully');
    
    await pool.query(schema);
    console.log('Database migrations completed successfully!');
    
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };