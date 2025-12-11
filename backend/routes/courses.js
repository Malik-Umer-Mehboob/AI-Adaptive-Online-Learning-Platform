// routes/courses.js - COMPLETE UPDATED VERSION
const express = require('express');
const router = express.Router();
const { auth, checkRole, isStudent } = require('../middleware/auth');
const mongoose = require('mongoose');
const Course = require('../models/Course');
const Category = require('../models/Category');
const Enrollment = require('../models/Enrollment');
const Favorite = require('../models/Favorite');
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const { google } = require("googleapis");
const multer = require("multer");
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require("path");

// ========== FFMPEG SETUP ==========
const ffmpegPath = 'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe';

console.log('🎬 Setting FFmpeg path...');

if (fs.existsSync(ffmpegPath)) {
    ffmpeg.setFfmpegPath(ffmpegPath);
    console.log('✅ FFmpeg path set successfully!');
    console.log('📍 Path:', ffmpegPath);
} else {
    console.error('❌ FFmpeg not found at:', ffmpegPath);
    console.log('💡 Trying to find FFmpeg in system PATH...');
    
    const { execSync } = require('child_process');
    try {
        const foundPath = execSync('where ffmpeg').toString().trim().split('\n')[0];
        if (foundPath) {
            ffmpeg.setFfmpegPath(foundPath);
            console.log('✅ Found FFmpeg in PATH:', foundPath);
        }
    } catch (err) {
        console.error('❌ FFmpeg not found anywhere');
    }
}

// ========== THUMBNAIL GENERATION ==========
const generateThumbnail = async (videoPath, thumbnailPath) => {
    console.log(`\n🎬 THUMBNAIL GENERATION STARTED`);
    console.log('📹 Input:', path.basename(videoPath));
    console.log('🖼️ Output:', path.basename(thumbnailPath));
    
    if (!fs.existsSync(videoPath)) {
        console.error('❌ Video file not found');
        throw new Error('Video file not found');
    }
    
    try {
        await new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .on('start', (cmd) => console.log('🚀 Command:', cmd))
                .on('end', () => {
                    console.log('✅ FFmpeg process completed');
                    resolve();
                })
                .on('error', (err) => {
                    console.error('❌ FFmpeg error:', err.message);
                    reject(err);
                })
                .screenshots({
                    count: 1,
                    folder: path.dirname(thumbnailPath),
                    filename: path.basename(thumbnailPath),
                    size: '640x480',
                    timemarks: ['00:00:01.000']
                });
        });
        
        if (fs.existsSync(thumbnailPath)) {
            const stats = fs.statSync(thumbnailPath);
            console.log(`✅ Thumbnail created! Size: ${stats.size} bytes`);
            return true;
        } else {
            console.error('❌ Thumbnail file not created');
            return false;
        }
    } catch (error) {
        console.error('❌ Thumbnail generation failed:', error.message);
        return false;
    }
};

// ========== WEB THUMBNAIL ==========
const getWebThumbnail = () => {
    return 'https://cdn.prod.website-files.com/6424a84a1a908839d5724077/674db4b94f6966c47d740174_video-thumbnails-1.webp';
};

// ========== UPLOAD DIRECTORIES ==========
const uploadsDir = path.join(__dirname, '../public/uploads');
const videoDir = path.join(uploadsDir, 'videos');
const resourceDir = path.join(uploadsDir, 'resources');
const thumbnailDir = path.join(uploadsDir, 'thumbnails');

