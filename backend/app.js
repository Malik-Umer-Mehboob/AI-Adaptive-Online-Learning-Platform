var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var cors = require('cors');
var dotenv = require('dotenv');
var rateLimit = require('express-rate-limit');

// Clear module cache to ensure latest routes are loaded
try {
    delete require.cache[require.resolve('./routes/auth')];
    delete require.cache[require.resolve('./routes/admin')];
    delete require.cache[require.resolve('./routes/dashboard')];
} catch (error) {
    console.error('Error clearing module cache:', error.message);
}

var authRoutes;
try {
    const authModule = require('./routes/auth');
    authRoutes = authModule.router; // Access router from module.exports
    console.log('authRoutes loaded successfully');
} catch (error) {
    console.error('Error loading authRoutes:', error.message);
}

var adminRoutes = require('./routes/admin');
var dashboardRoutes = require('./routes/dashboard');

dotenv.config({ path: path.resolve(__dirname, '.env') });

var connectDB = require('./config/db');
connectDB();

var app = express();

// Debug: Log to confirm routes are loaded
console.log('Loading routes:', {
    authRoutes: !!authRoutes,
    adminRoutes: !!adminRoutes,
    dashboardRoutes: !!dashboardRoutes
});

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

// CORS Configuration
app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:5000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Static file serving
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static('public/uploads'));

// Serve favicon explicitly
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'assets', 'img', 'favicon.png'));
});

// Test route to verify server
app.get('/api/test', (req, res) => {
    res.json({ message: 'Server is running' });
});

// Debug route to list all registered routes
app.get('/api/debug/routes', (req, res) => {
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

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', dashboardRoutes);

// 404 Error Handler
app.use(function(req, res, next) {
    console.log('Requested URL:', req.originalUrl, 'Method:', req.method);
    next(createError(404, 'Resource not found'));
});

// Global Error Handler
app.use(function(err, req, res, next) {
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    console.error('Error:', err.message, err.stack);
    res.status(err.status || 500);
    res.json({
        message: req.app.get('env') === 'development' ? err.message : 'Internal server error',
        details: req.app.get('env') === 'development' ? err.stack : undefined
    });
});

module.exports = app;