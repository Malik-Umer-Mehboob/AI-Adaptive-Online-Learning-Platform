const express = require('express');
const router = express.Router();
const { getModelByRole } = require('./auth'); // Assume yeh file mein hai, warna adjust
const { auth, checkRole, isAdmin } = require('../middleware/auth'); // Updated import with isAdmin
const Category = require('../models/Category');
const Course = require('../models/Course');
const Assignment = require('../models/Assignment'); // Keep for dashboard counts

router.use(auth, checkRole(['admin'])); // Ensure only admins can access these routes

// Existing users routes (unchanged)
router.get('/users', async (req, res) => {
    try {
        const admins = await getModelByRole('admin').find().select('-password -resetOtp -otpExpires');
        const students = await getModelByRole('student').find().select('-password -resetOtp -otpExpires');
        const users = [...admins, ...students];
        res.json({ users });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Server error while fetching users.', error: error.message });
    }
});

router.get('/users/:role/:id', async (req, res) => {
    try {
        const { role, id } = req.params;
        const validRoles = ['admin', 'student'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ message: 'Invalid role. Only admin or student role is allowed.' });
        }
        const Model = getModelByRole(role);
        const user = await Model.findById(id).select('-password -resetOtp -otpExpires');
        if (!user) return res.status(404).json({ message: 'User not found.' });
        if (user.profileImage) {
            user.profileImage = `http://localhost:5000${user.profileImage}`;
        }
        res.json(user);
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ message: 'Server error while fetching user.', error: error.message });
    }
});

router.put('/update-user/:role/:id', async (req, res) => {
    try {
        const { role, id } = req.params;
        const validRoles = ['admin', 'student'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ message: 'Invalid role. Only admin or student role is allowed.' });
        }
        const Model = getModelByRole(role);
        const user = await Model.findById(id);
        if (!user) return res.status(404).json({ message: 'User not found.' });

        const { name, email, phoneNumber, bio, dob, age } = req.body;
        if (name) user.name = name;
        if (email) user.email = email;
        if (phoneNumber) user.phoneNumber = phoneNumber;
        if (bio) user.bio = bio;
        if (dob) user.dob = dob === 'null' ? null : new Date(dob);
        if (age) user.age = age === 'null' ? null : Number(age);

        await user.save();
        if (user.profileImage) {
            user.profileImage = `http://localhost:5000${user.profileImage}`;
        }
        res.json({ message: `${role} profile updated by admin.`, user });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ message: 'Server error while updating user.', error: error.message });
    }
});

router.delete('/users/:role/:id', async (req, res) => {
    try {
        const { role, id } = req.params;
        const validRoles = ['admin', 'student'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ message: 'Invalid role. Only admin or student role is allowed.' });
        }
        const Model = getModelByRole(role);
        const user = await Model.findByIdAndDelete(id);
        if (!user) return res.status(404).json({ message: 'User not found.' });
        res.json({ message: `${role} deleted successfully.` });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ message: 'Server error while deleting user.', error: error.message });
    }
});

// Existing categories routes (unchanged)
router.get('/categories', async (req, res) => {
    try {
        const categories = await Category.find();
        res.json(categories);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/categories', async (req, res) => {
    const { name, description } = req.body;
    try {
        const category = new Category({ name, description });
        await category.save();
        res.status(201).json(category);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

router.put('/categories/:id', async (req, res) => {
    const { name, description } = req.body;
    try {
        const category = await Category.findByIdAndUpdate(req.params.id, { name, description }, { new: true });
        if (!category) return res.status(404).json({ message: 'Category not found' });
        res.json(category);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

router.delete('/categories/:id', async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) return res.status(404).json({ message: 'Category not found' });
        await category.deleteOne();
        res.json({ message: 'Category and related courses deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Existing Dashboard counts (Keep totalAssignments)
router.get('/dashboard/counts', async (req, res) => {
    try {
        const totalCategories = await Category.countDocuments();
        const totalCourses = await Course.countDocuments();
        const totalAssignments = await Assignment.countDocuments(); // Keep for dashboard
        res.json({ totalCategories, totalCourses, totalAssignments });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;