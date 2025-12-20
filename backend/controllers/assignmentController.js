// controllers/assignmentController.js - COMPLETE UPDATED VERSION
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const ollama = require('ollama').default;
const pdfParse = require('pdf-parse');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const mongoose = require('mongoose');

// Use qwen2.5:7b-instruct-q4_K_M model for fast evaluation
const MODEL = 'qwen2.5:7b-instruct-q4_K_M';

// BASE URL
const BASE_URL = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');

// Build full URL
const buildFullUrl = (relativeOrAbsolutePath) => {
    if (!relativeOrAbsolutePath) return null;
    if (/^https?:\/\//i.test(relativeOrAbsolutePath)) return relativeOrAbsolutePath;
    const cleanPath = relativeOrAbsolutePath.startsWith('/') ? relativeOrAbsolutePath : `/${relativeOrAbsolutePath}`;
    return `${BASE_URL}${cleanPath}`;
};

// ========== HELPER FUNCTIONS ==========

// Helper: Check if model is available
async function checkModelAvailable(modelName) {
    try {
        const list = await ollama.list();
        const modelsArr = Array.isArray(list) ? list : (list && list.models) ? list.models : [];
        const isAvailable = modelsArr.some(m => m.name === modelName || m.id === modelName);
        console.log(`Model check: ${modelName} - ${isAvailable ? 'AVAILABLE' : 'NOT AVAILABLE'}`);
        return isAvailable;
    } catch (err) {
        console.error('Model check error:', err.message);
        return false;
    }
}

// Helper: Extract text from PDF
async function extractTextFromPDF(dataBuffer) {
    try {
        const pdfData = await pdfParse(dataBuffer);
        if (pdfData && pdfData.text && pdfData.text.trim().length > 10) {
            const extractedText = pdfData.text.trim();
            console.log(`PDF parsed: ${extractedText.length} chars extracted`);
            return extractedText.substring(0, 2000);
        }
    } catch (err) {
        console.log('PDF parse failed:', err.message);
    }
    return '';
}

// Helper: Optimized AI call
async function callAIWithRetry(messages, options = {}, retries = 2) {
    console.log(`Calling AI with model: ${MODEL}`);
    
    for (let i = 0; i < retries; i++) {
        try {
            const response = await ollama.chat({
                model: MODEL,
                messages,
                stream: false,
                options: {
                    temperature: options.temperature || 0.1,
                    num_predict: options.num_predict || 256,
                    top_p: 0.9,
                    top_k: 40,
                    repeat_penalty: 1.1,
                    num_thread: 8,
                    ...options
                }
            });
            
            if (response && response.message && response.message.content) {
                return response;
            }
        } catch (error) {
            console.log(`AI call attempt ${i + 1} failed:`, error.message);
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 300 * (i + 1)));
        }
    }
    throw new Error('AI call failed after retries');
}

// Helper: Parse AI response
function parseAIResponse(content) {
    try {
        // Try to find JSON in the response
        const jsonMatch = content.match(/\{.*\}/s);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        
        // Try to find score and feedback
        const scoreMatch = content.match(/score[:\s]*(\d+)/i);
        const feedbackMatch = content.match(/feedback[:\s]*([^\n]+)/i);
        
        if (scoreMatch || feedbackMatch) {
            return {
                score: scoreMatch ? parseInt(scoreMatch[1]) : 50,
                feedback: feedbackMatch ? feedbackMatch[1].trim() : 'Evaluation completed.'
            };
        }
        
        // Default
        return { score: 50, feedback: 'Evaluation completed.' };
        
    } catch (error) {
        console.log('Parse error, using default');
        return { score: 50, feedback: 'Evaluation completed.' };
    }
}

// Helper: Generate questions with AI
async function generateQuestionsWithAI(prompt, numQuestions = 5) {
    const systemPrompt = `You are an educational assistant. Generate exactly ${numQuestions} assignment questions.

TOPIC: ${prompt}

INSTRUCTIONS:
- Generate ${numQuestions} questions in English
- Mix theoretical, practical, and analytical questions
- Return ONLY JSON array
- Each question should be a complete sentence
- Format: ["question1", "question2", ...]`;

    try {
        const response = await callAIWithRetry([
            { role: 'system', content: 'You generate educational questions.' },
            { role: 'user', content: systemPrompt }
        ], { 
            format: 'json',
            temperature: 0.3,
            num_predict: 512
        });

        const content = response.message.content;
        
        // Parse response
        let questions;
        try {
            const jsonMatch = content.match(/\[.*\]/s);
            questions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
        } catch {
            // Extract questions from text
            questions = content.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 10 && /^\d+[\.\)]/.test(line))
                .map(line => line.replace(/^\d+[\.\)\s]+/, '').trim());
        }
        
        // Ensure we have an array
        if (!Array.isArray(questions)) {
            questions = [questions];
        }
        
        // Clean up questions
        questions = questions
            .map(q => String(q).trim())
            .filter(q => q.length > 10)
            .slice(0, numQuestions);
        
        // If we don't have enough questions, generate defaults
        if (questions.length < numQuestions) {
            const defaultQuestions = [
                `Explain the main concepts of ${prompt}`,
                `What are the practical applications of ${prompt}?`,
                `Compare different approaches to ${prompt}`,
                `What challenges might arise when implementing ${prompt}?`,
                `How would you teach ${prompt} to a beginner?`
            ];
            questions = defaultQuestions.slice(0, numQuestions);
        }
        
        return questions;
        
    } catch (error) {
        console.error('Question generation failed:', error);
        throw error;
    }
}

