const logger = require('../utils/logger');

// Initialize all workers
const initializeWorkers = () => {
  logger.info('Initializing queue workers...');
  
  try {
    // Start unsubscribe worker
    require('./unsubscribeWorker');
    logger.info('Unsubscribe worker initialized');
    
    // Add other workers here as needed
    // require('./emailProcessingWorker');
    
    logger.info('All queue workers initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize workers:', error);
    throw error;
  }
};

module.exports = { initializeWorkers };