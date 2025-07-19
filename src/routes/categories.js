const express = require('express');
const Joi = require('joi');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Validation schema
const categorySchema = Joi.object({
  name: Joi.string().required().max(100).trim(),
  description: Joi.string().required().max(500).trim(),
});

// Get all categories for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, COUNT(e.id) as email_count 
       FROM categories c
       LEFT JOIN emails e ON c.id = e.category_id
       WHERE c.user_id = $1 
       GROUP BY c.id
       ORDER BY c.created_at DESC`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Get single category
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query('SELECT * FROM categories WHERE id = $1 AND user_id = $2', [
      id,
      req.user.id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching category:', error);
    res.status(500).json({ error: 'Failed to fetch category' });
  }
});

// Create new category
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { error, value } = categorySchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { name, description } = value;

    // Check if category with same name already exists
    const existingCategory = await db.query(
      'SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2)',
      [req.user.id, name]
    );

    if (existingCategory.rows.length > 0) {
      return res.status(400).json({ error: 'Category with this name already exists' });
    }

    const result = await db.query(
      'INSERT INTO categories (user_id, name, description) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, name, description]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Update category
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { error, value } = categorySchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { name, description } = value;
    const { id } = req.params;

    // Check if another category with same name exists
    const existingCategory = await db.query(
      'SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2) AND id != $3',
      [req.user.id, name, id]
    );

    if (existingCategory.rows.length > 0) {
      return res.status(400).json({ error: 'Category with this name already exists' });
    }

    const result = await db.query(
      'UPDATE categories SET name = $1, description = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4 RETURNING *',
      [name, description, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Delete category
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if category has emails
    const emailCount = await db.query('SELECT COUNT(*) FROM emails WHERE category_id = $1', [id]);

    if (parseInt(emailCount.rows[0].count) > 0) {
      return res.status(400).json({
        error: 'Cannot delete category with emails. Please move or delete emails first.',
      });
    }

    const result = await db.query(
      'DELETE FROM categories WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

module.exports = router;
