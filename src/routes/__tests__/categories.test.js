const request = require('supertest');
const express = require('express');
const categoriesRouter = require('../categories');
const db = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');

jest.mock('../../config/database');
jest.mock('../../middleware/auth');

describe('Categories Routes', () => {
  let app;
  let mockUser;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/categories', categoriesRouter);

    mockUser = { id: 123, email: 'test@example.com' };

    // Mock authenticateToken to always pass
    authenticateToken.mockImplementation((req, res, next) => {
      req.user = mockUser;
      next();
    });

    jest.clearAllMocks();
  });

  describe('GET /categories', () => {
    it('should return all categories with email count', async () => {
      const mockCategories = [
        { id: 1, name: 'Work', description: 'Work emails', email_count: '5' },
        { id: 2, name: 'Personal', description: 'Personal emails', email_count: '3' }
      ];

      db.query.mockResolvedValue({ rows: mockCategories });

      const response = await request(app)
        .get('/categories')
        .expect(200);

      expect(response.body).toEqual(mockCategories);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT c.*, COUNT(e.id) as email_count'),
        [mockUser.id]
      );
    });

    it('should handle database errors', async () => {
      db.query.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/categories')
        .expect(500);

      expect(response.body).toEqual({ error: 'Failed to fetch categories' });
    });

    it('should return empty array when no categories exist', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .get('/categories')
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('GET /categories/:id', () => {
    it('should return single category by id', async () => {
      const mockCategory = {
        id: 1,
        name: 'Work',
        description: 'Work emails',
        user_id: 123
      };

      db.query.mockResolvedValue({ rows: [mockCategory] });

      const response = await request(app)
        .get('/categories/1')
        .expect(200);

      expect(response.body).toEqual(mockCategory);
      expect(db.query).toHaveBeenCalledWith(
        'SELECT * FROM categories WHERE id = $1 AND user_id = $2',
        ['1', mockUser.id]
      );
    });

    it('should return 404 when category not found', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .get('/categories/999')
        .expect(404);

      expect(response.body).toEqual({ error: 'Category not found' });
    });

    it('should handle database errors', async () => {
      db.query.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/categories/1')
        .expect(500);

      expect(response.body).toEqual({ error: 'Failed to fetch category' });
    });
  });

  describe('POST /categories', () => {
    it('should create new category successfully', async () => {
      const newCategory = {
        name: 'Shopping',
        description: 'Shopping and promotions'
      };

      const createdCategory = {
        id: 3,
        ...newCategory,
        user_id: mockUser.id,
        created_at: new Date()
      };

      db.query
        .mockResolvedValueOnce({ rows: [] }) // Check for existing category
        .mockResolvedValueOnce({ rows: [createdCategory] }); // Insert new category

      const response = await request(app)
        .post('/categories')
        .send(newCategory)
        .expect(201);

      expect(response.body).toEqual(createdCategory);
      expect(db.query).toHaveBeenCalledWith(
        'INSERT INTO categories (user_id, name, description) VALUES ($1, $2, $3) RETURNING *',
        [mockUser.id, newCategory.name, newCategory.description]
      );
    });

    it('should trim whitespace from input', async () => {
      const categoryWithSpaces = {
        name: '  Shopping  ',
        description: '  Shopping and promotions  '
      };

      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 3, name: 'Shopping', description: 'Shopping and promotions' }] });

      const response = await request(app)
        .post('/categories')
        .send(categoryWithSpaces)
        .expect(201);

      expect(db.query).toHaveBeenCalledWith(
        'INSERT INTO categories (user_id, name, description) VALUES ($1, $2, $3) RETURNING *',
        [mockUser.id, 'Shopping', 'Shopping and promotions']
      );
    });

    it('should reject duplicate category names', async () => {
      const newCategory = {
        name: 'Work',
        description: 'Another work category'
      };

      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // Existing category found

      const response = await request(app)
        .post('/categories')
        .send(newCategory)
        .expect(400);

      expect(response.body).toEqual({ error: 'Category with this name already exists' });
    });

    it('should check for duplicates case-insensitively', async () => {
      const newCategory = {
        name: 'WORK',
        description: 'Another work category'
      };

      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // Existing category found

      const response = await request(app)
        .post('/categories')
        .send(newCategory)
        .expect(400);

      expect(db.query).toHaveBeenCalledWith(
        'SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2)',
        [mockUser.id, 'WORK']
      );
    });

    it('should validate required fields', async () => {
      const invalidCategory = {
        name: 'Shopping'
        // Missing description
      };

      const response = await request(app)
        .post('/categories')
        .send(invalidCategory)
        .expect(400);

      expect(response.body.error).toContain('description');
    });

    it('should validate field lengths', async () => {
      const invalidCategory = {
        name: 'a'.repeat(101),
        description: 'Valid description'
      };

      const response = await request(app)
        .post('/categories')
        .send(invalidCategory)
        .expect(400);

      expect(response.body.error).toContain('100');
    });

    it('should handle database errors', async () => {
      const newCategory = {
        name: 'Shopping',
        description: 'Shopping and promotions'
      };

      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .post('/categories')
        .send(newCategory)
        .expect(500);

      expect(response.body).toEqual({ error: 'Failed to create category' });
    });
  });

  describe('PUT /categories/:id', () => {
    it('should update category successfully', async () => {
      const updateData = {
        name: 'Work Updated',
        description: 'Updated description'
      };

      const updatedCategory = {
        id: 1,
        ...updateData,
        user_id: mockUser.id,
        updated_at: new Date()
      };

      db.query
        .mockResolvedValueOnce({ rows: [] }) // Check for duplicate name
        .mockResolvedValueOnce({ rows: [updatedCategory] }); // Update category

      const response = await request(app)
        .put('/categories/1')
        .send(updateData)
        .expect(200);

      expect(response.body).toEqual(updatedCategory);
      expect(db.query).toHaveBeenCalledWith(
        'UPDATE categories SET name = $1, description = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4 RETURNING *',
        [updateData.name, updateData.description, '1', mockUser.id]
      );
    });

    it('should prevent duplicate names when updating', async () => {
      const updateData = {
        name: 'Personal',
        description: 'Updated description'
      };

      db.query.mockResolvedValueOnce({ rows: [{ id: 2 }] }); // Another category with same name exists

      const response = await request(app)
        .put('/categories/1')
        .send(updateData)
        .expect(400);

      expect(response.body).toEqual({ error: 'Category with this name already exists' });
    });

    it('should allow keeping same name when updating', async () => {
      const updateData = {
        name: 'Work',
        description: 'Updated description only'
      };

      db.query
        .mockResolvedValueOnce({ rows: [] }) // No other category with same name
        .mockResolvedValueOnce({ rows: [{ id: 1, ...updateData }] });

      const response = await request(app)
        .put('/categories/1')
        .send(updateData)
        .expect(200);

      expect(db.query).toHaveBeenCalledWith(
        'SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2) AND id != $3',
        [mockUser.id, 'Work', '1']
      );
    });

    it('should return 404 when category not found', async () => {
      const updateData = {
        name: 'Updated',
        description: 'Updated description'
      };

      db.query
        .mockResolvedValueOnce({ rows: [] }) // No duplicate
        .mockResolvedValueOnce({ rows: [] }); // Category not found

      const response = await request(app)
        .put('/categories/999')
        .send(updateData)
        .expect(404);

      expect(response.body).toEqual({ error: 'Category not found' });
    });

    it('should validate input data', async () => {
      const invalidUpdate = {
        name: '',
        description: 'Valid description'
      };

      const response = await request(app)
        .put('/categories/1')
        .send(invalidUpdate)
        .expect(400);

      expect(response.body.error).toContain('empty');
    });
  });

  describe('DELETE /categories/:id', () => {
    it('should delete category without emails', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // No emails in category
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Work' }] }); // Delete category

      const response = await request(app)
        .delete('/categories/1')
        .expect(200);

      expect(response.body).toEqual({ message: 'Category deleted successfully' });
      expect(db.query).toHaveBeenCalledWith(
        'DELETE FROM categories WHERE id = $1 AND user_id = $2 RETURNING *',
        ['1', mockUser.id]
      );
    });

    it('should prevent deletion of category with emails', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ count: '5' }] }); // Has emails

      const response = await request(app)
        .delete('/categories/1')
        .expect(400);

      expect(response.body).toEqual({
        error: 'Cannot delete category with emails. Please move or delete emails first.'
      });
    });

    it('should return 404 when category not found', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] }); // Category not found

      const response = await request(app)
        .delete('/categories/999')
        .expect(404);

      expect(response.body).toEqual({ error: 'Category not found' });
    });

    it('should handle database errors', async () => {
      db.query.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .delete('/categories/1')
        .expect(500);

      expect(response.body).toEqual({ error: 'Failed to delete category' });
    });
  });

  describe('Authentication', () => {
    it('should require authentication for all routes', async () => {
      // Mock authenticateToken to fail
      authenticateToken.mockImplementation((req, res, next) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      await request(app).get('/categories').expect(401);
      await request(app).get('/categories/1').expect(401);
      await request(app).post('/categories').send({ name: 'Test', description: 'Test' }).expect(401);
      await request(app).put('/categories/1').send({ name: 'Test', description: 'Test' }).expect(401);
      await request(app).delete('/categories/1').expect(401);
    });
  });
});