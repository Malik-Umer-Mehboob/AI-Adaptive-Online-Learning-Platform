// backend/routes/courses.js
const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth');
const Course = require('../models/Course');
const Category = require('../models/Category');
const Enrollment = require('../models/Enrollment');
const Favorite = require('../models/Favorite');
const multer = require('multer');
const path = require('path');
const { google } = require('googleapis');

// YouTube API setup
const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

// Multer setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../public/Uploads/videos');
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const filename = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, filename);
    },
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const filetypes = /mp4|mov|avi|mkv|webm/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) return cb(null, true);
        cb(new Error('Only video files are allowed!'));
    }
});

// Helper: Check if YouTube playlist URL
function isPlaylistUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.searchParams.has('list');
    } catch {
        return false;
    }
}

// Helper: Extract playlist ID
function extractPlaylistId(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.searchParams.get('list');
    } catch {
        return null;
    }
}

// Helper: Fetch playlist videos (updated: more logging + fallback)
async function fetchPlaylistVideos(playlistId) {
    try {
        if (!process.env.YOUTUBE_API_KEY) {
            console.warn('YOUTUBE_API_KEY missing - cannot fetch playlist');
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
        return items.map(item => ({
            topic: item.snippet.title,
            url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
            type: 'single', // Individual videos
            isFile: false
        }));
    } catch (error) {
        console.error('Playlist fetch error:', error.response?.data || error.message);
        throw new Error(`Playlist fetch failed: ${error.message}. Check API key/quota.`);
    }
}

// POST /youtube/fetch-playlist - New route for frontend to fetch playlist videos
router.post('/youtube/fetch-playlist', auth, checkRole(['admin']), async (req, res) => {
    try {
        const { playlistUrl } = req.body;
        if (!playlistUrl || !playlistUrl.includes('playlist?list=')) {
            return res.status(400).json({ message: 'Valid playlist URL required' });
        }
        const playlistId = new URLSearchParams(playlistUrl.split('?')[1]).get('list');
        const videos = await fetchPlaylistVideos(playlistId);
        res.json({ videos });
    } catch (error) {
        console.error('Playlist fetch error:', error);
        res.status(500).json({ message: 'Failed to fetch playlist' });
    }
});

// GET all courses
router.get('/', auth, async (req, res) => {
    try {
        const search = req.query.search?.trim() || '';
        const category = req.query.category || '';
        let query = {};

        if (search) query.name = { $regex: search, $options: 'i' };
        if (category) query.category = category;

        if (req.user.role === 'student') {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 9;
            const skip = (page - 1) * limit;

            const totalCourses = await Course.countDocuments(query);
            const courses = await Course.find(query)
                .populate('category', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);

            const enrolledCourseIds = await Enrollment.find({ studentId: req.user.id })
                .distinct('courseId')
                .then(ids => ids.map(id => id.toString()));

            const coursesWithStatus = courses.map(course => {
                const plain = course.toObject();
                plain.isEnrolled = enrolledCourseIds.includes(plain._id.toString());
                return plain;
            });

            res.json({
                courses: coursesWithStatus,
                currentPage: page,
                totalPages: Math.ceil(totalCourses / limit),
                totalCourses
            });
        } else {
            const courses = await Course.find(query)
                .populate('category')
                .sort({ createdAt: -1 });
            res.json(courses);
        }
    } catch (error) {
        console.error('Error fetching courses:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// GET course by ID
router.get('/:id', auth, async (req, res) => {
    try {
        const course = await Course.findById(req.params.id).populate('category');
        if (!course) return res.status(404).json({ message: 'Course not found' });
        res.json(course);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// POST - Create course
router.post('/', auth, checkRole(['admin']), upload.array('videoFiles'), async (req, res) => {
    try {
        const { name, description, category, videos: videosJson } = req.body;
        if (!name || !description || !category) {
            return res.status(400).json({ message: 'Name, description, and category are required.' });
        }

        const cat = await Category.findById(category);
        if (!cat) return res.status(404).json({ message: 'Category not found' });

        let videos = [];
        if (videosJson) {
            try { videos = JSON.parse(videosJson); }
            catch (e) { return res.status(400).json({ message: 'Invalid videos JSON' }); }
        }

        const files = req.files || [];
        let fileIndex = 0;
        const finalVideos = [];

        for (const v of videos) {
            if (v.isFile && fileIndex < files.length) {
                const file = files[fileIndex++];
                finalVideos.push({
                    topic: v.topic || `Video ${fileIndex}`,
                    url: `/uploads/videos/${file.filename}`,
                    type: 'single',
                    isFile: true
                });
            } else if (!v.isFile && v.url) {
                try {
                    if (isPlaylistUrl(v.url)) {
                        const playlistId = extractPlaylistId(v.url);
                        if (!playlistId) {
                            throw new Error('Invalid playlist URL');
                        }
                        const playlistVideos = await fetchPlaylistVideos(playlistId);
                        finalVideos.push(...playlistVideos);
                    } else {
                        finalVideos.push({
                            topic: v.topic || 'YouTube Video',
                            url: v.url,
                            type: 'single',
                            isFile: false
                        });
                    }
                } catch (playlistError) {
                    console.error('Playlist fallback - storing as playlist:', playlistError.message);
                    finalVideos.push({
                        topic: v.topic || 'YouTube Playlist',
                        url: v.url,
                        type: 'playlist', // Mark as playlist for frontend
                        isFile: false
                    });
                }
            }
        }

        if (finalVideos.length === 0) {
            return res.status(400).json({ message: 'At least one video is required.' });
        }

        const course = new Course({ name, description, category, videos: finalVideos });
        await course.save();
        console.log(`Course created with ${finalVideos.length} videos`);
        res.status(201).json({ message: 'Course created successfully', course });
    } catch (error) {
        console.error('Create course error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// PUT - Update course
router.put('/:id', auth, checkRole(['admin']), upload.array('videoFiles'), async (req, res) => {
    try {
        const { name, description, category, videos: videosJson } = req.body;
        const course = await Course.findById(req.params.id);
        if (!course) return res.status(404).json({ message: 'Course not found' });

        if (name) course.name = name;
        if (description) course.description = description;
        if (category) {
            const cat = await Category.findById(category);
            if (!cat) return res.status(404).json({ message: 'Category not found' });
            course.category = category;
        }

        if (videosJson || req.files?.length > 0) {
            let videos = [];
            if (videosJson) {
                try { videos = JSON.parse(videosJson); }
                catch (e) { return res.status(400).json({ message: 'Invalid videos JSON' }); }
            }

            const files = req.files || [];
            let fileIndex = 0;
            const finalVideos = [];

            for (const v of videos) {
                if (v.isFile && fileIndex < files.length) {
                    const file = files[fileIndex++];
                    finalVideos.push({
                        topic: v.topic,
                        url: `/uploads/videos/${file.filename}`,
                        type: 'single',
                        isFile: true
                    });
                } else if (!v.isFile && v.url) {
                    try {
                        if (isPlaylistUrl(v.url)) {
                            const playlistId = extractPlaylistId(v.url);
                            if (!playlistId) {
                                throw new Error('Invalid playlist URL');
                            }
                            const playlistVideos = await fetchPlaylistVideos(playlistId);
                            finalVideos.push(...playlistVideos);
                        } else {
                            finalVideos.push({
                                topic: v.topic,
                                url: v.url,
                                type: 'single',
                                isFile: false
                            });
                        }
                    } catch (playlistError) {
                        console.error('Playlist update fallback:', playlistError.message);
                        finalVideos.push({
                            topic: `${v.topic || 'Playlist Error'} - ${playlistError.message}`,
                            url: v.url,
                            type: 'playlist',
                            isFile: false
                        });
                    }
                }
            }
            course.videos = finalVideos;
        }

        await course.save();
        res.json({ message: 'Course updated', course });
    } catch (error) {
        console.error('Update course error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// DELETE - Delete course
router.delete('/:id', auth, checkRole(['admin']), async (req, res) => {
    try {
        const course = await Course.findByIdAndDelete(req.params.id);
        if (!course) return res.status(404).json({ message: 'Course not found' });
        res.json({ message: 'Course deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// POST - Toggle favorite
router.post('/:id/favorite', auth, async (req, res) => {
    try {
        const { favorite } = req.body;
        const course = await Course.findById(req.params.id);
        if (!course) return res.status(404).json({ message: 'Course not found' });

        const userId = req.user.id;
        let fav = await Favorite.findOne({ userId, courseId: req.params.id });

        if (favorite && !fav) {
            fav = new Favorite({ userId, courseId: req.params.id });
            await fav.save();
        } else if (!favorite && fav) {
            await Favorite.deleteOne({ _id: fav._id });
        }

        res.json({ message: 'Favorite updated' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;