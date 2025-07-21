const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { CronJob } = require('cron');
const { createServer } = require('http');
const logger = require('./utils/logger');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const categoryRoutes = require('./routes/categories');
const emailRoutes = require('./routes/emails');
const accountRoutes = require('./routes/accounts');
const unsubscribeRoutes = require('./routes/unsubscribe');
const notificationRoutes = require('./routes/notifications');
const testQueueRoutes = require('./routes/test-queue');
const { scheduleEmailProcessing } = require('./jobs/emailProcessor');
const { initializeWorkers } = require('./workers');
const { initializeWebSocket } = require('./websocket/notificationSocket');

const app = express();
const PORT = process.env.PORT || 8080;

// Trust proxy headers (required for Fly.io and other proxies)
app.set('trust proxy', true);

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // Disable CSP for API
  })
);

// CORS configuration
app.use(
  cors({
    origin: [
      'http://localhost:3000',
      'https://email-sort-app-frontend.fly.dev',
      process.env.FRONTEND_URL,
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api', unsubscribeRoutes);
app.use('/api', testQueueRoutes);

// Health check
app.get('/health', async (req, res) => {
  try {
    // Basic health check - just return OK if server is running
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      status: 'ERROR',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Metrics endpoint - OPTIONAL
app.get('/metrics', (req, res) => {
  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Email Sorting API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      categories: '/api/categories',
      emails: '/api/emails',
      accounts: '/api/accounts',
    },
  });
});

// Start email processing job
if (process.env.NODE_ENV === 'production') {
  // Process emails every 10 minutes
  const emailJob = new CronJob('*/10 * * * *', async () => {
    logger.info('Starting scheduled email processing...');
    await scheduleEmailProcessing();
  });
  emailJob.start();
  logger.info('Email processing scheduled');
}

// Error handling middleware
app.use((err, req, res, _) => {
  logger.error('Error:', err.stack);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong!',
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

// Initialize queue workers
try {
  initializeWorkers();
  logger.info('Queue workers initialized successfully');
} catch (error) {
  logger.error('Failed to initialize queue workers:', error);
  // Continue running without workers - API will still function
}

// Create HTTP server
const server = createServer(app);

// Initialize WebSocket
initializeWebSocket(server);

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.info('WebSocket server initialized');
});

module.exports = app;
