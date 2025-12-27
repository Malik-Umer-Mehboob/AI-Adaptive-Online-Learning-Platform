// routes/assignments.js - COMPLETE FIXED VERSION
const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth');
const assignmentController = require('../controllers/assignmentController').assignmentController;
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

// Import models
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');

// ✅ IMPORTANT: Make PDF route PUBLIC for viewing
router.get('/:id/pdf', async (req, res) => {
    try {
        console.log(`📄 PDF Request for assignment: ${req.params.id}`);
        
        const assignment = await Assignment.findById(req.params.id);
        
        if (!assignment) {
            return res.status(404).json({
                success: false,
                message: 'Assignment not found'
            });
        }

        // 1. Agar PDF path hai database mein
        if (assignment.assignmentPdfPath) {
            const filePath = path.join(__dirname, '../public', assignment.assignmentPdfPath);
            
            console.log(`🔍 Looking for PDF at: ${filePath}`);
            
            if (fs.existsSync(filePath)) {
                console.log('✅ PDF found, sending...');
                
                if (req.query.download === 'true') {
                    res.download(filePath, `assignment-${assignment._id}.pdf`);
                } else {
                    res.sendFile(filePath);
                }
                return;
            } else {
                console.log('❌ PDF not found on disk');
            }
        }
        
        // 2. Agar nahi hai, to check karo uploads/assignments folder mein
        const assignmentsDir = path.join(__dirname, '../public/uploads/assignments');
        if (fs.existsSync(assignmentsDir)) {
            const files = fs.readdirSync(assignmentsDir);
            const pdfFile = files.find(f => 
                f.includes(`assignment_${assignment._id}`) && f.endsWith('.pdf')
            );
            
            if (pdfFile) {
                const filePath = path.join(assignmentsDir, pdfFile);
                console.log(`✅ Found PDF in folder: ${filePath}`);
                
                if (req.query.download === 'true') {
                    res.download(filePath, `assignment-${assignment._id}.pdf`);
                } else {
                    res.sendFile(filePath);
                }
                return;
            }
        }
        
        // 3. Agar koi bhi PDF nahi mili, to generate karo on the fly
        console.log('📝 No PDF found, generating on the fly');
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="assignment-${assignment._id}.pdf"`);
        
        const doc = new PDFDocument();
        doc.pipe(res);
        
        doc.fontSize(20).text(assignment.title || 'Assignment', { align: 'center' });
        doc.moveDown();
        
        doc.fontSize(12).text(`Course: ${assignment.courseId}`);
        doc.text(`Due Date: ${assignment.dueDate ? assignment.dueDate.toLocaleDateString() : 'Not set'}`);
        doc.moveDown();
        
        if (assignment.questions && assignment.questions.length > 0) {
            doc.fontSize(14).text('Questions:', { underline: true });
            doc.moveDown();
            doc.fontSize(12).text(assignment.questions.join('\n\n'));
        } else {
            doc.text('No questions available');
        }
        
        doc.end();
        
    } catch (error) {
        console.error('❌ PDF view error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get PDF',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ✅ Get assignment details (with auth)
router.get('/:id', auth, async (req, res) => {
    try {
        console.log(`🔍 Getting assignment details: ${req.params.id}`);
        
        const assignment = await Assignment.findById(req.params.id)
            .populate('courseId', 'name description');
        
        if (!assignment) {
            return res.status(404).json({
                success: false,
                message: 'Assignment not found'
            });
        }
        
        const assignmentObj = assignment.toObject();
        
        // Set PDF URL
        assignmentObj.pdfUrl = `http://localhost:5000/api/assignments/${assignment._id}/pdf`;
        assignmentObj.downloadUrl = `http://localhost:5000/api/assignments/${assignment._id}/pdf?download=true`;
        
        // For students, check submission status
        if (req.user.role === 'student') {
            const submission = await Submission.findOne({
                assignmentId: assignment._id,
                studentId: req.user.id
            });
            
            if (submission) {
                assignmentObj.submission = {
                    _id: submission._id,
                    submittedAt: submission.submittedAt,
                    evaluated: submission.evaluated,
                    score: submission.evaluation?.score,
                    feedback: submission.evaluation?.feedback
                };
                assignmentObj.submitted = true;
            } else {
                assignmentObj.submitted = false;
            }
        }
        
        res.json({
            success: true,
            assignment: assignmentObj
        });
        
    } catch (error) {
        console.error('Get assignment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get assignment'
        });
    }
});

