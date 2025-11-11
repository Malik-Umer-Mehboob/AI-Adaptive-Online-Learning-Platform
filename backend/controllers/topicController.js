// controller/topiccontroller.js - No major changes needed, but added better error handling for single video in addVideosToTopic to align with frontend (single only for topics). Also, ensured resources type 'url' handling.
const mongoose = require('mongoose');
const Topic = require('../models/Topic');
const Course = require('../models/Course');
const multer = require('multer');
const path = require('path');
const { google } = require('googleapis');

// YouTube API setup
const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

// Multer for videos
const videoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../public/uploads/videos'));
    },
    filename: (req, file, cb) => {
        const filename = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, filename);
    },
});
const uploadVideos = multer({
    storage: videoStorage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const filetypes = /mp4|mov|avi|mkv|webm/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) return cb(null, true);
        cb(new Error('Only video files are allowed!'));
    }
});

// Multer for PDFs/resources
const pdfStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../public/uploads/resources'));
    },
    filename: (req, file, cb) => {
        const filename = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, filename);
    },
});
const uploadPDFs = multer({
    storage: pdfStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB for PDFs
    fileFilter: (req, file, cb) => {
        const filetypes = /pdf/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) return cb(null, true);
        cb(new Error('Only PDF files are allowed!'));
    }
});

// Helper functions
function isPlaylistUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.searchParams.has('list');
    } catch {
        return false;
    }
}

function extractPlaylistId(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.searchParams.get('list');
    } catch {
        return null;
    }
}

async function fetchPlaylistVideos(playlistId) {
    try {
        if (!process.env.YOUTUBE_API_KEY) {
            throw new Error('YOUTUBE_API_KEY missing');
        }
        console.log(`Fetching playlist videos for ID: ${playlistId}`);
        const response = await youtube.playlistItems.list({
            part: 'snippet',
            playlistId: playlistId,
            maxResults: 50
        });
        const items = response.data.items || [];
        console.log(`Fetched ${items.length} videos from playlist`);
        return items.map((item, idx) => ({
            topic: item.snippet.title,
            url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
            isFile: false,
            order: idx
        }));
    } catch (error) {
        console.error('Playlist fetch error:', error.response?.data || error.message);
        throw new Error(`Playlist fetch failed: ${error.message}. Check API key/quota.`);
    }
}

// Improved topic identification
async function identifyTopicsFromVideos(videos) {
    const groups = {};
    videos.forEach(video => {
        // Better grouping: Use first 3-5 words or common prefix
        const titleWords = video.topic.toLowerCase().split(/\s+/).slice(0, 5).join(' ');
        let groupKey = titleWords;
        // Fallback to full title if too short
        if (titleWords.length < 10) groupKey = video.topic.toLowerCase();
        if (!groups[groupKey]) {
            groups[groupKey] = {
                name: video.topic.split(/[-:–]|part\s+\d+|episode\s+\d+|ch\d+|lec\d+/i)[0].trim() || video.topic,
                videos: []
            };
        }
        groups[groupKey].videos.push({ ...video });
    });
    return Object.values(groups).map((group, idx) => ({
        name: group.name.charAt(0).toUpperCase() + group.name.slice(1),
        description: `Auto-generated topic from playlist videos`,
        order: idx,
        status: 'draft',
        videos: group.videos.map((v, vidx) => ({ ...v, order: vidx }))
    }));
}

// Controllers
exports.createTopic = async (req, res) => {
    try {
        const { name, courseId, description = '', status = 'draft', order = 0, resources = [], videos = [] } = req.body;
        if (!name || !courseId) return res.status(400).json({ message: 'Name and courseId required' });
        const topic = new Topic({ name, courseId, description, status, order, resources, videos });
        await topic.save();
        const course = await Course.findById(courseId);
        if (course && !course.topics.includes(topic._id)) {
            course.topics.push(topic._id);
            await course.save();
        }
        res.status(201).json(topic);
    } catch (err) {
        console.error('Create topic error:', err);
        res.status(400).json({ message: err.message });
    }
};

exports.getTopicsByCourse = async (req, res) => {
    try {
        let topics = await Topic.find({ courseId: req.params.courseId }).sort({ order: 1 });
        topics = topics.map(topic => {
            topic.videos.sort((a, b) => (a.order || 0) - (b.order || 0));
            return topic;
        });
        res.json(topics);
    } catch (err) {
        console.error('Get topics error:', err);
        res.status(500).json({ message: err.message });
    }
};

exports.getTopic = async (req, res) => {
    try {
        const topic = await Topic.findById(req.params.id);
        if (!topic) return res.status(404).json({ message: 'Topic not found' });
        topic.videos.sort((a, b) => (a.order || 0) - (b.order || 0));
        res.json(topic);
    } catch (err) {
        console.error('Get topic error:', err);
        res.status(500).json({ message: err.message });
    }
};

exports.updateTopic = async (req, res) => {
    try {
        const updates = req.body;
        const topic = await Topic.findByIdAndUpdate(
            req.params.id,
            { $set: updates },
            { new: true, runValidators: true }
        );
        if (!topic) return res.status(404).json({ message: 'Topic not found' });
        topic.videos.sort((a, b) => (a.order || 0) - (b.order || 0));
        await topic.save();
        res.json(topic);
    } catch (err) {
        console.error('Update topic error:', err);
        res.status(400).json({ message: err.message });
    }
};