// FAST evaluation function
async function evaluateSubmissionFast(submission, dataBuffer) {
    console.log('Starting FAST evaluation with qwen2.5:7b-instruct...');
    
    const startTime = Date.now();
    
    try {
        // Quick text extraction
        let studentAnswer = '';
        try {
            const pdfData = await pdfParse(dataBuffer);
            studentAnswer = pdfData.text?.trim() || '';
        } catch (pdfErr) {
            console.log('Quick PDF parse error:', pdfErr.message);
        }
        
        // If no text extracted, return default
        if (!studentAnswer || studentAnswer.length < 10) {
            return {
                score: 50,
                feedback: 'Could not extract text from PDF. Ensure PDF has selectable text.',
                remarks: 'Submit a PDF with readable text.',
                extractedText: '',
                evaluatedAt: new Date(),
                timeTaken: Date.now() - startTime
            };
        }
        
        // Get assignment questions
        const assignment = await Assignment.findById(submission.assignmentId);
        if (!assignment) {
            return {
                score: 50,
                feedback: 'Assignment not found.',
                remarks: 'Assignment data missing.',
                extractedText: '',
                evaluatedAt: new Date(),
                timeTaken: Date.now() - startTime
            };
        }
        
        // Take only first 2 questions for faster processing
        const questions = assignment.questions.slice(0, 2).join('\n');
        
        // Optimized prompt
        const prompt = `Evaluate assignment submission.

Assignment Questions (first 2):
${questions.substring(0, 300)}

Student Answer:
${studentAnswer.substring(0, 600)}

GRADING:
- Score: 0-100 (be fair)
- Brief feedback: 1-2 sentences

Respond ONLY in JSON: {"score": number, "feedback": "text"}`;
        
        console.log('Calling AI for evaluation...');
        
        const response = await ollama.chat({
            model: MODEL,
            messages: [
                { 
                    role: 'system', 
                    content: 'You are a fair university grader. Give accurate scores and constructive feedback.' 
                },
                { role: 'user', content: prompt }
            ],
            stream: false,
            options: {
                temperature: 0.1,
                num_predict: 200,
                num_thread: 8,
                top_p: 0.9,
                top_k: 40
            }
        });
        
        // Parse response
        const evalData = parseAIResponse(response.message.content);
        
        const timeTaken = Date.now() - startTime;
        console.log(`Evaluation completed in ${timeTaken}ms`);
        
        return {
            score: Math.max(0, Math.min(100, Number(evalData.score || 50))),
            feedback: evalData.feedback || 'Evaluation completed successfully.',
            remarks: 'Auto-graded by system',
            extractedText: studentAnswer.substring(0, 300),
            evaluatedAt: new Date(),
            timeTaken: timeTaken,
            model: MODEL
        };
        
    } catch (error) {
        console.error('Fast evaluation error:', error);
        
        // Intelligent fallback
        let score = 50;
        let feedback = 'Evaluation completed.';
        
        try {
            const text = dataBuffer.toString('utf8', 0, 500);
            const wordCount = text.split(/\s+/).length;
            
            if (wordCount > 100) score = 70;
            else if (wordCount > 50) score = 60;
            else if (wordCount > 20) score = 50;
            else score = 40;
            
            if (wordCount < 10) {
                feedback = 'Answer is too brief. Provide more detailed explanations.';
            }
        } catch (e) {
            // Default fallback
        }
        
        return {
            score: score,
            feedback: feedback,
            remarks: 'Basic evaluation used.',
            extractedText: '',
            evaluatedAt: new Date(),
            timeTaken: Date.now() - startTime,
            method: 'fallback'
        };
    }
}

// Generate assignment PDF
async function generateAssignmentPDF(assignment) {
    return new Promise((resolve, reject) => {
        const assignmentsDir = path.join(__dirname, '..', 'public', 'uploads', 'assignments');
        if (!fsSync.existsSync(assignmentsDir)) {
            fsSync.mkdirSync(assignmentsDir, { recursive: true });
        }
        
        const timestamp = Date.now();
        const filename = `assignment-${assignment._id}-${timestamp}.pdf`;
        const fullPath = path.join(assignmentsDir, filename);
        const relativePath = `/uploads/assignments/${filename}`;
        
        const doc = new PDFDocument();
        const writeStream = fsSync.createWriteStream(fullPath);
        doc.pipe(writeStream);
        
        doc.font('Helvetica-Bold').fontSize(18).text(assignment.title, { align: 'center' });
        doc.moveDown();
        doc.font('Helvetica').fontSize(12).text('Instructions: Answer all questions. Submit as PDF.', { align: 'center' });
        doc.moveDown(2);
        
        doc.font('Helvetica-Bold').fontSize(14).text('Questions:', { underline: true });
        doc.moveDown();
        
        (assignment.questions || []).forEach((q, idx) => {
            doc.font('Helvetica').fontSize(12).text(`${idx + 1}. ${q}`);
            doc.moveDown(0.8);
        });
        
        doc.moveDown(3);
        doc.fontSize(10).text(`Due Date: ${new Date(assignment.dueDate).toLocaleDateString()}`, { align: 'right' });
        doc.text(`Assignment ID: ${assignment._id.toString().substring(0, 8)}`, { align: 'right' });
        
        doc.end();
        
        writeStream.on('finish', () => resolve(relativePath));
        writeStream.on('error', reject);
    });
}

