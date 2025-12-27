// routes/topics.js - FIXED VERSION
const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth');
const topicController = require('../controllers/topicController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ========== MULTER CONFIGURATION ==========

// Ensure directories exist
const uploadsDir = path.join(__dirname, '../public/uploads');
const videoDir = path.join(uploadsDir, 'videos');
const resourceDir = path.join(uploadsDir, 'resources');

[uploadsDir, videoDir, resourceDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
    }
});

// Storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'videoFiles') {
            cb(null, videoDir);
        } else if (file.fieldname === 'resourceFiles') {
            cb(null, resourceDir);
        } else {
            cb(null, uploadsDir);
        }
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

// File filter
const fileFilter = (req, file, cb) => {
    // Video files
    if (file.fieldname === 'videoFiles') {
        const allowedTypes = /mp4|mov|avi|mkv|webm/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = file.mimetype.startsWith('video/');
        
        if (extname && mimetype) return cb(null, true);
        return cb(new Error('Only video files (mp4, mov, avi, mkv, webm) are allowed!'));
    }
    
    // PDF files
    if (file.fieldname === 'resourceFiles') {
        const allowedTypes = /pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = file.mimetype === 'application/pdf';
        
        if (extname && mimetype) return cb(null, true);
        return cb(new Error('Only PDF files are allowed!'));
    }
    
    cb(null, true);
};

// Create multer instances
const uploadTopics = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB for videos
    fileFilter: fileFilter
});

const uploadVideos = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: fileFilter
}).array('videoFiles', 10);

const uploadResources = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB for PDFs
    fileFilter: fileFilter
}).array('resourceFiles', 10);

// ========== ROUTES ==========

// CRUD routes
router.post('/', 
    auth, 
    checkRole(['admin']), 
    uploadTopics.fields([
        { name: 'videoFiles', maxCount: 10 },
        { name: 'resourceFiles', maxCount: 10 }
    ]), 
    topicController.createTopic
);

router.get('/course/:courseId', 
    auth, 
    topicController.getTopicsByCourse
);

router.get('/:id', 
    auth, 
    topicController.getTopic
);

router.put('/:id', 
    auth, 
    checkRole(['admin']), 
    uploadTopics.fields([
        { name: 'videoFiles', maxCount: 10 },
        { name: 'resourceFiles', maxCount: 10 }
    ]), 
    topicController.updateTopic
);

router.delete('/:id', 
    auth, 
    checkRole(['admin']), 
    topicController.deleteTopic
);

// Video routes
router.post('/:id/videos', 
    auth, 
    checkRole(['admin']), 
    uploadVideos, 
    topicController.addVideosToTopic
);

router.delete('/:id/videos/:videoId', 
    auth, 
    checkRole(['admin']), 
    topicController.deleteVideoFromTopic
);

// Resource routes
router.post('/:id/resources', 
    auth, 
    checkRole(['admin']), 
    uploadResources, 
    topicController.addResourcesToTopic
);

router.delete('/:id/resources/:resourceId', 
    auth, 
    checkRole(['admin']), 
    topicController.deleteResourceFromTopic
);

// AI summary
router.get('/:id/summary', 
    auth, 
    topicController.getTopicSummary
);

// Auto from playlist
router.post('/auto-from-playlist', 
    auth, 
    checkRole(['admin']), 
    topicController.autoCreateTopicsFromPlaylist
);

module.exports = router;