// routes/assignments.js - Assignment routes
const express = require('express');
const router = express.Router();
const { auth, checkRole, isAdmin, isStudent } = require('../middleware/auth');
const { 
    createAssignment, 
    generateQuestions, 
    getAssignmentsByCourse, 
    getAllAssignments, 
    getSubmissionsByAssignment, // New
    submitAssignment, 
    evaluateSubmission 
} = require('../controllers/assignmentController');
const { uploadPDF } = require('../middleware/multer');

// Admin: Manual create
router.post('/', auth, isAdmin, createAssignment);

// Admin: AI generate
router.post('/generate', auth, isAdmin, generateQuestions);

// Admin: Get all
router.get('/', auth, isAdmin, getAllAssignments);

// Student/Admin: Get by course
router.get('/:courseId', auth, getAssignmentsByCourse);

// Admin: Get submissions for assignment (New route for frontend openEvaluateModal)
router.get('/:assignmentId/submissions', auth, isAdmin, getSubmissionsByAssignment);

// Student: Submit (PDF upload)
router.post('/:assignmentId/submit', auth, isStudent, uploadPDF.single('pdf'), submitAssignment);

// Admin: Evaluate by submission ID
router.post('/submissions/:submissionId/evaluate', auth, isAdmin, evaluateSubmission);

module.exports = router;