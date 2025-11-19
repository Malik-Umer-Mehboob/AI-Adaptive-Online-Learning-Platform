// controllers/assignmentController.js - All assignment logic here
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
// Fixed Import: Destructure default for CommonJS
const { default: ollama } = require('ollama');
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const { uploadPDF } = require('../middleware/multer');

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

// Submit Assignment (Student PDF upload)
exports.submitAssignment = async (req, res) => {
    try {
        const { assignmentId } = req.params; // Fixed: Use params, not body
        if (!assignmentId || !req.file) {
            return res.status(400).json({ message: 'Assignment ID and PDF required' });
        }

        const assignment = await Assignment.findById(assignmentId).populate('courseId');
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

        // Enrollment check
        const enrollment = await Enrollment.findOne({ studentId: req.user.id, courseId: assignment.courseId._id });
        if (!enrollment) return res.status(403).json({ message: 'Not enrolled' });

        const now = new Date();
        if (now > assignment.dueDate) return res.status(400).json({ message: 'Submission deadline passed' });

        const existing = await Submission.findOne({ studentId: req.user.id, assignmentId });
        if (existing) return res.status(400).json({ message: 'Already submitted' });

        const submission = new Submission({
            assignmentId,
            studentId: req.user.id,
            pdfPath: req.file.path.replace('public/', ''), // Relative path
            submittedAt: now
        });
        await submission.save();

        // Add to assignment submissions if not already (assume model has submissions array)
        assignment.submissions.push(submission._id);
        await assignment.save();

        res.json({ message: 'Assignment submitted successfully', submission });
    } catch (error) {
        console.error('Submit assignment error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// AI Evaluate Submission (Fixed import applies here too)
exports.evaluateSubmission = async (req, res) => {
    try {
        const { submissionId } = req.params;
        const submission = await Submission.findById(submissionId).populate('assignmentId');
        if (!submission || submission.evaluated) {
            return res.status(400).json({ message: 'Submission not found or already evaluated' });
        }

        // PDF extract
        const fullPath = path.join(__dirname, '../public', submission.pdfPath);
        const dataBuffer = fs.readFileSync(fullPath);
        const pdfData = await pdf(dataBuffer);
        const studentAnswer = pdfData.text.trim();

        const questions = submission.assignmentId.questions.join('\n');
        const evalPrompt = `Evaluate student answers for these questions: ${questions}. Student submission text: ${studentAnswer}. Provide: Score out of 100, detailed feedback, and remarks. Format: Score: XX\nFeedback: ...\nRemarks: ...`;

        // Fixed: Use object format with default import
        const response = await ollama.generate({
            model: 'llama3',
            prompt: evalPrompt
        });

        const evalText = response.response;
        const scoreMatch = evalText.match(/Score:\s*(\d+)/i);
        const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;
        const feedback = evalText.split('Feedback:')[1]?.split('Remarks:')[0]?.trim() || 'No feedback';
        const remarks = evalText.split('Remarks:')[1]?.trim() || 'No remarks';

        submission.evaluation = { score, feedback, remarks };
        submission.evaluated = true;
        await submission.save();

        res.json({ message: 'Evaluation completed', evaluation: submission.evaluation });
    } catch (error) {
        console.error('Evaluate submission error:', error);
        res.status(500).json({ message: 'Evaluation failed', error: error.message });
    }
};