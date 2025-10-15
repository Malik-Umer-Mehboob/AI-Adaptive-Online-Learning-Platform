const express = require('express');
const router = express.Router();
const { authenticateToken, checkRole } = require('../middleware/auth');
const { Course, Quiz, Enrollment, QuizAttempt } = require('../models'); // Models path adjust karo

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
        res.status(500).json({ message: 'Server error' });
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
        res.status(500).json({ message: 'Server error' });
    }
});

// Submit quiz route
router.post('/student/quiz', authenticateToken, checkRole(['student']), async (req, res) => {
    try {
        const { quizId, correct, total } = req.body;
        if (!quizId || correct === undefined || total === undefined) return res.status(400).json({ message: 'Missing fields' });

        // Check if quiz exists
        const quiz = await Quiz.findById(quizId);
        if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

        const attempt = new QuizAttempt({ userId: req.user.id, quizId, correct, total });
        await attempt.save();
        res.json({ message: 'Quiz submitted' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
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

        // Quiz attempts
        const userQuizzes = await QuizAttempt.find({ userId }).populate('quizId').sort({ date: -1 });
        const latestQuizzes = userQuizzes.slice(0, 5).map(q => {
            const quiz = q.quizId;
            const percentage = Math.round((q.correct / q.total) * 100);
            return {
                title: quiz.title,
                correct: q.correct,
                total: q.total,
                percentage
            };
        });

        // Latest quiz for top card
        let quizAnswered = '0/0';
        let quizTitle = 'No Quiz Attempted';
        if (userQuizzes.length > 0) {
            const latest = userQuizzes[0]; // Latest one
            quizAnswered = `${latest.correct}/${latest.total}`;
            quizTitle = latest.quizId.title;
        }

        res.json({
            enrolledCourses,
            activeCourses,
            completedCourses,
            quizAnswered,
            recentCourses,
            latestQuizzes,
            quizTitle
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Admin dashboard (mock rakha hai, agar dynamic banana ho to similarly DB use karo)
router.get('/admin/dashboard', authenticateToken, checkRole(['admin']), (req, res) => {
    // Yahan bhi DB se fetch kar sakte ho, lekin abhi mock
    const mockAdminData = {
        totalUsers: 53,
        totalStudents: 48,
        totalCourses: 15,
        totalCategories: 3,
        totalEarnings: 5000,
        recentActivities: [
            { user: 'Ali', role: 'student', action: 'Enrolled', date: new Date().toISOString() }
        ]
    };
    res.json(mockAdminData);
});

module.exports = router;