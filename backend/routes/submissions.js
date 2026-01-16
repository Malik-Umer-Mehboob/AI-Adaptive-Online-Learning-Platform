const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Submission = require('../models/Submission');
const Assignment = require('../models/Assignment');

// ✅ STUDENT: GET MY SUBMISSIONS WITH FEEDBACK
router.get('/my', auth, async (req, res) => {
    try {
        // Check if user is student
        if (req.user.role !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Only students can access this endpoint'
            });
        }

        const submissions = await Submission.find({ studentId: req.user.id })
            .populate({
                path: 'assignmentId',
                populate: {
                    path: 'courseId',
                    select: 'name code'
                },
                select: 'title dueDate courseId'
            })
            .sort({ submittedAt: -1 });
        
        const formatted = submissions.map(sub => {
  const assignment = sub.assignmentId;

  return {
    _id: sub._id,
    assignmentId: assignment?._id,
    assignmentTitle: assignment?.title || 'Unknown',
    courseName: assignment?.courseId?.name || 'Unknown',
    courseCode: assignment?.courseId?.code || '',
    submittedAt: sub.submittedAt,
    evaluated: sub.evaluated || !!sub.evaluation,
    score: typeof sub.evaluation?.score === 'number' ? sub.evaluation.score : 0,
    feedback: sub.evaluation && sub.evaluation.feedback ? sub.evaluation.feedback : 'Not evaluated yet',
    remarks: sub.evaluation?.remarks || '',
    evaluatedAt: sub.evaluation?.evaluatedAt,
    status: (sub.evaluated || sub.evaluation) ? 'Evaluated' : 'Pending Evaluation',
    pdfUrl: sub.pdfPath ? `http://localhost:5000${sub.pdfPath}` : null
  };
});

        
        res.json({
            success: true,
            message: 'Submissions retrieved',
            count: formatted.length,
            submissions: formatted
        });
        
    } catch (error) {
        console.error('Get my submissions error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Failed to load submissions'
        });
    }
});

// ✅ GET SPECIFIC SUBMISSION WITH DETAILS
router.get('/:submissionId', auth, async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        const submission = await Submission.findById(submissionId)
            .populate({
                path: 'assignmentId',
                populate: {
                    path: 'courseId',
                    select: 'name'
                },
                select: 'title questions'
            })
            .populate('studentId', 'name email');
        
        if (!submission) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found'
            });
        }
        
        // Check permissions
        const isStudentOwner = req.user.role === 'student' && 
                              submission.studentId._id.toString() === req.user.id;
        const isAdmin = req.user.role === 'admin';
        
        if (!isStudentOwner && !isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized'
            });
        }
        
        const response = {
            _id: submission._id,
            assignment: submission.assignmentId,
            student: submission.studentId,
            submittedAt: submission.submittedAt,
            evaluated: submission.evaluated,
            evaluation: submission.evaluation,
            textAnswer: submission.textAnswer,
            pdfUrl: submission.pdfPath ? `http://localhost:5000${submission.pdfPath}` : null

        };
        
        res.json({
            success: true,
            submission: response
        });
        
    } catch (error) {
        console.error('Get submission error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get submission'
        });
    }
});

module.exports = router;