// ✅ Get all assignments for a course
router.get('/course/:courseId', auth, async (req, res) => {
    try {
        console.log(`📚 Getting assignments for course: ${req.params.courseId}`);
        
        const assignments = await Assignment.find({ courseId: req.params.courseId })
            .sort({ dueDate: 1 });
        
        const assignmentsWithUrls = assignments.map(assignment => {
            const assignmentObj = assignment.toObject();
            
            // Generate PDF URLs
            assignmentObj.pdfUrl = `http://localhost:5000/api/assignments/${assignment._id}/pdf`;
            assignmentObj.viewPdfUrl = `http://localhost:5000/api/assignments/${assignment._id}/pdf`;
            assignmentObj.downloadPdfUrl = `http://localhost:5000/api/assignments/${assignment._id}/pdf?download=true`;
            
            // If assignmentPdfPath exists, use it as backup
            if (assignment.assignmentPdfPath) {
                assignmentObj.originalPdfUrl = `http://localhost:5000${assignment.assignmentPdfPath}`;
            }
            
            return assignmentObj;
        });
        
        // For students, add submission status
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
                
                // Calculate status
                const now = new Date();
                assignment.status = assignment.submitted ? 
                    'submitted' : 
                    (new Date(assignment.dueDate) < now ? 'overdue' : 'pending');
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

// ✅ Generate assignment from custom prompt
router.post('/generate/custom/:courseId', 
    auth, 
    checkRole(['admin']), 
    async (req, res) => {
        try {
            console.log(`🤖 Generating custom assignment for course: ${req.params.courseId}`);
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

// ✅ Evaluate submission
router.post('/submissions/:submissionId/evaluate', 
    auth, 
    checkRole(['admin']),
    async (req, res) => {
        try {
            console.log(`📊 Evaluating submission: ${req.params.submissionId}`);
            await assignmentController.evaluateSubmission(req, res);
        } catch (error) {
            console.error('Evaluation route error:', error);
            res.status(500).json({
                success: false,
                message: 'Evaluation failed'
            });
        }
    }
);

// ✅ Test route
router.get('/test/hello', (req, res) => {
    res.json({ 
        message: 'Assignment routes are working!',
        routes: [
            'GET /api/assignments/:id/pdf',
            'GET /api/assignments/:id',
            'GET /api/assignments/course/:courseId',
            'POST /api/assignments/generate/custom/:courseId'
        ]
    });
});

// ✅ Check PDF existence
router.get('/:id/check-pdf', async (req, res) => {
    try {
        const assignment = await Assignment.findById(req.params.id);
        
        if (!assignment) {
            return res.status(404).json({
                success: false,
                exists: false,
                message: 'Assignment not found'
            });
        }
        
        let pdfPath = '';
        let exists = false;
        
        // Check in database path
        if (assignment.assignmentPdfPath) {
            pdfPath = path.join(__dirname, '../public', assignment.assignmentPdfPath);
            exists = fs.existsSync(pdfPath);
        }
        
        // Check in uploads folder
        if (!exists) {
            const assignmentsDir = path.join(__dirname, '../public/uploads/assignments');
            if (fs.existsSync(assignmentsDir)) {
                const files = fs.readdirSync(assignmentsDir);
                const pdfFile = files.find(f => 
                    f.includes(`assignment_${assignment._id}`) && f.endsWith('.pdf')
                );
                if (pdfFile) {
                    pdfPath = path.join(assignmentsDir, pdfFile);
                    exists = true;
                }
            }
        }
        
        res.json({
            success: true,
            exists,
            pdfPath,
            assignmentPdfPath: assignment.assignmentPdfPath,
            viewUrl: `http://localhost:5000/api/assignments/${assignment._id}/pdf`,
            assignmentTitle: assignment.title,
            assignmentId: assignment._id
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            exists: false,
            error: error.message
        });
    }
});
// routes/assignments.js - ADD THESE ROUTES

// ✅ Submit assignment (Student only) - ADD THIS
// routes/assignments.js - UPDATED SUBMIT ROUTE
router.post('/:assignmentId/submit', 
    auth, 
    async (req, res) => {
        try {
            console.log(`📝 Submission request for assignment: ${req.params.assignmentId}`);
            console.log(`👤 Student: ${req.user.id} (${req.user.role})`);
            console.log(`📦 Request body keys:`, Object.keys(req.body));
            
            const { assignmentId } = req.params;
            const { textAnswer, pdfBase64 } = req.body;
            
            // Check if assignment exists
            const assignment = await Assignment.findById(assignmentId);
            if (!assignment) {
                return res.status(404).json({
                    success: false,
                    message: 'Assignment not found'
                });
            }
            
            // Check if student can submit
            if (req.user.role !== 'student') {
                return res.status(403).json({
                    success: false,
                    message: 'Only students can submit assignments'
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
                    message: 'You have already submitted this assignment',
                    submissionId: existingSubmission._id,
                    submittedAt: existingSubmission.submittedAt
                });
            }
            
            let pdfPath = null;
            
            // ✅ Handle PDF if base64 provided
            if (pdfBase64 && pdfBase64.trim()) {
                try {
                    const uploadsDir = path.join(__dirname, '../public/uploads/submissions');
                    if (!fs.existsSync(uploadsDir)) {
                        fs.mkdirSync(uploadsDir, { recursive: true });
                    }
                    
                    const fileName = `submission_${assignmentId}_${req.user.id}_${Date.now()}.pdf`;
                    const filePath = path.join(uploadsDir, fileName);
                    
                    // Remove data URI prefix if present
                    let base64Data = pdfBase64;
                    if (pdfBase64.includes('base64,')) {
                        base64Data = pdfBase64.split('base64,')[1];
                    }
                    
                    const pdfBuffer = Buffer.from(base64Data, 'base64');
                    
                    // Verify it's a valid PDF
                    if (pdfBuffer.length > 0) {
                        fs.writeFileSync(filePath, pdfBuffer);
                        pdfPath = `/uploads/submissions/${fileName}`;
                        
                        console.log(`✅ PDF saved: ${filePath} (${pdfBuffer.length} bytes)`);
                    } else {
                        console.warn('⚠️ Empty PDF buffer received');
                    }
                } catch (fileError) {
                    console.error('PDF save error:', fileError);
                    // Continue without PDF
                }
            }
            
            // ✅ Validate: At least one form of answer must be provided
            const hasTextAnswer = textAnswer && textAnswer.trim().length > 0;
            
            if (!pdfPath && !hasTextAnswer) {
                return res.status(400).json({
                    success: false,
                    message: 'Please provide either a PDF file or text answer'
                });
            }
            
            // ✅ Create submission data
            const submissionData = {
                assignmentId,
                studentId: req.user.id,
                submittedAt: new Date(),
                evaluated: false,
                evaluation: {
                    score: null,
                    feedback: 'Pending AI evaluation',
                    remarks: 'Submission received',
                    evaluatedAt: null,
                    aiGenerated: false
                }
            };
            
            // Add PDF path if available
            if (pdfPath) {
                submissionData.pdfPath = pdfPath;
            }
            
            // Add text answer if provided
            if (hasTextAnswer) {
                submissionData.textAnswer = textAnswer.trim();
            }
            
            // ✅ Create and save submission
            const submission = new Submission(submissionData);
            await submission.save();
            
            console.log(`✅ Submission created successfully: ${submission._id}`);
            console.log(`📁 PDF Path: ${pdfPath || 'No PDF'}`);
            console.log(`📝 Text Answer Length: ${hasTextAnswer ? textAnswer.length : 0} chars`);
            
            // ✅ Trigger auto-evaluation (async) - Only if we have content
            setTimeout(async () => {
                try {
                    const geminiService = require('../services/geminiService');
                    
                    // Get assignment content
                    const assignmentContent = assignment.questions ? assignment.questions.join('\n') : '';
                    
                    // Get student answer
                    let studentAnswer = '';
                    if (submission.textAnswer) {
                        studentAnswer = submission.textAnswer;
                    } else if (submission.pdfPath) {
                        // Extract text from PDF
                        const pdfFilePath = path.join(__dirname, '../public', submission.pdfPath);
                        if (fs.existsSync(pdfFilePath)) {
                            studentAnswer = await geminiService.extractTextFromPDFFile(pdfFilePath);
                        }
                    }
                    
                    // Only evaluate if we have both assignment and student answer
                    if (studentAnswer && assignmentContent && studentAnswer.length > 10) {
                        console.log(`🤖 Auto-evaluating submission: ${submission._id}`);
                        console.log(`📊 Student answer length: ${studentAnswer.length} chars`);
                        
                        const evaluationResult = await geminiService.evaluateSubmission(
                            assignmentContent,
                            studentAnswer
                        );
                        
                        if (evaluationResult.success) {
                            submission.evaluated = true;
                            submission.evaluation = {
                                score: evaluationResult.evaluation.score,
                                feedback: evaluationResult.evaluation.feedback || "Auto-evaluated by AI",
                                remarks: "AI Evaluation Complete",
                                strengths: ["AI evaluated"],
                                weaknesses: [],
                                evaluatedAt: new Date(),
                                aiGenerated: true
                            };
                            
                            await submission.save();
                            console.log(`✅ Auto-evaluation complete. Score: ${evaluationResult.evaluation.score}/100`);
                        } else {
                            console.warn('⚠️ AI evaluation failed, marking as manual review needed');
                            submission.evaluation.feedback = "AI evaluation failed - needs manual review";
                            await submission.save();
                        }
                    } else {
                        console.log('⚠️ Not enough content for auto-evaluation');
                        submission.evaluation.feedback = "Not enough content for AI evaluation";
                        await submission.save();
                    }
                } catch (evalError) {
                    console.error('Auto-evaluation error:', evalError.message);
                    // Update submission with error
                    submission.evaluation.feedback = "Evaluation error - needs manual review";
                    await submission.save();
                }
            }, 3000); // Wait 3 seconds before evaluation
            
            // ✅ Prepare response
            const submissionResponse = {
                _id: submission._id,
                assignmentId: submission.assignmentId,
                studentId: submission.studentId,
                submittedAt: submission.submittedAt,
                evaluated: submission.evaluated,
                evaluation: submission.evaluation,
                hasPdf: !!submission.pdfPath,
                hasText: !!submission.textAnswer
            };
            
            if (submission.pdfPath) {
                submissionResponse.pdfUrl = `http://localhost:5000${submission.pdfPath}`;
            }
            
            res.status(201).json({
                success: true,
                message: 'Assignment submitted successfully',
                submission: submissionResponse
            });
            
        } catch (error) {
            console.error('❌ Submit assignment error:', error);
            
            // Handle validation errors specifically
            if (error.name === 'ValidationError') {
                const errors = {};
                Object.keys(error.errors).forEach(key => {
                    errors[key] = error.errors[key].message;
                });
                
                return res.status(400).json({
                    success: false,
                    message: 'Validation error',
                    errors: errors
                });
            }
            
            res.status(500).json({
                success: false,
                message: 'Failed to submit assignment',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    }
);

// ✅ Get submission details
router.get('/submissions/:submissionId', 
    auth,
    async (req, res) => {
        try {
            const { submissionId } = req.params;
            const submission = await Submission.findById(submissionId)
                .populate('assignmentId', 'title courseId dueDate')
                .populate('studentId', 'name email');
            
            if (!submission) {
                return res.status(404).json({
                    success: false,
                    message: 'Submission not found'
                });
            }
            
            // Check permissions
            const isAdmin = req.user.role === 'admin';
            const isOwner = submission.studentId._id.toString() === req.user.id;
            
            if (!isAdmin && !isOwner) {
                return res.status(403).json({
                    success: false,
                    message: 'Not authorized to view this submission'
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
    }
);

// ✅ Get all submissions for an assignment (Admin/Teacher)
router.get('/:assignmentId/submissions', 
    auth, 
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
            
            let query = { assignmentId };
            
            // Students can only see their own submissions
            if (req.user.role === 'student') {
                query.studentId = req.user.id;
            }
            
            const submissions = await Submission.find(query)
                .populate('studentId', 'name email')
                .sort({ submittedAt: -1 });
            
            const submissionsWithUrls = submissions.map(sub => {
                const subObj = sub.toObject();
                if (sub.pdfPath) {
                    subObj.pdfUrl = `http://localhost:5000${sub.pdfPath}`;
                }
                return subObj;
            });

            res.json({
                success: true,
                submissions: submissionsWithUrls,
                count: submissions.length
            });
            
        } catch (error) {
            console.error('Get submissions error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get submissions'
            });
        }
    }
);

// ✅ Simple test route for submission
router.get('/test/submission', auth, (req, res) => {
    res.json({
        success: true,
        message: 'Submission route is working',
        user: {
            id: req.user.id,
            role: req.user.role
        },
        availableRoutes: [
            'POST /api/assignments/:assignmentId/submit',
            'GET /api/assignments/submissions/:submissionId',
            'GET /api/assignments/:assignmentId/submissions'
        ]
    });
});


module.exports = router;