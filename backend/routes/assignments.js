const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth');
const assignmentController = require('../controllers/assignmentController');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { uploadPDF, handleUploadError } = require('../middleware/multer');

const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Course = require('../models/Course');

// ✅ PUBLIC: View/Download Assignment PDF
router.get('/:id/pdf', async (req, res) => {
    try {
        const assignment = await Assignment.findById(req.params.id);
        
        if (!assignment) {
            return res.status(404).json({
                success: false,
                message: 'Assignment not found'
            });
        }

        // If PDF exists, serve it
        if (assignment.assignmentPdfPath) {
            const filePath = path.join(__dirname, '../public', assignment.assignmentPdfPath);
            
            if (fs.existsSync(filePath)) {
                if (req.query.download === 'true') {
                    res.download(filePath, `assignment-${assignment._id}.pdf`);
                } else {
                    res.sendFile(filePath);
                }
                return;
            }
        }

        // Generate PDF on the fly
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 
            req.query.download === 'true' 
                ? `attachment; filename="assignment-${assignment._id}.pdf"`
                : `inline; filename="assignment-${assignment._id}.pdf"`
        );
        
        const doc = new PDFDocument();
        doc.pipe(res);
        
        doc.fontSize(20).text(assignment.title, { align: 'center' });
        doc.moveDown();
        
        doc.fontSize(12)
           .text(`Course: ${assignment.courseId}`)
           .text(`Due Date: ${assignment.dueDate.toLocaleDateString()}`)
           .text(`Questions: ${assignment.numQuestions}`);
        doc.moveDown();
        
        doc.fontSize(14).text('Questions:', { underline: true });
        doc.moveDown();
        
        assignment.questions.forEach((q, i) => {
            doc.fontSize(12).text(`Q${i+1}. ${q.questionText}`);
            doc.moveDown(0.5);
        });
        
        doc.end();
        
    } catch (error) {
        console.error('PDF error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get PDF'
        });
    }
});

// ✅ GET ASSIGNMENT DETAILS
router.get('/:id', auth, async (req, res) => {
    try {
        await assignmentController.getAssignment(req, res);
    } catch (error) {
        console.error('Get assignment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get assignment'
        });
    }
});

// ✅ GET ASSIGNMENTS FOR A COURSE
router.get('/course/:courseId', auth, async (req, res) => {
    try {
        const { courseId } = req.params;
        
        const assignments = await Assignment.find({ 
            courseId: courseId,
            isActive: true 
        }).sort({ dueDate: 1 });
        
        // Add PDF URLs
        const assignmentsWithUrls = assignments.map(assignment => {
            const assignmentObj = assignment.toObject();
            assignmentObj.viewPdfUrl = `http://localhost:5000/api/assignments/${assignment._id}/pdf`;
            assignmentObj.downloadPdfUrl = `http://localhost:5000/api/assignments/${assignment._id}/pdf?download=true`;
            return assignmentObj;
        });
        
        // Add submission status for students
        if (req.user.role === 'student') {
            const submissions = await Submission.find({
                assignmentId: { $in: assignments.map(a => a._id) },
                studentId: req.user.id
            });
            
            assignmentsWithUrls.forEach(assignment => {
                const submission = submissions.find(s => 
                    s.assignmentId.toString() === assignment._id.toString()
                );
                
                assignment.submitted = !!submission;
                assignment.submissionId = submission?._id;
                assignment.evaluated = submission?.evaluated;
                assignment.score = submission?.evaluation?.score;
                assignment.feedback = submission?.evaluation?.feedback;
            });
        }
        
        res.json({
            success: true,
            assignments: assignmentsWithUrls,
            count: assignments.length
        });
        
    } catch (error) {
        console.error('Get course assignments error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get assignments'
        });
    }
});

// ✅ GENERATE FROM NOTES (5 DESCRIPTIVE QUESTIONS)
router.post('/generate/from-notes/:courseId',
    auth,
    checkRole(['admin']),
    uploadPDF.single('file'),
    handleUploadError,
    async (req, res) => {
        try {
            await assignmentController.generateAssignmentFromNotes(req, res);
        } catch (error) {
            console.error('Generate from notes error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate assignment from notes'
            });
        }
    }
);

