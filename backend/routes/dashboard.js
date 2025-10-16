const express = require('express');
const router = express.Router();
const { authenticateToken, checkRole } = require('../middleware/auth');
const Student = require('../models/Student');
const Admin = require('../models/Admin');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');

// Enroll course route
router.post('/student/enroll', authenticateToken, checkRole(['student']), async (req, res) => {
    try {
        const { courseId } = req.body;
        if (!courseId) return res.status(400).json({ message: 'Course ID required' });

        // Check if course exists
        const course = await Course.findById(courseId);
        if (!course) return res.status(404).json({ message: 'Course not found' });

        // Check if already enrolled
        const existing = await Enrollment.findOne({ userId: req.user.id, courseId });
        if (existing) return res.status(400).json({ message: 'Already enrolled' });

        const enrollment = new Enrollment({ userId: req.user.id, courseId });
        await enrollment.save();
        res.json({ message: 'Enrolled successfully' });
    } catch (error) {
        console.error('Enroll Error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Complete course route
router.post('/student/complete', authenticateToken, checkRole(['student']), async (req, res) => {
    try {
        const { courseId } = req.body;
        if (!courseId) return res.status(400).json({ message: 'Course ID required' });

        const enrollment = await Enrollment.findOne({ userId: req.user.id, courseId });
        if (!enrollment) return res.status(404).json({ message: 'Not enrolled' });
        if (enrollment.status === 'completed') return res.status(400).json({ message: 'Already completed' });

        enrollment.status = 'completed';
        await enrollment.save();
        res.json({ message: 'Course completed' });
    } catch (error) {
        console.error('Complete Course Error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Student Dashboard (fully dynamic from DB)
router.get('/student/dashboard', authenticateToken, checkRole(['student']), async (req, res) => {
    try {
        const userId = req.user.id;

        // Enrollments
        const userEnrollments = await Enrollment.find({ userId }).populate('courseId');
        const enrolledCourses = userEnrollments.length;
        const activeCourses = userEnrollments.filter(e => e.status === 'active').length;
        const completedCourses = userEnrollments.filter(e => e.status === 'completed').length;

        // Recent courses (latest 3, sorted by enrolledAt)
        const recentCourses = userEnrollments
            .sort((a, b) => new Date(b.enrolledAt) - new Date(a.enrolledAt))
            .slice(0, 3)
            .map(e => {
                const course = e.courseId;
                return {
                    id: course._id,
                    title: course.title,
                    image: course.image,
                    instructorName: course.instructorName,
                    instructorImage: course.instructorImage,
                    category: course.category,
                    price: course.price,
                    rating: course.rating,
                    reviews: course.reviews,
                    discount: course.discount
                };
            });

        res.json({
            enrolledCourses,
            activeCourses,
            completedCourses,
            recentCourses
        });
    } catch (error) {
        console.error('Student Dashboard Error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Admin Dashboard (dynamic from DB)
router.get('/admin/dashboard', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const totalUsers = await Student.countDocuments() + await Admin.countDocuments();
        const totalStudents = await Student.countDocuments();
        const totalAdmins = await Admin.countDocuments();
        const totalCourses = await Course.countDocuments();
        const totalCategories = (await Course.distinct('category')).length;
        const totalEarnings = await Enrollment.aggregate([
            { $lookup: { from: 'courses', localField: 'courseId', foreignField: '_id', as: 'course' } },
            { $unwind: '$course' },
            { $group: { _id: null, total: { $sum: '$course.price' } } }
        ]).then(result => result[0]?.total || 0);

        // Recent activities (latest 5 enrollments)
        const recentActivities = await Enrollment.find()
            .populate('userId', 'name role')
            .populate('courseId', 'title')
            .sort({ enrolledAt: -1 })
            .limit(5)
            .lean()
            .then(activities => activities.map(a => ({
                user: a.userId?.name || 'Unknown',
                role: a.userId?.role || 'Unknown',
                action: `Enrolled in ${a.courseId?.title || 'Unknown'}`,
                date: a.enrolledAt?.toISOString() || new Date().toISOString()
            })));

        res.json({
            totalUsers,
            totalStudents,
            totalCourses,
            totalCategories,
            recentActivities
        });
    } catch (error) {
        console.error('Admin Dashboard Error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;