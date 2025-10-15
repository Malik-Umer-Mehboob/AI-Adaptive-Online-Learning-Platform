const express = require('express');
const router = express.Router();
const { getModelByRole } = require('./auth');
const { authenticateToken, isAdmin } = require('../middleware/auth');

router.use(authenticateToken, isAdmin);

// Get all students
router.get('/users', async (req, res) => {
    try {
        const students = await getModelByRole('student').find().select('-password');
        res.json({ students });
    } catch (error) {
        res.status(500).json({ message: 'Server error.', error });
    }
});

// Update student profile by ID
router.put('/update-user/:role/:id', async (req, res) => {
    try {
        const { role, id } = req.params;
        if (role !== 'student') {
            return res.status(400).json({ message: 'Invalid role. Only student role is allowed.' });
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
        res.json({ message: 'Student profile updated by admin.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error.', error });
    }
});

module.exports = router;