// ========== MAIN CONTROLLER FUNCTIONS ==========

// Get all assignments - FIXED: Return proper structure
exports.getAllAssignments = async (req, res) => {
    try {
        console.log('Getting all assignments...');
        
        const assignments = await Assignment.find()
            .populate('courseId', 'name code')
            .sort({ createdAt: -1 });
        
        console.log(`Found ${assignments.length} assignments`);
        
        const assignmentsWithStats = await Promise.all(
            assignments.map(async (assign) => {
                const submissionCount = await Submission.countDocuments({ assignmentId: assign._id });
                const evaluatedCount = await Submission.countDocuments({ 
                    assignmentId: assign._id, 
                    evaluated: true 
                });
                
                const plain = assign.toObject();
                
                // FIX: Remove AI references from response
                delete plain.generatedByAI;
                delete plain.promptUsed;
                
                plain.pdfUrl = buildFullUrl(assign.assignmentPdfPath);
                plain.submissionCount = submissionCount;
                plain.evaluatedCount = evaluatedCount;
                plain.pendingCount = submissionCount - evaluatedCount;
                
                return plain;
            })
        );
        
        res.json({
            success: true,
            message: 'Assignments loaded successfully',
            count: assignmentsWithStats.length,
            assignments: assignmentsWithStats
        });
    } catch (error) {
        console.error('Get all assignments error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Failed to load assignments', 
            error: error.message 
        });
    }
};

// Generate AI assignment - FIXED: No AI mention in title
exports.generateQuestions = async (req, res) => {
    try {
        console.log('=== GENERATE ASSIGNMENT START ===');
        const { courseId, prompt, numQuestions = 5, type = 'mixed', dueDate } = req.body;
        
        // Validate required fields
        if (!courseId || !dueDate) {
            return res.status(400).json({ 
                success: false,
                message: 'Course ID and dueDate are required' 
            });
        }
        
        if (!prompt || prompt.trim().length < 3) {
            return res.status(400).json({ 
                success: false,
                message: 'Please provide a valid prompt/topic' 
            });
        }
        
        // Validate course
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ 
                success: false,
                message: 'Course not found' 
            });
        }
        
        console.log('Generating assignment for course:', course.name);
        
        // FIX 1: Create a clean, professional title (NO AI MENTION, NO PROMPT TEXT)
        // Extract only the main topic from prompt
        const cleanPrompt = prompt
            .replace(/You are an?/gi, '') // Remove "You are an" phrases
            .replace(/instructor|teacher|professor/gi, '') // Remove role mentions
            .replace(/experienced|expert|skilled/gi, '') // Remove experience level
            .replace(/create|generate|write|make/gi, '') // Remove action verbs
            .replace(/\s+/g, ' ') // Remove extra spaces
            .trim()
            .substring(0, 30); // Limit to 30 chars
        
        // Create professional title
        const assignmentTitle = `Assignment: ${cleanPrompt || 'New Topic'}${cleanPrompt.length > 30 ? '...' : ''}`;
        
        // Generate questions using AI
        let questions;
        try {
            questions = await generateQuestionsWithAI(prompt, numQuestions);
            console.log(`Generated ${questions.length} questions`);
        } catch (aiError) {
            console.error('AI generation failed:', aiError);
            // Fallback questions
            questions = [
                `Explain the main concepts of ${cleanPrompt}`,
                `What are the practical applications of ${cleanPrompt}?`,
                `Compare different approaches to ${cleanPrompt}`,
                `What challenges might arise when implementing ${cleanPrompt}?`,
                `How would you teach ${cleanPrompt} to a beginner?`
            ].slice(0, numQuestions);
        }
        
        // Validate we have questions
        if (!questions || questions.length === 0) {
            return res.status(400).json({ 
                success: false,
                message: 'Failed to generate questions. Please try a different prompt.' 
            });
        }
        
        // Create assignment - NO VISIBLE AI MENTION
        const assignment = new Assignment({
            courseId,
            title: assignmentTitle,
            questions: questions.slice(0, numQuestions),
            dueDate: new Date(dueDate),
            generatedByAI: true, // Internal flag only
            promptUsed: prompt,
            type: type,
            numQuestions: questions.length
        });
        
        await assignment.save();
        console.log(`Assignment created: ${assignment._id}`);
        
        // Generate PDF
        const pdfPath = await generateAssignmentPDF(assignment);
        assignment.assignmentPdfPath = pdfPath;
        await assignment.save();
        
        // Update course
        course.assignments = course.assignments || [];
        course.assignments.push(assignment._id);
        await course.save();
        
        console.log('=== GENERATE ASSIGNMENT SUCCESS ===');
        
        // FIXED: Return proper response WITHOUT AI mention
        res.json({
            success: true,
            message: 'Assignment created successfully',
            assignment: {
                _id: assignment._id,
                title: assignment.title,
                questions: assignment.questions,
                dueDate: assignment.dueDate,
                courseId: assignment.courseId,
                courseName: course.name,
                pdfUrl: buildFullUrl(pdfPath),
                submissionCount: 0,
                evaluatedCount: 0,
                pendingCount: 0
            }
        });
        
    } catch (error) {
        console.error('Generate assignment error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Failed to create assignment', 
            error: error.message
        });
    }
};