exports.deleteTopic = async (req, res) => {
    try {
        const topic = await Topic.findById(req.params.id);
        if (!topic) return res.status(404).json({ message: 'Topic not found' });

        // Explicitly remove from course (backup to pre-hook)
        const course = await Course.findById(topic.courseId);
        if (course) {
            course.topics = course.topics.filter(t => t.toString() !== topic._id.toString());
            await course.save();
        }

        await topic.remove(); // Triggers pre-remove hook
        res.json({ message: 'Topic deleted successfully' });
    } catch (err) {
        console.error('Delete topic error:', err);
        res.status(500).json({ message: err.message });
    }
};

exports.addVideosToTopic = async (req, res) => {
    try {
        const topic = await Topic.findById(req.params.id);
        if (!topic) return res.status(404).json({ message: 'Topic not found' });

        const { videos: videosJson } = req.body;
        let videos = [];
        if (videosJson) {
            try {
                videos = JSON.parse(videosJson);
            } catch {
                return res.status(400).json({ message: 'Invalid videos JSON' });
            }
        }

        const files = req.files || [];
        let fileIndex = 0;
        const newVideos = [];

        for (const v of videos) {
            if (v.isFile && fileIndex < files.length) {
                const file = files[fileIndex++];
                newVideos.push({
                    topic: v.topic || `Video ${newVideos.length + 1}`,
                    url: `/uploads/videos/${file.filename}`,
                    isFile: true,
                    order: topic.videos.length + newVideos.length
                });
            } else if (!v.isFile && v.url) {
                // FIXED: For topics, enforce single video (no playlist, as per frontend)
                if (isPlaylistUrl(v.url)) {
                    return res.status(400).json({ message: 'Playlists not supported for topics. Use single video URLs.' });
                }
                // Single video: No fetch needed
                newVideos.push({
                    topic: v.topic || 'YouTube Video',
                    url: v.url,
                    isFile: false,
                    order: topic.videos.length + newVideos.length
                });
            }
        }

        if (newVideos.length === 0) return res.status(400).json({ message: 'No valid videos provided' });

        topic.videos.push(...newVideos);
        await topic.save();

        res.json({ message: `${newVideos.length} videos added successfully`, videos: newVideos });
    } catch (err) {
        console.error('Add videos to topic error:', err);
        res.status(500).json({ message: err.message });
    }
};

// NEW: Add resources to topic (PDF upload or URL)
exports.addResourcesToTopic = async (req, res) => {
    try {
        const topic = await Topic.findById(req.params.id);
        if (!topic) return res.status(404).json({ message: 'Topic not found' });

        const { resources: resourcesJson, type = 'pdf', name } = req.body;
        let resources = [];
        if (resourcesJson) {
            try {
                resources = JSON.parse(resourcesJson);
            } catch {
                return res.status(400).json({ message: 'Invalid resources JSON' });
            }
        }

        const files = req.files || []; // PDF files
        let fileIndex = 0;
        const newResources = [];

        for (const r of resources) {
            if (r.isFile && fileIndex < files.length) {
                const file = files[fileIndex++];
                newResources.push({
                    type: type,
                    url: `/uploads/resources/${file.filename}`,
                    name: name || file.originalname
                });
            } else if (!r.isFile && r.url) {
                newResources.push({
                    type: type || 'url',
                    url: r.url,
                    name: name || 'External Resource'
                });
            }
        }

        if (newResources.length === 0) return res.status(400).json({ message: 'No valid resources provided' });

        topic.resources.push(...newResources);
        await topic.save();

        res.json({ message: `${newResources.length} resources added successfully`, resources: newResources });
    } catch (err) {
        console.error('Add resources to topic error:', err);
        res.status(500).json({ message: err.message });
    }
};

exports.deleteVideoFromTopic = async (req, res) => {
    try {
        const topic = await Topic.findById(req.params.id);
        if (!topic) return res.status(404).json({ message: 'Topic not found' });

        const video = topic.videos.id(req.params.videoId);
        if (!video) return res.status(404).json({ message: 'Video not found' });

        video.remove();
        await topic.save();

        res.json({ message: 'Video deleted successfully' });
    } catch (err) {
        console.error('Delete video from topic error:', err);
        res.status(500).json({ message: err.message });
    }
};

exports.autoCreateTopicsFromPlaylist = async (req, res) => {
    try {
        const { playlistUrl, courseId } = req.body;
        if (!playlistUrl || !courseId) return res.status(400).json({ message: 'playlistUrl and courseId required' });

        const playlistId = extractPlaylistId(playlistUrl);
        if (!playlistId) return res.status(400).json({ message: 'Invalid playlist URL' });

        const videos = await fetchPlaylistVideos(playlistId);
        if (videos.length === 0) return res.status(400).json({ message: 'No videos in playlist' });

        const topics = await identifyTopicsFromVideos(videos);

        const course = await Course.findById(courseId);
        if (!course) return res.status(404).json({ message: 'Course not found' });

        const savedTopics = await Topic.insertMany(topics.map(t => ({ ...t, courseId })));

        course.topics.push(...savedTopics.map(t => t._id));
        await course.save();

        res.json({ message: `${savedTopics.length} topics created`, topics: savedTopics });
    } catch (err) {
        console.error('Auto create topics error:', err);
        res.status(500).json({ message: err.message });
    }
};

// FIXED: Export multer instances to the exports object (no override)
exports.uploadVideos = uploadVideos;
exports.uploadPDFs = uploadPDFs;