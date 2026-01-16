const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Course = require('../models/Course');
const openaiService = require('../services/openaiService');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

class AssignmentController {
    // ✅ GENERATE FROM CUSTOM PROMPT (5 DESCRIPTIVE QUESTIONS)
    async generateAssignmentFromCustomPrompt(req, res) {
        try {
            const { courseId } = req.params;
            const { customPrompt, title, dueDate } = req.body;

            // Auth check
            if (!req.user || req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Only admins can generate assignments'
                });
            }

            if (!customPrompt?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Custom prompt is required'
                });
            }

            const course = await Course.findById(courseId);
            if (!course) {
                return res.status(404).json({
                    success: false,
                    message: 'Course not found'
                });
            }

            // ✅ ALWAYS 5 DESCRIPTIVE QUESTIONS
            const numQuestions = 5;

            // Generate questions using OpenAI
            const result = await openaiService.generateAssignmentFromPrompt(
                customPrompt, 
                numQuestions
            );

            if (!result.success) {
                console.error('OpenAI generation failed:', result.error);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to generate assignment',
                    error: result.error
                });
            }

            // Create assignment
            const assignment = new Assignment({
                courseId,
                title: title || `Assignment - ${course.name}`,
                questions: result.questions, // Store structured questions
                dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                numQuestions: numQuestions,
                generatedByAI: true,
                generationMethod: 'custom-prompt',
                promptUsed: customPrompt.substring(0, 500),
                createdBy: req.user.id
            });

            await assignment.save();

            // Add to course
            if (!course.assignments) course.assignments = [];
            course.assignments.push(assignment._id);
            await course.save();

            // Generate PDF
            const pdfPath = await this.generateAssignmentPDF(assignment);
            
            // Update with PDF path
            assignment.assignmentPdfPath = pdfPath;
            assignment.pdfUrl = `http://localhost:5000${pdfPath}`;
            await assignment.save();

            res.json({
                success: true,
                message: 'Assignment generated successfully (5 descriptive questions)',
                assignment: {
                    _id: assignment._id,
                    title: assignment.title,
                    courseId: assignment.courseId,
                    numQuestions: assignment.numQuestions,
                    dueDate: assignment.dueDate,
                    pdfUrl: assignment.pdfUrl,
                    downloadUrl: `http://localhost:5000${pdfPath}?download=true`,
                    questions: assignment.questions
                }
            });

        } catch (error) {
            console.error('❌ Generate assignment error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ✅ GENERATE FROM UPLOADED NOTES (5 DESCRIPTIVE QUESTIONS)
    async generateAssignmentFromNotes(req, res) {
        try {
            const { courseId } = req.params;
            const { title, dueDate } = req.body;

            // Auth check
            if (!req.user || req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Only admins can generate assignments'
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'Please upload a notes file (PDF/TXT)'
                });
            }

            const course = await Course.findById(courseId);
            if (!course) {
                return res.status(404).json({
                    success: false,
                    message: 'Course not found'
                });
            }

            // Extract text from uploaded file
            console.log('📄 Extracting text from file:', req.file.path);
            const textContent = await openaiService.extractTextFromFile(req.file.path);
            
            if (!textContent || textContent.length < 100) {
                console.log('❌ Text extraction failed:', textContent?.length);
                return res.status(400).json({
                    success: false,
                    message: 'Could not extract sufficient text from file'
                });
            }

            // ✅ ALWAYS 5 DESCRIPTIVE QUESTIONS
            const numQuestions = 5;

            // Generate questions from notes
            console.log('🤖 Generating questions from text...');
            const result = await openaiService.generateAssignmentFromText(
                textContent, 
                numQuestions
            );

            if (!result.success) {
                console.error('❌ OpenAI generation failed:', result.error);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to generate questions from notes',
                    error: result.error
                });
            }

            // Create assignment
            const assignment = new Assignment({
                courseId,
                title: title || `Notes-Based Assignment - ${course.name}`,
                questions: result.questions, // Store structured questions
                dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                numQuestions: numQuestions,
                generatedByAI: true,
                generationMethod: 'notes',
                promptUsed: "Generated from uploaded notes",
                createdBy: req.user.id
            });

            await assignment.save();

            // Add to course
            if (!course.assignments) course.assignments = [];
            course.assignments.push(assignment._id);
            await course.save();

            // Generate PDF
            const pdfPath = await this.generateAssignmentPDF(assignment);
            
            // Update with PDF path
            assignment.assignmentPdfPath = pdfPath;
            assignment.pdfUrl = `http://localhost:5000${pdfPath}`;
            await assignment.save();

            // Clean up uploaded file
            fs.unlinkSync(req.file.path);

            res.json({
                success: true,
                message: 'Assignment generated from notes (5 descriptive questions)',
                assignment: {
                    _id: assignment._id,
                    title: assignment.title,
                    courseId: assignment.courseId,
                    numQuestions: assignment.numQuestions,
                    dueDate: assignment.dueDate,
                    pdfUrl: assignment.pdfUrl,
                    downloadUrl: `http://localhost:5000${pdfPath}?download=true`,
                    questions: assignment.questions
                }
            });

        } catch (error) {
            console.error('❌ Generate from notes error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ✅ GENERATE PDF FOR ASSIGNMENT (5 QUESTIONS FORMAT)
    async generateAssignmentPDF(assignment) {
        return new Promise((resolve, reject) => {
            try {
                const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'assignments');
                
                if (!fs.existsSync(uploadsDir)) {
                    fs.mkdirSync(uploadsDir, { recursive: true });
                }

                const fileName = `assignment_${assignment._id}_${Date.now()}.pdf`;
                const filePath = path.join(uploadsDir, fileName);
                const publicPath = `/uploads/assignments/${fileName}`;

                const doc = new PDFDocument({ margin: 50 });
                const stream = fs.createWriteStream(filePath);
                
                doc.pipe(stream);

                // Header
                doc.fontSize(20).text(assignment.title || 'Assignment', { align: 'center' });
                doc.moveDown();
                
                // Course Info
                doc.fontSize(12)
                   .text(`Course: ${assignment.courseId}`, { continued: true })
                   .text(` | Due Date: ${assignment.dueDate.toLocaleDateString()}`, { align: 'right' });
                
                doc.text(`Questions: ${assignment.numQuestions} | Total Marks: ${assignment.numQuestions * 10}`);
                doc.text(`Type: Descriptive Questions`);
                doc.moveDown();
                
                doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
                doc.moveDown();

                // Questions
                doc.fontSize(16).text('QUESTIONS:', { underline: true });
                doc.moveDown();

                assignment.questions.forEach((q, index) => {
                    doc.fontSize(14).text(`Q${index + 1}. ${q.questionText}`, { underline: false });
                    doc.fontSize(10).text(`[${q.marks} Marks | Difficulty: ${q.difficulty}]`);
                    doc.moveDown(0.5);
                    
                    if (q.expectedPoints && q.expectedPoints.length > 0) {
                        doc.fontSize(10).text('Expected Points:');
                        q.expectedPoints.forEach(point => {
                            doc.fontSize(10).text(`• ${point}`, { indent: 20 });
                        });
                    }
                    
                    doc.moveDown();
                });

                // Footer
                doc.moveDown(2);
                doc.fontSize(10)
                   .text('-'.repeat(50), { align: 'center' })
                   .text('Generated by AI Assignment System', { align: 'center' })
                   .text(new Date().toLocaleString(), { align: 'center' });

                doc.end();

                stream.on('finish', () => {
                    if (fs.existsSync(filePath)) {
                        console.log(`✅ PDF created: ${publicPath}`);
                        resolve(publicPath);
                    } else {
                        reject(new Error('PDF file was not created'));
                    }
                });

                stream.on('error', reject);

            } catch (error) {
                console.error('❌ PDF generation error:', error);
                reject(error);
            }
        });
    }

    // ✅ EVALUATE SUBMISSION - FIXED VERSION
    async evaluateSubmission(req, res) {
        try {
            const { submissionId } = req.params;

            console.log('📝 Starting evaluation for submission:', submissionId);

            // Auth check
            if (!req.user || req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Only admins can evaluate submissions'
                });
            }

            const submission = await Submission.findById(submissionId)
                .populate('assignmentId');
            
            if (!submission) {
                return res.status(404).json({
                    success: false,
                    message: 'Submission not found'
                });
            }

            const assignment = await Assignment.findById(submission.assignmentId);
            if (!assignment) {
                return res.status(404).json({
                    success: false,
                    message: 'Assignment not found'
                });
            }

            console.log('📊 Assignment found:', assignment.title);
            console.log('📝 Submission type:', submission.textAnswer ? 'Text' : 'PDF');

            // Get student answer text
            let studentAnswerText = '';
            
           if (submission.pdfPath) {
    const pdfPath = path.join(__dirname, '..', 'public', submission.pdfPath);
    if (fs.existsSync(pdfPath)) {
        console.log('📄 Extracting text from PDF:', pdfPath);
        studentAnswerText = await openaiService.extractTextFromPDFFile(pdfPath);
        console.log('✅ PDF text extracted, length:', studentAnswerText?.length || 0);
    }
} else if (submission.textAnswer && submission.textAnswer.trim().length > 0) {
    studentAnswerText = submission.textAnswer;
    console.log('📝 Using text answer, length:', studentAnswerText.length);
}


            if (!studentAnswerText || studentAnswerText.trim().length < 50) {
                console.log('⚠️ Text too short for evaluation:', studentAnswerText?.length || 0);
                
                // Update with zero score for empty submission
                await Submission.findByIdAndUpdate(submissionId, {
                    evaluated: true,
                    evaluation: {
                        obtainedMarks: 0,
                        totalMarks: assignment.numQuestions * 10,
                        percentage: 0,
                        score: 0,
                        feedback: "Submission is empty or too short for evaluation.",
                        evaluatedAt: new Date(),
                        aiGenerated: true,
                        autoEvaluated: false
                    }
                });

                return res.json({
                    success: true,
                    message: 'Evaluation completed (empty submission)',
                    evaluation: { 
                        score: 0, 
                        obtainedMarks: 0,
                        feedback: "Empty submission" 
                    }
                });
            }

            console.log('🤖 Sending to OpenAI for evaluation...');
            console.log('📝 Question count:', assignment.questions.length);
            console.log('📝 Student answer preview:', studentAnswerText.substring(0, 200));

            // Evaluate using OpenAI
            const evaluationResult = await openaiService.evaluateAssignmentSubmission(
                assignment.questions,
                studentAnswerText
            );

            console.log('📊 OpenAI evaluation result:', {
                success: evaluationResult.success,
                obtainedMarks: evaluationResult.evaluation?.obtainedMarks,
                totalMarks: evaluationResult.evaluation?.totalMarks,
                feedbackLength: evaluationResult.evaluation?.detailedFeedback?.length
            });

            if (!evaluationResult.success) {
                console.error('❌ OpenAI evaluation failed:', evaluationResult.error);
                throw new Error(evaluationResult.error || 'Evaluation failed');
            }

            // Update submission
            const evaluationData = {
                obtainedMarks: evaluationResult.evaluation.obtainedMarks,
                totalMarks: evaluationResult.evaluation.totalMarks,
                percentage: evaluationResult.evaluation.percentage,
                score: evaluationResult.evaluation.obtainedMarks, // ✅ IMPORTANT: score = obtainedMarks
                feedback: evaluationResult.evaluation.detailedFeedback,
                questionWiseEvaluation: evaluationResult.evaluation.questionWiseEvaluation,
                strengths: evaluationResult.evaluation.strengths,
                weaknesses: evaluationResult.evaluation.weaknesses,
                evaluatedAt: new Date(),
                aiGenerated: true,
                autoEvaluated: false
            };

            console.log('💾 Saving evaluation data:', {
                score: evaluationData.score,
                obtainedMarks: evaluationData.obtainedMarks,
                feedbackLength: evaluationData.feedback?.length
            });

            submission.evaluated = true;
            submission.evaluation = evaluationData;
            await submission.save();

            res.json({
                success: true,
                message: 'Evaluation completed successfully',
                evaluation: submission.evaluation,
                submissionId: submission._id
            });

        } catch (error) {
            console.error('❌ Evaluation error:', error);
            res.status(500).json({
                success: false,
                message: 'Evaluation failed',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ✅ AUTO-EVALUATE ON SUBMISSION - FIXED VERSION
    async autoEvaluateSubmission(submissionId) {
        try {
            console.log('🤖 Starting auto-evaluation for submission:', submissionId);
            
            const submission = await Submission.findById(submissionId)
                .populate('assignmentId');
            
            if (!submission) {
                console.log('❌ Submission not found:', submissionId);
                return;
            }

            if (submission.evaluated) {
                console.log('📌 Submission already evaluated');
                return;
            }

            const assignment = await Assignment.findById(submission.assignmentId);
            if (!assignment) {
                console.log('❌ Assignment not found for submission:', submissionId);
                return;
            }

            // Get student answer text
            let studentAnswerText = '';
            if (submission.pdfPath) {
    const pdfPath = path.join(__dirname, '..', 'public', submission.pdfPath);
    if (fs.existsSync(pdfPath)) {
        console.log('📄 Auto-eval: Extracting from PDF:', pdfPath);
        studentAnswerText = await openaiService.extractTextFromPDFFile(pdfPath);
        console.log('✅ Auto-eval: PDF text length:', studentAnswerText?.length || 0);
    }
} else if (submission.textAnswer && submission.textAnswer.trim().length > 0) {
    studentAnswerText = submission.textAnswer;
    console.log('📝 Auto-eval: Using text answer, length:', studentAnswerText.length);
}


            if (!studentAnswerText || studentAnswerText.trim().length < 50) {
                console.log('⚠️ Auto-eval: Text too short, length:', studentAnswerText?.length || 0);
                
                // Mark as evaluated with zero score
                await Submission.findByIdAndUpdate(submissionId, {
                    evaluated: true,
                    evaluation: {
                        obtainedMarks: 0,
                        totalMarks: assignment.numQuestions * 10,
                        percentage: 0,
                        score: 0,
                        feedback: "Auto-evaluation: Submission too short for meaningful evaluation.",
                        evaluatedAt: new Date(),
                        aiGenerated: true,
                        autoEvaluated: true
                    }
                });
                return;
            }

            console.log('🤖 Auto-eval: Sending to OpenAI...');
            const evaluationResult = await openaiService.evaluateAssignmentSubmission(
                assignment.questions,
                studentAnswerText
            );

            if (evaluationResult.success) {
                console.log('✅ Auto-evaluation successful');
                
                await Submission.findByIdAndUpdate(submissionId, {
                    evaluated: true,
                    evaluation: {
                        obtainedMarks: evaluationResult.evaluation.obtainedMarks,
                        totalMarks: evaluationResult.evaluation.totalMarks,
                        percentage: evaluationResult.evaluation.percentage,
                        score: evaluationResult.evaluation.obtainedMarks,
                        feedback: evaluationResult.evaluation.detailedFeedback,
                        questionWiseEvaluation: evaluationResult.evaluation.questionWiseEvaluation,
                        strengths: evaluationResult.evaluation.strengths,
                        weaknesses: evaluationResult.evaluation.weaknesses,
                        evaluatedAt: new Date(),
                        aiGenerated: true,
                        autoEvaluated: true
                    }
                });
            } else {
                console.log('❌ Auto-evaluation failed:', evaluationResult.error);
                
                // Save error state
                await Submission.findByIdAndUpdate(submissionId, {
                    evaluation: {
                        score: 0,
                        feedback: "Auto-evaluation failed. Please evaluate manually.",
                        evaluatedAt: new Date(),
                        aiGenerated: false,
                        autoEvaluated: false
                    }
                });
            }

        } catch (error) {
            console.error('❌ Auto-evaluation error:', error);
        }
    }

    // ✅ GET ASSIGNMENT DETAILS
    async getAssignment(req, res) {
        try {
            const { assignmentId } = req.params;

            const assignment = await Assignment.findById(assignmentId)
                .populate('courseId', 'name code');

            if (!assignment) {
                return res.status(404).json({
                    success: false,
                    message: 'Assignment not found'
                });
            }

            // Add PDF URLs
            const assignmentObj = assignment.toObject();
            assignmentObj.viewPdfUrl = `http://localhost:5000/api/assignments/${assignment._id}/pdf`;
            assignmentObj.downloadPdfUrl = `http://localhost:5000/api/assignments/${assignment._id}/pdf?download=true`;

            // Check student submission if student
            if (req.user.role === 'student') {
                const submission = await Submission.findOne({
                    assignmentId,
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
    }

    // ✅ GENERATE ASSIGNMENT FOR NEW COURSE
    async generateAssignmentForNewCourse(courseId, courseName) {
        try {
            console.log(`🚀 Auto-generating assignment for new course: ${courseName} (${courseId})`);

            // Find course
            const course = await Course.findById(courseId);
            if (!course) {
                console.log('❌ Course not found for auto-generation');
                return null;
            }

            // Default assignment title
            const assignmentTitle = `Assignment - ${courseName}`;

            // Course description se descriptive questions generate karein
            const courseDescription = course.description || "General Course Content";
            
            // ✅ ALWAYS 5 DESCRIPTIVE QUESTIONS
            const customPrompt = `Generate 5 descriptive questions based on this course: ${courseName}. 
    Description: ${courseDescription.substring(0, 500)}`;

            // OpenAIService se questions generate karein
            const result = await openaiService.generateAssignmentFromPrompt(
                customPrompt, 
                5 // ✅ HAR BAAR 5 QUESTIONS
            );

            if (!result.success) {
                console.error('❌ AI assignment generation failed:', result.error);
                return null;
            }

            // Create assignment
            const assignment = new Assignment({
                courseId,
                title: assignmentTitle,
                questions: result.questions,
                dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
                numQuestions: 5, // ✅ FIXED 5 QUESTIONS
                generatedByAI: true,
                generationMethod: 'custom-prompt',
                promptUsed: customPrompt.substring(0, 500),
                createdBy: null // System generated
            });

            await assignment.save();

            // Course mein assignment ID add karein
            if (!course.assignments) course.assignments = [];
            course.assignments.push(assignment._id);
            await course.save();

            // PDF generate karein
            const pdfPath = await this.generateAssignmentPDF(assignment);
            
            // Update assignment with PDF
            assignment.assignmentPdfPath = pdfPath;
            assignment.pdfUrl = `http://localhost:5000${pdfPath}`;
            await assignment.save();

            console.log(`✅ Auto-assignment created: ${assignment._id}`);
            return assignment;

        } catch (error) {
            console.error('❌ Auto-assignment generation error:', error);
            return null;
        }
    }
}

// Create instance
const assignmentController = new AssignmentController();

// ✅ CORRECT EXPORT (EXACTLY YAHI KARNA HAI):
module.exports = assignmentController;