// Also update generateQuestionsWithAI function to avoid instructional text
async function generateQuestionsWithAI(prompt, numQuestions = 5) {
    // Clean prompt before sending to AI
    const cleanPrompt = prompt
        .replace(/You are an?/gi, '')
        .replace(/instructor|teacher|professor/gi, '')
        .replace(/experienced|expert|skilled/gi, '')
        .replace(/create|generate|write|make/gi, '')
        .trim();
    
    const systemPrompt = `Generate ${numQuestions} educational questions about: "${cleanPrompt}"

INSTRUCTIONS:
- Generate exactly ${numQuestions} questions
- Questions should be educational and practical
- Each question should be a complete sentence
- Avoid mentioning "You are an instructor" or similar phrases
- Return ONLY JSON array format: ["question1", "question2", ...]`;

    try {
        const response = await ollama.chat({
            model: MODEL,
            messages: [
                { role: 'system', content: 'You generate clean educational questions without instructional phrases.' },
                { role: 'user', content: systemPrompt }
            ],
            stream: false,
            options: { 
                temperature: 0.3,
                num_predict: 512
            }
        });

        const content = response.message.content;
        
        // Parse response
        let questions;
        try {
            const jsonMatch = content.match(/\[.*\]/s);
            questions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
        } catch {
            // Extract questions from text
            questions = content.split('\n')
                .map(line => line.trim())
                .filter(line => {
                    // Filter out instructional lines
                    return line.length > 10 && 
                           /^\d+[\.\)]/.test(line) &&
                           !line.toLowerCase().includes('you are') &&
                           !line.toLowerCase().includes('instructor') &&
                           !line.toLowerCase().includes('teacher');
                })
                .map(line => line.replace(/^\d+[\.\)\s]+/, '').trim());
        }
        
        // Ensure we have an array
        if (!Array.isArray(questions)) {
            questions = [questions];
        }
        
        // Clean up questions - remove any AI instructional text
        questions = questions
            .map(q => String(q).trim())
            .filter(q => {
                // Filter out instructional questions
                const lowerQ = q.toLowerCase();
                return q.length > 10 &&
                       !lowerQ.includes('you are') &&
                       !lowerQ.includes('as an instructor') &&
                       !lowerQ.includes('as a teacher');
            })
            .slice(0, numQuestions);
        
        // If we don't have enough questions, generate defaults
        if (questions.length < numQuestions) {
            const defaultQuestions = [
                `Explain the main concepts of ${cleanPrompt}`,
                `What are the practical applications of ${cleanPrompt}?`,
                `Compare different approaches to ${cleanPrompt}`,
                `What challenges might arise when implementing ${cleanPrompt}?`,
                `How would you teach ${cleanPrompt} to a beginner?`
            ].slice(0, numQuestions);
            questions = defaultQuestions.slice(0, numQuestions);
        }
        
        return questions;
        
    } catch (error) {
        console.error('Question generation failed:', error);
        throw error;
    }
}
// Get assignment by ID
exports.getAssignmentById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ 
                success: false,
                message: 'Invalid Assignment ID' 
            });
        }
        
        const assignment = await Assignment.findById(id).populate('courseId', 'name');
        if (!assignment) {
            return res.status(404).json({ 
                success: false,
                message: 'Assignment not found' 
            });
        }
        
        const plain = assignment.toObject();
        plain.pdfUrl = buildFullUrl(assignment.assignmentPdfPath);
        
        // FIX: Remove AI references
        delete plain.generatedByAI;
        delete plain.promptUsed;
        
        res.json({
            success: true,
            assignment: plain
        });
    } catch (error) {
        console.error('Get assignment error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error', 
            error: error.message 
        });
    }
};

// Create manual assignment
exports.createAssignment = async (req, res) => {
    try {
        const { courseId, title, questions, dueDate } = req.body;
        if (!courseId || !title || !questions || !dueDate) {
            return res.status(400).json({ 
                success: false,
                message: 'Course ID, title, questions, and dueDate required' 
            });
        }
        
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ 
                success: false,
                message: 'Course not found' 
            });
        }
        
        const assignment = new Assignment({
            courseId,
            title,
            questions: Array.isArray(questions) ? questions : [questions],
            dueDate: new Date(dueDate),
            generatedByAI: false
        });
        
        await assignment.save();
        
        // Update course assignments
        course.assignments = course.assignments || [];
        course.assignments.push(assignment._id);
        await course.save();
        
        // Generate PDF
        const pdfPath = await generateAssignmentPDF(assignment);
        assignment.assignmentPdfPath = pdfPath;
        await assignment.save();
        
        res.status(201).json({ 
            success: true,
            message: 'Assignment created successfully', 
            assignment,
            pdfUrl: buildFullUrl(pdfPath)
        });
    } catch (error) {
        console.error('Create assignment error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error', 
            error: error.message 
        });
    }
};

