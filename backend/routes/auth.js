const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const multer = require('multer');
const path = require('path');

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
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb('Error: Images only (jpeg, jpg, png)!');
        }
    }
});

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const authenticateToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided.' });
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token.' });
        req.user = user;
        next();
    });
};

router.post('/signup', async (req, res) => {
    const { name, email, password, role } = req.body;
    console.log('Signup Request:', { name, email, role });

    try {
        if (!['student', 'teacher'].includes(role)) {
            console.log('Invalid role:', role);
            return res.status(400).json({ message: 'Only student or teacher roles are allowed.' });
        }

        const Model = role === 'student' ? Student : Teacher;
        const existingUser = await Model.findOne({ email });
        if (existingUser) {
            console.log('Email already exists:', email);
            return res.status(400).json({ message: 'This email is already registered. Please use a new email.' });
        }

        const user = new Model({ name, email, password, role, dob: null, age: null, profileImage: null });
        await user.save();
        console.log('User saved:', { email, role });
        res.status(201).json({ message: 'User successfully registered.' });
    } catch (error) {
        console.error('Signup error:', error);
        if (error.code === 11000 && error.keyPattern.email) {
            return res.status(400).json({ message: 'This email is already registered. Please use a new email.' });
        }
        res.status(500).json({ message: 'Server error. Please try again later.', error: error.message });
    }
});

router.post('/signin', async (req, res) => {
    const { email, password } = req.body;
    console.log('Signin Request:', { email });

    try {
        let user = await Student.findOne({ email });
        let role = 'student';
        if (!user) {
            user = await Teacher.findOne({ email });
            role = 'teacher';
        }
        if (!user) {
            console.log('User not found:', email);
            return res.status(400).json({ message: 'Incorrect email or password.' });
        }

        console.log('User found:', { email, role, userId: user._id });
        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            console.log('Password mismatch:', email);
            return res.status(400).json({ message: 'Incorrect email or password.' });
        }

        const token = jwt.sign({ id: user._id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const redirectUrl = role === 'student' ? '/html/template/student-dashboard.html' : '/html/template/instructor-dashboard.html';
        console.log('Signin Success:', { email, role, redirectUrl, token: token.substring(0, 10) + '...' });
        res.json({ token, role, redirectUrl });
    } catch (error) {
        console.error('Signin error:', error);
        res.status(500).json({ message: 'Server error. Please try again later.', error: error.message });
    }
});

router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    console.log('Forgot Password Request:', { email });

    try {
        let user = await Student.findOne({ email });
        let Model = Student;
        if (!user) {
            user = await Teacher.findOne({ email });
            Model = Teacher;
        }
        if (!user) {
            console.log('User not found:', email);
            return res.status(400).json({ message: 'This email is not registered.' });
        }

        const resetToken = crypto.randomBytes(20).toString('hex');
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 3600000;
        user.otp = otp;
        user.otpExpires = Date.now() + 600000;
        await user.save();
        console.log('Reset Token and OTP:', { email, resetToken, otp });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Password Reset OTP - Dreams LMS',
            html: `
                <h3>Password Reset Request</h3>
                <p>Your OTP for password reset is: <strong>${otp}</strong></p>
                <p>Use this OTP along with the reset link to set your new password.</p>
                <p>Link: <a href="http://localhost:5500/html/template/set-password.html?token=${resetToken}&email=${encodeURIComponent(email)}">Reset Password</a></p>
                <p>This OTP is valid for 10 minutes.</p>
            `,
        };

        await transporter.sendMail(mailOptions);
        console.log('OTP Email Sent:', email);
        res.json({ message: 'Password reset OTP sent to your email.', resetToken });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ message: 'Server error. Please try again later.', error: error.message });
    }
});

router.post('/reset-password', async (req, res) => {
    const { token, email, password, confirmPassword, otp } = req.body;
    console.log('Reset Password Request:', { token, email, otp });

    try {
        if (!password || !confirmPassword || !otp) {
            return res.status(400).json({ message: 'Fill in all required fields, including OTP.' });
        }
        if (password !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match.' });
        }

        let user = await Student.findOne({
            email,
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() },
            otp,
            otpExpires: { $gt: Date.now() },
        });
        let Model = Student;
        let role = 'student';
        if (!user) {
            user = await Teacher.findOne({
                email,
                resetPasswordToken: token,
                resetPasswordExpires: { $gt: Date.now() },
                otp,
                otpExpires: { $gt: Date.now() },
            });
            Model = Teacher;
            role = 'teacher';
        }

        if (!user) {
            console.log('Invalid or expired token/OTP:', { token, otp });
            return res.status(400).json({ message: 'The token or OTP is invalid or has expired.' });
        }

        user.password = password;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();
        console.log('Password reset successful:', email);

        const redirectUrl = role === 'student' ? '/html/template/student-dashboard.html' : '/html/template/instructor-dashboard.html';
        res.json({ message: 'Password successfully reset.', role, redirectUrl });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ message: 'Server error. Please try again later.', error: error.message });
    }
});

router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const Model = req.user.role === 'student' ? Student : Teacher;
        const user = await Model.findById(req.user.id).select('-password -resetPasswordToken -resetPasswordExpires -otp -otpExpires');
        if (!user) return res.status(404).json({ message: 'User not found.' });
        res.json({
            ...user.toObject(),
            createdAt: user.createdAt ? user.createdAt.toISOString() : null
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
});

router.put('/update-profile', authenticateToken, upload.single('profileImage'), async (req, res) => {
    try {
        const { name, email, phoneNumber, bio, dob, age, education, experience } = req.body;
        const Model = req.user.role === 'student' ? Student : Teacher;
        const user = await Model.findById(req.user.id);

        if (!user) return res.status(404).json({ message: 'User not found.' });

        if (name) user.name = name;
        if (email) user.email = email;
        if (phoneNumber) user.phoneNumber = phoneNumber;
        if (bio) user.bio = bio;
        if (dob) user.dob = dob === 'null' ? null : new Date(dob);
        if (age) user.age = age === 'null' ? null : Number(age);
        if (education) user.education = JSON.parse(education);
        if (experience && req.user.role === 'teacher') user.experience = JSON.parse(experience);
        if (req.file) {
            user.profileImage = `/uploads/${req.file.filename}`;
        } else if (req.body.profileImage === 'null') {
            user.profileImage = null;
        }

        await user.save();
        res.json({ 
            message: 'Profile updated successfully.', 
            user: {
                ...user.toObject(),
                createdAt: user.createdAt ? user.createdAt.toISOString() : null
            }
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ message: 'Server error.', error: error.message });
    }
});

router.get('/logout', authenticateToken, (req, res) => {
    res.json({ message: 'Logout successful.' });
});

module.exports = router;