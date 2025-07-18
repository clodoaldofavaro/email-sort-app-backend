#!/usr/bin/env node

// Startup script to help debug deployment issues
console.log('🚀 Starting Email Sorting App Backend...');
console.log('Environment:', process.env.NODE_ENV);
console.log('Port:', process.env.PORT || 8080);

// Check required environment variables
const requiredEnvVars = ['JWT_SECRET'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.warn('⚠️  Missing required environment variables:', missingVars);
    console.warn('App will start but some features may not work');
}

// Optional environment variables
const optionalEnvVars = {
    'DATABASE_URL': 'Database operations will fail',
    'GOOGLE_CLIENT_ID': 'Google OAuth will not work',
    'GOOGLE_CLIENT_SECRET': 'Google OAuth will not work',
    'OPENAI_API_KEY': 'AI features will not work',
    'BROWSERBASE_API_KEY': 'Advanced unsubscribe will not work'
};

Object.entries(optionalEnvVars).forEach(([varName, consequence]) => {
    if (!process.env[varName]) {
        console.warn(`⚠️  ${varName} not set: ${consequence}`);
    }
});

console.log('✅ Environment check complete');

// Start the main application
try {
    require('../src/server');
} catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
}