[uploadsDir, videoDir, resourceDir, thumbnailDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created: ${dir}`);
    }
});

// ========== MULTER CONFIGURATIONS ==========
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
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    },
});

const fileFilter = (req, file, cb) => {
    if (file.fieldname === 'videoFiles') {
        const allowedTypes = /mp4|mov|avi|mkv|webm/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) return cb(null, true);
        return cb(new Error('Only video files (mp4, mov, avi, mkv, webm) are allowed!'));
    } else if (file.fieldname === 'resourceFiles') {
        const allowedTypes = /pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) return cb(null, true);
        return cb(new Error('Only PDF files are allowed!'));
    }
    cb(new Error('Invalid file field'));
};

// ========== MULTER MIDDLEWARES ==========
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
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: fileFilter
}).array('resourceFiles', 10);

// ========== HELPER FUNCTIONS ==========
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

function getVideoThumbnail(video) {
    // 1. Agar video mein thumbnail property hai
    if (video && video.thumbnail) {
        if (video.thumbnail.startsWith('/uploads/thumbnails/')) {
            return 'http://localhost:5000' + video.thumbnail;
        }
        if (video.thumbnail.startsWith('http')) {
            return video.thumbnail;
        }
        return 'http://localhost:5000/uploads/thumbnails/' + video.thumbnail;
    }
    
    // 2. YouTube video hai
    const url = video?.url || '';
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        const videoId = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
        if (videoId && videoId[1]) {
            return `https://img.youtube.com/vi/${videoId[1]}/hqdefault.jpg`;
        }
    }
    
    // 3. Default web thumbnail
    return getWebThumbnail();
}

// ========== YOUTUBE ROUTES ==========
const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

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

// ========== WISHLIST/Favorites ROUTES ==========

