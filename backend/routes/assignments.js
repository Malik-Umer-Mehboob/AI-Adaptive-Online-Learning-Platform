// routes/assignments.js - UPDATED WITH FIXES
const express = require('express');
const router = express.Router();
const { auth, isAdmin, isStudent } = require('../middleware/auth');
const assignmentController = require('../controllers/assignmentController');
const { uploadPDF, addBufferToFile } = require('../middleware/multer');

// ✅ **MOST IMPORTANT FIX: Import Submission Model**
const Submission = require('../models/Submission');

// ========== DEBUG & TEST ROUTES ==========

// Test AI endpoint
router.post('/test-ai', auth, assignmentController.testAI);

// Check submission existence
router.get('/check-submission/:submissionId', auth, assignmentController.checkSubmission);

// Health check for assignments
router.get('/health', (req, res) => {
    res.json({
        status: 'active',
        message: 'Assignments API is working',
        timestamp: new Date().toISOString(),
        endpoints: [
            'GET / - Get all assignments (admin)',
            'POST / - Create manual assignment (admin)',
            'POST /generate - Generate AI assignment (admin)',
            'GET /course/:courseId - Get assignments by course',
            'POST /:assignmentId/submit - Submit assignment (student)',
            'GET /:assignmentId/submissions - Get submissions (admin)',
            'POST /submissions/:submissionId/evaluate - Evaluate submission (admin)'
        ]
    });
});

// ========== DEBUG ENDPOINTS ==========

// Add these temporary debug endpoints:
router.get('/debug/user-info', auth, (req, res) => {
    console.log('🔍 DEBUG User Info for /submissions/my:', {
        userId: req.user.id,
        role: req.user.role,
        email: req.user.email
    });
    
    res.json({
        success: true,
        user: req.user,
        timestamp: new Date().toISOString(),
        route: '/api/assignments/submissions/my'
    });
});

// ========== PUBLIC/COMMON ROUTES ==========

// Get assignments by course (for both admin and students)
router.get('/course/:courseId', auth, assignmentController.getAssignmentsByCourse);

// Get assignment by ID (for both)
router.get('/:id', auth, assignmentController.getAssignmentById);

// ========== ADMIN ONLY ROUTES ==========

// Get all assignments (admin only)
router.get('/', auth, isAdmin, assignmentController.getAllAssignments);

// Create manual assignment (admin only)
router.post('/', auth, isAdmin, assignmentController.createAssignment);

// Generate AI assignment (admin only)
router.post('/generate', auth, isAdmin, assignmentController.generateQuestions);

// Update assignment (admin only)
router.put('/:id', auth, isAdmin, assignmentController.updateAssignment);

// Delete assignment (admin only)
router.delete('/:id', auth, isAdmin, assignmentController.deleteAssignment);

// Get submissions for an assignment (admin only)
router.get('/:assignmentId/submissions', auth, isAdmin, assignmentController.getSubmissionsByAssignment);

// ========== SUBMISSION ROUTES ==========

// Get submission by ID (admin only)
router.get('/submissions/:submissionId', auth, isAdmin, assignmentController.getSubmissionById);

// Evaluate a single submission (admin only)
router.post('/submissions/:submissionId/evaluate', auth, isAdmin, assignmentController.evaluateSubmission);

// Force evaluate a submission (admin only - for debugging)
router.post('/submissions/:submissionId/force', auth, isAdmin, assignmentController.forceEvaluate);

// ========== STUDENT ONLY ROUTES ==========

// Submit assignment (student only)
router.post('/:assignmentId/submit', 
    auth, 
    isStudent, 
    uploadPDF.single('pdf'),
    addBufferToFile,
    assignmentController.submitAssignment
);

// ✅ **FIXED: Get my submissions (student only) - UPDATED**
router.get('/submissions/my', auth, isStudent, async (req, res) => {
    try {
        console.log('✅ GET /api/assignments/submissions/my - Student ID:', req.user.id);
        console.log('✅ Student Role:', req.user.role);
        
        // Find submissions
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
        
        console.log(`✅ Found ${submissions.length} submissions for student ${req.user.id}`);
        
        // Create base URL
        const baseUrl = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
        
        // Format submissions
        const formatted = submissions.map((sub) => {
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
                questions: sub.assignmentId?.questions || [],
                studentId: sub.studentId // For debugging
            };
        });
        
        // Success response
        res.json({
            success: true,
            message: `Found ${formatted.length} submissions`,
            count: formatted.length,
            submissions: formatted,
            debug: {
                studentId: req.user.id,
                studentRole: req.user.role
            }
        });
        
    } catch (error) {
        console.error('❌ Get my submissions ERROR:', error);
        console.error('❌ Error stack:', error.stack);
        
        res.status(500).json({ 
            success: false,
            message: 'Failed to load submissions',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Check submission status (admin only)
router.get('/submissions/:submissionId/status', auth, isAdmin, assignmentController.checkSubmissionStatus);

// ========== STATISTICS ROUTES ==========

// Get assignment statistics (admin only)
router.get('/stats/summary', auth, isAdmin, async (req, res) => {
    try {
        const totalAssignments = await require('../models/Assignment').countDocuments();
        const totalSubmissions = await require('../models/Submission').countDocuments();
        const evaluatedSubmissions = await require('../models/Submission').countDocuments({ evaluated: true });
        
        res.json({
            success: true,
            stats: {
                totalAssignments,
                totalSubmissions,
                evaluatedSubmissions,
                pendingEvaluations: totalSubmissions - evaluatedSubmissions,
                evaluationRate: totalSubmissions > 0 ? 
                    Math.round((evaluatedSubmissions / totalSubmissions) * 100) : 0
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ success: false, message: 'Failed to load statistics' });
    }
});

// ========== FALLBACK ROUTES ==========

// Catch-all for undefined assignment routes
router.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: `Assignment route not found: ${req.originalUrl}`,
        availableRoutes: [
            'GET    /api/assignments - Get all assignments (Admin)',
            'POST   /api/assignments - Create manual assignment (Admin)',
            'POST   /api/assignments/generate - Generate AI assignment (Admin)',
            'GET    /api/assignments/course/:courseId - Get assignments by course',
            'POST   /api/assignments/:assignmentId/submit - Submit assignment (Student)',
            'GET    /api/assignments/submissions/my - Get my submissions (Student)'
        ]
    });
});

module.exports = router;