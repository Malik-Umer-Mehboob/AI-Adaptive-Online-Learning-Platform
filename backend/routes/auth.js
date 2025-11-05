const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const Student = require('../models/Student');
const Admin = require('../models/Admin');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { auth } = require('../middleware/auth'); // Ensure correct import

// Debug: Log to confirm route file is loaded
console.log('auth.js loaded with router export');

// Test route to verify /api/auth is working
router.get('/test', (req, res) => {
    console.log('Test route hit');
    res.json({ message: 'Auth routes are working' });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../public/uploads');
        console.log('Multer destination:', uploadPath);
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const filename = `${Date.now()}${path.extname(file.originalname)}`;
        console.log('Multer filename:', filename);
        cb(null, filename);
    },
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            console.error('Multer file filter error: Invalid file type', file.originalname);
            cb(new Error('Only .jpg, .jpeg, and .png files are allowed!'));
        }
    }
});

const transporter = nodemailer.createTransport({  // Fixed: createTransport, not createTransporter
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    debug: true,
    logger: true
});

// Function to generate a 6-digit OTP using crypto
const generateOtp = () => {
    return crypto.randomInt(100000, 1000000).toString();
};

const getModelByRole = (role) => {
    console.log('getModelByRole called with role:', role); // Debug
    switch (role) {
        case 'student': return Student;
        case 'admin': return Admin;
        default: throw new Error('Invalid role');
    }
};

// Signup (Student only for now)
router.post('/signup', async (req, res) => {
    const { name, email, password, confirmPassword } = req.body;

    try {
        console.log('Signup request:', { name, email }); // Debug
        if (!name || !email || !password || !confirmPassword) {
            return res.status(400).json({ message: 'All fields are required.' });
        }
        if (password !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match.' });
        }
        if (password.length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
        }

        const existingStudent = await Student.findOne({ email });
        const existingAdmin = await Admin.findOne({ email });
        if (existingStudent || existingAdmin) {
            return res.status(400).json({ message: 'This email is already registered.' });
        }

        const user = new Student({ 
            name, 
            email, 
            password, 
            role: 'student', 
            age: null, 
            profileImage: null,
            phoneNumber: null,
            bio: null
        });
        await user.save();
        res.status(201).json({ message: 'Student successfully registered.', user: { name, email, role: 'student' } });
    } catch (error) {
        console.error('Signup Error:', error);
        if (error.code === 11000 && error.keyPattern.email) {
            return res.status(400).json({ message: 'This email is already registered.' });
        }
        res.status(500).json({ message: 'Server error during signup.', error: error.message });
    }
});

// Signin
router.post('/signin', async (req, res) => {
    const { email, password } = req.body;

    try {
        console.log('Signin request received:', { email });
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required.' });
        }

        let user = await Student.findOne({ email }) || await Admin.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid email or password.' });
        }

        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid email or password.' });
        }

        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        const redirectUrl = user.role === 'admin'
            ? 'http://127.0.0.1:5500/html/template/admin-dashboard.html'
            : 'http://127.0.0.1:5500/html/template/student-dashboard.html';

        res.status(200).json({
            message: 'Signin successful.',
            token,
            role: user.role,
            redirectUrl
        });
    } catch (error) {
        console.error('Signin Error:', error);
        res.status(500).json({ message: 'Server error during signin.', error: error.message });
    }
});

