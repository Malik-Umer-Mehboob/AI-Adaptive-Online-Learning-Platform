// routes/submissions.js - COMPLETE: Minor fix for pdfUrl (use buildFullUrl for consistency with controller).
// No direct model changes needed (handled in assignmentController which prefers qwen2.5:7b).
// Added buildFullUrl helper here for full URLs in responses.

const express = require('express');
const router = express.Router();
const Submission = require('../models/Submission');
const { auth, isStudent, isAdmin } = require('../middleware/auth');
const assignmentController = require('../controllers/assignmentController');
const { uploadPDF } = require('../middleware/multer');

// BASE URL (env override) - Copied from controller for consistency
const BASE_URL = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/+$/, ''); // strip trailing slash

// Build full URL safely (handles already-absolute paths too) - Copied from controller
const buildFullUrl = (relativeOrAbsolutePath) => {
    if (!relativeOrAbsolutePath) return null;
    // If path already looks like a full URL, return as-is
    if (/^https?:\/\//i.test(relativeOrAbsolutePath)) return relativeOrAbsolutePath;
    // Ensure leading slash
    const cleanPath = relativeOrAbsolutePath.startsWith('/') ? relativeOrAbsolutePath : `/${relativeOrAbsolutePath}`;
    return `${BASE_URL}${cleanPath}`;
};

router.post('/:assignmentId/submit', auth, isStudent, uploadPDF.single('pdfFile'), async (req, res) => {
    try {
        console.log('Submit route matched, file:', req.file ? req.file.filename : 'none');
        req.user = res.locals.user;
        await assignmentController.submitAssignment(req, res);
    } catch (error) {
        console.error('Route submit error:', error);
        res.status(500).json({ message: 'Submit failed', error: error.message });
    }
});

router.post('/:submissionId/evaluate', auth, isAdmin, async (req, res) => {
    try {
        req.user = res.locals.user;
        await assignmentController.evaluateSubmission(req, res);
    } catch (error) {
        console.error('Route eval error:', error);
        res.status(500).json({ message: 'Eval failed', error: error.message });
    }
});

// routes/submissions.js
router.get('/my', auth, isStudent, async (req, res) => {
    try {
        const submissions = await Submission.find({ studentId: req.user.id })
            .populate({
                path: 'assignmentId',
                populate: {
                    path: 'courseId',
                    select: 'name'
                },
                select: 'title dueDate'
            })
            .sort({ submittedAt: -1 })
            .lean();

        const formatted = submissions.map(sub => {
            const isEvaluated = sub.evaluated && sub.evaluation && sub.evaluation.score !== undefined;
            
            return {
                ...sub,
                pdfUrl: sub.pdfPath ? buildFullUrl(sub.pdfPath) : null,
                score: isEvaluated ? sub.evaluation.score : null,
                feedback: isEvaluated 
                    ? (sub.evaluation.feedback || "No feedback provided.")
                    : "Evaluation in progress...",
                remarks: isEvaluated 
                    ? (sub.evaluation.remarks || "") 
                    : "",
                evaluationStatus: isEvaluated ? 'completed' : 'pending',
                courseName: sub.assignmentId?.courseId?.name || 'Unknown'
            };
        });

        res.json(formatted);
    } catch (error) {
        console.error('GET /my error:', error);
        res.status(500).json({ message: 'Failed to load submissions' });
    }
});
router.get('/:assignmentId', auth, isAdmin, async (req, res) => {
    try {
        req.user = res.locals.user;
        await assignmentController.getSubmissionsByAssignment(req, res);
    } catch (error) {
        console.error('GET submissions error:', error);
        res.status(500).json({ message: 'Failed to load submissions' });
    }
});

module.exports = router;