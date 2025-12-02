// routes/assignments.js - FIXED: Reordered routes - /:courseId first to avoid conflict, students allowed
const express = require('express');
const router = express.Router();
const { auth, checkRole, isAdmin, isStudent } = require('../middleware/auth');
const { 
    createAssignment, 
    generateQuestions, 
    getAssignmentsByCourse, 
    getAllAssignments, 
    getAssignmentById,
    getSubmissionsByAssignment, 
    submitAssignment, 
    evaluateSubmission,
    updateAssignment, 
    deleteAssignment 
} = require('../controllers/assignmentController');
const { uploadPDF } = require('../middleware/multer');

// FIXED: Student/Admin: Get by course - AUTH ONLY (no role check) - MOVED FIRST to match before /:id
router.get('/:courseId', auth, getAssignmentsByCourse);

// Admin: Manual create
router.post('/', auth, isAdmin, createAssignment);

// Admin: AI generate
router.post('/generate', auth, isAdmin, generateQuestions);

// Admin: Get all
router.get('/', auth, isAdmin, getAllAssignments);

// Admin: Get single by ID (for edit) - SECOND to avoid conflict with courseId
router.get('/:id', auth, isAdmin, getAssignmentById);

// Admin: Update (Edit)
router.put('/:id', auth, isAdmin, updateAssignment);

// Admin: Delete
router.delete('/:id', auth, isAdmin, deleteAssignment);

// Admin: Get submissions for assignment
router.get('/:assignmentId/submissions', auth, isAdmin, getSubmissionsByAssignment);

// Student: Submit (PDF upload)
router.post('/:assignmentId/submit', auth, isStudent, uploadPDF.single('pdf'), submitAssignment);

// Admin: Evaluate by submission ID
router.post('/submissions/:submissionId/evaluate', auth, isAdmin, evaluateSubmission);

module.exports = router;