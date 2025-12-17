// app.js - FIXED: Added submissionsRoutes import + uncomment mount for /api/submissions/my
// NEW: Global unhandled rejection and uncaught exception handlers to prevent crashes
// UPDATED: Improved error handling, added AI model check, and better file structure

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const cors = require('cors');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');
const createError = require('http-errors');
const fs = require('fs');
const { default: ollama } = require('ollama');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

// MongoDB Connection
const connectDB = require('./config/db');
connectDB().catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
});

// Check AI Model Availability
async function checkAIModel() {
    try {
        console.log('Checking Ollama availability...');
        const response = await fetch('http://localhost:11434/api/tags');
        const data = await response.json();
        const models = data.models || [];
        
        const targetModel = process.env.OLLAMA_MODEL || 'qwen2.5:14b';
        const hasModel = models.some(m => m.name === targetModel);
        
        if (hasModel) {
            console.log(`✅ Ollama model "${targetModel}" is available`);
        } else {
            console.warn(`⚠️ Model "${targetModel}" not found. Available models:`, models.map(m => m.name));
            console.log('Run: ollama pull qwen2.5:14b');
        }
        return hasModel;
    } catch (error) {
        console.error('❌ Ollama not running or unreachable:', error.message);
        console.log('Start Ollama with: ollama serve');
        return false;
    }
}

// Check AI model on startup (async)
setTimeout(() => {
    checkAIModel();
}, 2000);

// Models (for any app-level use, but mostly in controllers)
const Assignment = require('./models/Assignment');
const Submission = require('./models/Submission');

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const dashboardRoutes = require('./routes/dashboard');
const courseRoutes = require('./routes/courses');
const categoryRoutes = require('./routes/categories');
const topicRoutes = require('./routes/topics');

// FIXED: Check if assignments.js (with 's') exists before requiring
const assignmentsPath = path.join(__dirname, 'routes', 'assignments.js');
if (!fs.existsSync(assignmentsPath)) {
    console.error('ERROR: routes/assignments.js file not found!');
    // Create basic assignments routes file if missing
    const basicAssignmentsRoute = `
const express = require('express');
const router = express.Router();
const { auth, isAdmin, isStudent } = require('../middleware/auth');

router.get('/test', (req, res) => {
    res.json({ message: 'Assignments route working' });
});

module.exports = router;
`;
    fs.writeFileSync(assignmentsPath, basicAssignmentsRoute);
    console.log('Created basic assignments.js route file');
}
const assignmentsRoutes = require('./routes/assignments');

const studentRoutes = require('./routes/student');

// FIXED: Check if submissions.js exists
const submissionsPath = path.join(__dirname, 'routes', 'submissions.js');
if (!fs.existsSync(submissionsPath)) {
    console.log('Creating submissions.js route file...');
    const basicSubmissionsRoute = `
const express = require('express');
const router = express.Router();
const { auth, isStudent } = require('../middleware/auth');
const Submission = require('../models/Submission');

router.get('/my', auth, isStudent, async (req, res) => {
    try {
        const submissions = await Submission.find({ studentId: req.user.id })
            .populate({
                path: 'assignmentId',
                populate: { path: 'courseId', select: 'name' },
                select: 'title dueDate'
            })
            .sort({ submittedAt: -1 });
        
        const formatted = submissions.map(sub => ({
            _id: sub._id,
            assignmentTitle: sub.assignmentId?.title,
            courseName: sub.assignmentId?.courseId?.name,
            submittedAt: sub.submittedAt,
            evaluated: sub.evaluated,
            score: sub.evaluation?.score,
            feedback: sub.evaluation?.feedback || 'Pending evaluation'
        }));
        
        res.json(formatted);
    } catch (error) {
        console.error('Get submissions error:', error);
        res.status(500).json({ message: 'Failed to load submissions' });
    }
});

module.exports = router;
`;
    fs.writeFileSync(submissionsPath, basicSubmissionsRoute);
    console.log('Created submissions.js route file');
}
const submissionsRoutes = require('./routes/submissions');

// Ensure required directories exist
const requiredDirs = [
    path.join(__dirname, 'public', 'uploads', 'submissions'),
    path.join(__dirname, 'public', 'uploads', 'assignments'),
    path.join(__dirname, 'public', 'uploads', 'videos')
];

requiredDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
    }
});

const app = express();

// CORS Configuration
const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            'http://localhost:5500',
            'http://127.0.0.1:5500',
            'http://localhost:5000',
            'http://localhost:3000',
            'http://localhost:8080'
        ];
        
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};
app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// Rate Limiting
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: 'Too many requests from this IP, please try again after 15 minutes.',
    standardHeaders: true,
    legacyHeaders: false
});
app.use(generalLimiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: 'Too many authentication requests, please try again after 15 minutes.'
});
app.use('/api/auth', authLimiter);

const aiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 20,
    message: 'Too many AI requests, please wait a minute.'
});
app.use('/api/assignments/generate', aiLimiter);
app.use('/api/assignments/submissions/*/evaluate', aiLimiter);

