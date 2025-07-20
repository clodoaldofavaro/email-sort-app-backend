const logger = require('../utils/logger');

// Initialize all workers
const initializeWorkers = () => {
  logger.info('Initializing queue workers...');
  
  try {
    // Start unsubscribe worker
    // TEMPORARILY DISABLED DUE TO REDIS CONNECTION ISSUES
    // require('./unsubscribeWorker');
    // logger.info('Unsubscribe worker initialized');
    
    // Add other workers here as needed
    // require('./emailProcessingWorker');
    
    logger.info('Workers disabled - skipping initialization');
  } catch (error) {
    logger.error('Failed to initialize workers:', error);
    throw error;
  }
};

module.exports = { initializeWorkers };