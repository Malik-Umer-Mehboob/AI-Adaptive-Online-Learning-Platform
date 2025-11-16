// routes/courses.js
const express = require('express');
const router = express.Router();
const { auth, checkRole, isStudent } = require('../middleware/auth'); // Updated with isStudent
const mongoose = require('mongoose');
const Course = require('../models/Course');
const Category = require('../models/Category');
const Enrollment = require('../models/Enrollment');
const Favorite = require('../models/Favorite');
const Assignment = require('../models/Assignment'); // Keep for populate/cascade
const Submission = require('../models/Submission'); // Keep for cascade
const fs = require('fs');
const path = require("path");
const { google } = require("googleapis");
const multer = require("multer");

// Existing upload dirs and helpers (unchanged)
const uploadsDir = path.join(__dirname, '../public/uploads');
const videoDir = path.join(uploadsDir, 'videos');
const resourceDir = path.join(uploadsDir, 'resources');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
}
if (!fs.existsSync(resourceDir)) {
    fs.mkdirSync(resourceDir, { recursive: true });
}

// YouTube setup and multer (unchanged)
const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'videoFiles') {
            cb(null, videoDir);
        } else if (file.fieldname === 'resourceFiles') {
            cb(null, resourceDir);
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

const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: fileFilter
}).fields([
    { name: 'videoFiles', maxCount: 20 },
    { name: 'resourceFiles', maxCount: 10 }
]);

const uploadVideos = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: fileFilter
}).array('videoFiles', 20);

const uploadResources = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: fileFilter
}).array('resourceFiles', 10);

// Existing helpers: isPlaylistUrl, extractPlaylistId, fetchPlaylistVideos, computeAverageRating (unchanged)
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
        return items.map(item => ({
            topic: item.snippet.title,
            url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
            type: 'single',
            isFile: false
        }));
    } catch (error) {
        console.error('Playlist fetch error:', error.response?.data || error.message);
        throw new Error(`Playlist fetch failed: ${error.message}. Check API key/quota.`);
    }
}

function computeAverageRating(course) {
    if (!course.comments || course.comments.length === 0) return { average: 0, numRatings: 0 };
    const ratedComments = course.comments.filter(c => c.rating && c.rating > 0);
    const numRatings = ratedComments.length;
    if (numRatings === 0) return { average: 0, numRatings: 0 };
    const average = ratedComments.reduce((sum, c) => sum + c.rating, 0) / numRatings;
    return { average: parseFloat(average.toFixed(1)), numRatings };
}

// Existing YouTube fetch (unchanged)
router.post('/youtube/fetch-playlist', auth, checkRole(['admin']), async (req, res) => {
    try {
        const { playlistUrl } = req.body;
        if (!playlistUrl || !playlistUrl.includes('playlist?list=')) {
            return res.status(400).json({ message: 'Valid playlist URL required' });
        }
        const playlistId = extractPlaylistId(playlistUrl);
        if (!playlistId) {
            return res.status(400).json({ message: 'Invalid playlist URL - could not extract ID' });
        }
        const videos = await fetchPlaylistVideos(playlistId);
        res.json({ videos });
    } catch (error) {
        console.error('Playlist fetch error:', error);
        res.status(500).json({ message: 'Failed to fetch playlist' });
    }
});

// Existing comments/feedback routes (unchanged)
router.get('/:id/comments', auth, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).select('comments');
    if (!course) {
      return res.status(404).json({ msg: 'Course not found' });
    }
    res.json(course.comments || []);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

router.post('/:id/comments', auth, async (req, res) => {
  const { name, email, subject, comment, rating } = req.body;

  if (!name || !email || !subject || !comment) {
    return res.status(400).json({ msg: 'Please enter all fields' });
  }
  if (rating && (rating < 1 || rating > 5)) {
    return res.status(400).json({ msg: 'Rating must be between 1-5' });
  }

  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ msg: 'Course not found' });
    }

    const newComment = {
      name,
      email,
      subject,
      comment,
      rating: rating ? parseInt(rating) : undefined
    };

    course.comments.unshift(newComment);
    await course.save();

    res.json(newComment);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

router.get('/:id/feedback', auth, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).select('feedbacks');
    if (!course) {
      return res.status(404).json({ msg: 'Course not found' });
    }
    res.json(course.feedbacks || []);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

