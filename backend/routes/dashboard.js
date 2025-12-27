// backend/routes/dashboard.js
const express = require('express');
const router = express.Router();
const { auth, checkRole, isStudent } = require('../middleware/auth');
const Student = require('../models/Student');
const Admin = require('../models/Admin');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const Favorite = require('../models/Favorite');
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
// File ke TOP mein yeh line add karo
const User = require('../models/User'); // <-- Yeh line add karo

// Helper function
function getYouTubeThumbnail(url) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
    return match ? `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg` : 'assets/img/placeholder.jpg';
}

// POST - Enroll in course
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
        progress: 0,
        status: 'active'
        });
        await enrollment.save();
        res.json({ message: 'Enrolled successfully' });
    } catch (error) {
        console.error('Enroll Error:', error.stack);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// // POST - Complete course
// router.post('/student/complete', auth, checkRole(['student']), async (req, res) => {
//     try {
//         const { courseId } = req.body;
//         if (!courseId) return res.status(400).json({ message: 'Course ID required' });

//         const enrollment = await Enrollment.findOne({ studentId: req.user.id, courseId });
//         if (!enrollment) return res.status(404).json({ message: 'Not enrolled' });
//         if (enrollment.status === 'completed') return res.status(400).json({ message: 'Already completed' });

//         enrollment.status = 'completed';
//         enrollment.progress = 100;
//         enrollment.completedAt = new Date();
//         await enrollment.save();
//         res.json({ message: 'Course completed' });
//     } catch (error) {
//         console.error('Complete Course Error:', error.stack);
//         res.status(500).json({ message: 'Server error', error: error.message });
//     }
// });

// GET - Student enrollments
router.get('/student/enrollments', auth, checkRole(['student']), async (req, res) => {
    try {
        const enrollments = await Enrollment.find({ studentId: req.user.id })
            .sort({ enrolledAt: -1 });

        const plainEnrollments = enrollments.map(e => e.toObject({ getters: true, virtuals: false }));
        res.json(plainEnrollments);
    } catch (error) {
        console.error('Error fetching enrollments:', error.stack);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// DELETE - Unenroll from course
router.delete('/student/enrollments/:enrollmentId', auth, checkRole(['student']), async (req, res) => {
    try {
        const { enrollmentId } = req.params;

        const enrollment = await Enrollment.findOne({ 
            _id: enrollmentId, 
            studentId: req.user.id 
        });

        if (!enrollment) {
            return res.status(404).json({ message: 'Enrollment not found or access denied' });
        }

        await Enrollment.deleteOne({ _id: enrollmentId });

        res.json({ message: 'Successfully unenrolled from the course' });
    } catch (error) {
        console.error('Unenroll Error:', error.stack);
        res.status(500).json({ message: 'Server error during unenroll', error: error.message });
    }
});
// POST - Update Video Watch Progress
router.post("/student/video-watched", auth, checkRole(["student"]), async (req, res) => {
    try {
        const { courseId, videoIndex } = req.body;

        if (!courseId) {
            return res.status(400).json({ message: "Course ID is required" });
        }

        const enrollment = await Enrollment.findOne({
            studentId: req.user.id,
            courseId
        });

        if (!enrollment) {
            return res.status(404).json({ message: "Enrollment not found" });
        }

        const course = await Course.findById(courseId).lean();
        if (!course) {
            return res.status(404).json({ message: "Course not found" });
        }

        const totalVideos = course.videos?.length || 0;
        if (totalVideos === 0) {
            return res.status(400).json({ message: "Course has no videos" });
        }

        // Mark video completed only once
        if (!enrollment.videosWatched) enrollment.videosWatched = [];
if (!enrollment.videosWatched.includes(videoIndex)) {
    enrollment.videosWatched.push(videoIndex);
}

const watchedCount = enrollment.videosWatched.length;
        const progress = Math.round((watchedCount / totalVideos) * 100);

        enrollment.progress = progress;

        // Auto complete course if all videos watched
        if (progress >= 100) {
            enrollment.status = "completed";
            enrollment.completedAt = new Date();
        } else {
            enrollment.status = "in-progress";
        }

        await enrollment.save();

        res.json({
            message: "Video progress updated",
            progress,
            completedVideos: watchedCount,
            totalVideos,
            status: enrollment.status
        });
    } catch (error) {
        console.error("Video Watch Error:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});


// GET - Student submissions (last 10)
router.get('/student/submissions', auth, checkRole(['student']), async (req, res) => {
    try {
        const userId = req.user.id;
        const submissions = await Submission.find({ studentId: userId })
            .populate({
                path: 'assignmentId',
                select: 'title dueDate',
                populate: { path: 'courseId', select: 'name' }
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

// GET - Student ke diye hue reviews (Yeh naya route add kiya gaya hai)
router.get('/student/reviews', auth, checkRole(['student']), async (req, res) => {
    try {
        const userId = req.user.id;

        // Courses jin mein is student ne comment/review diya ho
        const courses = await Course.find({
            'comments.studentId': userId
        })
        .select('name comments')
        .lean();

        const myReviews = [];

        courses.forEach(course => {
            course.comments.forEach(comment => {
                if (comment.studentId && comment.studentId.toString() === userId.toString()) {
                    myReviews.push({
                        courseId: course._id,
                        courseName: course.name || 'Unknown Course',
                        rating: comment.rating || 0,
                        review: comment.text || comment.comment || 'No review text',
                        date: comment.createdAt 
                            ? new Date(comment.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                            : 'Unknown Date',
                        rawDate: comment.createdAt || null
                    });
                }
            });
        });

        // Latest reviews pehle dikhao
        myReviews.sort((a, b) => {
            if (!a.rawDate) return 1;
            if (!b.rawDate) return -1;
            return new Date(b.rawDate) - new Date(a.rawDate);
        });

        // rawDate field remove kar do final response mein
        const cleanReviews = myReviews.map(({ rawDate, ...review }) => review);

        res.json(cleanReviews);
    } catch (error) {
        console.error('Student Reviews Fetch Error:', error.stack);
        res.status(500).json({ message: 'Error fetching your reviews', error: error.message });
    }
});

// GET - Student dashboard
// GET - Student dashboard (FULL UPDATED ROUTE)
// GET - Student dashboard (FULL UPDATED - Sends ALL enrolled courses)
router.get('/student/dashboard', auth, isStudent, async (req, res) => {
    try {
        const userId = req.user.id;

        const userEnrollments = await Enrollment.find({ studentId: userId })
            .populate({
                path: 'courseId',
                populate: { path: 'category', select: 'name assignments' }
            })
            .sort({ enrolledAt: -1 })
            .lean();

        const validEnrollments = userEnrollments.filter(e => e.courseId);

        // Total Enrolled (all time)
        const enrolledCourses = validEnrollments.length;

        // Active Courses: non-completed (enrolled + in-progress)
      // Active Courses: non-completed (enrolled + in-progress)
       const activeCourses = validEnrollments.filter(e => e.status !== 'completed').length;
        // Completed Courses
        const completedCourses = validEnrollments.filter(e => e.status === 'completed').length;

        let pendingAssignments = 0;
        validEnrollments.forEach(e => {
            const now = new Date();
            const courseAssigns = e.courseId.assignments || [];
            pendingAssignments += courseAssigns.filter(a => new Date(a.dueDate) > now).length;
        });

        const mySubmissions = await Submission.find({ studentId: userId })
            .populate({
                path: 'assignmentId', 
                select: 'title', 
                populate: { path: 'courseId', select: 'name' } 
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

        // IMPORTANT CHANGE: Send ALL enrolled courses (not just first 3)
        const recentCourseIds = validEnrollments.map(e => e.courseId._id);
        const recentFavorites = await Favorite.find({
            userId,
            courseId: { $in: recentCourseIds }
        }).lean();
        const favoriteCourseIds = new Set(recentFavorites.map(f => f.courseId.toString()));

        const recentCourses = validEnrollments.map(e => {
            const course = e.courseId;
            const firstVideo = course.videos?.[0];
            let image = 'assets/img/course/course-placeholder.jpg';

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

            return {
                id: course._id,
                title: course.name || 'Untitled',
                name: course.name || 'Untitled',
                description: course.description || '',
                image,
                videos: course.videos || [],
                duration: course.duration || 'N/A',
                category: course.category?.name || 'General',
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
            pendingAssignments,
            recentCourses,  // ← Ab yahan SAB enrolled courses hain
            recentSubmissions,
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

// POST - Cleanup invalid enrollments
router.post('/student/cleanup-enrollments', auth, checkRole(['student']), async (req, res) => {
    try {
        const userId = req.user.id;

        let invalid = [];
        try {
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

// GET - Admin dashboard
router.get('/admin/dashboard', auth, checkRole(['admin']), async (req, res) => {
    try {
        console.log('Admin dashboard accessed by user:', req.user.id);
        const totalUsers = await Student.countDocuments() + await Admin.countDocuments();
        const totalStudents = await Student.countDocuments();
        const totalAdmins = await Admin.countDocuments();
        const totalCourses = await Course.countDocuments();
        const totalCategories = (await Course.distinct('category')).length;
        const totalAssignments = await Assignment.countDocuments();
        const pendingSubmissions = await Submission.countDocuments({ evaluated: false });

        let totalEarnings = 0;
        try {
            const aggResult = await Enrollment.aggregate([
                { $lookup: { from: 'courses', localField: 'courseId', foreignField: '_id', as: 'course' } },
                { $unwind: { path: '$course', preserveNullAndEmptyArrays: true } },
                { $match: { 'course.price': { $exists: true, $ne: null } } },
                { $group: { _id: null, total: { $sum: { $toDouble: '$course.price' } } } }
            ]);
            totalEarnings = aggResult[0]?.total || 0;
        } catch (aggError) {
            console.error('Earnings aggregate error:', aggError);
            totalEarnings = 0;
        }

        const activities = await Enrollment.find()
            .populate({ path: 'studentId', select: 'name' })
            .populate('courseId', 'name')
            .sort({ enrolledAt: -1 })
            .limit(3)
            .lean();

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
            totalAssignments,
            pendingSubmissions,
            totalEarnings,
            recentActivities: allActivities
        });
    } catch (error) {
        console.error('Admin Dashboard Error:', error.stack);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;