// routes/submissions.js - Updated with better debugging
const express = require('express');
const router = express.Router();
const { auth, isStudent, isAdmin } = require('../middleware/auth');
const Submission = require('../models/Submission');

// ✅ **FIXED: Student: Get my submissions with detailed debugging**
router.get('/my', auth, isStudent, async (req, res) => {
    try {
        console.log('=== GET MY SUBMISSIONS START ===');
        console.log('User ID from token:', req.user.id);
        console.log('User Role from token:', req.user.role);
        
        const submissions = await Submission.find({ studentId: req.user.id })
            .populate({
                path: 'assignmentId',
                populate: {
                    path: 'courseId',
                    select: 'name code'
                },
                select: 'title questions dueDate courseId'
            })
            .sort({ submittedAt: -1 });
        
        console.log(`Found ${submissions.length} submissions for student ${req.user.id}`);
        
        // Debug: Log first submission if exists
        if (submissions.length > 0) {
            console.log('First submission sample:', {
                _id: submissions[0]._id,
                assignmentTitle: submissions[0].assignmentId?.title,
                evaluated: submissions[0].evaluated,
                score: submissions[0].evaluation?.score,
                feedback: submissions[0].evaluation?.feedback
            });
        }
        
        // Create base URL
        const baseUrl = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
        
        const formatted = submissions.map((sub, index) => {
            // Fix PDF URL
            let pdfUrl = null;
            if (sub.pdfPath) {
                const cleanPath = sub.pdfPath.startsWith('/') ? sub.pdfPath : `/${sub.pdfPath}`;
                pdfUrl = `${baseUrl}${cleanPath}`;
            }
            
            // Get evaluation data
            const evaluated = sub.evaluated || false;
            const score = evaluated ? (sub.evaluation?.score || 0) : null;
            const feedback = evaluated ? (sub.evaluation?.feedback || 'No feedback provided') : 'Evaluation in progress...';
            const remarks = evaluated ? (sub.evaluation?.remarks || '') : '';
            
            // Debug log for each submission
            console.log(`Submission ${index + 1}:`, {
                id: sub._id,
                assignment: sub.assignmentId?.title,
                evaluated: evaluated,
                score: score,
                feedbackLength: feedback?.length
            });
            
            return {
                _id: sub._id,
                assignmentId: sub.assignmentId?._id,
                assignmentTitle: sub.assignmentId?.title || 'Unknown Assignment',
                courseId: sub.assignmentId?.courseId?._id,
                courseName: sub.assignmentId?.courseId?.name || 'Unknown Course',
                courseCode: sub.assignmentId?.courseId?.code || '',
                submittedAt: sub.submittedAt,
                pdfUrl: pdfUrl,
                evaluated: evaluated,
                score: score,
                feedback: feedback,
                remarks: remarks,
                evaluatedAt: sub.evaluation?.evaluatedAt,
                evaluationTime: sub.evaluation?.timeTaken,
                status: evaluated ? 'Evaluated' : 'Pending',
                questions: sub.assignmentId?.questions || []
            };
        });
        
        console.log('=== GET MY SUBMISSIONS END ===');
        
        res.json({
            success: true,
            message: `Found ${formatted.length} submissions`,
            count: formatted.length,
            submissions: formatted
        });
        
    } catch (error) {
        console.error('❌ Get my submissions ERROR:', error);
        res.status(500).json({ 
            success: false,
            message: 'Failed to load submissions',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
        
        res.json({
            success: true,
            count: submissions.length,
            submissions: submissions
        });
    } catch (error) {
        console.error('Get student submissions error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Failed to load submissions',
            error: error.message 
        });
    }
});

module.exports = router;