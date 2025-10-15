const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const Student = require('../models/Student');
const Admin = require('../models/Admin');
const multer = require('multer');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');

// Debug: Log to confirm route file is loaded
console.log('auth.js routes loaded');

// Test route to verify /api/auth is working
router.get('/test', (req, res) => {
    res.json({ message: 'Auth routes are working' });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../public/uploads'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    },
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Images only (jpeg, jpg, png)!'));
        }
    }
});

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    debug: true, // Enable debug mode
    logger: true // Log SMTP interactions
});

// Function to generate a 6-digit OTP
const generateOtp = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

const getModelByRole = (role) => {
    switch (role) {
        case 'student': return Student;
        case 'admin': return Admin;
        default: throw new Error('Invalid role');
    }
};

router.post('/signup', async (req, res) => {
    const { name, email, password, confirmPassword } = req.body;

    try {
        // Validate inputs
        if (!name || !email || !password || !confirmPassword) {
            return res.status(400).json({ message: 'All fields are required.' });
        }
        if (password !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match.' });
        }
        if (password.length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
        }

        // Check for existing user in both models
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
            dob: null, 
            age: null, 
            profileImage: null,
            phoneNumber: null,
            bio: null
        });
        await user.save();
        res.status(201).json({ message: 'Student successfully registered.' });
    } catch (error) {
        console.error('Signup Error:', error);
        if (error.code === 11000 && error.keyPattern.email) {
            return res.status(400).json({ message: 'This email is already registered.' });
        }
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
});

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
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
});

router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    try {
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
            from: process.env.EMAIL_USER,
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

        await transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Email Send Error:', error);
                return res.status(500).json({ message: 'Error sending email.', error: error.message });
            }
            console.log('Email sent to', email, 'with OTP:', otp, 'Response:', info.response);
            res.status(200).json({ message: 'Password reset link and OTP sent to your email.', resetToken });
        });
    } catch (error) {
        console.error('Forgot Password Error:', error);
        res.status(500).json({ message: 'Error sending reset link.', error: error.message });
    }
});

router.post('/reset-password', async (req, res) => {
    const { token, email, password, confirmPassword, otp } = req.body;

    try {
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

module.exports = {
    router,
    getModelByRole
};