// Get assignments by course
exports.getAssignmentsByCourse = async (req, res) => {
    try {
        const { courseId } = req.params;
        const course = await Course.findById(courseId).populate('assignments');
        if (!course) {
            return res.status(404).json({ 
                success: false,
                message: 'Course not found' 
            });
        }
        
        const assignmentsWithUrls = await Promise.all(
            (course.assignments || []).map(async (assign) => {
                const plain = assign.toObject();
                plain.pdfUrl = buildFullUrl(assign.assignmentPdfPath);
                
                // FIX: Remove AI references
                delete plain.generatedByAI;
                delete plain.promptUsed;
                
                if (req.user && req.user.role === 'student') {
                    const submission = await Submission.findOne({
                        studentId: req.user.id,
                        assignmentId: assign._id
                    });
                    plain.hasSubmitted = !!submission;
                    plain.submission = submission ? {
                        score: submission.evaluation?.score,
                        evaluated: submission.evaluated,
                        feedback: submission.evaluation?.feedback
                    } : null;
                }
                
                return plain;
            })
        );
        
        res.json({
            success: true,
            assignments: assignmentsWithUrls
        });
    } catch (error) {
        console.error('Get assignments by course error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error', 
            error: error.message 
        });
    }
};

// Submit assignment
exports.submitAssignment = async (req, res) => {
    const startTime = Date.now();
    
    try {
        console.log('=== SUBMIT ASSIGNMENT START ===');
        const { assignmentId } = req.params;
        
        // Check if file exists
        if (!req.file) {
            return res.status(400).json({ 
                success: false,
                message: 'No file uploaded. Please select a PDF file.' 
            });
        }
        
        console.log('File received:', {
            originalname: req.file.originalname,
            size: req.file.size,
            bufferSize: req.file.buffer?.length || 0
        });
        
        // Check assignment
        const assignment = await Assignment.findById(assignmentId);
        if (!assignment) {
            return res.status(404).json({ 
                success: false,
                message: 'Assignment not found' 
            });
        }
        
        // Check enrollment
        const enrollment = await Enrollment.findOne({
            studentId: req.user.id,
            courseId: assignment.courseId
        });
        if (!enrollment) {
            return res.status(403).json({ 
                success: false,
                message: 'You are not enrolled in this course' 
            });
        }
        
        // Check deadline
        if (new Date() > new Date(assignment.dueDate)) {
            return res.status(400).json({ 
                success: false,
                message: 'Assignment deadline has passed' 
            });
        }
        
        // Check if already submitted
        const existing = await Submission.findOne({
            studentId: req.user.id,
            assignmentId
        });
        if (existing) {
            return res.status(400).json({ 
                success: false,
                message: 'You have already submitted this assignment' 
            });
        }
        
        // Get buffer from file
        let fileBuffer;
        if (req.file.buffer) {
            fileBuffer = req.file.buffer;
        } else if (req.file.path && fsSync.existsSync(req.file.path)) {
            fileBuffer = await fs.readFile(req.file.path);
        } else {
            return res.status(400).json({ 
                success: false,
                message: 'Could not process uploaded file.' 
            });
        }
        
        // Create correct file path
        const filename = path.basename(req.file.path);
        const pdfPath = `/uploads/submissions/${filename}`;
        
        // Create submission record
        const submission = new Submission({
            assignmentId,
            studentId: req.user.id,
            pdfPath: pdfPath,
            submittedAt: new Date(),
            evaluated: false
        });
        
        await submission.save();
        
        // Update assignment
        assignment.submissions = assignment.submissions || [];
        assignment.submissions.push(submission._id);
        await assignment.save();
        
        console.log(`Submission created: ${submission._id}`);
        
        // IMMEDIATE auto-evaluation
        let evaluation = null;
        try {
            console.log(`Starting immediate auto-evaluation...`);
            evaluation = await evaluateSubmissionFast(submission, fileBuffer);
            
            submission.evaluation = {
                score: evaluation.score,
                feedback: evaluation.feedback,
                remarks: evaluation.remarks,
                extractedText: evaluation.extractedText,
                evaluatedAt: new Date(),
                timeTaken: evaluation.timeTaken,
                model: evaluation.model
            };
            submission.evaluated = true;
            
            await submission.save();
            console.log(`Auto-evaluation COMPLETED in ${evaluation.timeTaken}ms, Score: ${evaluation.score}`);
        } catch (evalError) {
            console.error('Auto-evaluation failed:', evalError);
            submission.evaluation = {
                score: 0,
                feedback: 'Auto-evaluation failed. Will be manually graded.',
                remarks: 'Technical issue occurred.',
                evaluatedAt: new Date()
            };
            await submission.save();
        }
        
        const totalTime = Date.now() - startTime;
        console.log(`=== SUBMIT ASSIGNMENT SUCCESS in ${totalTime}ms ===`);
        
        // Get updated submission
        const updatedSubmission = await Submission.findById(submission._id);
        
        res.json({
            success: true,
            message: 'Assignment submitted successfully!',
            evaluationTime: evaluation?.timeTaken || 0,
            totalTime: totalTime,
            submission: {
                _id: submission._id,
                submittedAt: submission.submittedAt,
                pdfUrl: buildFullUrl(pdfPath),
                evaluated: updatedSubmission.evaluated,
                score: updatedSubmission.evaluation?.score,
                feedback: updatedSubmission.evaluation?.feedback,
                remarks: updatedSubmission.evaluation?.remarks,
                assignmentId: assignment._id,
                assignmentTitle: assignment.title,
                evaluatedAt: updatedSubmission.evaluation?.evaluatedAt
            }
        });
        
    } catch (error) {
        console.error('Submit assignment error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Submission failed. Please try again.',
            error: error.message
        });
    }
};

