// routes/assignments.js - COMPLETE UPDATED VERSION
const express = require('express');
const router = express.Router();
const { auth, isAdmin, isStudent } = require('../middleware/auth');
const assignmentController = require('../controllers/assignmentController');
const { uploadPDF, addBufferToFile } = require('../middleware/multer');

// Test AI endpoint
router.post('/test-ai', auth, assignmentController.testAI);

// Get assignments by course (for both admin and students)
router.get('/course/:courseId', auth, assignmentController.getAssignmentsByCourse);

// Admin only routes
router.post('/', auth, isAdmin, assignmentController.createAssignment);
router.post('/generate', auth, isAdmin, assignmentController.generateQuestions);
router.get('/', auth, isAdmin, assignmentController.getAllAssignments);
router.get('/:id', auth, assignmentController.getAssignmentById);
router.put('/:id', auth, isAdmin, assignmentController.updateAssignment);
router.delete('/:id', auth, isAdmin, assignmentController.deleteAssignment);

// Submission routes
router.get('/:assignmentId/submissions', auth, isAdmin, assignmentController.getSubmissionsByAssignment);
router.get('/submissions/:submissionId', auth, isAdmin, assignmentController.getSubmissionById);

// Student submission route
router.post('/:assignmentId/submit', 
    auth, 
    isStudent, 
    uploadPDF.single('pdf'), // This saves to disk
    addBufferToFile, // This adds buffer to req.file
    assignmentController.submitAssignment
);

// Evaluate submission routes
router.post('/submissions/:submissionId/evaluate', auth, isAdmin, assignmentController.evaluateSubmission);
router.post('/:assignmentId/bulk-evaluate', auth, isAdmin, assignmentController.bulkEvaluate);

// Debug route to check submission
router.get('/check-submission/:submissionId', auth, isAdmin, assignmentController.checkSubmission);

module.exports = router;