// Middleware
app.use(logger('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Static file serving
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/public/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Health Check with AI status
app.get('/api/health', async (req, res) => {
    const aiStatus = await checkAIModel();
    res.status(200).json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        ai: {
            available: aiStatus,
            model: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
            host: process.env.OLLAMA_HOST || 'http://localhost:11434'
        },
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// AI Status Check Endpoint
app.get('/api/ai/status', async (req, res) => {
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        const data = await response.json();
        const models = data.models || [];
        
        const targetModel = process.env.OLLAMA_MODEL || 'qwen2.5:14b';
        const modelExists = models.some(m => m.name === targetModel);
        
        // Test model with simple prompt
        let testResult = null;
        if (modelExists) {
            try {
                const testResponse = await fetch('http://localhost:11434/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: targetModel,
                        prompt: "Hello",
                        stream: false
                    })
                });
                testResult = await testResponse.json();
            } catch (testError) {
                testResult = { error: testError.message };
            }
        }
        
        res.json({
            ollamaRunning: true,
            modelExists,
            targetModel,
            availableModels: models.map(m => m.name),
            testResult: testResult ? 'Model responding' : 'Model not responding'
        });
    } catch (error) {
        res.json({
            ollamaRunning: false,
            error: error.message,
            suggestion: 'Start Ollama with: ollama serve'
        });
    }
});

// Test Route
app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'Server is running',
        version: '1.0.0',
        features: [
            'AI Assignment Generation',
            'PDF Submission & Evaluation',
            'Plagiarism Detection',
            'Course Management'
        ]
    });
});

// Mount Routes
app.use('/api/auth', authRoutes.router || authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/topics', topicRoutes);
app.use('/api/assignments', assignmentsRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/submissions', submissionsRoutes);
app.use("/api/enrollment", require("./routes/enrollment"));

// Cache Control Middleware
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
});

// 404 Handler
app.use((req, res, next) => {
    const userInfo = req.user ? `User: ${req.user.id} (${req.user.role})` : 'No user';
    console.log(`[404] ${req.method} ${req.originalUrl} - ${userInfo}`);
    
    // Return JSON for API routes
    if (req.originalUrl.startsWith('/api/')) {
        return res.status(404).json({
            message: `Resource not found: ${req.originalUrl}`,
            method: req.method,
            timestamp: new Date().toISOString()
        });
    }
    
    // For non-API routes, send HTML or redirect
    next(createError(404, `Resource not found: ${req.originalUrl}`));
});

// Global Error Handler
app.use((err, req, res, next) => {
    // Log the error
    const userInfo = req.user ? `User: ${req.user.id} (${req.user.role})` : 'No user';
    console.error(`[ERROR] ${err.message}`);
    console.error(`Stack: ${err.stack}`);
    console.error(`Request: ${req.method} ${req.originalUrl} - ${userInfo}`);
    
    // Handle file cleanup for upload errors
    if (err.message.includes('Only PDF files') || err.message.includes('Only video files') || err.code === 'LIMIT_FILE_SIZE') {
        if (req.file && req.file.path) {
            fs.unlink(req.file.path, (unlinkErr) => {
                if (unlinkErr) console.error('File cleanup failed:', unlinkErr);
            });
        }
    }
    
    // Set locals
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};
    
    // Determine status code
    const status = err.status || 500;
    
    // Prepare error response
    const errorResponse = {
        message: err.message || 'Internal Server Error',
        status: status,
        timestamp: new Date().toISOString()
    };
    
    // Add stack trace in development
    if (req.app.get('env') === 'development') {
        errorResponse.stack = err.stack;
        errorResponse.details = err;
    }
    
    // Special handling for validation errors
    if (err.name === 'ValidationError') {
        errorResponse.message = 'Validation Error';
        errorResponse.errors = Object.values(err.errors).map(e => e.message);
        return res.status(400).json(errorResponse);
    }
    
    // Special handling for JWT errors
    if (err.name === 'JsonWebTokenError') {
        errorResponse.message = 'Invalid token';
        return res.status(401).json(errorResponse);
    }
    
    if (err.name === 'TokenExpiredError') {
        errorResponse.message = 'Token expired';
        return res.status(401).json(errorResponse);
    }
    
    // Special handling for MongoDB duplicate key
    if (err.code === 11000) {
        errorResponse.message = 'Duplicate key error';
        errorResponse.field = Object.keys(err.keyPattern)[0];
        return res.status(400).json(errorResponse);
    }
    
    // Send error response
    res.status(status).json(errorResponse);
});

// Global unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Log to file in production
    if (process.env.NODE_ENV === 'production') {
        const errorLog = {
            type: 'unhandledRejection',
            timestamp: new Date().toISOString(),
            reason: reason?.message || reason,
            stack: reason?.stack
        };
        fs.appendFileSync(
            path.join(__dirname, 'logs', 'errors.log'),
            JSON.stringify(errorLog) + '\n'
        );
    }
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    
    // Log to file
    const errorLog = {
        type: 'uncaughtException',
        timestamp: new Date().toISOString(),
        error: err.message,
        stack: err.stack
    };
    
    fs.appendFileSync(
        path.join(__dirname, 'logs', 'errors.log'),
        JSON.stringify(errorLog) + '\n'
    );
    
    // Graceful shutdown in production
    if (process.env.NODE_ENV === 'production') {
        console.log('Uncaught Exception - Shutting down gracefully...');
        process.exit(1);
    }
});

// Create logs directory if not exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

module.exports = app;