// routes/topics.js
const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth');
const topicController = require('../controllers/topicController');

// Define multer for topics (fields for videos and resources)
const multer = require('multer');
const path = require('path');
const storage = multer.diskStorage({
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
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) return cb(null, true);
        return cb(new Error('Only video files are allowed!'));
    } else if (file.fieldname === 'resourceFiles') {
        const filetypes = /pdf/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) return cb(null, true);
        return cb(new Error('Only PDF files are allowed!'));
    } else {
        cb(new Error('Invalid file field'));
    }
};
const uploadTopics = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
    fileFilter: fileFilter
}).fields([
    { name: 'videoFiles', maxCount: 20 },
    { name: 'resourceFiles', maxCount: 10 }
]);

// Destructure other multer from controller
const { uploadVideos, uploadPDFs } = topicController;

// Videos routes
router.post('/:id/videos', auth, checkRole(['admin']), uploadVideos.array('videoFiles'), topicController.addVideosToTopic);
router.delete('/:id/videos/:videoId', auth, checkRole(['admin']), topicController.deleteVideoFromTopic);

// Resources routes
router.post('/:id/resources', auth, checkRole(['admin']), uploadPDFs.array('resourceFiles'), topicController.addResourcesToTopic);
router.delete('/:id/resources/:resourceId', auth, checkRole(['admin']), async (req, res) => {
    try {
        const Topic = require('../models/Topic');
        const topic = await Topic.findById(req.params.id);
        if (!topic) return res.status(404).json({ message: 'Topic not found' });
        const resource = topic.resources.id(req.params.resourceId);
        if (!resource) return res.status(404).json({ message: 'Resource not found' });
        resource.remove();
        await topic.save();
        res.json({ message: 'Resource deleted successfully' });
    } catch (err) {
        console.error('Delete resource error:', err);
        res.status(500).json({ message: err.message });
    }
});

// CRUD - ADDED: Multer for POST and PUT
router.post('/', auth, checkRole(['admin']), uploadTopics, topicController.createTopic);
router.get('/course/:courseId', auth, topicController.getTopicsByCourse);
router.get('/:id', auth, topicController.getTopic);
router.put('/:id', auth, checkRole(['admin']), uploadTopics, topicController.updateTopic);
router.delete('/:id', auth, checkRole(['admin']), topicController.deleteTopic);

// Auto from playlist
router.post('/auto-from-playlist', auth, checkRole(['admin']), topicController.autoCreateTopicsFromPlaylist);

module.exports = router;