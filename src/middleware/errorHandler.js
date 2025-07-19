const errorHandler = (err, req, res, next) => {
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  // Default error
  let error = {
    message: 'Internal server error',
    status: 500,
  };

  // Specific error types
  if (err.name === 'ValidationError') {
    error = {
      message: 'Validation failed',
      status: 400,
      details: err.details,
    };
  } else if (err.name === 'UnauthorizedError') {
    error = {
      message: 'Unauthorized',
      status: 401,
    };
  } else if (err.code === '23505') {
    // PostgreSQL unique constraint
    error = {
      message: 'Resource already exists',
      status: 409,
    };
  } else if (err.code === 'ECONNREFUSED') {
    error = {
      message: 'Database connection failed',
      status: 503,
    };
  }

  // Send error response
  res.status(error.status).json({
    error: error.message,
    ...(process.env.NODE_ENV === 'development' && {
      details: error.details,
      stack: err.stack,
    }),
  });
};

module.exports = errorHandler;