// Get submissions by assignment
exports.getSubmissionsByAssignment = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        
        // Validate assignment exists
        const assignment = await Assignment.findById(assignmentId);
        if (!assignment) {
            return res.status(404).json({ 
                success: false,
                message: 'Assignment not found' 
            });
        }
        
        const submissions = await Submission.find({ assignmentId })
            .populate('studentId', 'name email')
            .sort({ submittedAt: -1 });
        
        const submissionsWithUrls = submissions.map(sub => ({
            ...sub.toObject(),
            pdfUrl: buildFullUrl(sub.pdfPath),
            status: sub.evaluated ? 'Evaluated' : 'Pending',
            evaluationTime: sub.evaluation?.timeTaken
        }));
        
        res.json({
            success: true,
            submissions: submissionsWithUrls
        });
    } catch (error) {
        console.error('Get submissions error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error', 
            error: error.message 
        });
    }
};

// Get submission by ID
exports.getSubmissionById = async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        if (!mongoose.isValidObjectId(submissionId)) {
            return res.status(400).json({ 
                success: false,
                message: 'Invalid Submission ID' 
            });
        }
        
        const submission = await Submission.findById(submissionId)
            .populate('assignmentId', 'title questions')
            .populate('studentId', 'name email');
        
        if (!submission) {
            return res.status(404).json({ 
                success: false,
                message: 'Submission not found' 
            });
        }
        
        const submissionData = submission.toObject();
        submissionData.pdfUrl = buildFullUrl(submission.pdfPath);
        
        res.json({
            success: true,
            submission: submissionData
        });
    } catch (error) {
        console.error('Get submission by ID error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error', 
            error: error.message 
        });
    }
};

// Get my submissions (for students)
exports.getMySubmissions = async (req, res) => {
    try {
        const studentId = req.user.id;
        
        console.log(`Getting submissions for student: ${studentId}`);
        
        const submissions = await Submission.find({ studentId: studentId })
            .populate({
                path: 'assignmentId',
                populate: {
                    path: 'courseId',
                    select: 'name'
                },
                select: 'title dueDate'
            })
            .sort({ submittedAt: -1 });
        
        const result = submissions.map(sub => {
            const pdfUrl = sub.pdfPath ? 
                `${BASE_URL}${sub.pdfPath.startsWith('/') ? sub.pdfPath : '/' + sub.pdfPath}` : 
                null;
            
            return {
                _id: sub._id,
                assignmentId: sub.assignmentId?._id,
                assignmentTitle: sub.assignmentId?.title || 'Unknown',
                courseName: sub.assignmentId?.courseId?.name || 'Unknown',
                submittedAt: sub.submittedAt,
                pdfUrl: pdfUrl,
                evaluated: sub.evaluated,
                score: sub.evaluation?.score,
                feedback: sub.evaluation?.feedback,
                remarks: sub.evaluation?.remarks,
                status: sub.evaluated ? 'Evaluated' : 'Pending',
                evaluatedAt: sub.evaluation?.evaluatedAt,
                evaluationTime: sub.evaluation?.timeTaken,
                model: sub.evaluation?.model
            };
        });
        
        res.json({
            success: true,
            count: result.length,
            submissions: result
        });
        
    } catch (error) {
        console.error('Get my submissions error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Failed to load submissions',
            error: error.message 
        });
    }
};

// Evaluate submission
exports.evaluateSubmission = async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        console.log(`Evaluating submission: ${submissionId}`);
        
        // Validate ObjectId
        if (!mongoose.isValidObjectId(submissionId)) {
            return res.status(400).json({ 
                success: false,
                message: 'Invalid Submission ID format' 
            });
        }
        
        // Find submission
        const submission = await Submission.findById(submissionId)
            .populate('assignmentId', 'title questions');
        
        if (!submission) {
            return res.status(404).json({ 
                success: false,
                message: 'Submission not found'
            });
        }
        
        console.log(`Found submission: ${submission._id}`);
        
        // Check if PDF path exists
        if (!submission.pdfPath) {
            return res.status(400).json({ 
                success: false,
                message: 'PDF file path not found' 
            });
        }
        
        // Find the file
        let dataBuffer = null;
        const relativePath = submission.pdfPath.replace(/^\//, '');
        const possiblePaths = [
            path.join(__dirname, '..', 'public', relativePath),
            path.join(process.cwd(), 'public', relativePath),
        ];
        
        for (const filePath of possiblePaths) {
            if (fsSync.existsSync(filePath)) {
                dataBuffer = fsSync.readFileSync(filePath);
                console.log(`Found PDF at: ${filePath}`);
                break;
            }
        }
        
        if (!dataBuffer) {
            return res.status(404).json({ 
                success: false,
                message: 'PDF file not found',
                storedPath: submission.pdfPath
            });
        }
        
        // Evaluate the submission
        const evaluation = await evaluateSubmissionFast(submission, dataBuffer);
        
        // Update submission
        submission.evaluation = {
            score: evaluation.score,
            feedback: evaluation.feedback,
            remarks: evaluation.remarks,
            extractedText: evaluation.extractedText,
            evaluatedAt: new Date(),
            timeTaken: evaluation.timeTaken,
            model: evaluation.model
        };
        submission.evaluated = true;
        await submission.save();
        
        res.json({
            success: true,
            message: 'Evaluation completed successfully',
            evaluation: submission.evaluation,
            submissionId: submission._id,
            assignmentTitle: submission.assignmentId?.title
        });
        
    } catch (error) {
        console.error('Manual evaluation error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Evaluation failed', 
            error: error.message
        });
    }
};