// ✅ GENERATE FROM CUSTOM PROMPT (5 DESCRIPTIVE QUESTIONS)
router.post('/generate/custom/:courseId', 
    auth, 
    checkRole(['admin']), 
    async (req, res) => {
        try {
            await assignmentController.generateAssignmentFromCustomPrompt(req, res);
        } catch (error) {
            console.error('Generate assignment error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate assignment'
            });
        }
    }
);

// ✅ SUBMIT ASSIGNMENT (STUDENT)
router.post('/:assignmentId/submit', 
    auth, 
    async (req, res) => {
        try {
            const { assignmentId } = req.params;
            const { textAnswer, pdfBase64 } = req.body;

            // Validate user is student
            if (req.user.role !== 'student') {
                return res.status(403).json({
                    success: false,
                    message: 'Only students can submit assignments'
                });
            }

            // Check assignment exists
            const assignment = await Assignment.findById(assignmentId);
            if (!assignment) {
                return res.status(404).json({
                    success: false,
                    message: 'Assignment not found'
                });
            }

            // Check if already submitted
            const existingSubmission = await Submission.findOne({
                assignmentId,
                studentId: req.user.id
            });
            
            if (existingSubmission) {
                return res.status(400).json({
                    success: false,
                    message: 'Already submitted'
                });
            }

            // Process PDF if provided
            let pdfPath = null;
            if (pdfBase64) {
                const uploadsDir = path.join(__dirname, '../public/uploads/submissions');
                if (!fs.existsSync(uploadsDir)) {
                    fs.mkdirSync(uploadsDir, { recursive: true });
                }
                
                const fileName = `submission_${assignmentId}_${req.user.id}_${Date.now()}.pdf`;
                const filePath = path.join(uploadsDir, fileName);
                
                // Clean base64
                let base64Data = pdfBase64;
                if (pdfBase64.includes('base64,')) {
                    base64Data = pdfBase64.split('base64,')[1];
                }
                
                const pdfBuffer = Buffer.from(base64Data, 'base64');
                fs.writeFileSync(filePath, pdfBuffer);
                
                pdfPath = `/uploads/submissions/${fileName}`;
            }

            // Validate at least one answer provided
            if (!pdfPath && (!textAnswer || textAnswer.trim().length < 10)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please provide either a PDF file or text answer (min 10 characters)'
                });
            }

            // Create submission
            const submission = new Submission({
                assignmentId,
                studentId: req.user.id,
                pdfPath,
                textAnswer: textAnswer?.trim(),
                submittedAt: new Date()
            });

            await submission.save();

            // Trigger auto-evaluation in background
            assignmentController.autoEvaluateSubmission(submission._id).catch(console.error);

            res.status(201).json({
                success: true,
                message: 'Assignment submitted successfully',
                submission: {
                    _id: submission._id,
                    assignmentId: submission.assignmentId,
                    submittedAt: submission.submittedAt,
                    hasPdf: !!pdfPath,
                    hasText: !!textAnswer
                }
            });

        } catch (error) {
            console.error('Submit error:', error);
            res.status(500).json({
                success: false,
                message: 'Submission failed'
            });
        }
    }
);

// ✅ EVALUATE SUBMISSION (ADMIN)
router.post('/submissions/:submissionId/evaluate', 
    auth, 
    checkRole(['admin']),
    async (req, res) => {
        try {
            await assignmentController.evaluateSubmission(req, res);
        } catch (error) {
            console.error('Evaluation error:', error);
            res.status(500).json({
                success: false,
                message: 'Evaluation failed'
            });
        }
    }
);

