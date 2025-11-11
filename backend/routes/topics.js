// routes/topics.js - No changes needed, as destructuring works with the fixed exports.
const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth');
const topicController = require('../controllers/topicController');

// Destructure multer instances
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

// CRUD
router.post('/', auth, checkRole(['admin']), topicController.createTopic);
router.get('/course/:courseId', auth, topicController.getTopicsByCourse);
router.get('/:id', auth, topicController.getTopic);
router.put('/:id', auth, checkRole(['admin']), topicController.updateTopic);
router.delete('/:id', auth, checkRole(['admin']), topicController.deleteTopic);

// Auto from playlist
router.post('/auto-from-playlist', auth, checkRole(['admin']), topicController.autoCreateTopicsFromPlaylist);

module.exports = router;