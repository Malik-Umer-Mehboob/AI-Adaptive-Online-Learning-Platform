// backend/routes/dashboard.js
const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth');
const Student = require('../models/Student');
const Admin = require('../models/Admin');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const Favorite = require('../models/Favorite');

// Helper: YouTube thumbnail
function getYouTubeThumbnail(url) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
    return match ? `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg` : 'assets/img/placeholder.jpg';
}

// POST - Enroll in course (Fixed: Set progress: 0 and status: 'enrolled' explicitly)
router.post('/student/enroll', auth, checkRole(['student']), async (req, res) => {
    try {
        const { courseId } = req.body;
        if (!courseId) return res.status(400).json({ message: 'Course ID required' });

        const course = await Course.findById(courseId);
        if (!course) return res.status(404).json({ message: 'Course not found' });

        const existing = await Enrollment.findOne({ studentId: req.user.id, courseId });
        if (existing) return res.status(400).json({ message: 'Already enrolled' });

        const enrollment = new Enrollment({ 
            studentId: req.user.id, 
            courseId,
            progress: 0,  // Explicitly set to 0 for new enrollments
            status: 'enrolled'  // Default status set to 'enrolled'
        });
        await enrollment.save();
        res.json({ message: 'Enrolled successfully' });
    } catch (error) {
        console.error('Enroll Error:', error.stack);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// POST - Complete course
router.post('/student/complete', auth, checkRole(['student']), async (req, res) => {
    try {
        const { courseId } = req.body;
        if (!courseId) return res.status(400).json({ message: 'Course ID required' });

        const enrollment = await Enrollment.findOne({ studentId: req.user.id, courseId });
        if (!enrollment) return res.status(404).json({ message: 'Not enrolled' });
        if (enrollment.status === 'completed') return res.status(400).json({ message: 'Already completed' });

        enrollment.status = 'completed';
        enrollment.progress = 100;  // Set progress to 100% on complete
        await enrollment.save();
        res.json({ message: 'Course completed' });
    } catch (error) {
        console.error('Complete Course Error:', error.stack);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// GET - Student enrollments (Fixed: No populate, return plain objects with string courseId)
router.get('/student/enrollments', auth, checkRole(['student']), async (req, res) => {
    try {
        const enrollments = await Enrollment.find({ studentId: req.user.id })
            .sort({ enrolledAt: -1 });

        // Convert to plain JS objects to ensure courseId is string
        const plainEnrollments = enrollments.map(e => e.toObject({ getters: true, virtuals: false }));
        res.json(plainEnrollments);
    } catch (error) {
        console.error('Error fetching enrollments:', error.stack);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// GET - Student dashboard (FIXED: valid counts + enriched recentCourses + favorites + quiz defaults)
router.get('/student/dashboard', auth, checkRole(['student']), async (req, res) => {
    try {
        const userId = req.user.id;

        const userEnrollments = await Enrollment.find({ studentId: userId })
            .populate({
                path: 'courseId',
                populate: { path: 'category', select: 'name' }
            })
            .sort({ enrolledAt: -1 })
            .lean();  // Use lean for performance

        // FILTER INVALID (deleted courses)
        const validEnrollments = userEnrollments.filter(e => e.courseId);

        // CORRECT COUNTS (only valid courses)
        const enrolledCourses = validEnrollments.length;
        const activeCourses = validEnrollments.filter(e => e.status !== 'completed').length;
        const completedCourses = validEnrollments.filter(e => e.status === 'completed').length;

        // Fetch favorites for recent 3 courses
        const recentCourseIds = validEnrollments.slice(0, 3).map(e => e.courseId._id);
        const recentFavorites = await Favorite.find({
            userId,
            courseId: { $in: recentCourseIds }
        }).lean();
        const favoriteCourseIds = new Set(recentFavorites.map(f => f.courseId.toString()));

        // ENRICHED recentCourses (exact match with frontend expectations)
        const recentCourses = validEnrollments.slice(0, 3).map(e => {
            const course = e.courseId;
            const firstVideo = course.videos?.[0];
            let image = 'assets/img/placeholder.jpg';

            if (firstVideo) {
                if (firstVideo.isFile) {
                    image = `http://localhost:5000${firstVideo.url}`;
                } else if (firstVideo.url) {
                    image = getYouTubeThumbnail(firstVideo.url);
                }
            }

            // Compute average rating (reuse your computeAverageRating if available, or inline)
            let averageRating = 0;
            let numRatings = 0;
            if (course.comments && course.comments.length > 0) {
                const ratedComments = course.comments.filter(c => c.rating && c.rating > 0);
                numRatings = ratedComments.length;
                if (numRatings > 0) {
                    averageRating = parseFloat((ratedComments.reduce((sum, c) => sum + c.rating, 0) / numRatings).toFixed(1));
                }
            }

            return {
                id: course._id,
                title: course.name || 'Untitled',
                name: course.name || 'Untitled',  // Dual key for compatibility
                description: course.description || '',
                image,
                videos: course.videos || [],
                duration: course.duration || '2h 30m',  // Default if not present
                category: course.category?.name || 'General',
                instructorName: course.instructor?.name || 'Unknown Instructor',
                instructorImage: course.instructor?.profileImage || 'assets/img/default-profile.png',
                progress: e.progress || 0,
                isFavorite: favoriteCourseIds.has(course._id.toString()),
                averageRating,
                numRatings
            };
        });

        res.json({
            enrolledCourses,
            activeCourses,
            completedCourses,
            recentCourses,
            latestQuizzes: [],  // Default empty (add quiz logic if needed)
            quizTitle: 'No Quiz Attempted',
            quizAnswered: '0/0',
            totalQuestions: 0
        });
    } catch (error) {
        console.error('Student Dashboard Error:', error.stack);
        res.status(500).json({ message: 'Error fetching dashboard data.', error: error.message });
    }
});

// POST - Cleanup invalid enrollments (NEW: for old stale data)
router.post('/student/cleanup-enrollments', auth, checkRole(['student']), async (req, res) => {
    try {
        const userId = req.user.id;

        const invalid = await Enrollment.aggregate([
            { $match: { studentId: userId } },
            {
                $lookup: {
                    from: 'courses',
                    localField: 'courseId',
                    foreignField: '_id',
                    as: 'course'
                }
            },
            { $match: { 'course': { $size: 0 } } },
            { $group: { _id: null, ids: { $push: '$_id' }, count: { $sum: 1 } } }
        ]);

        let deleted = 0;
        if (invalid.length > 0 && invalid[0].count > 0) {
            const result = await Enrollment.deleteMany({ _id: { $in: invalid[0].ids } });
            deleted = result.deletedCount;
        }

        res.json({ deleted });
    } catch (error) {
        console.error('Cleanup error:', error);
        res.status(500).json({ message: 'Cleanup failed' });
    }
});

// GET - Admin dashboard
router.get('/admin/dashboard', auth, checkRole(['admin']), async (req, res) => {
    try {
        const totalUsers = await Student.countDocuments() + await Admin.countDocuments();
        const totalStudents = await Student.countDocuments();
        const totalAdmins = await Admin.countDocuments();
        const totalCourses = await Course.countDocuments();
        const totalCategories = (await Course.distinct('category')).length;

        // Earnings (if course has price) - Cleaned without .then
        const aggResult = await Enrollment.aggregate([
            { $lookup: { from: 'courses', localField: 'courseId', foreignField: '_id', as: 'course' } },
            { $unwind: { path: '$course', preserveNullAndEmptyArrays: true } }, // Added preserve to handle missing courses
            { $match: { 'course.price': { $exists: true, $ne: null } } },
            { $group: { _id: null, total: { $sum: { $toDouble: '$course.price' } } } } // $toDouble to ensure number
        ]);
        const totalEarnings = aggResult[0]?.total || 0;

        // Recent activities - Cleaned without .then, filter invalid
        const activities = await Enrollment.find()
            .populate({
                path: 'studentId',
                select: 'name'
            })
            .populate('courseId', 'name')
            .sort({ enrolledAt: -1 })
            .limit(5)
            .lean();

        const recentActivities = activities
            .filter(a => a.studentId && a.courseId) // Skip invalid enrollments
            .map(a => ({
                user: a.studentId.name || 'Unknown',
                role: 'student',
                action: `Enrolled in ${a.courseId.name || 'Unknown'}`,
                date: a.enrolledAt?.toISOString() || new Date().toISOString()
            }));

        res.json({
            totalUsers,
            totalStudents,
            totalAdmins,
            totalCourses,
            totalCategories,
            totalEarnings,
            recentActivities
        });
    } catch (error) {
        console.error('Admin Dashboard Error:', error.stack);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;