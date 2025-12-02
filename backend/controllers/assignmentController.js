// controllers/assignmentController.js - FIXED: Added mongoose import & ID validation in getAssignmentsByCourse to route correctly
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const ollama = require('ollama').default;
const pdfParse = require('pdf-parse');
const { fromBuffer } = require('pdf2pic'); // FIXED: Use fromBuffer for buffer-based OCR
const { createWorker } = require('tesseract.js');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { uploadPDF } = require('../middleware/multer');
const PDFDocument = require('pdfkit'); // For generating assignment PDFs
const os = require('os'); // For temp files
const mongoose = require('mongoose'); // FIXED: Import for ID validation

// FIXED: Model change to 'llama3.2:3b'
const MODEL = 'llama3.2:3b'; // Lightweight & faster

// Extracted function for evaluation logic (fixed: pass fullPath or use buffer/temp for OCR)
async function evaluateSubmissionLogic(submission, dataBuffer, fullPath) {
    let studentAnswer = '';

    // PDF Parse first
    let pdfData;
    try {
        pdfData = await pdfParse(dataBuffer);
    } catch (parseError) {
        console.error('PDF Parse error:', parseError);
    }

    if (pdfData && pdfData.text && pdfData.text.trim().length > 0) {
        studentAnswer = pdfData.text.trim();
    } else {
        // OCR fallback (FIXED: Use buffer to create temp PDF file for pdf2pic)
        const tempDir = path.join(os.tmpdir(), 'ocr_temp');
        await fs.mkdir(tempDir, { recursive: true });

        // Write buffer to temp PDF
        const tempPdfPath = path.join(tempDir, 'temp_submission.pdf');
        await fs.writeFile(tempPdfPath, dataBuffer);

        try {
            const convert = fromBuffer(dataBuffer, {  // FIXED: Use fromBuffer directly
                density: 200,
                saveFilename: "page",
                savePath: tempDir,
                format: "png",
                width: 1500,
                height: 1500
            });

            const convertResult = await convert.bulk(-1);

            const worker = await createWorker('eng');
            let ocrText = '';
            for (let i = 0; i < convertResult.length; i++) {
                const imagePath = convertResult[i].path;
                const { data: { text } } = await worker.recognize(imagePath);
                ocrText += text + '\n--- Page Break ---\n';
                await fs.unlink(imagePath);
            }
            await worker.terminate();
            studentAnswer = ocrText.trim();
        } catch (ocrError) {
            console.error('OCR error:', ocrError);
        } finally {
            // Cleanup temp
            await fs.unlink(tempPdfPath).catch(() => {});
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }

    if (studentAnswer.length === 0) {
        throw new Error('PDF is empty or unreadable');
    }

    // FIXED: Populate assignment for questions
    const populatedSubmission = await Submission.findById(submission._id).populate('assignmentId');
    const questions = populatedSubmission.assignmentId.questions.join('\n');
    
    // OPTIMIZED: Shorter prompt for Ollama (JSON format for easy parse) + FIXED model
    const evalPrompt = `Evaluate student answers against these questions: ${questions.substring(0, 1000)}\nStudent answers: ${studentAnswer.substring(0, 2000)}\n\nRespond ONLY in JSON: {"score": number (0-100), "feedback": "string (detailed, 2-3 sentences)", "remarks": "string (1-2 tips)"}. No extra text.`;

    try {
        const response = await ollama.generate({
            model: MODEL, // FIXED: 'llama3.2:3b'
            prompt: evalPrompt,
            options: { temperature: 0.5, num_predict: 300 } // FIXED: Lower for speed + shorter output
        });

        const evalText = response.response.trim();
        console.log('Ollama raw response:', evalText.substring(0, 200)); // Debug

        // FIXED: Better JSON parsing
        let evalData;
        try {
            evalData = JSON.parse(evalText);
        } catch (parseErr) {
            // Fallback: Regex extract
            const scoreMatch = evalText.match(/"score":\s*(\d+)/i);
            const feedbackMatch = evalText.match(/"feedback":\s*"([^"]+)"/i);
            const remarksMatch = evalText.match(/"remarks":\s*"([^"]+)"/i);
            evalData = {
                score: scoreMatch ? parseInt(scoreMatch[1]) : 50,
                feedback: feedbackMatch ? feedbackMatch[1] : 'Evaluation incomplete. Please review your answers.',
                remarks: remarksMatch ? remarksMatch[1] : 'Tip: Ensure answers are clear and complete.'
            };
        }

        return {
            score: Math.max(0, Math.min(100, evalData.score || 0)),
            feedback: evalData.feedback || 'No feedback available.',
            remarks: evalData.remarks || 'No remarks.'
        };
    } catch (ollamaErr) {
        console.error('Ollama eval error:', ollamaErr);
        return { score: 50, feedback: 'AI evaluation unavailable. Manual review needed.', remarks: 'Check Ollama server.' };
    }
}

