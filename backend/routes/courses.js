const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth');
const Course = require('../models/Course');
const Category = require('../models/Category');
const multer = require('multer');
const path = require('path');

// Multer setup for video uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../public/Uploads/videos');
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const filename = `${Date.now()}${path.extname(file.originalname)}`;
        cb(null, filename);
    },
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit for videos
    fileFilter: (req, file, cb) => {
        const filetypes = /mp4|mov|avi/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only .mp4, .mov, and .avi files are allowed!'));
        }
    }
});

// Get all courses
router.get('/', async (req, res) => {
    try {
        const courses = await Course.find().populate('category');
        res.json(courses);
    } catch (error) {
        console.error('Error fetching courses:', error);
        res.status(500).json({ message: 'Server error while fetching courses.', error: error.message });
    }
});

// Get course by ID
router.get('/:id', async (req, res) => {
    try {
        const course = await Course.findById(req.params.id).populate('category');
        if (!course) return res.status(404).json({ message: 'Course not found' });
        res.json(course);
    } catch (error) {
        console.error('Error fetching course:', error);
        res.status(500).json({ message: 'Server error while fetching course.', error: error.message });
    }
});

// Add new course (Admin only)
router.post('/', auth, checkRole(['admin']), upload.array('videoFiles'), async (req, res) => {
    try {
        const { name, description, category, price } = req.body;
        if (!name || !description || !category) {
            return res.status(400).json({ message: 'Name, description, and category are required.' });
        }

        const categoryExists = await Category.findById(category);
        if (!categoryExists) return res.status(404).json({ message: 'Category not found' });

        const videoUrls = req.files.map(file => `/Uploads/videos/${file.filename}`);
        const course = new Course({
            name,
            description,
            category,
            price: price || 0,
            videos: videoUrls,
        });

        await course.save();
        res.status(201).json({ message: 'Course created successfully', course });
    } catch (error) {
        console.error('Error creating course:', error);
        res.status(500).json({ message: 'Server error while creating course.', error: error.message });
    }
});

// Update course (Admin only)
router.put('/:id', auth, checkRole(['admin']), upload.array('videoFiles'), async (req, res) => {
    try {
        const { name, description, category, price } = req.body;
        const course = await Course.findById(req.params.id);
        if (!course) return res.status(404).json({ message: 'Course not found' });

        if (category) {
            const categoryExists = await Category.findById(category);
            if (!categoryExists) return res.status(404).json({ message: 'Category not found' });
            course.category = category;
        }

        if (name) course.name = name;
        if (description) course.description = description;
        if (price) course.price = Number(price);
        if (req.files && req.files.length > 0) {
            course.videos = req.files.map(file => `/Uploads/videos/${file.filename}`);
        }

        await course.save();
        res.json({ message: 'Course updated successfully', course });
    } catch (error) {
        console.error('Error updating course:', error);
        res.status(500).json({ message: 'Server error while updating course.', error: error.message });
    }
});

// Delete course (Admin only)
router.delete('/:id', auth, checkRole(['admin']), async (req, res) => {
    try {
        const course = await Course.findByIdAndDelete(req.params.id);
        if (!course) return res.status(404).json({ message: 'Course not found' });
        res.json({ message: 'Course deleted successfully' });
    } catch (error) {
        console.error('Error deleting course:', error);
        res.status(500).json({ message: 'Server error while deleting course.', error: error.message });
    }
});

module.exports = router;