// Force evaluate a submission
exports.forceEvaluate = async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        const submission = await Submission.findById(submissionId)
            .populate('assignmentId', 'questions');
        
        if (!submission) {
            return res.status(404).json({ 
                success: false,
                message: 'Submission not found' 
            });
        }
        
        // Find PDF file
        let fileBuffer = null;
        if (submission.pdfPath) {
            const relativePath = submission.pdfPath.replace(/^\//, '');
            const possiblePaths = [
                path.join(__dirname, '..', 'public', relativePath),
                path.join(process.cwd(), 'public', relativePath),
            ];
            
            for (const p of possiblePaths) {
                if (fsSync.existsSync(p)) {
                    fileBuffer = fsSync.readFileSync(p);
                    console.log(`Found file at: ${p}`);
                    break;
                }
            }
        }
        
        if (!fileBuffer) {
            return res.status(404).json({ 
                success: false,
                message: 'PDF file not found',
                pdfPath: submission.pdfPath 
            });
        }
        
        console.log(`Force evaluating submission: ${submissionId}`);
        
        // Use fast evaluation
        const evaluation = await evaluateSubmissionFast(submission, fileBuffer);
        
        // Update submission
        submission.evaluation = {
            score: evaluation.score,
            feedback: evaluation.feedback,
            remarks: evaluation.remarks,
            extractedText: evaluation.extractedText,
            evaluatedAt: new Date(),
            timeTaken: evaluation.timeTaken,
            model: evaluation.model,
            forced: true
        };
        submission.evaluated = true;
        
        await submission.save();
        
        res.json({
            success: true,
            message: 'Force evaluation completed',
            evaluation: submission.evaluation,
            submissionId: submission._id
        });
        
    } catch (error) {
        console.error('Force evaluate error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Force evaluation failed',
            error: error.message 
        });
    }
};

// Update assignment
exports.updateAssignment = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, questions, dueDate } = req.body;
        
        const assignment = await Assignment.findById(id);
        if (!assignment) {
            return res.status(404).json({ 
                success: false,
                message: 'Assignment not found' 
            });
        }
        
        if (title) assignment.title = title;
        if (questions) assignment.questions = Array.isArray(questions) ? questions : [questions];
        if (dueDate) assignment.dueDate = new Date(dueDate);
        
        // Regenerate PDF if questions changed
        if (questions) {
            const pdfPath = await generateAssignmentPDF(assignment);
            assignment.assignmentPdfPath = pdfPath;
        }
        
        await assignment.save();
        
        res.json({
            success: true,
            message: 'Assignment updated',
            assignment,
            pdfUrl: buildFullUrl(assignment.assignmentPdfPath)
        });
        
    } catch (error) {
        console.error('Update assignment error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Update failed', 
            error: error.message 
        });
    }
};

// Delete assignment
exports.deleteAssignment = async (req, res) => {
    try {
        const { id } = req.params;
        const assignment = await Assignment.findById(id);
        
        if (!assignment) {
            return res.status(404).json({ 
                success: false,
                message: 'Assignment not found' 
            });
        }
        
        // Delete associated PDFs
        if (assignment.assignmentPdfPath) {
            const pdfPath = path.join(__dirname, '..', 'public', assignment.assignmentPdfPath);
            if (fsSync.existsSync(pdfPath)) {
                fsSync.unlinkSync(pdfPath);
            }
        }
        
        // Delete submissions and their PDFs
        const submissions = await Submission.find({ assignmentId: id });
        for (const sub of submissions) {
            if (sub.pdfPath) {
                const subPath = path.join(__dirname, '..', 'public', sub.pdfPath);
                if (fsSync.existsSync(subPath)) {
                    fsSync.unlinkSync(subPath);
                }
            }
            await Submission.findByIdAndDelete(sub._id);
        }
        
        // Remove from course
        await Course.updateOne(
            { _id: assignment.courseId },
            { $pull: { assignments: assignment._id } }
        );
        
        await Assignment.findByIdAndDelete(id);
        
        res.json({ 
            success: true,
            message: 'Assignment deleted successfully' 
        });
        
    } catch (error) {
        console.error('Delete assignment error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Deletion failed', 
            error: error.message 
        });
    }
};

