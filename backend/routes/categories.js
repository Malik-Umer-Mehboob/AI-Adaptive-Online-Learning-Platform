const express = require('express');
const router = express.Router();
const Category = require('../models/Category');
const { auth, checkRole } = require('../middleware/auth'); // Updated import

// GET all categories (accessible to all authenticated users)
router.get('/', auth, async (req, res) => {
  try {
    const categories = await Category.find();
    res.json(categories);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ message: 'Server error while fetching categories.', error: err.message });
  }
});

// POST create a new category (admin only)
router.post('/', auth, checkRole(['admin']), async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ message: 'Category name is required.' });
    
    const existingCategory = await Category.findOne({ name });
    if (existingCategory) return res.status(400).json({ message: 'Category with this name already exists.' });

    const category = new Category({ name, description });
    await category.save();
    res.status(201).json({ message: 'Category created successfully', category });
  } catch (err) {
    console.error('Error creating category:', err);
    res.status(400).json({ message: 'Error creating category.', error: err.message });
  }
});

// PUT update a category (admin only)
router.put('/:id', auth, checkRole(['admin']), async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ message: 'Category name is required.' });

    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { name, description },
      { new: true }
    );
    if (!category) return res.status(404).json({ message: 'Category not found' });
    res.json({ message: 'Category updated successfully', category });
  } catch (err) {
    console.error('Error updating category:', err);
    res.status(400).json({ message: 'Error updating category.', error: err.message });
  }
});

// DELETE a category (admin only)
router.delete('/:id', auth, checkRole(['admin']), async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found' });
    await category.deleteOne();
    res.json({ message: 'Category deleted successfully' });
  } catch (err) {
    console.error('Error deleting category:', err);
    res.status(500).json({ message: 'Server error while deleting category.', error: err.message });
  }
});

module.exports = router;