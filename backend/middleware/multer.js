// middleware/multer.js - FIXED VERSION FOR ASSIGNMENT PDFS
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Project root directory
const projectRoot = path.resolve(__dirname, '..');

// Create all required directories
const createDirectories = () => {
    const directories = [
        path.join(projectRoot, 'public', 'uploads', 'assignments'),  // ✅ ASSIGNMENTS FOLDER
        path.join(projectRoot, 'public', 'uploads', 'submissions'),
        path.join(projectRoot, 'public', 'uploads', 'videos'),
        path.join(projectRoot, 'public', 'uploads', 'images'),
        path.join(projectRoot, 'public', 'uploads', 'documents'),
        path.join(projectRoot, 'public', 'uploads', 'resources'),
        path.join(projectRoot, 'public', 'uploads', 'temp')
    ];
    
    directories.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`✅ Created directory: ${dir}`);
        }
    });
};

// Initialize directories
createDirectories();

// ========== ASSIGNMENT PDF UPLOAD CONFIGURATION ==========
// ✅ YEH WALA USE KARNA HAI ASSIGNMENT PDFs KE LIYE
const assignmentStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Always save assignment PDFs to assignments folder
        const uploadPath = path.join(projectRoot, 'public', 'uploads', 'assignments');
        
        // Ensure directory exists
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        
        console.log(`📁 Saving assignment PDF to: ${uploadPath}`);
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Use assignment ID in filename if available
        let filename;
        
        if (req.params.assignmentId) {
            // For assignment submission
            filename = `assignment_${req.params.assignmentId}_submission_${Date.now()}.pdf`;
        } else if (req.params.id || req.body.assignmentId) {
            // For new assignment creation
            const assignmentId = req.params.id || req.body.assignmentId || 'new';
            filename = `assignment_${assignmentId}.pdf`;
        } else {
            // Generic filename
            const timestamp = Date.now();
            const random = Math.round(Math.random() * 1E9);
            filename = `assignment_${timestamp}_${random}.pdf`;
        }
        
        console.log(`📄 Assignment PDF filename: ${filename}`);
        cb(null, filename);
    }
});

// ✅ Main PDF upload middleware
const uploadPDF = multer({
    storage: assignmentStorage,
    fileFilter: function (req, file, cb) {
        // Allow only PDF files
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

// ========== VIDEO UPLOAD ==========
const uploadVideo = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            const uploadPath = path.join(projectRoot, 'public', 'uploads', 'videos');
            if (!fs.existsSync(uploadPath)) {
                fs.mkdirSync(uploadPath, { recursive: true });
            }
            cb(null, uploadPath);
        },
        filename: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const originalName = path.parse(file.originalname).name;
            const safeName = originalName.replace(/[^a-zA-Z0-9]/g, '_');
            cb(null, safeName + '_' + uniqueSuffix + path.extname(file.originalname));
        }
    }),
    fileFilter: function (req, file, cb) {
        const allowedMimes = [
            'video/mp4', 'video/mpeg', 'video/ogg', 'video/webm',
            'video/quicktime', 'video/x-msvideo'
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only video files are allowed.'), false);
        }
    },
    limits: { fileSize: 500 * 1024 * 1024, files: 20 }
});

// ========== IMAGE UPLOAD ==========
const uploadImage = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            const uploadPath = path.join(projectRoot, 'public', 'uploads', 'images');
            if (!fs.existsSync(uploadPath)) {
                fs.mkdirSync(uploadPath, { recursive: true });
            }
            cb(null, uploadPath);
        },
        filename: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, 'img_' + uniqueSuffix + path.extname(file.originalname));
        }
    }),
    fileFilter: function (req, file, cb) {
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 }
});

// ========== ERROR HANDLING ==========
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

// ========== UTILITY FUNCTIONS ==========
const getFilePath = (filename, type = 'assignments') => {
    return path.join(projectRoot, 'public', 'uploads', type, filename);
};

const deleteFile = (filePath) => {
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
};

// Export all configurations
module.exports = {
    // Multer instances
    uploadVideo,
    uploadPDF,          // ✅ Assignment PDF upload
    uploadImage,
    
    // Helper middleware
    handleUploadError,
    
    // Utility functions
    getFilePath,
    deleteFile,
    
    // Direct paths for reference
    uploadPaths: {
        assignments: path.join(projectRoot, 'public', 'uploads', 'assignments'),
        submissions: path.join(projectRoot, 'public', 'uploads', 'submissions'),
        videos: path.join(projectRoot, 'public', 'uploads', 'videos'),
        images: path.join(projectRoot, 'public', 'uploads', 'images'),
        resources: path.join(projectRoot, 'public', 'uploads', 'resources')
    }
};