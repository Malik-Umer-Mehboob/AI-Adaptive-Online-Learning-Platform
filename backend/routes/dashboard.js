// backend/routes/dashboard.js
const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth');
const Student = require('../models/Student');
const Admin = require('../models/Admin');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');

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

// GET - Student dashboard
router.get('/student/dashboard', auth, checkRole(['student']), async (req, res) => {
    try {
        const userId = req.user.id;

        const userEnrollments = await Enrollment.find({ studentId: userId })
            .populate({
                path: 'courseId',
                populate: { path: 'category', select: 'name' }
            })
            .sort({ enrolledAt: -1 });

        const enrolledCourses = userEnrollments.length;
        const activeCourses = userEnrollments.filter(e => e.status !== 'completed').length;
        const completedCourses = userEnrollments.filter(e => e.status === 'completed').length;

        // Fix: Filter out invalid enrollments where courseId is null/undefined before mapping
        const validEnrollments = userEnrollments.filter(e => e.courseId);
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

            return {
                id: course._id,
                title: course.name || 'Untitled',
                image,
                category: course.category?.name || 'Uncategorized',
                instructorName: course.instructor?.name || 'Unknown',  // Added if needed
                instructorImage: course.instructor?.profileImage || 'assets/img/default-profile.png'
            };
        });

        res.json({
            enrolledCourses,
            activeCourses,
            completedCourses,
            recentCourses
        });
    } catch (error) {
        console.error('Student Dashboard Error:', error.stack);
        res.status(500).json({ message: 'Error fetching dashboard data.', error: error.message });
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