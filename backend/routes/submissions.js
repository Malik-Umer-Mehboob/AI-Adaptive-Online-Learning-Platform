// routes/submissions.js - Student submission routes
const express = require('express');
const router = express.Router();
const { auth, isStudent, isAdmin } = require('../middleware/auth');
const Submission = require('../models/Submission');

// Student: Get my submissions
// In your routes/submissions.js - Update the /my endpoint
router.get('/my', auth, isStudent, async (req, res) => {
    try {
        const submissions = await Submission.find({ studentId: req.user.id })
            .populate({
                path: 'assignmentId',
                populate: {
                    path: 'courseId',
                    select: 'name'
                },
                select: 'title dueDate courseId'
            })
            .sort({ submittedAt: -1 });
        
        // Create base URL
        const baseUrl = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
        
        const formatted = submissions.map(sub => {
            // Fix PDF URL
            let pdfUrl = null;
            if (sub.pdfPath) {
                // Ensure path starts with /
                const cleanPath = sub.pdfPath.startsWith('/') ? sub.pdfPath : `/${sub.pdfPath}`;
                pdfUrl = `${baseUrl}${cleanPath}`;
            }
            
            return {
                _id: sub._id,
                assignmentId: sub.assignmentId?._id,
                assignmentTitle: sub.assignmentId?.title || 'Unknown Assignment',
                courseId: sub.assignmentId?.courseId?._id,
                courseName: sub.assignmentId?.courseId?.name || 'Unknown Course',
                submittedAt: sub.submittedAt,
                pdfUrl: pdfUrl,
                evaluated: sub.evaluated,
                score: sub.evaluated ? sub.evaluation?.score : null,
                feedback: sub.evaluated ? (sub.evaluation?.feedback || 'No feedback yet') : 'Evaluation in progress...',
                remarks: sub.evaluated ? (sub.evaluation?.remarks || '') : '',
                status: sub.evaluated ? 'Evaluated' : 'Pending'
            };
        });
        
        console.log(`Returning ${formatted.length} submissions for student ${req.user.id}`);
        
        res.json({
            success: true,
            count: formatted.length,
            submissions: formatted
        });
        
    } catch (error) {
        console.error('Get my submissions error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Failed to load submissions',
            error: error.message 
        });
    }
});

// Admin: Get all submissions for a student
router.get('/student/:studentId', auth, isAdmin, async (req, res) => {
    try {
        const { studentId } = req.params;
        const submissions = await Submission.find({ studentId })
            .populate({
                path: 'assignmentId',
                populate: {
                    path: 'courseId',
                    select: 'name'
                },
                select: 'title'
            })
            .sort({ submittedAt: -1 });
        
        res.json(submissions);
    } catch (error) {
        console.error('Get student submissions error:', error);
        res.status(500).json({ message: 'Failed to load submissions' });
    }
});

module.exports = router;