// ✅ GET SUBMISSION DETAILS - FIXED
router.get('/submissions/:submissionId', auth, async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        // ✅ SPECIAL HANDLING FOR "my" - Redirect to submissions router
        if (submissionId === 'my') {
            // Agar student apne submissions dekhna chahta hai
            if (req.user.role === 'student') {
                // Redirect to submissions router
                return res.redirect(`/api/submissions/my`);
            } else {
                return res.status(403).json({
                    success: false,
                    message: 'Only students can access "my" submissions'
                });
            }
        }
        
        // ✅ Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(submissionId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid submission ID format'
            });
        }
        
        const submission = await Submission.findById(submissionId)
            .populate('assignmentId', 'title')
            .populate('studentId', 'name email');
        
        if (!submission) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found'
            });
        }

        // Permission check
        const isOwner = submission.studentId._id.toString() === req.user.id;
        const isAdmin = req.user.role === 'admin';
        
        if (!isOwner && !isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized'
            });
        }

        const submissionObj = submission.toObject();
        if (submission.pdfPath) {
            submissionObj.pdfUrl = `http://localhost:5000${submission.pdfPath}`;
        }

        res.json({
            success: true,
            submission: submissionObj
        });

    } catch (error) {
        console.error('Get submission error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get submission'
        });
    }
});
// ✅ GET SUBMISSIONS FOR ASSIGNMENT
router.get('/:assignmentId/submissions', auth, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        
        let query = { assignmentId };
        
        // Students can only see their own
        if (req.user.role === 'student') {
            query.studentId = req.user.id;
        }
        
        const submissions = await Submission.find(query)
            .populate('studentId', 'name email')
            .sort({ submittedAt: -1 });
        
        res.json({
            success: true,
            submissions: submissions,
            count: submissions.length
        });
        
    } catch (error) {
        console.error('Get submissions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get submissions'
        });
    }
});
// ✅ EXTEND ASSIGNMENT DUE DATE
router.put('/:assignmentId/extend', 
    auth,
    checkRole(['admin']),
    async (req, res) => {
        try {
            const { assignmentId } = req.params;
            const { dueDate } = req.body;
            
            if (!dueDate) {
                return res.status(400).json({
                    success: false,
                    message: 'Due date is required'
                });
            }
            
            const assignment = await Assignment.findById(assignmentId);
            if (!assignment) {
                return res.status(404).json({
                    success: false,
                    message: 'Assignment not found'
                });
            }
            
            // Check if assignment is overdue
            const now = new Date();
            const currentDueDate = new Date(assignment.dueDate);
            if (currentDueDate >= now) {
                return res.status(400).json({
                    success: false,
                    message: 'Assignment is not overdue yet'
                });
            }
            
            // Check if any submissions exist
            const submissions = await Submission.find({ assignmentId });
            if (submissions.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot extend date: Students have already submitted'
                });
            }
            
            // Update due date
            assignment.dueDate = new Date(dueDate);
            assignment.updatedAt = new Date();
            await assignment.save();
            
            res.json({
                success: true,
                message: 'Due date extended successfully',
                assignment: {
                    _id: assignment._id,
                    title: assignment.title,
                    dueDate: assignment.dueDate,
                    updatedAt: assignment.updatedAt
                }
            });
            
        } catch (error) {
            console.error('Extend date error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to extend due date'
            });
        }
    }
);


// ✅ DELETE ASSIGNMENT (ADMIN) - MODIFIED VERSION
router.delete('/:assignmentId', 
    auth,
    checkRole(['admin']),
    async (req, res) => {
        try {
            const { assignmentId } = req.params;
            
            const assignment = await Assignment.findById(assignmentId);
            if (!assignment) {
                return res.status(404).json({
                    success: false,
                    message: 'Assignment not found'
                });
            }
            
            // Delete all submissions for this assignment
            await Submission.deleteMany({ assignmentId });
            
            // Delete PDF file if exists
            if (assignment.assignmentPdfPath) {
                const filePath = path.join(__dirname, '../public', assignment.assignmentPdfPath);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
            
            // Remove from course's assignments array
            await Course.findByIdAndUpdate(
                assignment.courseId,
                { $pull: { assignments: assignmentId } },
                { new: true }
            );
            
            // Delete assignment
            await Assignment.findByIdAndDelete(assignmentId);
            
            res.json({
                success: true,
                message: 'Assignment and all related submissions deleted successfully'
            });
            
        } catch (error) {
            console.error('Delete assignment error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete assignment'
            });
        }
    }
);

module.exports = router;