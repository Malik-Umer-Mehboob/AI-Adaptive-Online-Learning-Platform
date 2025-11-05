const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const cors = require('cors');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');
const createError = require('http-errors');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

// MongoDB Connection
const connectDB = require('./config/db');
connectDB().catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1); // Exit if MongoDB connection fails
});

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const dashboardRoutes = require('./routes/dashboard');
const courseRoutes = require('./routes/courses');
const categoryRoutes = require('./routes/categories');

const app = express();

// CORS Configuration
app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:5000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate Limiting for all routes
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests from this IP, please try again after 15 minutes.'
});
app.use(generalLimiter);

// Stricter Rate Limiting for auth routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50,
    message: 'Too many authentication requests, please try again after 15 minutes.'
});
app.use('/api/auth', authLimiter);

// Middleware
app.use(logger('dev'));
app.use(express.json({ limit: '10mb' })); // Support large payloads for file uploads
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(cookieParser());

// Static file serving
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Serve favicon
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'assets', 'img', 'favicon.png'));
});

// Health Check Endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// Test Route
app.get('/api/test', (req, res) => {
    res.json({ message: 'Server is running' });
});

// Debug Route (Development Only)
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
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/categories', categoryRoutes);

// Cache Control for Performance
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store'); // Prevent caching for dynamic API responses
    next();
});

// 404 Error Handler
app.use((req, res, next) => {
    console.log(`[404] Requested URL: ${req.originalUrl}, Method: ${req.method}, Headers: ${JSON.stringify(req.headers)}`);
    next(createError(404, `Resource not found: ${req.originalUrl}`));
});

// Global Error Handler
app.use((err, req, res, next) => {
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    console.error(`[Error] ${err.message}\nStack: ${err.stack}`);
    res.status(err.status || 500).json({
        message: req.app.get('env') === 'development' ? err.message : 'Internal server error',
        details: req.app.get('env') === 'development' ? err.stack : undefined
    });
});

module.exports = app;