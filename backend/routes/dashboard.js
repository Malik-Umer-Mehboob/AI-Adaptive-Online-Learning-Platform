// backend/routes/dashboard.js - FIXED: Import with correct spelling, aggregate safe
const express = require('express');
const router = express.Router();
const { auth, checkRole, isStudent } = require('../middleware/auth'); // Updated with isStudent
const Student = require('../models/Student');
const Admin = require('../models/Admin');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment'); // FIXED: Single 'l' - matches renamed file
const Favorite = require('../models/Favorite');
const Assignment = require('../models/Assignment'); // New
const Submission = require('../models/Submission'); // New

// Existing helper (unchanged)
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
        enrollment.completedAt = new Date(); // Add completed date
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

// NEW ROUTE: GET /student/submissions - For frontend loadSubmissions() (last 10 submissions with details)
router.get('/student/submissions', auth, checkRole(['student']), async (req, res) => {
    try {
        const userId = req.user.id;
        const submissions = await Submission.find({ studentId: userId })
            .populate({
                path: 'assignmentId',
                select: 'title dueDate',
                populate: { 
                    path: 'courseId', 
                    select: 'name' 
                }
            })
            .sort({ submittedAt: -1 })
            .limit(10)
            .lean();

        const formattedSubs = submissions.map(s => ({
            _id: s._id,
            assignmentTitle: s.assignmentId?.title || 'Untitled Assignment',
            courseName: s.assignmentId?.courseId?.name || 'Unknown Course',
            submittedAt: s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : 'Unknown Date',
            score: s.evaluation?.score ? `${s.evaluation.score}/100` : 'Pending Evaluation',
            feedback: s.evaluation?.feedback || 'No feedback yet.',
            evaluated: s.evaluated || false
        }));

        res.json(formattedSubs);
    } catch (error) {
        console.error('Student Submissions Error:', error.stack);
        res.status(500).json({ message: 'Error loading submissions', error: error.message });
    }
});

// GET - Student dashboard (FIXED: Added auth before isStudent + better populate for submissions)
router.get('/student/dashboard', auth, isStudent, async (req, res) => {  // Added auth here
    try {
        const userId = req.user.id;

        const userEnrollments = await Enrollment.find({ studentId: userId })
            .populate({
                path: 'courseId',
                populate: { path: 'category', select: 'name assignments' } // New: assignments in populate
            })
            .sort({ enrolledAt: -1 })
            .lean();

        const validEnrollments = userEnrollments.filter(e => e.courseId);

        const enrolledCourses = validEnrollments.length;
        const activeCourses = validEnrollments.filter(e => e.status !== 'completed').length;
        const completedCourses = validEnrollments.filter(e => e.status === 'completed').length;

        // New: Pending assignments count
        let pendingAssignments = 0;
        validEnrollments.forEach(e => {
            const now = new Date();
            const courseAssigns = e.courseId.assignments || [];
            pendingAssignments += courseAssigns.filter(a => new Date(a.dueDate) > now).length;
        });

        // New: My recent submissions (last 5) - Better populate
        const mySubmissions = await Submission.find({ studentId: userId })
            .populate({
                path: 'assignmentId', 
                select: 'title', 
                populate: { 
                    path: 'courseId', 
                    select: 'name' 
                }
            })
            .sort({ submittedAt: -1 })
            .limit(5)
            .lean();
        const recentSubmissions = mySubmissions.map(s => ({
            title: s.assignmentId?.title || 'Unknown',
            course: s.assignmentId?.courseId?.name || 'Unknown',
            score: s.evaluation?.score ? `${s.evaluation.score}/100` : 'Pending',
            feedback: s.evaluation?.feedback || '',
            submittedAt: s.submittedAt ? new Date(s.submittedAt).toISOString() : new Date().toISOString()
        }));

        // Existing recent courses (updated with assignments info)
        const recentCourseIds = validEnrollments.slice(0, 3).map(e => e.courseId._id);
        const recentFavorites = await Favorite.find({
            userId,
            courseId: { $in: recentCourseIds }
        }).lean();
        const favoriteCourseIds = new Set(recentFavorites.map(f => f.courseId.toString()));

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

            let averageRating = 0;
            let numRatings = 0;
            if (course.comments && course.comments.length > 0) {
                const ratedComments = course.comments.filter(c => c.rating && c.rating > 0);
                numRatings = ratedComments.length;
                if (numRatings > 0) {
                    averageRating = parseFloat((ratedComments.reduce((sum, c) => sum + c.rating, 0) / numRatings).toFixed(1));
                }
            }

            // New: Active assignments count for this course
            const now = new Date();
            const activeAssigns = course.assignments ? course.assignments.filter(a => new Date(a.dueDate) > now) : 0;

            return {
                id: course._id,
                title: course.name || 'Untitled',
                name: course.name || 'Untitled',
                description: course.description || '',
                image,
                videos: course.videos || [],
                duration: course.duration || '2h 30m',
                category: course.category?.name || 'General',
                instructorName: course.instructor?.name || 'Unknown Instructor',
                instructorImage: course.instructor?.profileImage || 'assets/img/default-profile.png',
                progress: e.progress || 0,
                isFavorite: favoriteCourseIds.has(course._id.toString()),
                averageRating,
                numRatings,
                activeAssignments: activeAssigns.length // New
            };
        });

        res.json({
            enrolledCourses,
            activeCourses,
            completedCourses,
            pendingAssignments, // New
            recentCourses,
            recentSubmissions, // New
            latestQuizzes: [],
            quizTitle: 'No Quiz Attempted',
            quizAnswered: '0/0',
            totalQuestions: 0
        });
    } catch (error) {
        console.error('Student Dashboard Error:', error.stack);
        res.status(500).json({ message: 'Error fetching dashboard data.', error: error.message });
    }
});