// Forgot Password
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    try {
        console.log('Forgot password request:', { email }); // Debug
        if (!email) {
            return res.status(400).json({ message: 'Email is required.' });
        }

        let user = await Student.findOne({ email }) || await Admin.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'No account found with this email.' });
        }

        const resetToken = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );

        const otp = generateOtp();
        console.log(`Generated OTP for ${email}: ${otp}`);
        user.resetOtp = otp;
        user.otpExpires = Date.now() + 15 * 60 * 1000;
        await user.save();
        console.log(`Saved OTP to user: ${user.resetOtp}, Expires: ${user.otpExpires}`);

        const resetUrl = `http://127.0.0.1:5500/html/template/set-password.html?token=${resetToken}&email=${encodeURIComponent(email)}`;
        const mailOptions = {
            from: '"AI Adaptive Online Learning Platform" <' + process.env.EMAIL_USER + '>',
            to: email,
            subject: 'Password Reset Request',
            html: `
                <h2>Password Reset Request</h2>
                <p>You requested a password reset. Use the following OTP to reset your password:</p>
                <h3 style="color: #007bff;">${otp}</h3>
                <p>Click the link below to proceed:</p>
                <a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a>
                <p>This OTP and link will expire in 15 minutes.</p>
            `
        };

        // Fixed: Use promise version of sendMail (no callback)
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent to', email, 'with OTP:', otp, 'Response:', info.response);
        res.status(200).json({ message: 'Password reset link and OTP sent to your email.', resetToken });
    } catch (error) {
        console.error('Forgot Password Error:', error);
        res.status(500).json({ message: 'Error sending reset link.', error: error.message });
    }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
    const { token, email, password, confirmPassword, otp } = req.body;

    try {
        console.log('Reset password request:', { email, otp }); // Debug
        if (!token || !email || !password || !confirmPassword || !otp) {
            return res.status(400).json({ message: 'All fields are required.' });
        }
        if (password !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match.' });
        }
        if (password.length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            return res.status(400).json({ message: 'Invalid or expired reset token.' });
        }

        let user = await Student.findOne({ email }) || await Admin.findOne({ email });
        if (!user || user._id.toString() !== decoded.id) {
            return res.status(400).json({ message: 'Invalid email or token.' });
        }

        if (!user.resetOtp || user.resetOtp !== otp || user.otpExpires < Date.now()) {
            return res.status(400).json({ message: 'Invalid or expired OTP.' });
        }

        user.password = password;
        user.resetOtp = undefined;
        user.otpExpires = undefined;
        await user.save();

        const redirectUrl = user.role === 'admin'
            ? 'http://127.0.0.1:5500/html/template/admin-dashboard.html'
            : 'http://127.0.0.1:5500/html/template/student-dashboard.html';

        res.status(200).json({
            message: 'Password reset successful.',
            role: user.role,
            redirectUrl
        });
    } catch (error) {
        console.error('Reset Password Error:', error);
        res.status(500).json({ message: 'Error resetting password.', error: error.message });
    }
});

// Get Profile
router.get('/profile', auth, async (req, res) => {
    try {
        console.log('Profile request for user:', req.user); // Debug
        const userId = req.user.id;
        const Model = getModelByRole(req.user.role);
        const user = await Model.findById(userId).select('-password -resetOtp -otpExpires');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (user.profileImage) {
            user.profileImage = `http://localhost:5000${user.profileImage}`;
        }
        res.status(200).json(user);
    } catch (error) {
        console.error('Profile Fetch Error:', error);
        res.status(500).json({ message: 'Error fetching profile', error: error.message });
    }
});

// Update Profile (Email hardcoded - not updatable)
router.put('/update-profile', auth, upload.single('profileImage'), async (req, res) => {
    try {
        console.log('Update profile request:', req.user); // Debug
        if (!req.user) {
            console.error('req.user is undefined');
            return res.status(401).json({ message: 'Unauthorized: No user data found.' });
        }

        const userId = req.user.id;
        const Model = getModelByRole(req.user.role);
        const updateData = {
            name: req.body.name,
            // Email removed - hardcoded, not updatable
            phoneNumber: req.body.phoneNumber,
            age: req.body.age,
            bio: req.body.bio,
            profileImage: req.file ? `/uploads/${req.file.filename}` : undefined,
        };

        Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

        console.log('Updating profile with data:', updateData);
        const user = await Model.findByIdAndUpdate(userId, updateData, { new: true }).select('-password -resetOtp -otpExpires');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (user.profileImage) {
            user.profileImage = `http://localhost:5000${user.profileImage}`;
        }
        console.log('Profile updated:', user);
        res.status(200).json({ message: 'Profile updated successfully', user });
    } catch (error) {
        console.error('Profile Update Error:', error);
        res.status(500).json({ message: 'Error updating profile', error: error.message });
    }
});

// Sample new route (to demonstrate correct syntax)
router.get('/user-info', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const Model = getModelByRole(req.user.role);
        const user = await Model.findById(userId).select('name email role');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json({ message: 'User info retrieved', user });
    } catch (error) {
        console.error('User Info Error:', error);
        res.status(500).json({ message: 'Error fetching user info', error: error.message });
    }
});

module.exports = {
    router,
    getModelByRole
};