// middleware/multer.js - FIXED: Removed uploadPDFs, only keep uploadPDF

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Project root directory
const projectRoot = path.resolve(__dirname, '..');

// Create all required directories
const createDirectories = () => {
    const directories = [
        path.join(projectRoot, 'public', 'uploads', 'videos'),
        path.join(projectRoot, 'public', 'uploads', 'submissions'),
        path.join(projectRoot, 'public', 'uploads', 'assignments'),
        path.join(projectRoot, 'public', 'uploads', 'images'),
        path.join(projectRoot, 'public', 'uploads', 'documents'),
        path.join(projectRoot, 'public', 'uploads', 'resources'),
        path.join(projectRoot, 'public', 'uploads', 'temp')
    ];
    
    directories.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`Created upload directory: ${dir}`);
        }
    });
};

// Initialize directories
createDirectories();

// ========== PDF UPLOAD CONFIGURATION ==========
// IMPORTANT: Middleware to add buffer to file object even with disk storage
const addBufferToFile = (req, res, next) => {
    if (req.file && req.file.path && !req.file.buffer) {
        try {
            const fileData = fs.readFileSync(req.file.path);
            req.file.buffer = fileData;
        } catch (error) {
            console.error('Error reading file to buffer:', error);
        }
    } else if (req.files) {
        // Handle array of files
        for (let file of req.files) {
            if (file.path && !file.buffer) {
                try {
                    const fileData = fs.readFileSync(file.path);
                    file.buffer = fileData;
                } catch (error) {
                    console.error('Error reading file to buffer:', error);
                }
            }
        }
    }
    next();
};

const pdfStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Determine destination based on route
        let dest = 'submissions';
        if (req.originalUrl && req.originalUrl.includes('/topics/') && req.originalUrl.includes('/resources')) {
            dest = 'resources';
        } else if (req.originalUrl && req.originalUrl.includes('/assignments/')) {
            dest = 'assignments';
        }
        
        const uploadPath = path.join(projectRoot, 'public', 'uploads', dest);
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const userPrefix = req.user ? `user_${req.user.id}_` : '';
        const timestamp = Date.now();
        const random = Math.round(Math.random() * 1E9);
        const originalExt = path.extname(file.originalname);
        
        // Clean filename
        const originalName = path.parse(file.originalname).name;
        const cleanName = originalName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        
        cb(null, `${cleanName}_${timestamp}_${random}${originalExt}`);
    }
});

// Single PDF upload - can use .single(), .array(), or .fields()
const uploadPDF = multer({
    storage: pdfStorage,
    fileFilter: function (req, file, cb) {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed!'), false);
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// ========== VIDEO UPLOAD CONFIGURATION ==========
const videoStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(projectRoot, 'public', 'uploads', 'videos'));
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const originalName = path.parse(file.originalname).name;
        const safeName = originalName.replace(/[^a-zA-Z0-9]/g, '_');
        cb(null, safeName + '_' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadVideo = multer({
    storage: videoStorage,
    fileFilter: function (req, file, cb) {
        const allowedMimes = [
            'video/mp4',
            'video/mpeg',
            'video/ogg',
            'video/webm',
            'video/quicktime',
            'video/x-msvideo'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Invalid file type. Only video files are allowed. Received: ${file.mimetype}`), false);
        }
    },
    limits: {
        fileSize: 500 * 1024 * 1024,
        files: 20
    }
});

// ========== IMAGE UPLOAD CONFIGURATION ==========
const imageStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(projectRoot, 'public', 'uploads', 'images'));
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'img_' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadImage = multer({
    storage: imageStorage,
    fileFilter: function (req, file, cb) {
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed (JPEG, PNG, GIF, WebP, SVG)!'), false);
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024
    }
});

// ========== DOCUMENT UPLOAD CONFIGURATION ==========
const documentStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(projectRoot, 'public', 'uploads', 'documents'));
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const originalName = path.parse(file.originalname).name;
        const safeName = originalName.replace(/[^a-zA-Z0-9]/g, '_');
        cb(null, safeName + '_' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadDocument = multer({
    storage: documentStorage,
    fileFilter: function (req, file, cb) {
        const allowedMimes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain',
            'text/csv'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid document type. Allowed: PDF, Word, Excel, PowerPoint, TXT, CSV'), false);
        }
    },
    limits: {
        fileSize: 20 * 1024 * 1024
    }
});

// ========== TEMP UPLOAD ==========
const tempStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(projectRoot, 'public', 'uploads', 'temp'));
    },
    filename: function (req, file, cb) {
        cb(null, 'temp_' + Date.now() + path.extname(file.originalname));
    }
});

const uploadTemp = multer({
    storage: tempStorage,
    limits: {
        fileSize: 50 * 1024 * 1024
    }
});

// ========== HELPER MIDDLEWARE ==========

// Middleware to handle upload errors
const handleUploadError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: `File too large. Maximum size is ${err.limit / (1024*1024)}MB`
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                message: `Too many files. Maximum allowed: ${err.limit}`
            });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                message: 'Unexpected file field'
            });
        }
        return res.status(400).json({
            success: false,
            message: `Upload error: ${err.message}`
        });
    } else if (err) {
        return res.status(400).json({
            success: false,
            message: err.message
        });
    }
    next();
};

// Export all configurations
module.exports = {
    // Multer instances - REMOVED uploadPDFs, only keep uploadPDF
    uploadVideo,
    uploadPDF,          // This can be used with .single(), .array(), or .fields()
    uploadImage,
    uploadDocument,
    uploadTemp,
    
    // Helper middleware
    handleUploadError,
    addBufferToFile,
    
    // Direct paths
    uploadPaths: {
        videos: path.join(projectRoot, 'public', 'uploads', 'videos'),
        submissions: path.join(projectRoot, 'public', 'uploads', 'submissions'),
        assignments: path.join(projectRoot, 'public', 'uploads', 'assignments'),
        images: path.join(projectRoot, 'public', 'uploads', 'images'),
        documents: path.join(projectRoot, 'public', 'uploads', 'documents'),
        resources: path.join(projectRoot, 'public', 'uploads', 'resources'),
        temp: path.join(projectRoot, 'public', 'uploads', 'temp')
    },
    
    // Utility functions
    deleteFile: (filePath) => {
        return new Promise((resolve, reject) => {
            if (!filePath || !fs.existsSync(filePath)) {
                return resolve(false);
            }
            
            fs.unlink(filePath, (err) => {
                if (err) {
                    console.error('Failed to delete file:', err);
                    reject(err);
                } else {
                    resolve(true);
                }
            });
        });
    }
};