router.post('/:id/feedback', auth, async (req, res) => {
  const { rating, comment, videoId, isCourse } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ msg: 'Please provide a valid rating (1-5)' });
  }

  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ msg: 'Course not found' });
    }

    const newFeedback = {
      rating,
      comment: comment || '',
      videoId: videoId || null,
      isCourse: isCourse || false
    };

    course.feedbacks.unshift(newFeedback);
    await course.save();

    res.json(newFeedback);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Updated: GET all courses (Keep assignments populate for overview)
router.get('/', auth, async (req, res) => {
    try {
        const search = req.query.search?.trim() || '';
        const category = req.query.category || '';
        let query = {};

        if (search) query.name = { $regex: search, $options: 'i' };
        if (category) query.category = category;

        if (req.query.ids) {
            const idList = req.query.ids.split(',').map(id => id.trim()).filter(id => id && id.length === 24 && /^[0-9a-fA-F]{24}$/.test(id));
            if (idList.length > 0) {
                const objectIds = idList.map(id => new mongoose.Types.ObjectId(id));
                query._id = { $in: objectIds };
            } else {
                return res.json([]);
            }
            const courses = await Course.find(query)
                .populate('category assignments'); // Keep for overview
            const coursesWithRating = courses.map(course => {
                const plain = course.toObject();
                const { average, numRatings } = computeAverageRating(course);
                plain.averageRating = average;
                plain.numRatings = numRatings;
                return plain;
            });
            return res.json(coursesWithRating);
        }

        if (req.user.role === 'student') {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 9;
            const skip = (page - 1) * limit;

            const totalCourses = await Course.countDocuments(query);
            const courses = await Course.find(query)
                .populate('category assignments') // Keep for overview
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);

            const enrolledCourseIds = await Enrollment.find({ studentId: req.user.id })
                .distinct('courseId')
                .then(ids => ids.map(id => id.toString()));

            const coursesWithStatus = courses.map(course => {
                const plain = course.toObject();
                plain.isEnrolled = enrolledCourseIds.includes(plain._id.toString());
                const { average, numRatings } = computeAverageRating(course);
                plain.averageRating = average;
                plain.numRatings = numRatings;
                // Filter active assignments for overview
                if (plain.assignments) {
                    const now = new Date();
                    plain.activeAssignments = plain.assignments.filter(a => new Date(a.dueDate) > now);
                }
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
                .populate('category assignments') // Keep
                .sort({ createdAt: -1 });
            const coursesWithRating = courses.map(course => {
                const plain = course.toObject();
                const { average, numRatings } = computeAverageRating(course);
                plain.averageRating = average;
                plain.numRatings = numRatings;
                return plain;
            });
            res.json(coursesWithRating);
        }
    } catch (error) {
        console.error('Error fetching courses:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Updated: GET course by ID (Keep assignments populate for overview)
router.get('/:id', auth, async (req, res) => {
    try {
        const course = await Course.findById(req.params.id).populate('category topics assignments'); // Keep assignments
        if (!course) return res.status(404).json({ message: 'Course not found' });
        const plainCourse = course.toObject();
        const { average, numRatings } = computeAverageRating(course);
        plainCourse.averageRating = average;
        plainCourse.numRatings = numRatings;
        // Filter active assignments for overview
        const now = new Date();
        plainCourse.activeAssignments = plainCourse.assignments ? plainCourse.assignments.filter(a => new Date(a.dueDate) > now) : [];
        res.json(plainCourse);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// POST - Create course (unchanged)
router.post('/', auth, checkRole(['admin']), upload, async (req, res) => {
    try {
        const { name, description, category, videos: videosJson, resources: resourcesJson } = req.body;
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

        const videoFiles = req.files['videoFiles'] || [];
        let fileIndex = 0;
        const finalVideos = [];

        for (const v of videos) {
            if (v.isFile && fileIndex < videoFiles.length) {
                const file = videoFiles[fileIndex++];
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

        // FIXED: Handle resources - use 'name' field, no isFile, type='url' for external
        let finalResources = [];
        if (resourcesJson) {
            let resources = [];
            try { resources = JSON.parse(resourcesJson); }
            catch (e) { return res.status(400).json({ message: 'Invalid resources JSON' }); }

            const resourceFiles = req.files['resourceFiles'] || [];
            let resIndex = 0;

            for (const r of resources) {
                if (r.isFile && resIndex < resourceFiles.length) {
                    const file = resourceFiles[resIndex++];
                    finalResources.push({
                        name: r.name || `Resource ${resIndex}`,  // FIXED: name instead of topic
                        url: `/uploads/resources/${file.filename}`,
                        type: 'pdf'
                    });
                } else if (!r.isFile && r.url) {
                    finalResources.push({
                        name: r.name || 'External Resource',
                        url: r.url,
                        type: 'url'  // FIXED: 'url' for external
                    });
                }
            }
        }

        const course = new Course({ name, description, category, videos: finalVideos, resources: finalResources });
        await course.save();
        console.log(`Course created with ${finalVideos.length} videos and ${finalResources.length} resources`);
        const plainCourse = course.toObject();
        // UPDATED: Add averageRating and numRatings
        const { average, numRatings } = computeAverageRating(course);
        plainCourse.averageRating = average;
        plainCourse.numRatings = numRatings;
        res.status(201).json({ message: 'Course created successfully', course: plainCourse });
    } catch (error) {
        console.error('Create course error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// PUT - Update course (unchanged)
router.put('/:id', auth, checkRole(['admin']), upload, async (req, res) => {
    try {
        const { name, description, category, videos: videosJson, resources: resourcesJson } = req.body;
        const course = await Course.findById(req.params.id);
        if (!course) return res.status(404).json({ message: 'Course not found' });

        if (name) course.name = name;
        if (description) course.description = description;
        if (category) {
            const cat = await Category.findById(category);
            if (!cat) return res.status(404).json({ message: 'Category not found' });
            course.category = category;
        }

        // Handle videos update
        if (videosJson || (req.files && req.files['videoFiles'] && req.files['videoFiles'].length > 0)) {
            let videos = [];
            if (videosJson) {
                try { videos = JSON.parse(videosJson); }
                catch (e) { return res.status(400).json({ message: 'Invalid videos JSON' }); }
            }

            const videoFiles = req.files['videoFiles'] || [];
            let fileIndex = 0;
            const finalVideos = [];

            for (const v of videos) {
                if (v.isFile && fileIndex < videoFiles.length) {
                    const file = videoFiles[fileIndex++];
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

        // FIXED: Handle resources update - same as POST
        if (resourcesJson || (req.files && req.files['resourceFiles'] && req.files['resourceFiles'].length > 0)) {
            let resources = [];
            if (resourcesJson) {
                try { resources = JSON.parse(resourcesJson); }
                catch (e) { return res.status(400).json({ message: 'Invalid resources JSON' }); }
            }

            const resourceFiles = req.files['resourceFiles'] || [];
            let resIndex = 0;
            const finalResources = [];

            for (const r of resources) {
                if (r.isFile && resIndex < resourceFiles.length) {
                    const file = resourceFiles[resIndex++];
                    finalResources.push({
                        name: r.name || `Resource ${resIndex}`,  // FIXED: name
                        url: `/uploads/resources/${file.filename}`,
                        type: 'pdf'
                    });
                } else if (!r.isFile && r.url) {
                    finalResources.push({
                        name: r.name || 'External Resource',
                        url: r.url,
                        type: 'url'  // FIXED: 'url'
                    });
                }
            }
            course.resources = finalResources;
        }

        await course.save();
        const plainCourse = course.toObject();
        // UPDATED: Add averageRating and numRatings
        const { average, numRatings } = computeAverageRating(course);
        plainCourse.averageRating = average;
        plainCourse.numRatings = numRatings;
        res.json({ message: 'Course updated', course: plainCourse });
    } catch (error) {
        console.error('Update course error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// NEW: Add videos to course (incremental, similar to topics)
router.post('/:id/videos', auth, checkRole(['admin']), uploadVideos, async (req, res) => {
    try {
        const course = await Course.findById(req.params.id);
        if (!course) return res.status(404).json({ message: 'Course not found' });

        const { videos: videosJson } = req.body;
        let videos = [];
        if (videosJson) {
            try {
                videos = JSON.parse(videosJson);
            } catch (e) {
                return res.status(400).json({ message: 'Invalid videos JSON' });
            }
        }

        const videoFiles = req.files || [];
        let fileIndex = 0;
        const newVideos = [];

        for (const v of videos) {
            if (v.isFile && fileIndex < videoFiles.length) {
                const file = videoFiles[fileIndex++];
                newVideos.push({
                    topic: v.topic || `Video ${course.videos.length + newVideos.length + 1}`,
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
                        newVideos.push(...playlistVideos);
                    } else {
                        newVideos.push({
                            topic: v.topic || 'YouTube Video',
                            url: v.url,
                            type: 'single',
                            isFile: false
                        });
                    }
                } catch (playlistError) {
                    console.error('Playlist fallback - storing as playlist:', playlistError.message);
                    newVideos.push({
                        topic: v.topic || 'YouTube Playlist',
                        url: v.url,
                        type: 'playlist',
                        isFile: false
                    });
                }
            }
        }

        if (newVideos.length === 0) {
            return res.status(400).json({ message: 'No valid videos provided' });
        }

        course.videos.push(...newVideos);
        await course.save();

        const plainCourse = course.toObject();
        const { average, numRatings } = computeAverageRating(course);
        plainCourse.averageRating = average;
        plainCourse.numRatings = numRatings;

        res.json({ message: `${newVideos.length} videos added successfully`, videos: newVideos, course: plainCourse });
    } catch (error) {
        console.error('Add videos to course error:', error);
        res.status(500).json({ message: error.message });
    }
});

// UPDATED: Add resources to a specific topic in the course (incremental) - Enforces topic selection (but frontend uses /topics, so this is backup)
router.post('/:id/topics/:topicId/resources', auth, checkRole(['admin']), uploadResources, async (req, res) => {
    try {
        const course = await Course.findById(req.params.id).populate('topics');
        if (!course) return res.status(404).json({ message: 'Course not found' });

        const topic = course.topics.find(t => t._id.toString() === req.params.topicId);
        if (!topic) return res.status(404).json({ message: 'Topic not found in this course' });

        const { resources: resourcesJson } = req.body;
        let resources = [];
        if (resourcesJson) {
            try {
                resources = JSON.parse(resourcesJson);
            } catch (e) {
                return res.status(400).json({ message: 'Invalid resources JSON' });
            }
        }

        const resourceFiles = req.files || [];
        let resIndex = 0;
        const newResources = [];

        for (const r of resources) {
            if (r.isFile && resIndex < resourceFiles.length) {
                const file = resourceFiles[resIndex++];
                newResources.push({
                    name: r.name || `Resource ${topic.resources.length + newResources.length + 1}`,  // FIXED: name
                    url: `/uploads/resources/${file.filename}`,
                    type: 'pdf'
                });
            } else if (!r.isFile && r.url) {
                newResources.push({
                    name: r.name || 'External Resource',
                    url: r.url,
                    type: 'url'  // FIXED: 'url'
                });
            }
        }

        if (newResources.length === 0) {
            return res.status(400).json({ message: 'No valid resources provided' });
        }

        topic.resources.push(...newResources);
        await topic.save();

        const plainCourse = course.toObject();
        const { average, numRatings } = computeAverageRating(course);
        plainCourse.averageRating = average;
        plainCourse.numRatings = numRatings;

        res.json({ 
            message: `${newResources.length} resources added successfully to the selected topic`, 
            resources: newResources, 
            topic: topic.toObject(), 
            course: plainCourse 
        });
    } catch (error) {
        console.error('Add resources to topic error:', error);
        res.status(500).json({ message: error.message });
    }
});

// DELETE - Delete course (Keep cascade for assignments/submissions)
router.delete('/:id', auth, checkRole(['admin']), async (req, res) => {
    try {
        const courseId = req.params.id;

        // CASCADE: Also delete assignments and submissions
        await Assignment.deleteMany({ courseId });
        await Submission.deleteMany({ assignmentId: { $in: await Assignment.distinct('_id', { courseId }) } });

        await Enrollment.deleteMany({ courseId });
        await Favorite.deleteMany({ courseId });

        const course = await Course.findByIdAndDelete(courseId);
        if (!course) return res.status(404).json({ message: 'Course not found' });

        res.json({ message: 'Course deleted successfully (all related data removed)' });
    } catch (error) {
        console.error('Delete course error:', error);
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

// Logout route (assuming this router is mounted at /api/courses, but comment notes URL /api/auth/logout; adjust mounting if needed)
router.post('/logout', auth, async (req, res) => {
    try {
        // Clear token or handle session logout here (e.g., blacklist token if using JWT)
        // For JWT, typically client-side deletion; server-side could add to blacklist
        req.logout?.(); // If using passport, etc.; adjust based on auth setup
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;