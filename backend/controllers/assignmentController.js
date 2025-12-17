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

// Force use qwen2.5:14b model
const MODEL = 'qwen2.5:14b';

// BASE URL
const BASE_URL = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');

// Build full URL
const buildFullUrl = (relativeOrAbsolutePath) => {
    if (!relativeOrAbsolutePath) return null;
    if (/^https?:\/\//i.test(relativeOrAbsolutePath)) return relativeOrAbsolutePath;
    const cleanPath = relativeOrAbsolutePath.startsWith('/') ? relativeOrAbsolutePath : `/${relativeOrAbsolutePath}`;
    return `${BASE_URL}${cleanPath}`;
};

// Helper: Check if model is available
async function checkModelAvailable(modelName) {
    try {
        const list = await ollama.list();
        const modelsArr = Array.isArray(list) ? list : (list && list.models) ? list.models : [];
        return modelsArr.some(m => m.name === modelName || m.id === modelName);
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
            console.log(`PDF parsed successfully: ${extractedText.length} chars`);
            return extractedText.substring(0, 5000);
        }
    } catch (err) {
        console.log('PDF parse failed:', err.message);
    }
    return '';
}

// Helper: AI call with retry
async function callAIWithRetry(messages, options = {}, retries = 3) {
    const modelAvailable = await checkModelAvailable(MODEL);
    const useModel = modelAvailable ? MODEL : 'qwen2.5:7b';
    
    for (let i = 0; i < retries; i++) {
        try {
            const response = await ollama.chat({
                model: useModel,
                messages,
                stream: false,
                options: {
                    temperature: options.temperature || 0.2,
                    num_predict: options.num_predict || 800,
                    format: options.format || 'text',
                    ...options
                }
            });
            
            if (response && response.message && response.message.content) {
                return response;
            }
        } catch (error) {
            console.log(`AI call attempt ${i + 1} failed:`, error.message);
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
    throw new Error('AI call failed after retries');
}

// Helper: Parse AI response to JSON safely
function parseAIResponse(content) {
    try {
        // Try to find JSON in the response
        const jsonMatch = content.match(/\[.*\]|\{.*\}/s);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        
        // If no JSON found, try to parse the entire content
        return JSON.parse(content);
    } catch (error) {
        console.error('JSON parse error:', error.message);
        console.log('Raw content:', content.substring(0, 200));
        
        // Fallback: If it looks like a list of questions (one per line)
        const lines = content.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .filter(line => !line.startsWith('```'))
            .map(line => line.replace(/^\d+[\.\)\-\s]+/, '').trim());
        
        if (lines.length > 0) {
            return lines;
        }
        
        // Return empty array as last resort
        return [];
    }
}

// Helper: Generate questions with AI
async function generateQuestionsWithAI(prompt, numQuestions = 5) {
    const systemPrompt = `You are an educational assistant. Generate exactly ${numQuestions} assignment questions based on the topic.

TOPIC: ${prompt}

IMPORTANT:
1. Generate exactly ${numQuestions} questions
2. Each question should be in ENGLISH
3. Questions should be diverse (mix of theoretical, practical, analytical)
4. Return ONLY a JSON array of strings
5. Each question should be a complete sentence
6. Do not include any explanations, just the JSON array

Example format:
[
  "Explain the concept of...",
  "Write a program that...",
  "Compare and contrast...",
  "What are the advantages of...",
  "How would you implement..."
]`;

    const response = await callAIWithRetry([
        { role: 'system', content: 'You generate educational assignment questions.' },
        { role: 'user', content: systemPrompt }
    ], { 
        format: 'json',
        temperature: 0.3,
        num_predict: 1000
    });

    const content = response.message.content;
    console.log('AI Response:', content.substring(0, 300));
    
    // Parse the response
    let questions = parseAIResponse(content);
    
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
}

// Main evaluation function
async function evaluateSubmissionLogic(submission, dataBuffer) {
    console.log(`Starting evaluation with model: ${MODEL}`);
    
    // Extract text from PDF
    const studentAnswer = await extractTextFromPDF(dataBuffer);
    
    if (!studentAnswer || studentAnswer.length < 10) {
        return {
            score: 0,
            feedback: 'Cannot evaluate: PDF is empty or could not be read.',
            remarks: 'Submit PDF with selectable text.',
            extractedText: ''
        };
    }
    
    // Get assignment questions
    const populatedSubmission = await Submission.findById(submission._id).populate('assignmentId');
    const assignment = populatedSubmission.assignmentId;
    const questions = assignment.questions.join('\n').substring(0, 1000);
    
    // AI Evaluation
    const evaluationPrompt = `You are a university professor grading assignments.
    
ASSIGNMENT QUESTIONS:
${questions}

STUDENT ANSWER:
${studentAnswer.substring(0, 1500)}

Grading Rubric:
- 90-100: Excellent (complete, accurate, well-explained)
- 80-89: Very Good (minor issues)
- 70-79: Good (acceptable)
- 60-69: Satisfactory (basic understanding)
- 50-59: Below Average (significant gaps)
- 0-49: Poor (incorrect/missing concepts)

Respond with EXACT JSON format:
{
    "score": number (0-100),
    "feedback": "2-3 sentence specific feedback",
    "remarks": "1 actionable improvement tip"
}`;
    
    try {
        const response = await callAIWithRetry([
            { role: 'system', content: 'You are an expert educator. Grade assignments fairly.' },
            { role: 'user', content: evaluationPrompt }
        ], { format: 'json', temperature: 0.1 });
        
        const evalData = parseAIResponse(response.message.content || '{}');
        
        return {
            score: Math.max(0, Math.min(100, Number(evalData.score || 0))),
            feedback: evalData.feedback || 'Evaluation completed.',
            remarks: evalData.remarks || 'Focus on understanding core concepts.',
            extractedText: studentAnswer.substring(0, 1000)
        };
        
    } catch (error) {
        console.error('Evaluation failed:', error);
        return {
            score: 50,
            feedback: 'Auto-evaluation failed. Will be manually graded.',
            remarks: 'Technical issue in grading system.',
            extractedText: studentAnswer.substring(0, 1000)
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

// Submit assignment
exports.submitAssignment = async (req, res) => {
    try {
        console.log('=== SUBMIT ASSIGNMENT START ===');
        const { assignmentId } = req.params;
        
        // Check if file exists
        if (!req.file) {
            console.error('No file in request');
            return res.status(400).json({ 
                message: 'No file uploaded. Please select a PDF file.' 
            });
        }
        
        console.log('File received:', {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            path: req.file.path,
            hasBuffer: !!req.file.buffer
        });
        
        // Validate PDF
        if (!req.file.mimetype.startsWith('application/pdf')) {
            // Clean up file if uploaded
            if (req.file.path && fsSync.existsSync(req.file.path)) {
                await fs.unlink(req.file.path);
            }
            return res.status(400).json({ 
                message: 'Only PDF files are allowed.' 
            });
        }
        
        // Check assignment
        const assignment = await Assignment.findById(assignmentId);
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }
        
        // Check enrollment
        const enrollment = await Enrollment.findOne({
            studentId: req.user.id,
            courseId: assignment.courseId
        });
        if (!enrollment) {
            return res.status(403).json({ message: 'You are not enrolled in this course' });
        }
        
        // Check deadline
        if (new Date() > new Date(assignment.dueDate)) {
            return res.status(400).json({ 
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
                message: 'You have already submitted this assignment' 
            });
        }
        
        // Get buffer from file
        let fileBuffer;
        if (req.file.buffer) {
            // If buffer already exists (from middleware)
            fileBuffer = req.file.buffer;
        } else if (req.file.path && fsSync.existsSync(req.file.path)) {
            // Read from disk
            fileBuffer = await fs.readFile(req.file.path);
        } else {
            return res.status(400).json({ 
                message: 'Could not process uploaded file.' 
            });
        }
        
        // Create submission record
        const submission = new Submission({
            assignmentId,
            studentId: req.user.id,
            pdfPath: req.file.path ? `/uploads/submissions/${path.basename(req.file.path)}` : null,
            submittedAt: new Date(),
            evaluated: false
        });
        
        await submission.save();
        
        // Update assignment
        assignment.submissions = assignment.submissions || [];
        assignment.submissions.push(submission._id);
        await assignment.save();
        
        // Start auto-evaluation in background
        setTimeout(async () => {
            try {
                console.log(`Starting auto-evaluation for submission: ${submission._id}`);
                const evaluation = await evaluateSubmissionLogic(submission, fileBuffer);
                
                submission.evaluation = {
                    score: evaluation.score,
                    feedback: evaluation.feedback,
                    remarks: evaluation.remarks,
                    extractedText: evaluation.extractedText
                };
                submission.evaluated = true;
                
                await submission.save();
                console.log(`Auto-evaluation completed for submission: ${submission._id}`);
            } catch (evalError) {
                console.error('Auto-evaluation failed:', evalError);
                submission.evaluation = {
                    score: 0,
                    feedback: 'Auto-evaluation failed. Will be manually graded.',
                    remarks: 'Technical issue occurred.'
                };
                await submission.save();
            }
        }, 1000);
        
        console.log('=== SUBMIT ASSIGNMENT SUCCESS ===');
        
        res.json({
            message: 'Assignment submitted successfully! Evaluation in progress...',
            submission: {
                _id: submission._id,
                submittedAt: submission.submittedAt,
                pdfUrl: buildFullUrl(`/uploads/submissions/${path.basename(req.file.path)}`),
                evaluated: false,
                assignmentId: assignment._id
            }
        });
        
    } catch (error) {
        console.error('Submit assignment error:', error);
        res.status(500).json({ 
            message: 'Submission failed. Please try again.',
            error: error.message
        });
    }
};

// Get assignment by ID
exports.getAssignmentById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid Assignment ID' });
        
        const assignment = await Assignment.findById(id).populate('courseId', 'name');
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
        
        const plain = assignment.toObject();
        plain.pdfUrl = buildFullUrl(assignment.assignmentPdfPath);
        res.json(plain);
    } catch (error) {
        console.error('Get assignment error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Create assignment manually
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
            message: 'Assignment created successfully', 
            assignment,
            pdfUrl: buildFullUrl(pdfPath)
        });
    } catch (error) {
        console.error('Create assignment error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Generate questions with AI
exports.generateQuestions = async (req, res) => {
    try {
        console.log('=== GENERATE QUESTIONS START ===');
        const { courseId, prompt, numQuestions = 5, type = 'mixed', dueDate } = req.body;
        
        console.log('Request body:', { courseId, prompt, numQuestions, type, dueDate });
        
        // Validate required fields
        if (!courseId || !dueDate) {
            return res.status(400).json({ message: 'Course ID and dueDate are required' });
        }
        
        if (!prompt || prompt.trim().length < 3) {
            return res.status(400).json({ message: 'Please provide a valid prompt/topic' });
        }
        
        // Validate course
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }
        
        console.log('Generating questions for prompt:', prompt);
        
        // Generate questions using AI
        let questions;
        try {
            questions = await generateQuestionsWithAI(prompt, numQuestions);
            console.log('Generated questions:', questions);
        } catch (aiError) {
            console.error('AI generation failed:', aiError);
            // Fallback questions
            questions = [
                `Explain the main concepts of ${prompt}`,
                `What are the practical applications of ${prompt}?`,
                `Compare different approaches to ${prompt}`,
                `What challenges might arise when implementing ${prompt}?`,
                `How would you teach ${prompt} to a beginner?`
            ].slice(0, numQuestions);
        }
        
        // Validate we have questions
        if (!questions || questions.length === 0) {
            return res.status(400).json({ 
                message: 'Failed to generate questions. Please try a different prompt.' 
            });
        }
        
        // Create assignment
        const assignment = new Assignment({
            courseId,
            title: `AI Assignment: ${prompt.substring(0, 50)}`,
            questions: questions.slice(0, numQuestions),
            dueDate: new Date(dueDate),
            generatedByAI: true,
            promptUsed: prompt,
            type: type,
            numQuestions: questions.length
        });
        
        await assignment.save();
        
        // Generate PDF
        const pdfPath = await generateAssignmentPDF(assignment);
        assignment.assignmentPdfPath = pdfPath;
        await assignment.save();
        
        // Update course
        course.assignments = course.assignments || [];
        course.assignments.push(assignment._id);
        await course.save();
        
        console.log('=== GENERATE QUESTIONS SUCCESS ===');
        
        res.json({
            message: 'AI assignment generated successfully',
            assignment: {
                _id: assignment._id,
                title: assignment.title,
                questions: assignment.questions,
                dueDate: assignment.dueDate,
                generatedByAI: assignment.generatedByAI
            },
            questions: assignment.questions,
            pdfUrl: buildFullUrl(pdfPath)
        });
        
    } catch (error) {
        console.error('Generate questions error:', error);
        res.status(500).json({ 
            message: 'AI generation failed', 
            error: error.message,
            details: 'Please check your prompt and try again.'
        });
    }
};

// Get assignments by course
exports.getAssignmentsByCourse = async (req, res) => {
    try {
        const { courseId } = req.params;
        const course = await Course.findById(courseId).populate('assignments');
        if (!course) return res.status(404).json({ message: 'Course not found' });
        
        const assignmentsWithUrls = await Promise.all(
            (course.assignments || []).map(async (assign) => {
                const plain = assign.toObject();
                plain.pdfUrl = buildFullUrl(assign.assignmentPdfPath);
                
                if (req.user && req.user.role === 'student') {
                    const submission = await Submission.findOne({
                        studentId: req.user.id,
                        assignmentId: assign._id
                    });
                    plain.hasSubmitted = !!submission;
                    plain.submission = submission ? {
                        score: submission.evaluation?.score,
                        evaluated: submission.evaluated
                    } : null;
                }
                
                return plain;
            })
        );
        
        res.json(assignmentsWithUrls);
    } catch (error) {
        console.error('Get assignments by course error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Get all assignments
exports.getAllAssignments = async (req, res) => {
    try {
        const assignments = await Assignment.find()
            .populate('courseId', 'name')
            .sort({ createdAt: -1 });
        
        const assignmentsWithStats = await Promise.all(
            assignments.map(async (assign) => {
                const submissionCount = await Submission.countDocuments({ assignmentId: assign._id });
                const evaluatedCount = await Submission.countDocuments({ 
                    assignmentId: assign._id, 
                    evaluated: true 
                });
                
                const plain = assign.toObject();
                plain.pdfUrl = buildFullUrl(assign.assignmentPdfPath);
                plain.submissionCount = submissionCount;
                plain.evaluatedCount = evaluatedCount;
                plain.pendingCount = submissionCount - evaluatedCount;
                
                return plain;
            })
        );
        
        res.json(assignmentsWithStats);
    } catch (error) {
        console.error('Get all assignments error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Get submissions by assignment
exports.getSubmissionsByAssignment = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        
        // Validate assignment exists
        const assignment = await Assignment.findById(assignmentId);
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }
        
        const submissions = await Submission.find({ assignmentId })
            .populate('studentId', 'name email')
            .sort({ submittedAt: -1 });
        
        const submissionsWithUrls = submissions.map(sub => ({
            ...sub.toObject(),
            pdfUrl: buildFullUrl(sub.pdfPath),
            status: sub.evaluated ? 'Evaluated' : 'Pending'
        }));
        
        res.json(submissionsWithUrls);
    } catch (error) {
        console.error('Get submissions error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Get submission by ID
exports.getSubmissionById = async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        if (!mongoose.isValidObjectId(submissionId)) {
            return res.status(400).json({ message: 'Invalid Submission ID' });
        }
        
        const submission = await Submission.findById(submissionId)
            .populate('assignmentId', 'title questions')
            .populate('studentId', 'name email');
        
        if (!submission) {
            return res.status(404).json({ message: 'Submission not found' });
        }
        
        const submissionData = submission.toObject();
        submissionData.pdfUrl = buildFullUrl(submission.pdfPath);
        
        res.json(submissionData);
    } catch (error) {
        console.error('Get submission by ID error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Manual evaluation endpoint - FIXED VERSION
// In assignmentController.js - Update the evaluateSubmission function

exports.evaluateSubmission = async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        console.log(`Evaluating submission: ${submissionId}`);
        
        // Validate ObjectId
        if (!mongoose.isValidObjectId(submissionId)) {
            return res.status(400).json({ message: 'Invalid Submission ID format' });
        }
        
        // Find submission with assignment populated
        const submission = await Submission.findById(submissionId)
            .populate('assignmentId', 'title questions');
        
        if (!submission) {
            console.log(`Submission not found: ${submissionId}`);
            return res.status(404).json({ 
                message: 'Submission not found',
                suggestion: 'Check if the submission ID exists in the database'
            });
        }
        
        console.log(`Found submission: ${submission._id}`);
        console.log(`PDF path from DB: ${submission.pdfPath}`);
        
        // Check if PDF path exists
        if (!submission.pdfPath) {
            return res.status(400).json({ 
                message: 'PDF file path not found for this submission' 
            });
        }
        
        // Clean the path - remove leading slash if present
        let relativePath = submission.pdfPath;
        if (relativePath.startsWith('/')) {
            relativePath = relativePath.substring(1);
        }
        
        // Try multiple possible locations for the file
        const possiblePaths = [
            // Path 1: As stored in DB
            path.join(__dirname, '..', 'public', relativePath),
            
            // Path 2: Relative from backend folder
            path.join(__dirname, '..', '..', 'public', relativePath),
            
            // Path 3: Absolute path if it's stored as full path
            submission.pdfPath,
            
            // Path 4: From project root
            path.join(process.cwd(), 'public', relativePath),
            
            // Path 5: Common alternative structure
            path.join(__dirname, '..', relativePath),
        ];
        
        console.log('Looking for PDF at these locations:');
        possiblePaths.forEach((p, i) => {
            console.log(`  ${i + 1}. ${p}`);
        });
        
        let fileFound = false;
        let foundPath = null;
        let dataBuffer = null;
        
        // Try each possible path
        for (const filePath of possiblePaths) {
            try {
                if (fsSync.existsSync(filePath)) {
                    console.log(`✓ Found PDF at: ${filePath}`);
                    dataBuffer = fsSync.readFileSync(filePath);
                    foundPath = filePath;
                    fileFound = true;
                    break;
                }
            } catch (err) {
                console.log(`✗ Not found at: ${filePath}`);
                continue;
            }
        }
        
        if (!fileFound) {
            console.error('PDF file not found at any location');
            
            // Try to list files in the uploads directory to see what's there
            try {
                const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'submissions');
                if (fsSync.existsSync(uploadsDir)) {
                    const files = fsSync.readdirSync(uploadsDir);
                    console.log(`Files in uploads/submissions directory:`, files);
                    
                    // Try to find a matching file by filename
                    const filename = path.basename(submission.pdfPath);
                    console.log(`Looking for filename: ${filename}`);
                    
                    const matchingFiles = files.filter(f => f.includes(filename.split('_')[0]));
                    if (matchingFiles.length > 0) {
                        console.log(`Possible matching files:`, matchingFiles);
                        
                        // Try the first matching file
                        const matchPath = path.join(uploadsDir, matchingFiles[0]);
                        if (fsSync.existsSync(matchPath)) {
                            console.log(`Using matching file: ${matchPath}`);
                            dataBuffer = fsSync.readFileSync(matchPath);
                            fileFound = true;
                            foundPath = matchPath;
                        }
                    }
                }
            } catch (dirError) {
                console.error('Error scanning uploads directory:', dirError);
            }
            
            if (!fileFound) {
                return res.status(404).json({ 
                    message: 'PDF file not found',
                    storedPath: submission.pdfPath,
                    relativePath: relativePath,
                    suggestion: 'Check if the file was moved or deleted'
                });
            }
        }
        
        // Now evaluate the submission
        const evaluation = await evaluateSubmissionLogic(submission, dataBuffer);
        
        // Update submission
        submission.evaluation = {
            score: evaluation.score,
            feedback: evaluation.feedback,
            remarks: evaluation.remarks,
            extractedText: evaluation.extractedText,
            evaluatedAt: new Date(),
            filePathUsed: foundPath || submission.pdfPath
        };
        submission.evaluated = true;
        await submission.save();
        
        res.json({
            message: 'Evaluation completed successfully',
            evaluation: submission.evaluation,
            submissionId: submission._id,
            assignmentTitle: submission.assignmentId?.title,
            fileFoundAt: foundPath
        });
        
    } catch (error) {
        console.error('Manual evaluation error:', error);
        res.status(500).json({ 
            message: 'Evaluation failed', 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};
// Update assignment
exports.updateAssignment = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, questions, dueDate } = req.body;
        
        const assignment = await Assignment.findById(id);
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
        
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
            message: 'Assignment updated',
            assignment,
            pdfUrl: buildFullUrl(assignment.assignmentPdfPath)
        });
        
    } catch (error) {
        console.error('Update assignment error:', error);
        res.status(500).json({ message: 'Update failed', error: error.message });
    }
};

// Delete assignment
exports.deleteAssignment = async (req, res) => {
    try {
        const { id } = req.params;
        const assignment = await Assignment.findById(id);
        
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
        
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
        
        res.json({ message: 'Assignment deleted successfully' });
        
    } catch (error) {
        console.error('Delete assignment error:', error);
        res.status(500).json({ message: 'Deletion failed', error: error.message });
    }
};

// Test endpoint to check submission existence
exports.checkSubmission = async (req, res) => {
    try {
        const { submissionId } = req.params;
        
        console.log(`Checking submission: ${submissionId}`);
        
        if (!mongoose.isValidObjectId(submissionId)) {
            return res.status(400).json({ 
                isValidObjectId: false,
                message: 'Invalid MongoDB ObjectId format'
            });
        }
        
        const submission = await Submission.findById(submissionId);
        
        if (!submission) {
            return res.status(404).json({ 
                exists: false,
                message: 'Submission not found in database'
            });
        }
        
        res.json({
            exists: true,
            submission: {
                _id: submission._id,
                assignmentId: submission.assignmentId,
                studentId: submission.studentId,
                evaluated: submission.evaluated,
                pdfPath: submission.pdfPath,
                submittedAt: submission.submittedAt
            }
        });
        
    } catch (error) {
        console.error('Check submission error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Test AI connection
exports.testAI = async (req, res) => {
    try {
        const { prompt = "Hello, how are you?" } = req.body;
        
        console.log('Testing AI with prompt:', prompt);
        
        const response = await ollama.chat({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            stream: false,
            options: { temperature: 0.7 }
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
            suggestion: 'Check if Ollama is running and the model is downloaded.'
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
                message: 'No pending submissions to evaluate',
                count: 0 
            });
        }
        
        const results = [];
        
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
                
                const fullPath = path.join(__dirname, '..', 'public', submission.pdfPath);
                if (!fsSync.existsSync(fullPath)) {
                    results.push({
                        submissionId: submission._id,
                        success: false,
                        error: 'PDF file not found'
                    });
                    continue;
                }
                
                const dataBuffer = fsSync.readFileSync(fullPath);
                const evaluation = await evaluateSubmissionLogic(submission, dataBuffer);
                
                submission.evaluation = {
                    score: evaluation.score,
                    feedback: evaluation.feedback,
                    remarks: evaluation.remarks,
                    extractedText: evaluation.extractedText
                };
                submission.evaluated = true;
                await submission.save();
                
                results.push({
                    submissionId: submission._id,
                    success: true,
                    score: evaluation.score
                });
                
            } catch (error) {
                results.push({
                    submissionId: submission._id,
                    success: false,
                    error: error.message
                });
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        
        res.json({
            message: `Bulk evaluation completed. Success: ${successCount}, Failed: ${failCount}`,
            total: pendingSubmissions.length,
            success: successCount,
            failed: failCount,
            results: results
        });
        
    } catch (error) {
        console.error('Bulk evaluate error:', error);
        res.status(500).json({ 
            message: 'Bulk evaluation failed', 
            error: error.message 
        });
    }
};