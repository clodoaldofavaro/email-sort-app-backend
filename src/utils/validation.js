const Joi = require('joi');

const schemas = {
  category: Joi.object({
    name: Joi.string().required().max(100).trim(),
    description: Joi.string().required().max(500).trim()
  }),
  
  bulkEmailAction: Joi.object({
    emailIds: Joi.array().items(Joi.string().uuid()).min(1).max(100).required()
  }),
  
  emailSearch: Joi.object({
    query: Joi.string().min(1).max(200).required(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20)
  }),
  
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20)
  })
};

const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details[0].message
      });
    }
    req.body = value;
    next();
  };
};

const validateQuery = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: 'Query validation failed',
        details: error.details[0].message
      });
    }
    req.query = value;
    next();
  };
};

module.exports = {
  schemas,
  validate,
  validateQuery
};