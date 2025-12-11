// routes/student.js (PURA FILE REPLACE KAR DO)

const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Student = require('../models/Student');
const Submission = require('../models/Submission');

// Existing: Get student's submissions
router.get('/submissions', auth, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ message: 'Access denied: Students only' });
    }

    const submissions = await Submission.find({ studentId: req.user.id })
      .populate('assignmentId', 'title')
      .sort({ submittedAt: -1 })
      .lean();

    const formattedSubmissions = submissions.map(sub => ({
      assignmentTitle: sub.assignmentId?.title || 'Untitled Assignment',
      submittedAt: sub.submittedAt,
      score: sub.evaluation?.score || null,
      feedback: sub.evaluation?.feedback || null,
      remarks: sub.evaluation?.remarks || null,
      pdfPath: sub.pdfPath,
      evaluated: sub.evaluated
    }));

    res.json(formattedSubmissions);
  } catch (error) {
    console.error('Error fetching student submissions:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


module.exports = router;