// Get Single Assignment by ID (unchanged)
exports.getAssignmentById = async (req, res) => {
    try {
        const { id } = req.params;
        const assignment = await Assignment.findById(id).populate('courseId', 'name');
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
        res.json(assignment);
    } catch (error) {
        console.error('Get assignment by ID error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Manual Assignment Create (unchanged)
exports.createAssignment = async (req, res) => {
    try {
        const { courseId, title, questions, dueDate } = req.body;
        if (!courseId || !title || !questions || !dueDate) {
            return res.status(400).json({ message: 'Course ID, title, questions, and dueDate required' });
        }
        const course = await Course.findById(courseId);
        if (!course) return res.status(404).json({ message: 'Course not found' });

        const assignment = new Assignment({
            courseId,
            title,
            questions: Array.isArray(questions) ? questions : questions.split(',').map(q => q.trim()),
            dueDate: new Date(dueDate),
            generatedByAI: false
        });
        await assignment.save();

        // Add to course
        course.assignments.push(assignment._id);
        await course.save();

        res.status(201).json({ message: 'Assignment created successfully', assignment });
    } catch (error) {
        console.error('Create assignment error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// AI Generate Questions & Create Assignment + PDF (FIXED: Model change + shorter prompt/options)
exports.generateQuestions = async (req, res) => {
    try {
        const { courseId, prompt, numQuestions = 5, type = 'mixed', dueDate } = req.body;
        if (!courseId || !prompt || !dueDate) {
            return res.status(400).json({ message: 'Course ID, prompt, and dueDate required' });
        }
        const course = await Course.findById(courseId).populate('topics');
        if (!course) return res.status(404).json({ message: 'Course not found' });

        // OPTIMIZED: Short course content
        let courseContent = course.description.substring(0, 300) || '';
        if (course.topics && course.topics.length > 0) {
            courseContent += '\nTopics: ' + course.topics.map(t => t.name).join(', ').substring(0, 200);
        }

        const fullPrompt = `${prompt}. Based on: ${courseContent}. Generate exactly ${numQuestions} ${type} questions. Numbered: 1. Q? (MCQ: A/B/C/D). Respond as numbered list only.`;

        const response = await ollama.generate({
            model: MODEL, // FIXED: 'llama3.2:3b'
            prompt: fullPrompt,
            options: { temperature: 0.5, num_predict: 600 } // FIXED: Shorter for speed
        });

        const generatedText = response.response;
        const questions = generatedText.split('\n').filter(line => line.trim() && line.match(/^\d+\./)).map(line => line.trim());

        if (questions.length < numQuestions) {
            return res.status(400).json({ message: 'AI generated fewer questions than requested' });
        }

        const assignment = new Assignment({
            courseId,
            title: `AI Assignment: ${prompt.substring(0, 50)}...`,
            questions: questions.slice(0, numQuestions),
            dueDate: new Date(dueDate),
            generatedByAI: true,
            promptUsed: fullPrompt,
            type,
            numQuestions
        });
        await assignment.save();

        course.assignments.push(assignment._id);
        await course.save();

        // Generate PDF
        const pdfPath = await generateAssignmentPDF(assignment);

        assignment.assignmentPdfPath = pdfPath;
        await assignment.save();

        res.json({ message: 'AI assignment created with PDF', assignment, questions });
    } catch (error) {
        console.error('AI generate error:', error);
        res.status(500).json({ message: 'AI generation failed', error: error.message });
    }
};

// Helper: Generate PDF (unchanged)
async function generateAssignmentPDF(assignment) {
    return new Promise((resolve, reject) => {
        const assignmentsDir = path.join(__dirname, '..', 'public', 'uploads', 'assignments');
        if (!fsSync.existsSync(assignmentsDir)) {
            fsSync.mkdirSync(assignmentsDir, { recursive: true });
        }

        const timestamp = Date.now();
        const filename = `assignment-${assignment._id}-${timestamp}.pdf`;
        const fullPath = path.join(assignmentsDir, filename);
        const relativePath = `uploads/assignments/${filename}`;

        const doc = new PDFDocument();
        doc.pipe(fsSync.createWriteStream(fullPath));

        doc.fontSize(20).text(assignment.title, { align: 'center' });
        doc.moveDown();

        assignment.questions.forEach((q, index) => {
            doc.fontSize(14).text(`${index + 1}. ${q}`);
            doc.moveDown(0.5);
        });

        doc.fontSize(12).text(`Due Date: ${assignment.dueDate.toLocaleString()}`, { align: 'right' });
        doc.end();

        doc.on('end', () => resolve(relativePath));
        doc.on('error', reject);
    });
}

// Get Assignments by Course (FIXED: Added ID validation to route correctly - if not valid course, next() to /:id route)
exports.getAssignmentsByCourse = async (req, res, next) => {
    try {
        const { courseId } = req.params;

        // FIXED: Validate if valid ObjectId and exists as Course - else next() to single assignment route
        if (!mongoose.isValidObjectId(courseId)) {
            return next();
        }

        const course = await Course.findById(courseId).select('_id'); // Quick check
        if (!course) {
            return next();
        }

        // Now full populate for assignments
        const fullCourse = await Course.findById(courseId).populate('assignments');
        if (!fullCourse) return res.status(404).json({ message: 'Course not found' });

        const now = new Date();
        const activeAssignments = fullCourse.assignments.filter(a => new Date(a.dueDate) > now);

        if (req.user.role === 'student') {
            const enrollment = await Enrollment.findOne({ studentId: req.user.id, courseId });
            if (!enrollment) return res.status(403).json({ message: 'Not enrolled' }); // FIXED: 403 for unenrolled

            const assignmentsWithStatus = await Promise.all(activeAssignments.map(async (assign) => {
                const submission = await Submission.findOne({ studentId: req.user.id, assignmentId: assign._id });
                const plain = assign.toObject();
                plain.hasSubmitted = !!submission;
                plain.submittedAt = submission ? submission.submittedAt : null;
                plain.pdfUrl = assign.assignmentPdfPath ? `/${assign.assignmentPdfPath}` : null; // FIXED: Direct relative
                if (submission && submission.evaluation) {
                    plain.score = submission.evaluation.score;
                    plain.feedback = submission.evaluation.feedback;
                    plain.remarks = submission.evaluation.remarks;
                }
                return plain;
            }));
            return res.json(assignmentsWithStatus);
        }

        // For admin
        const adminAssignments = activeAssignments.map(assign => ({
            ...assign.toObject(),
            pdfUrl: assign.assignmentPdfPath ? `/${assign.assignmentPdfPath}` : null // FIXED
        }));

        res.json(adminAssignments);
    } catch (error) {
        console.error('Get assignments error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Get All Assignments (FIXED: pdfUrl)
exports.getAllAssignments = async (req, res) => {
    try {
        const assignments = await Assignment.find()
            .populate('courseId', 'name description')
            .populate({
                path: 'submissions',
                populate: { path: 'studentId', select: 'name' }
            });
        
        const assignmentsWithCounts = assignments.map(assignment => {
            const pendingCount = assignment.submissions ? 
                assignment.submissions.filter(s => !s.evaluated).length : 0;
            return {
                ...assignment.toObject(),
                pendingSubmissions: pendingCount,
                pdfUrl: assignment.assignmentPdfPath ? `/${assignment.assignmentPdfPath}` : null // FIXED
            };
        });

        res.json(assignmentsWithCounts);
    } catch (error) {
        console.error('Get all assignments error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Get Submissions by Assignment (unchanged)
exports.getSubmissionsByAssignment = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const assignment = await Assignment.findById(assignmentId);
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

        const submissions = await Submission.find({ assignmentId })
            .populate({
                path: 'studentId',
                select: 'name email'
            })
            .sort({ submittedAt: -1 })
            .lean();

        const pendingSubmissions = submissions.filter(s => !s.evaluated);

        res.json(pendingSubmissions);
    } catch (error) {
        console.error('Get submissions by assignment error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Update Assignment (unchanged, but PDF regen fixed)
exports.updateAssignment = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, courseId, dueDate, questions } = req.body;
        if (!title || !courseId || !dueDate) {
            return res.status(400).json({ message: 'Title, courseId, and dueDate required' });
        }

        const assignment = await Assignment.findById(id).populate('courseId');
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

        // Update course reference if changed
        if (assignment.courseId.toString() !== courseId) {
            const oldCourse = await Course.findById(assignment.courseId);
            if (oldCourse) {
                oldCourse.assignments = oldCourse.assignments.filter(a => a.toString() !== id);
                await oldCourse.save();
            }

            const newCourse = await Course.findById(courseId);
            if (newCourse) {
                if (!newCourse.assignments.includes(assignment._id)) {
                    newCourse.assignments.push(assignment._id);
                    await newCourse.save();
                }
            }

            assignment.courseId = courseId;
        }

        assignment.title = title;
        assignment.dueDate = new Date(dueDate);
        if (questions) {
            assignment.questions = questions;
            const pdfPath = await generateAssignmentPDF(assignment);
            assignment.assignmentPdfPath = pdfPath;
        }
        await assignment.save();

        const updatedAssignment = await Assignment.findById(id).populate('courseId', 'name');

        res.json({ message: 'Assignment updated successfully', assignment: updatedAssignment });
    } catch (error) {
        console.error('Update assignment error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Delete Assignment (FIXED: Path cleanup)
exports.deleteAssignment = async (req, res) => {
    try {
        const { id } = req.params;
        const assignment = await Assignment.findById(id).populate('courseId');
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

        // Remove from course
        if (assignment.courseId && assignment.courseId.assignments) {
            assignment.courseId.assignments = assignment.courseId.assignments.filter(a => a.toString() !== id);
            await assignment.courseId.save();
        }

        // Delete PDF if exists
        if (assignment.assignmentPdfPath) {
            const relativePath = assignment.assignmentPdfPath.startsWith('/') ? assignment.assignmentPdfPath.substring(1) : assignment.assignmentPdfPath;
            const fullPath = path.join(__dirname, '..', 'public', relativePath);
            if (fsSync.existsSync(fullPath)) {
                fsSync.unlinkSync(fullPath);
            }
        }

        // Delete related submissions
        const submissions = await Submission.find({ assignmentId: id });
        for (const submission of submissions) {
            if (submission.pdfPath) {
                const relativePath = submission.pdfPath.startsWith('/') ? submission.pdfPath.substring(1) : submission.pdfPath;
                const fullPath = path.join(__dirname, '..', 'public', relativePath);
                if (fsSync.existsSync(fullPath)) {
                    fsSync.unlinkSync(fullPath);
                }
            }
        }
        await Submission.deleteMany({ assignmentId: id });

        await Assignment.findByIdAndDelete(id);

        res.json({ message: 'Assignment, PDF, and submissions deleted' });
    } catch (error) {
        console.error('Delete assignment error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Submit Assignment (FIXED: Use evaluate logic properly, paths clean, Ollama integrated with new model)
exports.submitAssignment = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        if (!assignmentId || !req.file) {
            return res.status(400).json({ message: 'Assignment ID and PDF required' });
        }

        console.log('Multer file received - path:', req.file.path);

        const assignment = await Assignment.findById(assignmentId).populate('courseId');
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

        const enrollment = await Enrollment.findOne({ studentId: req.user.id, courseId: assignment.courseId._id });
        if (!enrollment) return res.status(403).json({ message: 'Not enrolled' });

        const now = new Date();
        if (now > assignment.dueDate) return res.status(400).json({ message: 'Deadline passed' });

        const existing = await Submission.findOne({ studentId: req.user.id, assignmentId });
        if (existing) return res.status(400).json({ message: 'Already submitted' });

        // FIXED: Clean relative path
        let filePath = req.file.path.replace(/\\/g, '/');
        const publicIndex = filePath.toLowerCase().indexOf('public/');
        if (publicIndex !== -1) {
            filePath = filePath.substring(publicIndex + 7);
        }
        const uploadsIndex = filePath.toLowerCase().indexOf('uploads/');
        if (uploadsIndex !== -1) {
            filePath = filePath.substring(uploadsIndex);
        } else {
            filePath = `uploads/submissions/${path.basename(req.file.filename)}`; // Fallback
        }
        console.log('Stored relative PDF path:', filePath);

        const submission = new Submission({
            assignmentId,
            studentId: req.user.id,
            pdfPath: `/${filePath}`, // Start with /
            submittedAt: now
        });
        await submission.save();

        if (assignment.submissions && !assignment.submissions.includes(submission._id)) {
            assignment.submissions.push(submission._id);
            await assignment.save();
        }

        // Auto AI Evaluate
        const fullPath = path.join(__dirname, '..', 'public', filePath.substring(1)); // Remove leading /
        if (!fsSync.existsSync(fullPath)) {
            return res.status(404).json({ message: 'PDF file not saved properly' });
        }

        const dataBuffer = fsSync.readFileSync(fullPath);
        try {
            const evaluation = await evaluateSubmissionLogic(submission, dataBuffer, fullPath);
            submission.evaluation = evaluation;
            submission.evaluated = true;
            await submission.save();
            console.log('Auto evaluation completed: Score', evaluation.score);
        } catch (evalError) {
            console.error('Auto eval error:', evalError);
            submission.evaluated = false;
            await submission.save();
        }

        res.json({ message: 'Assignment submitted and evaluated!', submission });
    } catch (error) {
        console.error('Submit assignment error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// AI Evaluate Submission (Manual for admin, fixed)
exports.evaluateSubmission = async (req, res) => {
    try {
        const { submissionId } = req.params;
        console.log('Evaluating submission ID:', submissionId);
        
        const submission = await Submission.findById(submissionId).populate('assignmentId');
        if (!submission || submission.evaluated) {
            return res.status(400).json({ message: 'Submission not found or already evaluated' });
        }
        console.log('Submission loaded, PDF Path:', submission.pdfPath);

        let relativePath = submission.pdfPath.substring(1); // Remove leading /
        const fullPath = path.join(__dirname, '..', 'public', relativePath);
        console.log('Full PDF path:', fullPath, 'Exists?', fsSync.existsSync(fullPath));

        if (!fsSync.existsSync(fullPath)) {
            return res.status(404).json({ message: 'PDF file not found' });
        }

        const dataBuffer = fsSync.readFileSync(fullPath);
        const evaluation = await evaluateSubmissionLogic(submission, dataBuffer, fullPath);

        submission.evaluation = evaluation;
        submission.evaluated = true;
        await submission.save();

        res.json({ message: 'Evaluation completed', evaluation });
    } catch (error) {
        console.error('Evaluation Error:', error);
        res.status(500).json({ message: 'Evaluation failed', error: error.message });
    }
};