// POST - Cleanup invalid enrollments (NEW: for old stale data) - FIXED: Aggregate wrapped in try-catch
router.post('/student/cleanup-enrollments', auth, checkRole(['student']), async (req, res) => {
    try {
        const userId = req.user.id;

        let invalid = [];
        try {
            // FIXED: Aggregate with error handling
            invalid = await Enrollment.aggregate([
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
        } catch (aggError) {
            console.error('Aggregate error in cleanup:', aggError);
            return res.status(500).json({ message: 'Cleanup aggregate failed', error: aggError.message });
        }

        let deleted = 0;
        if (invalid.length > 0 && invalid[0]?.count > 0 && invalid[0].ids.length > 0) {
            const result = await Enrollment.deleteMany({ _id: { $in: invalid[0].ids } });
            deleted = result.deletedCount;
        }

        res.json({ deleted });
    } catch (error) {
        console.error('Cleanup error:', error.stack);
        res.status(500).json({ message: 'Cleanup failed', error: error.message });
    }
});

// GET - Admin dashboard (unchanged, but added console for debug + FIXED: Aggregate safe)
router.get('/admin/dashboard', auth, checkRole(['admin']), async (req, res) => {
    try {
        console.log('Admin dashboard accessed by user:', req.user.id); // Debug log
        const totalUsers = await Student.countDocuments() + await Admin.countDocuments();
        const totalStudents = await Student.countDocuments();
        const totalAdmins = await Admin.countDocuments();
        const totalCourses = await Course.countDocuments();
        const totalCategories = (await Course.distinct('category')).length;
        const totalAssignments = await Assignment.countDocuments(); // New

        // New: Pending submissions (unevaluated)
        const pendingSubmissions = await Submission.countDocuments({ evaluated: false });

        let totalEarnings = 0;
        try {
            // FIXED: Aggregate with error handling
            const aggResult = await Enrollment.aggregate([
                { $lookup: { from: 'courses', localField: 'courseId', foreignField: '_id', as: 'course' } },
                { $unwind: { path: '$course', preserveNullAndEmptyArrays: true } },
                { $match: { 'course.price': { $exists: true, $ne: null } } },
                { $group: { _id: null, total: { $sum: { $toDouble: '$course.price' } } } }
            ]);
            totalEarnings = aggResult[0]?.total || 0;
        } catch (aggError) {
            console.error('Earnings aggregate error:', aggError);
            totalEarnings = 0; // Fallback
        }

        // Updated: Recent activities (Added assignment submissions)
        const activities = await Enrollment.find()
            .populate({
                path: 'studentId',
                select: 'name'
            })
            .populate('courseId', 'name')
            .sort({ enrolledAt: -1 })
            .limit(3)
            .lean();

        // New: Recent submissions as activities
        const recentSubs = await Submission.find()
            .populate('studentId', 'name')
            .populate({ path: 'assignmentId', populate: { path: 'courseId', select: 'name' } })
            .sort({ submittedAt: -1 })
            .limit(2)
            .lean();

        const allActivities = [
            ...activities.map(a => ({
                user: a.studentId?.name || 'Unknown',
                role: 'student',
                action: `Enrolled in ${a.courseId?.name || 'Unknown'}`,
                date: a.enrolledAt?.toISOString() || new Date().toISOString()
            })),
            ...recentSubs.map(s => ({
                user: s.studentId?.name || 'Unknown',
                role: 'student',
                action: `Submitted assignment for ${s.assignmentId?.courseId?.name || 'Unknown'}`,
                date: s.submittedAt?.toISOString() || new Date().toISOString()
            }))
        ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

        res.json({
            totalUsers,
            totalStudents,
            totalAdmins,
            totalCourses,
            totalCategories,
            totalAssignments, // New
            pendingSubmissions, // New
            totalEarnings,
            recentActivities: allActivities
        });
    } catch (error) {
        console.error('Admin Dashboard Error:', error.stack);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;