// controllers/assignmentController.js - Fixed: PDF to image with pdf2pic + Tesseract OCR for scanned PDFs
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
// Fixed Import: Standard CJS for ollama (ESM default export)
const ollama = require('ollama').default;
const pdfParse = require('pdf-parse'); // For text-based PDFs
const { fromPath } = require('pdf2pic'); // NEW: PDF to images (needs Ghostscript)
const { createWorker } = require('tesseract.js'); // For OCR on images
const fs = require('fs').promises; // Use promises for async
const path = require('path');
const { uploadPDF } = require('../middleware/multer');

// NEW: Get Single Assignment by ID (for admin edit)
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

// Manual Assignment Create (Kept for compatibility, but frontend won't use it now)
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

// AI Generate Questions & Create Assignment (Now with fixed import and object format)
exports.generateQuestions = async (req, res) => {
    try {
        const { courseId, prompt, numQuestions = 5, type = 'mixed', dueDate } = req.body;
        if (!courseId || !prompt || !dueDate) {
            return res.status(400).json({ message: 'Course ID, prompt, and dueDate required' });
        }
        const course = await Course.findById(courseId).populate('topics');
        if (!course) return res.status(404).json({ message: 'Course not found' });

        // Build course content
        let courseContent = course.description || '';
        if (course.topics && course.topics.length > 0) {
            courseContent += '\nTopics Content: ';
            course.topics.forEach(topic => {
                courseContent += `\nTopic: ${topic.name}. Description: ${topic.description}. Summary: ${topic.contentSummary || ''}. `;
                if (topic.videos && topic.videos.length > 0) {
                    courseContent += `Videos: ${topic.videos.map(v => v.topic + ' (' + v.url + ')').join('; ')}. `;
                }
                if (topic.resources && topic.resources.length > 0) {
                    courseContent += `Resources: ${topic.resources.map(r => r.name + ' (' + r.url + ')').join('; ')}.`;
                }
            });
        }

        const fullPrompt = `${prompt}. Course content to base questions on: ${courseContent}. Generate exactly ${numQuestions} ${type} questions. Format as numbered list: 1. Question text? (For MCQs: options A) B) C) D)).`;

        // Fixed: Use object format with default import
        const response = await ollama.generate({
            model: 'llama3',
            prompt: fullPrompt
        });

        const generatedText = response.response;
        const questions = generatedText.split('\n').filter(line => line.trim() && line.match(/^\d+\./)).map(line => line.trim());

        if (questions.length < numQuestions) {
            return res.status(400).json({ message: 'AI generated fewer questions than requested' });
        }

        const assignment = new Assignment({
            courseId,
            title: `AI Generated Assignment: ${prompt.substring(0, 50)}...`,
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

        res.json({ message: 'AI questions generated and assignment created', assignment, questions });
    } catch (error) {
        console.error('AI generate error:', error);
        res.status(500).json({ message: 'AI generation failed', error: error.message });
    }
};

// Get Assignments by Course (for students/admins)
exports.getAssignmentsByCourse = async (req, res) => {
    try {
        const { courseId } = req.params;
        const course = await Course.findById(courseId).populate('assignments');
        if (!course) return res.status(404).json({ message: 'Course not found' });

        const now = new Date();
        const activeAssignments = course.assignments.filter(a => new Date(a.dueDate) > now);

        // For students: Add submission status
        if (req.user.role === 'student') {
            const enrollment = await Enrollment.findOne({ studentId: req.user.id, courseId });
            if (!enrollment) return res.status(403).json({ message: 'Not enrolled' });

            const assignmentsWithStatus = await Promise.all(activeAssignments.map(async (assign) => {
                const submission = await Submission.findOne({ studentId: req.user.id, assignmentId: assign._id });
                const plain = assign.toObject();
                plain.hasSubmitted = !!submission;
                plain.submittedAt = submission ? submission.submittedAt : null;
                if (submission && submission.evaluation) {
                    plain.score = submission.evaluation.score;
                    plain.feedback = submission.evaluation.feedback;
                }
                return plain;
            }));
            return res.json(assignmentsWithStatus);
        }

        res.json(activeAssignments);
    } catch (error) {
        console.error('Get assignments error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Get All Assignments (for admin) - Updated to include pending submissions count
exports.getAllAssignments = async (req, res) => {
    try {
        // Populate course and submissions for pending count
        const assignments = await Assignment.find()
            .populate('courseId', 'name description')
            .populate({
                path: 'submissions',
                populate: { path: 'studentId', select: 'name' }
            });
        
        // Add pending count to each assignment
        const assignmentsWithCounts = assignments.map(assignment => {
            const pendingCount = assignment.submissions ? 
                assignment.submissions.filter(s => !s.evaluated).length : 0;
            return {
                ...assignment.toObject(),
                pendingSubmissions: pendingCount
            };
        });

        res.json(assignmentsWithCounts);
    } catch (error) {
        console.error('Get all assignments error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// NEW: Get Submissions by Assignment (for admin evaluate modal)
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

        // Filter pending (not evaluated)
        const pendingSubmissions = submissions.filter(s => !s.evaluated);

        res.json(pendingSubmissions);
    } catch (error) {
        console.error('Get submissions by assignment error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// NEW: Update Assignment (for admin edit)
exports.updateAssignment = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, courseId, dueDate } = req.body;
        if (!title || !courseId || !dueDate) {
            return res.status(400).json({ message: 'Title, courseId, and dueDate required' });
        }

        const assignment = await Assignment.findById(id);
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
        await assignment.save();

        const updatedAssignment = await Assignment.findById(id).populate('courseId', 'name');

        res.json({ message: 'Assignment updated successfully', assignment: updatedAssignment });
    } catch (error) {
        console.error('Update assignment error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// NEW: Delete Assignment (for admin delete)
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

        // Delete related submissions
        const submissions = await Submission.find({ assignmentId: id });
        for (const submission of submissions) {
            // Delete PDF file if exists - Fixed path logic
            if (submission.pdfPath) {
                let relativePath = submission.pdfPath.replace(/\\/g, '/');
                const uploadsIndex = relativePath.toLowerCase().indexOf('uploads/');
                if (uploadsIndex !== -1) {
                    relativePath = relativePath.substring(uploadsIndex);
                }
                const fullPath = path.join(__dirname, '..', 'public', relativePath);
                if (fs.existsSync(fullPath)) {
                    require('fs').unlinkSync(fullPath); // Sync for delete
                }
            }
        }
        await Submission.deleteMany({ assignmentId: id });

        // Delete assignment
        await Assignment.findByIdAndDelete(id);

        res.json({ message: 'Assignment and related submissions deleted successfully' });
    } catch (error) {
        console.error('Delete assignment error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Submit Assignment (Student PDF upload) - Fixed: Store clean relative path from 'uploads/submissions'
exports.submitAssignment = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        if (!assignmentId || !req.file) {
            return res.status(400).json({ message: 'Assignment ID and PDF required' });
        }

        console.log('Multer file received - path:', req.file.path); // Debug log

        const assignment = await Assignment.findById(assignmentId).populate('courseId');
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

        // Enrollment check
        const enrollment = await Enrollment.findOne({ studentId: req.user.id, courseId: assignment.courseId._id });
        if (!enrollment) return res.status(403).json({ message: 'Not enrolled' });

        const now = new Date();
        if (now > assignment.dueDate) return res.status(400).json({ message: 'Submission deadline passed' });

        const existing = await Submission.findOne({ studentId: req.user.id, assignmentId });
        if (existing) return res.status(400).json({ message: 'Already submitted' });

        // Fixed: Extract relative path starting from 'uploads/submissions/' (handles Windows/Linux, casing)
        let filePath = req.file.path.replace(/\\/g, '/'); // Normalize to forward slashes
        const publicIndex = filePath.toLowerCase().indexOf('public/');
        if (publicIndex !== -1) {
            filePath = filePath.substring(publicIndex + 7); // Strip 'public/' (case-insensitive)
        }
        const uploadsIndex = filePath.toLowerCase().indexOf('uploads/');
        if (uploadsIndex !== -1) {
            filePath = filePath.substring(uploadsIndex); // Keep from 'uploads/' onwards
        }
        console.log('Stored relative PDF path:', filePath); // Debug log

        const submission = new Submission({
            assignmentId,
            studentId: req.user.id,
            pdfPath: filePath, // e.g., 'uploads/submissions/1763534538045-691569eaa000a9c280ff394a.pdf'
            submittedAt: now
        });
        await submission.save();

        // Add to assignment submissions if model has array
        if (assignment.submissions && !assignment.submissions.includes(submission._id)) {
            assignment.submissions.push(submission._id);
            await assignment.save();
        }

        res.json({ message: 'Assignment submitted successfully', submission });
    } catch (error) {
        console.error('Submit assignment error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// AI Evaluate Submission - Fixed: PDF to image with pdf2pic + Tesseract OCR for scanned PDFs
exports.evaluateSubmission = async (req, res) => {
    let submissionId; // Declare outside
    let submission;   // Declare outside
    let fullPath;     // Declare outside
    let relativePath; // Declare outside (for logging)

    try {
        submissionId = req.params.submissionId; // Assign here (destructure safe)
        console.log('Evaluating submission ID:', submissionId); // Debug
        
        submission = await Submission.findById(submissionId).populate('assignmentId');
        if (!submission || submission.evaluated) {
            return res.status(400).json({ message: 'Submission not found or already evaluated' });
        }
        console.log('Submission loaded, stored PDF Path:', submission.pdfPath); // Debug

        // Fixed: Reconstruct full path with normalization and stripping
        relativePath = submission.pdfPath.replace(/\\/g, '/'); // Normalize
        const uploadsIndex = relativePath.toLowerCase().indexOf('uploads/');
        if (uploadsIndex !== -1) {
            relativePath = relativePath.substring(uploadsIndex); // Ensure starts with 'uploads/'
        }
        fullPath = path.join(__dirname, '..', 'public', relativePath); // controllers/../public + relative
        console.log('Reconstructed full PDF path:', fullPath); // Debug
        console.log('File exists at full path?', require('fs').existsSync(fullPath)); // Debug

        if (!require('fs').existsSync(fullPath)) {
            return res.status(404).json({ 
                message: 'PDF file not found. Check upload path or re-submit the assignment.' 
            });
        }

        const dataBuffer = require('fs').readFileSync(fullPath);
        console.log('PDF buffer loaded, size (bytes):', dataBuffer.length); // Debug

        let studentAnswer = '';

        // Step 1: Try pdf-parse for text-based PDFs (fast)
        console.log('Starting PDF parse with pdf-parse...');
        let pdfData;
        try {
            pdfData = pdfParse(dataBuffer);
            console.log('pdfData pages:', pdfData.numpages || 'unknown'); // Debug
        } catch (parseError) {
            console.error('PDF Parse specific error:', parseError);
        }

        if (pdfData && pdfData.text && typeof pdfData.text === 'string' && pdfData.text.trim().length > 0) {
            studentAnswer = pdfData.text.trim();
            console.log('Text extracted via pdf-parse, length:', studentAnswer.length);
        } else {
            // Step 2: Fallback to PDF to images + OCR for scanned PDFs
            console.log('pdf-parse failed, converting PDF to images with pdf2pic...');
            const tempDir = path.join(__dirname, '..', 'temp');
            await fs.mkdir(tempDir, { recursive: true });

            const convert = fromPath(fullPath, {
                density: 200,       // High quality
                saveFilename: "page",
                savePath: tempDir,
                format: "png",
                width: 1500,
                height: 1500
            });

            const convertResult = await convert.bulk(-1); // Convert all pages
            console.log(`Converted ${convertResult.length} pages to images.`);

            // Step 3: OCR on each image using worker
            console.log('Running OCR on images...');
            const worker = await createWorker('eng');
            let ocrText = '';
            for (let i = 0; i < convertResult.length; i++) {
                const imagePath = convertResult[i].path;
                console.log(`OCR on page ${i+1}: ${imagePath}`);
                const { data: { text } } = await worker.recognize(imagePath);
                ocrText += text + '\n--- Page Break ---\n'; // Combine with marker
                await fs.unlink(imagePath); // Clean up image
            }
            await worker.terminate();
            studentAnswer = ocrText.trim();
            console.log('OCR extracted total text length:', studentAnswer.length);

            // Clean up temp dir
            await fs.rm(tempDir, { recursive: true, force: true });
        }

        if (studentAnswer.length === 0) {
            return res.status(400).json({ message: 'PDF is empty or unreadable even after OCR. Try a clearer scan or typed PDF.' });
        }

        console.log('Extracted student text preview:', studentAnswer.substring(0, 200) + '...'); // Debug preview

        const questions = submission.assignmentId.questions.join('\n');
        const evalPrompt = `Evaluate student answers for these questions: ${questions}\n\nStudent submission text (from PDF): ${studentAnswer}\n\nProvide: Score out of 100, detailed feedback on each question, and overall remarks. Format exactly: Score: XX\nFeedback: ...\nRemarks: ...`;
        console.log('Ollama prompt length:', evalPrompt.length); // Debug

        const response = await ollama.generate({
            model: 'llama3',
            prompt: evalPrompt
        });
        console.log('Ollama response received, length:', response.response.length); // Debug

        const evalText = response.response;
        const scoreMatch = evalText.match(/Score:\s*(\d+)/i);
        const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;
        const feedback = evalText.split('Feedback:')[1]?.split('Remarks:')[0]?.trim() || 'No feedback';
        const remarks = evalText.split('Remarks:')[1]?.trim() || 'No remarks';

        submission.evaluation = { score, feedback, remarks };
        submission.evaluated = true;
        await submission.save();

        console.log('Evaluation saved: Score', score); // Debug

        res.json({ message: 'Evaluation completed', evaluation: submission.evaluation });
    } catch (error) {
        console.error('Detailed Evaluation Error:', {
            message: error.message,
            stack: error.stack,
            submissionId,  // Now accessible
            pdfPath: submission?.pdfPath,  // Safe with ?
            fullPathAttempt: fullPath,     // Now accessible
            relativePathAttempt: relativePath  // Extra for debug
        });
        res.status(500).json({ message: 'Evaluation failed', error: error.message });
    }
};