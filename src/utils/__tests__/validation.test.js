const Joi = require('joi');
const { schemas, validate, validateQuery } = require('../validation');

describe('Validation Utils', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      body: {},
      query: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  describe('schemas', () => {
    describe('category schema', () => {
      it('should validate valid category data', () => {
        const validData = {
          name: 'Work',
          description: 'Work related emails'
        };

        const { error, value } = schemas.category.validate(validData);

        expect(error).toBeUndefined();
        expect(value).toEqual(validData);
      });

      it('should trim whitespace from strings', () => {
        const dataWithSpaces = {
          name: '  Work  ',
          description: '  Work related emails  '
        };

        const { error, value } = schemas.category.validate(dataWithSpaces);

        expect(error).toBeUndefined();
        expect(value.name).toBe('Work');
        expect(value.description).toBe('Work related emails');
      });

      it('should reject category without name', () => {
        const invalidData = {
          description: 'Work related emails'
        };

        const { error } = schemas.category.validate(invalidData);

        expect(error).toBeDefined();
        expect(error.details[0].message).toContain('name');
      });

      it('should reject category without description', () => {
        const invalidData = {
          name: 'Work'
        };

        const { error } = schemas.category.validate(invalidData);

        expect(error).toBeDefined();
        expect(error.details[0].message).toContain('description');
      });

      it('should reject name longer than 100 characters', () => {
        const invalidData = {
          name: 'a'.repeat(101),
          description: 'Description'
        };

        const { error } = schemas.category.validate(invalidData);

        expect(error).toBeDefined();
        expect(error.details[0].message).toContain('100');
      });

      it('should reject description longer than 500 characters', () => {
        const invalidData = {
          name: 'Work',
          description: 'a'.repeat(501)
        };

        const { error } = schemas.category.validate(invalidData);

        expect(error).toBeDefined();
        expect(error.details[0].message).toContain('500');
      });
    });

    describe('bulkEmailAction schema', () => {
      it('should validate valid email IDs array', () => {
        const validData = {
          emailIds: [
            '550e8400-e29b-41d4-a716-446655440000',
            '550e8400-e29b-41d4-a716-446655440001'
          ]
        };

        const { error, value } = schemas.bulkEmailAction.validate(validData);

        expect(error).toBeUndefined();
        expect(value).toEqual(validData);
      });

      it('should reject empty array', () => {
        const invalidData = {
          emailIds: []
        };

        const { error } = schemas.bulkEmailAction.validate(invalidData);

        expect(error).toBeDefined();
        expect(error.details[0].message).toContain('1');
      });

      it('should reject array with more than 100 items', () => {
        const invalidData = {
          emailIds: Array(101).fill('550e8400-e29b-41d4-a716-446655440000')
        };

        const { error } = schemas.bulkEmailAction.validate(invalidData);

        expect(error).toBeDefined();
        expect(error.details[0].message).toContain('100');
      });

      it('should reject invalid UUID format', () => {
        const invalidData = {
          emailIds: ['not-a-uuid']
        };

        const { error } = schemas.bulkEmailAction.validate(invalidData);

        expect(error).toBeDefined();
        expect(error.details[0].message).toContain('uuid');
      });

      it('should reject missing emailIds', () => {
        const invalidData = {};

        const { error } = schemas.bulkEmailAction.validate(invalidData);

        expect(error).toBeDefined();
        expect(error.details[0].message).toContain('emailIds');
      });
    });

    describe('emailSearch schema', () => {
      it('should validate valid search data', () => {
        const validData = {
          query: 'important email',
          page: 2,
          limit: 50
        };

        const { error, value } = schemas.emailSearch.validate(validData);

        expect(error).toBeUndefined();
        expect(value).toEqual(validData);
      });

      it('should use default values for page and limit', () => {
        const dataWithDefaults = {
          query: 'search term'
        };

        const { error, value } = schemas.emailSearch.validate(dataWithDefaults);

        expect(error).toBeUndefined();
        expect(value.page).toBe(1);
        expect(value.limit).toBe(20);
      });

      it('should reject empty query', () => {
        const invalidData = {
          query: ''
        };

        const { error } = schemas.emailSearch.validate(invalidData);

        expect(error).toBeDefined();
        expect(error.details[0].message).toContain('empty');
      });

      it('should reject query longer than 200 characters', () => {
        const invalidData = {
          query: 'a'.repeat(201)
        };

        const { error } = schemas.emailSearch.validate(invalidData);

        expect(error).toBeDefined();
        expect(error.details[0].message).toContain('200');
      });

      it('should reject page less than 1', () => {
        const invalidData = {
          query: 'search',
          page: 0
        };

        const { error } = schemas.emailSearch.validate(invalidData);

        expect(error).toBeDefined();
        expect(error.details[0].message).toContain('1');
      });

      it('should reject limit greater than 100', () => {
        const invalidData = {
          query: 'search',
          limit: 101
        };

        const { error } = schemas.emailSearch.validate(invalidData);

        expect(error).toBeDefined();
        expect(error.details[0].message).toContain('100');
      });
    });

    describe('pagination schema', () => {
      it('should validate valid pagination data', () => {
        const validData = {
          page: 3,
          limit: 30
        };

        const { error, value } = schemas.pagination.validate(validData);

        expect(error).toBeUndefined();
        expect(value).toEqual(validData);
      });

      it('should use default values when not provided', () => {
        const { error, value } = schemas.pagination.validate({});

        expect(error).toBeUndefined();
        expect(value.page).toBe(1);
        expect(value.limit).toBe(20);
      });

      it('should reject non-integer page', () => {
        const invalidData = {
          page: 1.5
        };

        const { error } = schemas.pagination.validate(invalidData);

        expect(error).toBeDefined();
        expect(error.details[0].message).toContain('integer');
      });

      it('should reject negative limit', () => {
        const invalidData = {
          limit: -5
        };

        const { error } = schemas.pagination.validate(invalidData);

        expect(error).toBeDefined();
        expect(error.details[0].message).toContain('1');
      });
    });
  });

  describe('validate middleware', () => {
    it('should call next() when validation passes', () => {
      const schema = Joi.object({
        name: Joi.string().required()
      });
      const middleware = validate(schema);

      req.body = { name: 'Test' };

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 400 error when validation fails', () => {
      const schema = Joi.object({
        name: Joi.string().required()
      });
      const middleware = validate(schema);

      req.body = {};

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Validation failed',
        details: expect.any(String)
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should update req.body with validated values', () => {
      const schema = Joi.object({
        name: Joi.string().trim()
      });
      const middleware = validate(schema);

      req.body = { name: '  Test  ' };

      middleware(req, res, next);

      expect(req.body.name).toBe('Test');
      expect(next).toHaveBeenCalled();
    });
  });

  describe('validateQuery middleware', () => {
    it('should call next() when query validation passes', () => {
      const schema = Joi.object({
        page: Joi.number().default(1)
      });
      const middleware = validateQuery(schema);

      req.query = { page: '2' };

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 400 error when query validation fails', () => {
      const schema = Joi.object({
        page: Joi.number().required()
      });
      const middleware = validateQuery(schema);

      req.query = { page: 'invalid' };

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Query validation failed',
        details: expect.any(String)
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should update req.query with validated values', () => {
      const schema = Joi.object({
        page: Joi.number().default(1),
        limit: Joi.number().default(20)
      });
      const middleware = validateQuery(schema);

      req.query = {};

      middleware(req, res, next);

      expect(req.query.page).toBe(1);
      expect(req.query.limit).toBe(20);
      expect(next).toHaveBeenCalled();
    });

    it('should coerce string numbers to actual numbers', () => {
      const schema = Joi.object({
        page: Joi.number()
      });
      const middleware = validateQuery(schema);

      req.query = { page: '5' };

      middleware(req, res, next);

      expect(req.query.page).toBe(5);
      expect(typeof req.query.page).toBe('number');
      expect(next).toHaveBeenCalled();
    });
  });
});