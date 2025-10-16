const express = require('express');
const router = express.Router();
const { getModelByRole } = require('./auth');
const { authenticateToken, isAdmin } = require('../middleware/auth');

router.use(authenticateToken, isAdmin);

// Get all users (Admin + Students)
router.get('/users', async (req, res) => {
    try {
        const admins = await getModelByRole('admin').find().select('-password -resetOtp -otpExpires');
        const students = await getModelByRole('student').find().select('-password -resetOtp -otpExpires');
        const users = [...admins, ...students]; // Combine both arrays
        res.json({ users });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Server error while fetching users.', error: error.message });
    }
});

// Get user by role and ID
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
        // Ensure full URL for profileImage if it exists
        if (user.profileImage) {
            user.profileImage = `http://localhost:5000${user.profileImage}`;
        }
        res.json(user);
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ message: 'Server error while fetching user.', error: error.message });
    }
});

// Update user profile by ID
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
        // Ensure full URL for profileImage in response
        if (user.profileImage) {
            user.profileImage = `http://localhost:5000${user.profileImage}`;
        }
        res.json({ message: `${role} profile updated by admin.`, user });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ message: 'Server error while updating user.', error: error.message });
    }
});

// Delete user by ID
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

module.exports = router;