// Check submission status
exports.checkSubmissionStatus = async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        const submission = await Submission.findById(submissionId)
            .populate('assignmentId', 'title')
            .populate('studentId', 'name email');
        
        if (!submission) {
            return res.status(404).json({ 
                success: false,
                message: 'Submission not found' 
            });
        }
        
        // Check if PDF file exists
        let fileExists = false;
        let filePath = null;
        
        if (submission.pdfPath) {
            const relativePath = submission.pdfPath.replace(/^\//, '');
            const possiblePaths = [
                path.join(__dirname, '..', 'public', relativePath),
                path.join(process.cwd(), 'public', relativePath),
            ];
            
            for (const p of possiblePaths) {
                if (fsSync.existsSync(p)) {
                    fileExists = true;
                    filePath = p;
                    break;
                }
            }
        }
        
        res.json({
            success: true,
            submission: {
                _id: submission._id,
                assignmentTitle: submission.assignmentId?.title,
                studentName: submission.studentId?.name,
                evaluated: submission.evaluated,
                pdfPath: submission.pdfPath,
                fileExists: fileExists,
                filePath: filePath,
                evaluation: submission.evaluation || null,
                submittedAt: submission.submittedAt,
                evaluatedAt: submission.evaluation?.evaluatedAt,
                evaluationTime: submission.evaluation?.timeTaken,
                model: submission.evaluation?.model
            }
        });
        
    } catch (error) {
        console.error('Check submission status error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Failed to check status',
            error: error.message 
        });
    }
};

// Check submission
exports.checkSubmission = async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        console.log(`Checking submission: ${submissionId}`);
        
        if (!mongoose.isValidObjectId(submissionId)) {
            return res.status(400).json({ 
                success: false,
                isValidObjectId: false,
                message: 'Invalid MongoDB ObjectId format'
            });
        }
        
        const submission = await Submission.findById(submissionId);
        
        if (!submission) {
            return res.status(404).json({ 
                success: false,
                exists: false,
                message: 'Submission not found in database'
            });
        }
        
        res.json({
            success: true,
            exists: true,
            submission: {
                _id: submission._id,
                assignmentId: submission.assignmentId,
                studentId: submission.studentId,
                evaluated: submission.evaluated,
                pdfPath: submission.pdfPath,
                submittedAt: submission.submittedAt,
                evaluation: submission.evaluation
            }
        });
        
    } catch (error) {
        console.error('Check submission error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error', 
            error: error.message 
        });
    }
};

// Bulk evaluate all pending submissions
exports.bulkEvaluate = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        
        const pendingSubmissions = await Submission.find({
            assignmentId,
            evaluated: false
        }).populate('assignmentId');
        
        if (pendingSubmissions.length === 0) {
            return res.json({ 
                success: true,
                message: 'No pending submissions to evaluate',
                count: 0 
            });
        }
        
        console.log(`Found ${pendingSubmissions.length} submissions to evaluate`);
        
        const results = [];
        const startTime = Date.now();
        
        // Process sequentially
        for (const submission of pendingSubmissions) {
            try {
                if (!submission.pdfPath) {
                    results.push({
                        submissionId: submission._id,
                        success: false,
                        error: 'No PDF path'
                    });
                    continue;
                }
                
                // Find file
                let fileBuffer = null;
                const relativePath = submission.pdfPath.replace(/^\//, '');
                const possiblePaths = [
                    path.join(__dirname, '..', 'public', relativePath),
                    path.join(process.cwd(), 'public', relativePath),
                ];
                
                let fileFound = false;
                for (const p of possiblePaths) {
                    if (fsSync.existsSync(p)) {
                        fileBuffer = fsSync.readFileSync(p);
                        fileFound = true;
                        break;
                    }
                }
                
                if (!fileFound) {
                    results.push({
                        submissionId: submission._id,
                        success: false,
                        error: 'PDF file not found'
                    });
                    continue;
                }
                
                // Evaluate
                const evaluation = await evaluateSubmissionFast(submission, fileBuffer);
                
                // Update submission
                submission.evaluation = {
                    score: evaluation.score,
                    feedback: evaluation.feedback,
                    remarks: evaluation.remarks,
                    extractedText: evaluation.extractedText,
                    evaluatedAt: new Date(),
                    timeTaken: evaluation.timeTaken,
                    model: evaluation.model
                };
                submission.evaluated = true;
                await submission.save();
                
                results.push({
                    submissionId: submission._id,
                    success: true,
                    score: evaluation.score,
                    timeTaken: evaluation.timeTaken
                });
                
            } catch (error) {
                results.push({
                    submissionId: submission._id,
                    success: false,
                    error: error.message
                });
            }
        }
        
        const totalTime = Date.now() - startTime;
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        
        res.json({
            success: true,
            message: `Bulk evaluation completed in ${totalTime}ms`,
            stats: {
                total: pendingSubmissions.length,
                success: successCount,
                failed: failCount,
                totalTime: totalTime,
                averageTime: successCount > 0 ? totalTime / successCount : 0
            },
            results: results
        });
        
    } catch (error) {
        console.error('Bulk evaluate error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Bulk evaluation failed', 
            error: error.message 
        });
    }
};

// Test AI
exports.testAI = async (req, res) => {
    try {
        const { prompt = "Hello, how are you?" } = req.body;
        
        console.log('Testing AI with model:', MODEL);
        
        const response = await ollama.chat({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            stream: false,
            options: { 
                temperature: 0.7,
                num_thread: 8
            }
        });
        
        res.json({
            success: true,
            model: MODEL,
            response: response.message.content
        });
    } catch (error) {
        console.error('Test AI error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message,
            model: MODEL,
            suggestion: 'Check if Ollama is running and the model is downloaded: ollama pull qwen2.5:7b-instruct-q4_K_M'
        });
    }
};

module.exports = exports;