const express = require('express');
const router = express.Router();
const { authenticateToken, checkRole } = require('../middleware/auth');

const mockData = {
    students: [
        { _id: '1', name: 'Ali', email: 'ali@example.com', role: 'student' },
        { _id: '2', name: 'Ahmed', email: 'ahmed@example.com', role: 'student' }
    ],
    admin: { _id: '4', name: 'Admin', email: 'admin@example.com', role: 'admin' }
};

// Student Dashboard
router.get('/student/dashboard', authenticateToken, checkRole(['student']), (req, res) => {
    const mockStudentData = {
        enrolledCourses: 5,
        activeCourses: 3,
        completedCourses: 2,
        quizAnswered: '5/10',
        recentCourses: [
            { id: 'c1', title: 'Web Development', image: 'assets/img/course/course-01.jpg', instructorName: 'John Doe', instructorImage: 'assets/img/user/user-29.jpg', category: 'IT', price: 100, rating: 4.5, reviews: 100, discount: 10 }
        ],
        recentInvoices: [
            { id: '#INV001', title: 'Course Fee', amount: 100, status: 'paid' }
        ],
        latestQuizzes: [
            { title: 'Quiz 1', correct: 4, total: 5, percentage: 80 }
        ]
    };
    res.json(mockStudentData);
});

// Admin Dashboard
router.get('/admin/dashboard', authenticateToken, checkRole(['admin']), (req, res) => {
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