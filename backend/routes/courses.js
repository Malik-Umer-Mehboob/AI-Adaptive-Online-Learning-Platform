const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth');
const mongoose = require('mongoose');
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
        const uploadPath = path.join(__dirname, '../public/uploads/videos');
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

// Helper: Fetch playlist videos
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

// UPDATED: Helper: Compute average rating from comments (now returns { average, numRatings })
function computeAverageRating(course) {
    if (!course.comments || course.comments.length === 0) return { average: 0, numRatings: 0 };
    const ratedComments = course.comments.filter(c => c.rating && c.rating > 0);
    const numRatings = ratedComments.length;
    if (numRatings === 0) return { average: 0, numRatings: 0 };
    const average = ratedComments.reduce((sum, c) => sum + c.rating, 0) / numRatings;
    return { average: parseFloat(average.toFixed(1)), numRatings };
}

// POST /youtube/fetch-playlist - Route for frontend to fetch playlist videos
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

// GET /:id/comments - Fetch comments for a course
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

// POST /:id/comments - Add a new comment to course (updated to include rating)
router.post('/:id/comments', auth, async (req, res) => {
  const { name, email, subject, comment, rating } = req.body;

  // Basic validation
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

    course.comments.unshift(newComment); // Add to beginning for latest first
    await course.save();

    res.json(newComment);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// GET /:id/feedback - Fetch feedbacks for a course (kept for compatibility, but not used)
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

// POST /:id/feedback - Add a new feedback to course (kept for compatibility, but not used)
router.post('/:id/feedback', auth, async (req, res) => {
  const { rating, comment, videoId, isCourse } = req.body;

  // Basic validation
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

    course.feedbacks.unshift(newFeedback); // Add to beginning for latest first
    await course.save();

    res.json(newFeedback);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// GET all courses (UPDATED: Now includes averageRating and numRatings)
router.get('/', auth, async (req, res) => {
    try {
        const search = req.query.search?.trim() || '';
        const category = req.query.category || '';
        let query = {};

        if (search) query.name = { $regex: search, $options: 'i' };
        if (category) query.category = category;

        // Bulk fetch support for multiple IDs (no pagination)
        if (req.query.ids) {
            const idList = req.query.ids.split(',').map(id => id.trim()).filter(id => id && id.length === 24 && /^[0-9a-fA-F]{24}$/.test(id));
            if (idList.length > 0) {
                const objectIds = idList.map(id => new mongoose.Types.ObjectId(id));
                query._id = { $in: objectIds };
            } else {
                return res.json([]); // No valid IDs, return empty array
            }
            const courses = await Course.find(query)
                .populate('category')  // Removed 'instructor' as it's not in schema
                .sort({ createdAt: -1 });
            // UPDATED: Add averageRating and numRatings to each course
            const coursesWithRating = courses.map(course => {
                const plain = course.toObject();
                const { average, numRatings } = computeAverageRating(course);
                plain.averageRating = average;
                plain.numRatings = numRatings;
                return plain;
            });
            return res.json(coursesWithRating); // Return array directly
        }

        if (req.user.role === 'student') {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 9;
            const skip = (page - 1) * limit;

            const totalCourses = await Course.countDocuments(query);
            const courses = await Course.find(query)
                .populate('category')  // Removed 'instructor'
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);

            const enrolledCourseIds = await Enrollment.find({ studentId: req.user.id })
                .distinct('courseId')
                .then(ids => ids.map(id => id.toString()));

            // UPDATED: Add averageRating and numRatings to each course
            const coursesWithStatus = courses.map(course => {
                const plain = course.toObject();
                plain.isEnrolled = enrolledCourseIds.includes(plain._id.toString());
                const { average, numRatings } = computeAverageRating(course);
                plain.averageRating = average;
                plain.numRatings = numRatings;
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
                .populate('category')  // Removed 'instructor'
                .sort({ createdAt: -1 });
            // UPDATED: Add averageRating and numRatings to each course
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

// GET course by ID (UPDATED: Now includes averageRating and numRatings)
router.get('/:id', auth, async (req, res) => {
    try {
        const course = await Course.findById(req.params.id).populate('category');  // Removed 'instructor'
        if (!course) return res.status(404).json({ message: 'Course not found' });
        const plainCourse = course.toObject();
        // UPDATED: Add averageRating and numRatings
        const { average, numRatings } = computeAverageRating(course);
        plainCourse.averageRating = average;
        plainCourse.numRatings = numRatings;
        res.json(plainCourse);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// POST - Create course (UPDATED: Now includes averageRating and numRatings in response)
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

// PUT - Update course (UPDATED: Now includes averageRating and numRatings in response)
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