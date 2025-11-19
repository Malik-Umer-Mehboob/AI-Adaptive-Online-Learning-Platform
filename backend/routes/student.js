// routes/student.js (Updated: Destructure auth from middleware to fix object callback error)
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth'); // Destructure to get the auth function
const Submission = require('../models/Submission');

// GET /api/student/submissions - Fetch student's submissions
router.get('/submissions', auth, async (req, res) => {
  try {
    // Verify user is a student (optional, but good practice based on role)
    if (req.user.role !== 'student') {
      return res.status(403).json({ message: 'Access denied: Students only' });
    }

    const submissions = await Submission.find({ studentId: req.user.id })
      .populate('assignmentId', 'title') // Populate assignment title
      .sort({ submittedAt: -1 }) // Most recent first
      .select('assignmentId pdfPath submittedAt evaluated evaluation') // Select relevant fields
      .lean(); // Optimize for JSON response

    // Format response to match frontend expectations
    const formattedSubmissions = submissions.map(sub => ({
      assignmentTitle: sub.assignmentId?.title || 'Untitled Assignment',
      submittedAt: sub.submittedAt,
      score: sub.evaluation?.score || null,
      feedback: sub.evaluation?.feedback || null,
      remarks: sub.evaluation?.remarks || null,
      pdfPath: sub.pdfPath, // Include for potential download/view
      evaluated: sub.evaluated
    }));

    res.json(formattedSubmissions);
  } catch (error) {
    console.error('Error fetching student submissions:', error);
    res.status(500).json({ message: 'Server error while fetching submissions' });
  }
});

module.exports = router;