// 1. POST - Add/Remove favorite
router.post('/:id/favorite', auth, async (req, res) => {
    try {
        const { favorite } = req.body;
        const course = await Course.findById(req.params.id);
        if (!course) return res.status(404).json({ message: 'Course not found' });

        const userId = req.user.id;
        let fav = await Favorite.findOne({ userId, courseId: req.params.id });

        if (favorite === true && !fav) {
            fav = new Favorite({ userId, courseId: req.params.id });
            await fav.save();
            console.log(`✅ Added to favorites: User ${userId}, Course ${req.params.id}`);
        } else if (favorite === false && fav) {
            await Favorite.deleteOne({ _id: fav._id });
            console.log(`❌ Removed from favorites: User ${userId}, Course ${req.params.id}`);
        }

        res.json({ 
            success: true, 
            message: 'Favorite updated successfully',
            isFavorite: favorite 
        });
    } catch (error) {
        console.error('Favorite toggle error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// 2. GET - Get user's favorite courses (WISHLIST)
router.get('/favorites', auth, async (req, res) => {
    try {
        console.log('🔍 Loading favorites for user:', req.user.id);
        
        // Sirf student hi access kar sake
        if (req.user.role !== 'student') {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Pehle saare favorites lao
        const favorites = await Favorite.find({ 
            userId: req.user.id 
        }).select('courseId').lean();

        console.log('📦 Raw favorites found:', favorites.length);

        if (!favorites || favorites.length === 0) {
            return res.json({ 
                success: true, 
                favorites: [], 
                message: 'No favorite courses found',
                count: 0 
            });
        }

        // Valid ObjectId filter karo
        const validCourseIds = favorites
            .map(f => f.courseId)
            .filter(id => id && mongoose.Types.ObjectId.isValid(id))
            .map(id => new mongoose.Types.ObjectId(id));

        console.log('✅ Valid course IDs:', validCourseIds.length);

        if (validCourseIds.length === 0) {
            return res.json({ 
                success: true, 
                favorites: [], 
                message: 'No valid course IDs found',
                count: 0 
            });
        }

        // Ab sirf valid IDs se courses lao
        const courses = await Course.find({ 
            _id: { $in: validCourseIds } 
        })
        .populate('category', 'name')
        .select('name description category videos duration instructor ratings comments')
        .sort({ createdAt: -1 })
        .lean();

        console.log('📚 Courses found:', courses.length);

        // Enhanced courses with thumbnail and rating
        const enhancedCourses = courses.map(course => {
            const plain = course;
            
            // Get thumbnail from first video
            let thumbnail = '';
            if (course.videos && course.videos.length > 0) {
                const firstVideo = course.videos[0];
                thumbnail = getVideoThumbnail(firstVideo);
            }
            
            // Add thumbnail to course object
            plain.thumbnail = thumbnail;
            
            // Add isFavorite flag
            plain.isFavorite = true;
            
            // Calculate rating
            const { average, numRatings } = computeAverageRating(course);
            plain.averageRating = average;
            plain.numRatings = numRatings;
            
            return plain;
        });

        res.json({ 
            success: true, 
            favorites: enhancedCourses, 
            count: enhancedCourses.length,
            userId: req.user.id
        });

    } catch (error) {
        console.error('❌ FATAL ERROR in /api/courses/favorites:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error while loading wishlist',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal error'
        });
    }
});

// 3. GET - Get favorite count (for badges)
router.get('/favorites/count', auth, async (req, res) => {
    try {
        const count = await Favorite.countDocuments({ userId: req.user.id });
        res.json({ success: true, count });
    } catch (error) {
        console.error('Count error:', error);
        res.status(500).json({ success: false, count: 0 });
    }
});

// 4. GET - Check if course is favorite
router.get('/:id/is-favorite', auth, async (req, res) => {
    try {
        const favorite = await Favorite.findOne({ 
            userId: req.user.id, 
            courseId: req.params.id 
        });
        
        res.json({ 
            success: true, 
            isFavorite: !!favorite 
        });
    } catch (error) {
        console.error('Check favorite error:', error);
        res.status(500).json({ 
            success: false, 
            isFavorite: false 
        });
    }
});

// 5. Debug endpoint for testing
router.get('/wishlist-debug', auth, async (req, res) => {
    try {
        console.log('🔍 Wishlist debug called for user:', req.user.id);
        
        const favorites = await Favorite.find({ userId: req.user.id }).lean();
        const count = await Favorite.countDocuments({ userId: req.user.id });
        
        res.json({
            success: true,
            userId: req.user.id,
            favoritesCount: count,
            favorites: favorites,
            message: 'Debug endpoint working',
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Wishlist debug error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Debug error',
            error: error.message 
        });
    }
});

// ========== COURSE ROUTES ==========

// GET all courses with favorite status
router.get('/', auth, async (req, res) => {
    try {
        const search = req.query.search?.trim() || '';
        const category = req.query.category || '';
        let query = {};

        if (search) query.name = { $regex: search, $options: 'i' };
        if (category) query.category = category;

        if (req.query.ids) {
            const idList = req.query.ids.split(',').map(id => id.trim()).filter(id => id && /^[0-9a-fA-F]{24}$/.test(id));
            if (idList.length > 0) {
                query._id = { $in: idList.map(id => new mongoose.Types.ObjectId(id)) };
            } else {
                return res.json([]);
            }
            const courses = await Course.find(query).populate('category assignments');
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
                .populate('category assignments')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);

            // Get enrolled courses
            const enrolledCourseIds = await Enrollment.find({ studentId: req.user.id })
                .distinct('courseId')
                .then(ids => ids.map(id => id.toString()));

            // Get favorite courses
            const favoriteCourseIds = await Favorite.find({ userId: req.user.id })
                .distinct('courseId')
                .then(ids => ids.map(id => id.toString()));

            const coursesWithStatus = courses.map(course => {
                const plain = course.toObject();
                plain.isEnrolled = enrolledCourseIds.includes(plain._id.toString());
                plain.isFavorite = favoriteCourseIds.includes(plain._id.toString());
                
                const { average, numRatings } = computeAverageRating(course);
                plain.averageRating = average;
                plain.numRatings = numRatings;
                
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
                .populate('category assignments')
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

// GET course by ID with favorite status
router.get('/:id', auth, async (req, res) => {
    try {
        const course = await Course.findById(req.params.id)
            .populate('category topics assignments');
        
        if (!course) return res.status(404).json({ message: 'Course not found' });
        
        const plainCourse = course.toObject();
        const { average, numRatings } = computeAverageRating(course);
        plainCourse.averageRating = average;
        plainCourse.numRatings = numRatings;
        
        // Check if user has favorited this course
        if (req.user.role === 'student') {
            const favorite = await Favorite.findOne({ 
                userId: req.user.id, 
                courseId: req.params.id 
            });
            plainCourse.isFavorite = !!favorite;
        }
        
        const now = new Date();
        plainCourse.activeAssignments = plainCourse.assignments ? 
            plainCourse.assignments.filter(a => new Date(a.dueDate) > now) : [];
        
        res.json(plainCourse);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// POST - Create course (with web thumbnail)
router.post('/', auth, checkRole(['admin']), upload, async (req, res) => {
    try {
        const { name, description, category, videos: videosJson, resources: resourcesJson } = req.body;
        
        console.log('📝 Creating course:', name);
        
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

        console.log(`📦 Processing ${videos.length} video entries...`);

        const WEB_THUMBNAIL = getWebThumbnail();

        for (const v of videos) {
            if (v.isFile && fileIndex < videoFiles.length) {
                const file = videoFiles[fileIndex++];
                const videoUrl = `/uploads/videos/${file.filename}`;
                
                console.log(`🎬 Processing: ${file.originalname}`);

                const finalThumb = WEB_THUMBNAIL;
                console.log(`✅ Using web thumbnail: ${finalThumb}`);

                finalVideos.push({
                    topic: v.topic || `Video ${fileIndex}`,
                    url: videoUrl,
                    thumbnail: finalThumb,
                    type: 'single',
                    isFile: true,
                    createdAt: new Date()
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
                        let youtubeThumb = WEB_THUMBNAIL;
                        
                        if (v.url.includes('youtube.com') || v.url.includes('youtu.be')) {
                            const videoId = v.url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
                            if (videoId && videoId[1]) {
                                youtubeThumb = `https://img.youtube.com/vi/${videoId[1]}/hqdefault.jpg`;
                            }
                        }
                        
                        finalVideos.push({
                            topic: v.topic || 'YouTube Video',
                            url: v.url,
                            thumbnail: youtubeThumb,
                            type: 'single',
                            isFile: false,
                            createdAt: new Date()
                        });
                    }
                } catch (playlistError) {
                    console.error('Playlist error:', playlistError.message);
                    finalVideos.push({
                        topic: v.topic || 'YouTube Playlist',
                        url: v.url,
                        thumbnail: WEB_THUMBNAIL,
                        type: 'playlist',
                        isFile: false,
                        createdAt: new Date()
                    });
                }
            }
        }

        if (finalVideos.length === 0) {
            return res.status(400).json({ message: 'At least one video is required.' });
        }

        // Handle resources
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
                        name: r.name || `Resource ${resIndex}`,
                        url: `/uploads/resources/${file.filename}`,
                        type: 'pdf'
                    });
                } else if (!r.isFile && r.url) {
                    finalResources.push({
                        name: r.name || 'External Resource',
                        url: r.url,
                        type: 'url'
                    });
                }
            }
        }

        // Create course
        const course = new Course({ 
            name, 
            description, 
            category, 
            videos: finalVideos, 
            resources: finalResources 
        });
        
        await course.save();
        
        console.log(`✅ Course created: ${course._id} with ${finalVideos.length} videos`);
        
        const plainCourse = course.toObject();
        const { average, numRatings } = computeAverageRating(course);
        plainCourse.averageRating = average;
        plainCourse.numRatings = numRatings;
        
        res.status(201).json({ 
            message: 'Course created successfully', 
            course: plainCourse 
        });
    } catch (error) {
        console.error('❌ Create course error:', error);
        res.status(500).json({ 
            message: 'Server error', 
            error: error.message 
        });
    }
});

// PUT - Update course
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

        const WEB_THUMBNAIL = getWebThumbnail();

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
                    const videoUrl = `/uploads/videos/${file.filename}`;
                    
                    const finalThumb = WEB_THUMBNAIL;
                    
                    console.log(`✅ Video updated with web thumbnail: ${file.originalname}`);
                    
                    finalVideos.push({
                        topic: v.topic || `Video ${fileIndex}`,
                        url: videoUrl,
                        thumbnail: finalThumb,
                        type: 'single',
                        isFile: true
                    });
                    
                } else if (!v.isFile && v.url) {
                    let youtubeThumb = WEB_THUMBNAIL;
                    
                    if (v.url.includes('youtube.com') || v.url.includes('youtu.be')) {
                        const videoId = v.url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
                        if (videoId && videoId[1]) {
                            youtubeThumb = `https://img.youtube.com/vi/${videoId[1]}/hqdefault.jpg`;
                        }
                    }
                    
                    finalVideos.push({
                        topic: v.topic || 'YouTube Video',
                        url: v.url,
                        thumbnail: youtubeThumb,
                        type: 'single',
                        isFile: false
                    });
                }
            }
            
            if (finalVideos.length > 0) {
                course.videos = finalVideos;
            }
        }

        await course.save();
        
        console.log(`✅ Course updated: ${course._id}`);
        
        const plainCourse = course.toObject();
        const { average, numRatings } = computeAverageRating(course);
        plainCourse.averageRating = average;
        plainCourse.numRatings = numRatings;
        
        res.json({ 
            message: 'Course updated successfully', 
            course: plainCourse 
        });
    } catch (error) {
        console.error('❌ Update course error:', error);
        res.status(500).json({ 
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// POST - Add videos to course
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

        const WEB_THUMBNAIL = getWebThumbnail();

        for (const v of videos) {
            if (v.isFile && fileIndex < videoFiles.length) {
                const file = videoFiles[fileIndex++];
                const videoUrl = `/uploads/videos/${file.filename}`;
                
                newVideos.push({
                    topic: v.topic || `Video ${course.videos.length + newVideos.length + 1}`,
                    url: videoUrl,
                    thumbnail: WEB_THUMBNAIL,
                    type: 'single',
                    isFile: true
                });
            } else if (!v.isFile && v.url) {
                let youtubeThumb = WEB_THUMBNAIL;
                
                if (v.url.includes('youtube.com') || v.url.includes('youtu.be')) {
                    const videoId = v.url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
                    if (videoId && videoId[1]) {
                        youtubeThumb = `https://img.youtube.com/vi/${videoId[1]}/hqdefault.jpg`;
                    }
                }
                
                newVideos.push({
                    topic: v.topic || 'YouTube Video',
                    url: v.url,
                    thumbnail: youtubeThumb,
                    type: 'single',
                    isFile: false
                });
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

        res.json({ 
            message: `${newVideos.length} videos added successfully`, 
            videos: newVideos, 
            course: plainCourse 
        });
    } catch (error) {
        console.error('Add videos to course error:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST - Add resources to topic
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
                    name: r.name || `Resource ${topic.resources.length + newResources.length + 1}`,
                    url: `/uploads/resources/${file.filename}`,
                    type: 'pdf'
                });
            } else if (!r.isFile && r.url) {
                newResources.push({
                    name: r.name || 'External Resource',
                    url: r.url,
                    type: 'url'
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
            message: `${newResources.length} resources added successfully`, 
            resources: newResources, 
            topic: topic.toObject(), 
            course: plainCourse 
        });
    } catch (error) {
        console.error('Add resources to topic error:', error);
        res.status(500).json({ message: error.message });
    }
});

// DELETE - Delete course
router.delete('/:id', auth, checkRole(['admin']), async (req, res) => {
    try {
        const courseId = req.params.id;

        // Delete related data
        await Assignment.deleteMany({ courseId });
        await Enrollment.deleteMany({ courseId });
        await Favorite.deleteMany({ courseId });

        const course = await Course.findByIdAndDelete(courseId);
        if (!course) return res.status(404).json({ message: 'Course not found' });

        res.json({ message: 'Course deleted successfully' });
    } catch (error) {
        console.error('Delete course error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// ========== COMMENTS/FEEDBACK ROUTES ==========
router.get('/:id/comments', auth, async (req, res) => {
    try {
        const course = await Course.findById(req.params.id).select('comments');
        if (!course) return res.status(404).json({ msg: 'Course not found' });
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
        if (!course) return res.status(404).json({ msg: 'Course not found' });
        
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
        if (!course) return res.status(404).json({ msg: 'Course not found' });
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
        if (!course) return res.status(404).json({ msg: 'Course not found' });
        
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

// Logout route
router.post('/logout', auth, async (req, res) => {
    try {
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;