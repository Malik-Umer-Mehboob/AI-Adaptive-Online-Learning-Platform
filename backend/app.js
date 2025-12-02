// app.js - FIXED: Added submissionsRoutes import + uncomment mount for /api/submissions/my
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const cors = require('cors');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');
const createError = require('http-errors');
const fs = require('fs');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

// MongoDB Connection
const connectDB = require('./config/db');
connectDB().catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
});

// Models (for any app-level use, but mostly in controllers)
const Assignment = require('./models/Assignment');
const Submission = require('./models/Submission');

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const dashboardRoutes = require('./routes/dashboard');  // Ensure this has /student/enroll POST
const courseRoutes = require('./routes/courses');
const categoryRoutes = require('./routes/categories');
const topicRoutes = require('./routes/topics');

// FIXED: Check if assignments.js (with 's') exists before requiring
const assignmentsPath = path.join(__dirname, 'routes', 'assignments.js');
if (!fs.existsSync(assignmentsPath)) {
    console.error('ERROR: routes/assignments.js file not found! Check folder.');
    process.exit(1); // Exit early to avoid crash
}
const assignmentsRoutes = require('./routes/assignments'); // FIXED: With 's' - matches your file name

const studentRoutes = require('./routes/student');

// FIXED: Add import for submissionsRoutes (uncomment if file exists)
const submissionsPath = path.join(__dirname, 'routes', 'submissions.js');
if (!fs.existsSync(submissionsPath)) {
    console.error('ERROR: routes/submissions.js file not found! Create it with the code from previous response.');
    process.exit(1); // Exit early
}
const submissionsRoutes = require('./routes/submissions'); // FIXED: Import added

const app = express();

// CORS
app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:5000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate Limiting
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again after 15 minutes.'
});
app.use(generalLimiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: 'Too many authentication requests, please try again after 15 minutes.'
});
app.use('/api/auth', authLimiter);

// Middleware
app.use(logger('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(cookieParser());

// Static file serving
app.use(express.static(path.join(__dirname, 'public')));

// FIXED: Explicit /uploads for PDFs/submissions (covers /uploads/assignments too)
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Ensure folders exist
const submissionsDir = path.join(__dirname, 'public', 'uploads', 'submissions');
if (!fs.existsSync(submissionsDir)) {
    fs.mkdirSync(submissionsDir, { recursive: true });
}

// Ensure assignments folder exists for generated PDFs
const assignmentsDir = path.join(__dirname, 'public', 'uploads', 'assignments');
if (!fs.existsSync(assignmentsDir)) {
    fs.mkdirSync(assignmentsDir, { recursive: true });
}

// Serve favicon
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'assets', 'img', 'favicon.png'));
});

// Health Check (unchanged)
app.get('/api/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(), 
        uptime: process.uptime(),
        date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    });
});

// Test Route
app.get('/api/test', (req, res) => {
    res.json({ message: 'Server is running' });
});

// Debug Route
app.get('/api/debug/routes', (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ message: 'Debug route disabled in production' });
    }
    const routes = [];
    app._router.stack.forEach((middleware) => {
        if (middleware.route) {
            routes.push({
                path: middleware.route.path,
                methods: Object.keys(middleware.route.methods)
            });
        } else if (middleware.name === 'router' && middleware.handle.stack) {
            middleware.handle.stack.forEach((handler) => {
                if (handler.route) {
                    routes.push({
                        path: middleware.regexp.source.replace('^\\', '').replace('(?=\\/|$)', '') + handler.route.path,
                        methods: Object.keys(handler.route.methods)
                    });
                }
            });
        }
    });
    res.json({ routes });
});

// Mount Routes
app.use('/api/auth', authRoutes.router);
app.use('/api/admin', adminRoutes);
app.use('/api/dashboard', dashboardRoutes);  // /api/dashboard/student/enroll here
app.use('/api/courses', courseRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/topics', topicRoutes);
app.use('/api/assignments', assignmentsRoutes);  // /api/assignments/:courseId GET
app.use('/api/student', studentRoutes);
app.use('/api/submissions', submissionsRoutes); // FIXED: Uncomment + import for /my route

// Cache Control
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

// 404 Handler (unchanged)
app.use((req, res, next) => {
    const userInfo = req.user ? `User: ${req.user.id} (${req.user.role})` : 'No user';
    console.log(`[404] URL: ${req.originalUrl}, Method: ${req.method}, ${userInfo}, Headers: ${JSON.stringify(req.headers)}`);
    next(createError(404, `Resource not found: ${req.originalUrl}`));
});

// Error Handler (unchanged)
app.use((err, req, res, next) => {
    if (err.message.includes('Only PDF files') || err.code === 'LIMIT_FILE_SIZE') {
        if (req.file && req.file.path) {
            fs.unlink(req.file.path, (unlinkErr) => {
                if (unlinkErr) console.error('File cleanup failed:', unlinkErr);
                else console.log('File cleaned up:', req.file.path);
            });
        }
    }

    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    const userInfo = req.user ? `User: ${req.user.id} (${req.user.role})` : 'No user';
    console.error(`[Error] ${err.message} | ${userInfo}\nStack: ${err.stack}`);
    res.status(err.status || 500).json({
        message: req.app.get('env') === 'development' ? err.message : 'Internal server error',
        details: req.app.get('env') === 'development' ? err.stack : undefined
    });
});

module.exports = app;