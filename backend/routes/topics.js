// routes/topics.js - FIXED with correct multer usage
const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth');
const topicController = require('../controllers/topicController');
const { uploadPDF, uploadVideo } = require('../middleware/multer'); // Only uploadPDF, not uploadPDFs

// Videos routes - FIXED: use .array() on uploadVideo
router.post('/:id/videos', 
    auth, 
    checkRole(['admin']), 
    uploadVideo.array('videoFiles', 10), 
    topicController.addVideosToTopic
);

router.delete('/:id/videos/:videoId', 
    auth, 
    checkRole(['admin']), 
    topicController.deleteVideoFromTopic
);

// Resources routes - FIXED: use .array() on uploadPDF (not uploadPDFs)
router.post('/:id/resources', 
    auth, 
    checkRole(['admin']), 
    uploadPDF.array('resourceFiles', 10), 
    topicController.addResourcesToTopic
);

router.delete('/:id/resources/:resourceId', 
    auth, 
    checkRole(['admin']), 
    topicController.deleteResourceFromTopic
);

// CRUD routes
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure directories exist
const createDirectories = () => {
    const dirs = [
        path.join(__dirname, '../public/uploads/videos'),
        path.join(__dirname, '../public/uploads/resources'),
        path.join(__dirname, '../public/uploads/images')
    ];
    
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
};
createDirectories();

const videoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'videoFiles') {
            cb(null, path.join(__dirname, '../public/uploads/videos'));
        } else if (file.fieldname === 'resourceFiles') {
            cb(null, path.join(__dirname, '../public/uploads/resources'));
        } else {
            cb(new Error('Invalid file field'));
        }
    },
    filename: (req, file, cb) => {
        const filename = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, filename);
    },
});

const fileFilter = (req, file, cb) => {
    if (file.fieldname === 'videoFiles') {
        const filetypes = /mp4|mov|avi|mkv|webm/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = file.mimetype.startsWith('video/');
        if (extname && mimetype) return cb(null, true);
        return cb(new Error('Only video files are allowed!'));
    } else if (file.fieldname === 'resourceFiles') {
        if (file.mimetype === 'application/pdf') return cb(null, true);
        return cb(new Error('Only PDF files are allowed!'));
    } else {
        cb(new Error('Invalid file field'));
    }
};

const uploadTopics = multer({
    storage: videoStorage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: fileFilter
}).fields([
    { name: 'videoFiles', maxCount: 20 },
    { name: 'resourceFiles', maxCount: 10 }
]);

// Basic CRUD
router.post('/', 
    auth, 
    checkRole(['admin']), 
    uploadTopics, 
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
    uploadTopics, 
    topicController.updateTopic
);

router.delete('/:id', 
    auth, 
    checkRole(['admin']), 
    topicController.deleteTopic
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