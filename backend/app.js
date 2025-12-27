// app.js - COMPLETE FIXED VERSION WITH CORRECT PATHS
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const cors = require('cors');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');
const createError = require('http-errors');
const fs = require('fs');
const mongoose = require('mongoose');



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
        console.log('Checking Ollama availability for qwen2.5:7b-instruct-q4_K_M...');
        const response = await fetch('http://localhost:11434/api/tags');
        const data = await response.json();
        const models = data.models || [];
        
        const targetModel = 'qwen2.5:7b-instruct-q4_K_M';
        const hasModel = models.some(m => m.name === targetModel);
        
        if (hasModel) {
            console.log(`✅ Ollama model "${targetModel}" is available`);
            console.log(`ℹ️  Model details: 7B parameter, instruct-tuned, Q4_K_M quantized`);
            console.log(`⚡ Expected performance: Fast inference (2-5 seconds per evaluation)`);
        } else {
            console.warn(`⚠️  Model "${targetModel}" not found.`);
            console.log('Available models:', models.map(m => m.name));
            console.log('\nTo download the model, run:');
            console.log('  ollama pull qwen2.5:7b-instruct-q4_K_M');
            console.log('\nFor optimal performance, also run:');
            console.log('  set OLLAMA_NUM_GPU=1 (Windows)');
            console.log('  export OLLAMA_NUM_GPU=1 (Linux/Mac)');
        }
        return hasModel;
    } catch (error) {
        console.error('❌ Ollama not running or unreachable:', error.message);
        console.log('\nTo start Ollama:');
        console.log('  1. Open terminal/command prompt');
        console.log('  2. Run: ollama serve');
        console.log('  3. In another terminal, run: ollama pull qwen2.5:7b-instruct-q4_K_M');
        return false;
    }
}

// Test AI model with simple prompt
async function testAIModel() {
    try {
        console.log('\nTesting AI model response...');
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen2.5:7b-instruct-q4_K_M',
                prompt: "Hello, are you ready to grade assignments?",
                stream: false,
                options: {
                    temperature: 0.1,
                    num_predict: 50
                }
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log(`✅ Model test successful: ${data.response?.substring(0, 50)}...`);
            return true;
        } else {
            console.log('⚠️  Model test failed with status:', response.status);
            return false;
        }
    } catch (error) {
        console.log('⚠️  Model test error:', error.message);
        return false;
    }
}

// Check AI model on startup
setTimeout(async () => {
    const modelAvailable = await checkAIModel();
    if (modelAvailable) {
        await testAIModel();
    }
}, 2000);

// Models (for any app-level use)
const Assignment = require('./models/Assignment');
const Submission = require('./models/Submission');

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const dashboardRoutes = require('./routes/dashboard');
const courseRoutes = require('./routes/courses');
const categoryRoutes = require('./routes/categories');
const topicRoutes = require('./routes/topics');

// Check if assignments.js exists
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

// Check if submissions.js exists
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
    path.join(__dirname, 'public', 'uploads', 'videos'),
    path.join(__dirname, 'public', 'uploads', 'resources'),
    path.join(__dirname, 'public', 'uploads', 'images'),
    path.join(__dirname, 'public', 'uploads', 'documents'),
    path.join(__dirname, 'public', 'uploads', 'temp'),
    path.join(__dirname, 'logs')
];

requiredDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
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
            'http://localhost:8080',
            'http://localhost:3001',
            'http://localhost:5501'
        ];
        
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            console.warn(`CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
};
app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// Rate Limiting
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Too many requests from this IP, please try again after 15 minutes.',
    standardHeaders: true,
    legacyHeaders: false
});
app.use(generalLimiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many authentication requests, please try again after 15 minutes.'
});
app.use('/api/auth', authLimiter);

const aiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 30, // Increased for faster model
    message: 'Too many AI requests, please wait a minute.'
});
app.use('/api/assignments/generate', aiLimiter);
app.use('/api/assignments/submissions/*/evaluate', aiLimiter);

// Middleware
app.use(logger('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// ========== ✅ CRITICAL FIX: STATIC FILE SERVING ==========
// Serve public directory
// In app.js, add these static file serving routes BEFORE your routes:

// ========== ✅ CRITICAL FIX: STATIC FILE SERVING ==========
// Serve public directory
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Serve uploads directory
const uploadsDir = path.join(__dirname, 'public', 'uploads');
app.use('/uploads', express.static(uploadsDir, {
    setHeaders: (res, filePath) => {
        // Set proper headers for PDF files
        if (filePath.endsWith('.pdf')) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.setHeader('Content-Disposition', 'inline');
        }
    }
}));

// Serve assignments directory specifically
const assignmentsDir = path.join(__dirname, 'public', 'uploads', 'assignments');
app.use('/uploads/assignments', express.static(assignmentsDir, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.pdf')) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
    }
}));

// Log all file requests for debugging
app.use('/uploads/assignments', (req, res, next) => {
    const filePath = path.join(assignmentsDir, req.path);
    const exists = fs.existsSync(filePath);
    
    if (!exists && req.path.includes('.pdf')) {
        console.log(`❌ PDF not found: ${req.path}`);
        console.log(`📁 Looking in: ${filePath}`);
    }
    next();
});

// Serve other upload directories
app.use('/uploads/submissions', express.static(path.join(__dirname, 'public', 'uploads', 'submissions')));
app.use('/uploads/videos', express.static(path.join(__dirname, 'public', 'uploads', 'videos')));
app.use('/uploads/resources', express.static(path.join(__dirname, 'public', 'uploads', 'resources')));

// Health Check with AI status
app.get('/api/health', async (req, res) => {
    const aiStatus = await checkAIModel();
    const aiTest = await testAIModel();
    
    // Check directories
    const dirStatus = {
        assignments: fs.existsSync(assignmentsDir) ? '✅' : '❌',
        submissions: fs.existsSync(path.join(__dirname, 'public', 'uploads', 'submissions')) ? '✅' : '❌',
        videos: fs.existsSync(path.join(__dirname, 'public', 'uploads', 'videos')) ? '✅' : '❌'
    };
    
    // Count PDF files
    let pdfCount = 0;
    if (fs.existsSync(assignmentsDir)) {
        try {
            const files = fs.readdirSync(assignmentsDir);
            pdfCount = files.filter(f => f.endsWith('.pdf')).length;
        } catch (err) {
            console.error('Error reading assignments dir:', err);
        }
    }
    
    res.status(200).json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        ai: {
            available: aiStatus,
            responsive: aiTest,
            model: 'qwen2.5:7b-instruct-q4_K_M',
            host: process.env.OLLAMA_HOST || 'http://localhost:11434',
            performance: 'Fast (Q4_K_M quantized)'
        },
        directories: dirStatus,
        pdfCount: pdfCount,
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        environment: process.env.NODE_ENV || 'development'
    });
});

// AI Status Check Endpoint
app.get('/api/ai/status', async (req, res) => {
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        const data = await response.json();
        const models = data.models || [];
        
        const targetModel = 'qwen2.5:7b-instruct-q4_K_M';
        const modelExists = models.some(m => m.name === targetModel);
        
        // Test model with grading prompt
        let testResult = null;
        if (modelExists) {
            try {
                const testResponse = await fetch('http://localhost:11434/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: targetModel,
                        prompt: "Grade this answer about JavaScript: 'JavaScript is a programming language used for web development.' Give score 0-100 and brief feedback in JSON.",
                        stream: false,
                        options: {
                            temperature: 0.1,
                            num_predict: 100,
                            num_thread: 8
                        }
                    })
                });
                
                if (testResponse.ok) {
                    const testData = await testResponse.json();
                    testResult = {
                        success: true,
                        response: testData.response,
                        timing: testData.total_duration ? `${testData.total_duration / 1e9}s` : 'unknown'
                    };
                } else {
                    testResult = { success: false, error: `HTTP ${testResponse.status}` };
                }
            } catch (testError) {
                testResult = { success: false, error: testError.message };
            }
        }
        
        res.json({
            ollamaRunning: true,
            modelExists,
            targetModel,
            availableModels: models.map(m => ({
                name: m.name,
                size: m.size ? `${Math.round(m.size / 1e9)}GB` : 'unknown'
            })),
            testResult: testResult,
            recommendations: modelExists ? [
                'Model is ready for fast grading',
                'Average evaluation time: 2-5 seconds',
                'Optimized for assignment grading'
            ] : [
                'Download model: ollama pull qwen2.5:7b-instruct-q4_K_M',
                'Start Ollama: ollama serve',
                'Set OLLAMA_NUM_GPU=1 for GPU acceleration'
            ]
        });
    } catch (error) {
        res.status(500).json({
            ollamaRunning: false,
            error: error.message,
            suggestion: 'Start Ollama with: ollama serve',
            downloadCommand: 'ollama pull qwen2.5:7b-instruct-q4_K_M'
        });
    }
});

// Quick AI Test
app.get('/api/ai/quick-test', async (req, res) => {
    try {
        const startTime = Date.now();
        
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen2.5:7b-instruct-q4_K_M',
                prompt: "What is 2+2? Answer only with the number.",
                stream: false,
                options: {
                    temperature: 0.1,
                    num_predict: 10,
                    num_thread: 8
                }
            })
        });
        
        const duration = Date.now() - startTime;
        
        if (response.ok) {
            const data = await response.json();
            res.json({
                success: true,
                model: 'qwen2.5:7b-instruct-q4_K_M',
                response: data.response,
                duration: `${duration}ms`,
                performance: duration < 1000 ? 'Excellent' : duration < 3000 ? 'Good' : 'Slow',
                readyForGrading: duration < 5000
            });
        } else {
            res.status(500).json({
                success: false,
                error: `HTTP ${response.status}`,
                duration: `${duration}ms`
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            suggestion: 'Check if Ollama is running: ollama serve'
        });
    }
});

// Test Route
app.get('/api/test', (req, res) => {
    // Check directories
    const dirs = {
        assignments: assignmentsDir,
        exists: fs.existsSync(assignmentsDir),
        files: fs.existsSync(assignmentsDir) ? fs.readdirSync(assignmentsDir).filter(f => f.endsWith('.pdf')) : []
    };
    
    res.json({ 
        message: 'Assignment Grading System Server is running',
        version: '2.0.0',
        features: [
            'Fast AI Assignment Evaluation (qwen2.5:7b-instruct-q4_K_M)',
            'Instant PDF Submission & Grading',
            'Automated Feedback Generation',
            'Course & Assignment Management',
            'Student Progress Tracking'
        ],
        directories: dirs,
        paths: {
            uploads: uploadsDir,
            assignments: assignmentsDir,
            public: publicDir
        },
        endpoints: {
            assignments: '/api/assignments',
            submissions: '/api/submissions',
            aiStatus: '/api/ai/status',
            health: '/api/health'
        }
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

// Request logging middleware with AI endpoints highlight
app.use((req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const isAIEndpoint = req.originalUrl.includes('/generate') || 
                           req.originalUrl.includes('/evaluate') ||
                           req.originalUrl.includes('/submit');
        
        const logMessage = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;
        
        if (isAIEndpoint) {
            console.log(`🧠 AI ${logMessage}`);
        } else {
            console.log(logMessage);
        }
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
            success: false,
            message: `Resource not found: ${req.originalUrl}`,
            method: req.method,
            timestamp: new Date().toISOString(),
            availableEndpoints: [
                '/api/assignments - Assignment management',
                '/api/submissions - Submission handling',
                '/api/ai/status - AI model status',
                '/api/health - System health check'
            ]
        });
    }
    
    // For non-API routes, send HTML or redirect
    next(createError(404, `Resource not found: ${req.originalUrl}`));
});

// Global Error Handler
app.use((err, req, res, next) => {
    // Log the error
    const userInfo = req.user ? `User: ${req.user.id} (${req.user.role})` : 'No user';
    
    console.error(`[ERROR] ${req.method} ${req.originalUrl}`);
    console.error(`Message: ${err.message}`);
    console.error(`User: ${userInfo}`);
    
    if (err.stack && process.env.NODE_ENV === 'development') {
        console.error(`Stack: ${err.stack}`);
    }
    
    // Handle file cleanup for upload errors
    if (err.message.includes('Only PDF files') || err.message.includes('Only video files') || err.code === 'LIMIT_FILE_SIZE') {
        if (req.file && req.file.path) {
            fs.unlink(req.file.path, (unlinkErr) => {
                if (unlinkErr) console.error('File cleanup failed:', unlinkErr);
            });
        }
    }
    
    // Determine status code
    const status = err.status || 500;
    
    // Prepare error response
    const errorResponse = {
        success: false,
        message: err.message || 'Internal Server Error',
        status: status,
        timestamp: new Date().toISOString(),
        path: req.originalUrl
    };
    
    // Add stack trace in development
    if (req.app.get('env') === 'development') {
        errorResponse.stack = err.stack;
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
    
    // Special handling for AI errors
    if (err.message.includes('Ollama') || err.message.includes('AI') || err.message.includes('model')) {
        errorResponse.suggestion = [
            'Check if Ollama is running: ollama serve',
            'Download the model: ollama pull qwen2.5:7b-instruct-q4_K_M',
            'Set OLLAMA_NUM_GPU=1 for GPU acceleration'
        ];
    }
    
    // Send error response
    res.status(status).json(errorResponse);
});

// Global unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
    
    // Log to file
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
    
    // In production, we might want to restart
    if (process.env.NODE_ENV === 'production' && reason.message && reason.message.includes('Ollama')) {
        console.log('⚠️  AI service error detected. Consider restarting Ollama.');
    }
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    console.error('🚨 Uncaught Exception:', err.message);
    
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
        console.log('🔄 Uncaught Exception - Performing graceful shutdown...');
        setTimeout(() => {
            process.exit(1);
        }, 1000);
    }
});

// Startup message
console.log('\n========================================');
console.log('🚀 Assignment Grading System Starting...');
console.log('========================================');
console.log(`Port: ${process.env.PORT || 5000}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log('========================================\n');

module.exports = app;