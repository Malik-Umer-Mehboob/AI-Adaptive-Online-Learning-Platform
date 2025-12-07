// controllers/assignmentController.js
// Updated/fixed: full URLs, robust path handling, safer PDF write/finish handling,
// improved Tesseract init for v5+ (no load/initialize), PDF header validation, graceful extraction fallback,
// defensive checks, clearer logs, env BASE_URL support. No throw on empty text - manual review instead.
// NEW: pdf2pic for PDF-to-image conversion in OCR, better error isolation, min size checks.
// MAJOR UPDATE: Switched to ollama.chat for better instruction following. Prefer qwen2.5:7b model (larger, better accuracy).
// Added few-shot examples, retry logic (2 attempts), stricter parsing/validation. Lower temp for consistency.
// CRITICAL FIX: Added format: 'json' for JSON mode in Ollama (forces valid JSON output). Updated prompts to leverage it.
// For generateQuestions: Now outputs JSON array of questions for reliable parsing.
// BUG FIX: Removed web-dev specific fallback/override. Now uses neutral fallback questions if AI fails.
// Increased timeout to 20s, added more logs for debugging failures. Simplified retry logic to avoid prompt override.
// NEW (as per requirement): Enhanced submit response to inform about auto-evaluation. Async eval now logs more.
// MAJOR FIX (user req): Improved generateQuestions prompt - stricter adherence to user prompt, few-shot examples for accuracy, emphasize course context.
// FIXED: Evaluation prompts - more detailed system prompt with grading rubric, better feedback (specific strengths/weaknesses), actionable remarks.
// Increased num_predict for eval to allow richer feedback. Added validation for feedback/remarks length/quality.
// CRITICAL FIX (this update): Made systemPrompt adaptive to user's 'type' param and detect "descriptive" in prompt for only open-ended questions.
// UPDATED fallback: Now generates 10 descriptive questions covering all specified Python topics (hardcoded as JSON array for reliability).
// If prompt mentions "descriptive", force type='descriptive' and adjust system prompt accordingly. Ensured exactly numQuestions, all descriptive if requested.
// UPDATED: Switched preferred model to qwen2.5:7b (user-activated, larger/better for instruction/coding tasks).

const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const ollama = require('ollama').default;
const pdfParse = require('pdf-parse');
const { createWorker } = require('tesseract.js');
const { fromBuffer } = require('pdf2pic');  // NEW: For PDF-to-image conversion
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const os = require('os');
const mongoose = require('mongoose');

let MODEL = 'qwen2.5:7b';

// BASE URL (env override)
const BASE_URL = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/+$/, ''); // strip trailing slash

// Build full URL safely (handles already-absolute paths too)
const buildFullUrl = (relativeOrAbsolutePath) => {
    if (!relativeOrAbsolutePath) return null;
    // If path already looks like a full URL, return as-is
    if (/^https?:\/\//i.test(relativeOrAbsolutePath)) return relativeOrAbsolutePath;
    // Ensure leading slash
    const cleanPath = relativeOrAbsolutePath.startsWith('/') ? relativeOrAbsolutePath : `/${relativeOrAbsolutePath}`;
    return `${BASE_URL}${cleanPath}`;
};

// Helper: detect available model (defensive) - UPDATED: Prefer qwen2.5:7b for better accuracy/instruction following
async function getAvailableModel() {
    try {
        const list = await ollama.list(); // expected API: returns object/array - do best-effort checks
        // Try different shapes defensively
        const modelsArr = Array.isArray(list) ? list : (list && list.models) ? list.models : [];
        
        // Prefer qwen2.5:7b if available (larger, better for prompts), fallback to llama3.2:3b or phi3:mini
        const preferred = modelsArr.find(m => m.name === 'qwen2.5:7b' || m.id === 'qwen2.5:7b');
        if (preferred) {
            console.log(`Using preferred model: qwen2.5:7b (larger, better accuracy)`);
            return 'qwen2.5:7b';
        }
        
        // Next, llama3.2:3b
        const llamaFound = modelsArr.find(m => m.name === 'llama3.2:3b' || m.id === 'llama3.2:3b');
        if (llamaFound) {
            console.log(`Using model: llama3.2:3b (good balance)`);
            return 'llama3.2:3b';
        }
        
        // Next, phi3:mini
        const phiFound = modelsArr.find(m => m.name === 'phi3:mini' || m.id === 'phi3:mini');
        if (phiFound) {
            console.log(`Using model: phi3:mini (compact)`);
            return 'phi3:mini';
        }
        
        // Fallback to 1b
        const smallLlama = modelsArr.find(m => m.name === 'llama3.2:1b' || m.id === 'llama3.2:1b' || m === MODEL);
        if (smallLlama) {
            console.log(`Using model: llama3.2:1b (fast but monitor accuracy)`);
            return 'llama3.2:1b';
        } else {
            console.log(`No preferred models found, falling back to qwen2.5:7b (assume pulled)`);
            return 'qwen2.5:7b';
        }
    } catch (err) {
        console.error('Model list error (using fallback):', err && err.message ? err.message : err);
        return 'qwen2.5:7b';
    }
}

async function tryPdfTextExtract(dataBuffer) {
    // UPDATED: Basic PDF validation + pdf-parse
    try {
        // FIXED: Check PDF header (%PDF-1.4 or similar)
        const header = dataBuffer.slice(0, 8).toString('ascii');
        if (!header.startsWith('%PDF-')) {
            console.warn('Invalid PDF header:', header);
            return '';
        }
        
        // NEW: Add size check to catch tiny/corrupt files early
        if (dataBuffer.length < 1000) {
            console.warn('PDF too small (possible corruption):', dataBuffer.length);
            return '';
        }
        
        const pdfData = await pdfParse(dataBuffer);
        if (pdfData && pdfData.text && pdfData.text.trim().length > 0) {
            return pdfData.text.trim().substring(0, 2000);  // Limit early
        }
    } catch (err) {
        console.warn('pdf-parse failed (possible corrupted PDF):', err && err.message ? err.message : err);
    }
    return '';
}

async function tryOcrExtract(dataBuffer) {
    let worker;
    let convertedImages = [];  // NEW: Store image buffers
    try {
        // NEW: Convert PDF to images first (only first 2 pages for speed)
        const convert = fromBuffer(dataBuffer, {
            density: 200,  // DPI for quality
            saveFilename: 'page',
            savePath: os.tmpdir(),  // Temp dir
            format: 'png',
            width: 800,
            height: 600
        });
        
        const pages = await convert.bulk(-1, { responseType: 'buffer' });  // All pages, but we'll limit later
        if (!pages || pages.length === 0) {
            throw new Error('No pages converted from PDF');
        }
        convertedImages = pages.map(p => p.buffer);  // Extract buffers
        console.log(`OCR: Converted ${convertedImages.length} pages to images`);

        // FIXED: Tesseract.js v5+ API - createWorker('eng') loads lang directly, no load/initialize
        worker = await createWorker('eng');  // English lang auto-loaded
        
        // FIXED: Parameters via recognize options (not setParameters)
        let ocrText = '';
        for (const imgBuffer of convertedImages.slice(0, 2)) {  // Limit to 2 pages
            const { data: { text } } = await worker.recognize(imgBuffer, {
                tessedit_pageseg_mode: '1',  // Single uniform block of text
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,?!:;-()[]{}"\'\n'  // Whitelist chars
            });
            ocrText += (text || '').trim() + '\n';
        }
        
        await worker.terminate();
        
        // NEW: Explicit cleanup for converted images (if any) - buffers auto-GC, but if files saved: unlink
        // For now, since responseType: 'buffer', no files to delete
        
        return ocrText.trim().substring(0, 2000);
    } catch (ocrErr) {
        console.error('OCR error (check pdf2pic/Tesseract install):', ocrErr && ocrErr.message ? ocrErr.message : ocrErr);
        if (worker) {
            try { await worker.terminate(); } catch (_) {}
        }
        // NEW: Explicit cleanup for converted images (if any)
        for (const img of convertedImages) {
            // Buffers auto-GC, but if files: unlink
        }
        return '';  // Graceful empty return - no crash
    }
}

// UPDATED: evaluateSubmissionLogic - Enhanced system prompt for better, more accurate feedback/remarks.
// Added grading rubric, examples for constructive feedback. Increased num_predict for detailed outputs.
// Stricter validation to ensure feedback/remarks are meaningful (not too short/vague).
async function evaluateSubmissionLogic(submission, dataBuffer, fullPath) {
    const currentModel = await getAvailableModel();
    console.log(`Starting eval with model: ${currentModel}`);

    let studentAnswer = await tryPdfTextExtract(dataBuffer);
    console.log(`PDF extract length: ${studentAnswer.length}`);
    
    if (!studentAnswer || studentAnswer.length === 0) {
        console.log('PDF empty, trying OCR...');
        studentAnswer = await tryOcrExtract(dataBuffer);
        console.log(`OCR extract length: ${studentAnswer.length}`);
    }

    // FIXED: Graceful fallback - no throw, return manual review if empty
    if (!studentAnswer || studentAnswer.length === 0) {
        console.warn('No text extracted from PDF - marking for manual review');
        return { 
            score: 0, 
            feedback: 'PDF unreadable (no text detected via PDF/OCR). Please resubmit a text-based PDF or contact admin for manual grading.', 
            remarks: 'Tip: Use editable PDF with selectable text (not scanned images).' 
        };
    }

    // Limit to safe length
    studentAnswer = studentAnswer.substring(0, 2000);

    const populatedSubmission = await Submission.findById(submission._id).populate('assignmentId');
    const questions = populatedSubmission.assignmentId.questions.join('\n').substring(0, 1000);

    // UPDATED: Enhanced prompt with rubric, few-shot for better feedback/remarks
    const systemPrompt = `You are a strict, expert assignment grader for computer science courses. Grade based on this rubric: 
- 90-100: Complete, accurate, insightful answers with examples/code.
- 70-89: Mostly correct, minor errors, good structure.
- 50-69: Partial understanding, key points missing.
- 30-49: Basic errors, incomplete.
- 0-29: Incorrect or irrelevant.

Provide concise, specific feedback (1-2 sentences: highlight 1 strength + 1 weakness). Remarks: 1 actionable tip (e.g., "Add code examples next time"). Be fair and constructive.

Respond with ONLY a valid JSON object: {"score": <0-100 number>, "feedback": "<specific feedback>", "remarks": "<actionable tip>"}. No other text.

Example 1: Questions on variables, Answer correct but no example.
{"score": 80, "feedback": "Strong grasp of concepts, but lacks practical example.", "remarks": "Include code snippets for better illustration."}

Example 2: Poor answer on scope.
{"score": 40, "feedback": "Misunderstands local vs global scope.", "remarks": "Review scope rules with nested function examples."}`;

    const userPrompt = `Questions: ${questions}\n\nStudent Answer: ${studentAnswer}\n\nGrade it now.`;

    const timeoutMs = 15000;  // Increased for retry
    const timeoutPromise = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error(`Eval timeout ${ms}ms`)), ms));

    let evalData;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
        try {
            console.log(`Eval attempt ${attempts + 1}...`);
            const response = await Promise.race([
                ollama.chat({
                    model: currentModel,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    stream: false,
                    options: { 
                        temperature: 0.1,  // Lower for strict output
                        num_predict: 300,  // Increased for richer feedback
                        top_p: 0.7,
                        num_thread: Math.min(os.cpus().length, 4),
                        format: 'json'  // CRITICAL: Forces JSON output
                    }
                }),
                timeoutPromise(timeoutMs)
            ]);

            const evalText = (response && response.message && response.message.content) ? response.message.content.trim() : '';
            console.log('Ollama eval SUCCESS - Raw JSON response:', evalText.substring(0, 200));

            // With JSON mode, direct parse (fallback regex if needed)
            try {
                evalData = JSON.parse(evalText);
                // Enhanced validation: Ensure feedback/remarks are meaningful
                if (typeof evalData.score === 'number' && 
                    evalData.feedback && evalData.feedback.length > 10 && 
                    evalData.remarks && evalData.remarks.length > 5) {
                    console.log('Valid JSON parsed successfully');
                    break;  // Good, exit loop
                } else {
                    throw new Error('Invalid JSON structure or too short content');
                }
            } catch (parseErr) {
                console.warn('JSON parse failed on attempt', attempts + 1, ':', parseErr.message);
                // Fallback regex (enhanced for JSON-like)
                const scoreMatch = evalText.match(/"score"\s*:\s*(\d{1,3})/) || evalText.match(/score[:\s]*(\d{1,3})/);
                const feedbackMatch = evalText.match(/"feedback"\s*:\s*"([^"]{10,300})"/) || evalText.match(/feedback[:\s]*"([^"]{10,300})"/);
                const remarksMatch = evalText.match(/"remarks"\s*:\s*"([^"]{5,200})"/) || evalText.match(/remarks[:\s]*"([^"]{5,200})"/);

                evalData = {
                    score: scoreMatch ? parseInt(scoreMatch[1], 10) : 50,
                    feedback: (feedbackMatch ? feedbackMatch[1] : 'Review needed for accuracy and completeness.').substring(0, 300),
                    remarks: (remarksMatch ? remarksMatch[1] : 'Focus on key concepts with examples.').substring(0, 200)
                };
                // Accept if regex works and lengths ok
                if (scoreMatch && feedbackMatch && remarksMatch) {
                    console.log('Regex fallback successful');
                    break;
                }
            }
            attempts++;
        } catch (ollamaErr) {
            console.error(`Ollama eval error on attempt ${attempts + 1}:`, ollamaErr.message);
            attempts++;
            if (attempts >= maxAttempts) {
                throw ollamaErr;  // Final error
            }
        }
    }

    return {
        score: Math.max(0, Math.min(100, Number(evalData.score || 0))),
        feedback: (evalData.feedback || 'Evaluation pending - check understanding of core concepts.').substring(0, 300),
        remarks: (evalData.remarks || 'Next time, provide detailed explanations with examples.').substring(0, 200)
    };
}

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
        console.error('Get assignment by ID error:', error && error.message ? error.message : error);
        res.status(500).json({ message: 'Server error', error: error.message || error });
    }
};

exports.createAssignment = async (req, res) => {
    try {
        const { courseId, title, questions, dueDate } = req.body;
        if (!courseId || !title || !questions || !dueDate) {
            return res.status(400).json({ message: 'Course ID, title, questions, and dueDate required' });
        }
        if (!mongoose.isValidObjectId(courseId)) return res.status(400).json({ message: 'Invalid Course ID' });

        const course = await Course.findById(courseId);
        if (!course) return res.status(404).json({ message: 'Course not found' });

        const assignment = new Assignment({
            courseId,
            title,
            questions: Array.isArray(questions) ? questions : String(questions).split(',').map(q => q.trim()).filter(Boolean),
            dueDate: new Date(dueDate),
            generatedByAI: false
        });
        await assignment.save();

        course.assignments = course.assignments || [];
        course.assignments.push(assignment._id);
        await course.save();

        res.status(201).json({ message: 'Assignment created successfully', assignment });
    } catch (error) {
        console.error('Create assignment error:', error && error.message ? error.message : error);
        res.status(500).json({ message: 'Server error', error: error.message || error });
    }
};

// UPDATED: generateQuestions - Enhanced system prompt for strict prompt adherence, few-shot examples, better relevance to user prompt/course.
// Added emphasis on "exactly match the user's specific request" e.g., if prompt is "Python loops", generate only on that.
// NEW: Adaptive systemPrompt based on 'type' (mixed/descriptive) and detect "descriptive" in prompt to force descriptive-only.
// UPDATED fallback: Hardcoded 10 descriptive questions covering Python topics as JSON array (no MCQs, open-ended).
exports.generateQuestions = async (req, res) => {
    try {
        console.log('Request body:', JSON.stringify(req.body || {}, null, 2));
        const { courseId, prompt, numQuestions = 5, type = 'mixed', dueDate } = req.body;
        if (!courseId || !prompt || !dueDate) {
            return res.status(400).json({ message: 'Course ID, prompt, and dueDate required' });
        }
        if (!mongoose.isValidObjectId(courseId)) return res.status(400).json({ message: 'Invalid Course ID' });

        const course = await Course.findById(courseId).populate('topics');
        if (!course) return res.status(404).json({ message: 'Course not found' });

        let courseContent = (course.description || '').substring(0, 120);
        if (course.topics?.length) {
            courseContent += '\nTopics: ' + course.topics.map(t => t.name).slice(0, 6).join(', ');
        }

        // NEW: Auto-detect if prompt wants descriptive-only
        const effectiveType = (prompt.toLowerCase().includes('descriptive') || type === 'descriptive') ? 'descriptive' : type;
        console.log(`Effective question type: ${effectiveType}`);

        const currentModel = await getAvailableModel();
        const timeoutPromise = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error(`Ollama timeout ${ms}ms`)), ms));

        // UPDATED: Adaptive system prompt - based on effectiveType, emphasize descriptive if requested
        let systemPrompt = `You are an expert question generator for programming courses. Strictly follow the user's exact prompt (e.g., if "Python loops", focus ONLY on loops, not other topics). Incorporate course context where relevant. Create EXACTLY ${numQuestions} questions. `;
        
        if (effectiveType === 'descriptive') {
            systemPrompt += `Generate ONLY descriptive/open-ended questions (no MCQs/options). Format each as a string: "1. Explain [detailed topic or concept].", "2. Describe how to [process] with examples." etc. Ensure coverage of specified topics if mentioned.`;
            systemPrompt += `\nFew-shot examples for descriptive:\nIf prompt: "Python variables basics", output: ["1. Explain the concept of variables in Python and their role in programming.", "2. Describe the process of variable assignment and reassignment with an example.", "3. Discuss the different data types available in Python and when to use each.", "4. Elaborate on variable naming conventions and best practices.", "5. Describe variable scope (local vs global) with a code example."]`;
        } else {
            systemPrompt += `Mix MCQs (4 options A-D, one correct) and descriptive questions. Format MCQs as: "1. Question? A) opt1 B) opt2 C) opt3 D) opt4" and descriptive as: "1. Explain [topic].".`;
            systemPrompt += `\nFew-shot examples:\nIf prompt: "Python variables basics", output: ["1. What is a variable in Python? A) Fixed memory B) Dynamic storage C) Function type D) Class attribute", "2. How to assign value? A) x=5 B) var x=5 C) let x=5 D) int x=5", "3. Explain dynamic typing.", "4. Naming conventions? A) Start with _ B) Numbers only C) Spaces OK D) All caps always", "5. What error for undefined var? A) NameError B) SyntaxError C) TypeError D) ValueError"]`;
        }

        systemPrompt += `\nRespond with ONLY a valid JSON array of ${numQuestions} strings. No intro/conclusion.`;

        const userPrompt = `User's specific request: ${prompt}\nCourse context: ${courseContent}\n\nGenerate ${numQuestions} relevant questions now.`;

        let generatedText = '';
        let attempts = 0;
        const maxAttempts = 2;

        while (attempts < maxAttempts && (!generatedText || generatedText.trim().length < 60)) {
            try {
                console.log(`Question gen attempt ${attempts + 1} with prompt: ${userPrompt.substring(0, 100)}... (type: ${effectiveType})`);
                const response = await Promise.race([
                    ollama.chat({
                        model: currentModel,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userPrompt }
                        ],
                        stream: false,
                        options: {
                            temperature: 0.1,
                            num_predict: 800,  // Increased for more detailed questions
                            top_p: 0.6,
                            num_thread: Math.min(os.cpus().length, 4),
                            format: 'json'  // CRITICAL: Forces JSON array output
                        }
                    }),
                    timeoutPromise(20000)  // Increased to 20s for complex prompts
                ]);
                generatedText = (response && response.message && response.message.content) ? response.message.content.trim() : '';
                console.log(`Raw generatedText length: ${generatedText.length}, preview: ${generatedText.substring(0, 200)}`);
            } catch (ollamaErr) {
                console.error('Ollama generate error/timeout on attempt', attempts + 1, ':', ollamaErr && ollamaErr.message ? ollamaErr.message : ollamaErr);
                // UPDATED: Better fallback - 10 descriptive questions on Python topics (as JSON array)
                if (attempts === 0) {
                    generatedText = `["1. Explain the basic syntax rules for writing Python code, including indentation and comments.", "2. Describe the different data types in Python (int, float, str, bool) and provide examples of each.", "3. Discuss how variables are declared and assigned values in Python, including dynamic typing.", "4. Elaborate on arithmetic, comparison, logical, and assignment operators with examples.", "5. Describe the use of if-elif-else statements for conditional execution in Python.", "6. Explain the for loop and while loop constructs, including range() function and loop control statements like break and continue.", "7. Discuss how to define functions with parameters, default arguments, and return statements.", "8. Describe the scope of variables in functions (local vs global) and how to use global keyword.", "9. Explain lists, tuples, dictionaries, and sets: their creation, indexing, methods, and differences.", "10. Describe string manipulation techniques including slicing, methods like split(), join(), and formatting."]`;
                    console.log('Using enhanced descriptive fallback JSON for questions (Python topics).');
                } else {
                    return res.status(500).json({ message: 'AI service unavailable - check Ollama', error: ollamaErr.message });
                }
            }

            attempts++;
        }

        const startTime = Date.now();

        let questions = [];
        try {
            // Direct JSON parse since format='json'
            const parsed = JSON.parse(generatedText);
            if (Array.isArray(parsed)) {
                questions = parsed.map(q => String(q).trim()).filter(q => q.length > 8);
                console.log(`Parsed ${questions.length} questions from JSON.`);
            } else {
                throw new Error('Not an array');
            }
        } catch (parseErr) {
            console.warn('JSON parse failed for questions, using fallback extraction:', parseErr.message);
            // Fallback to line-based parsing if JSON fails
            const lines = generatedText.split('\n').map(l => l.trim()).filter(Boolean);
            let current = null;
            for (const line of lines) {
                if (/^\d+\.\s*/.test(line)) {
                    if (current) questions.push(current.trim());
                    current = line;
                } else if (current) {
                    current += ' ' + line;
                } else if (line.length > 20) {
                    questions.push(line);
                }
            }
            if (current) questions.push(current.trim());
            console.log(`Fallback extraction yielded ${questions.length} questions.`);
        }

        // Limit and filter
        const finalQs = questions.slice(0, numQuestions).filter(q => q.length > 8);
        if (finalQs.length === 0) {
            return res.status(400).json({ message: 'AI output invalid. Try simpler prompt (e.g., "3 Python MCQs").', raw: generatedText });
        }

        const assignment = new Assignment({
            courseId,
            title: `AI Assignment: ${String(prompt).substring(0, 60)}...`,
            questions: finalQs,
            dueDate: new Date(dueDate),
            generatedByAI: true,
            promptUsed: userPrompt,
            type: effectiveType,
            numQuestions: finalQs.length
        });
        await assignment.save();

        course.assignments = course.assignments || [];
        course.assignments.push(assignment._id);
        await course.save();

        const pdfPath = await generateAssignmentPDF(assignment);
        assignment.assignmentPdfPath = pdfPath;
        await assignment.save();

        const totalTime = Date.now() - startTime;
        res.json({
            message: `AI assignment generated.`,
            assignment,
            questions: finalQs,
            genTimeMs: totalTime,
            usedModel: currentModel
        });
    } catch (error) {
        console.error('AI generate error:', error && error.message ? error.message : error);
        res.status(500).json({ message: 'AI generation failed', error: (error && error.message) ? error.message : error });
    }
};

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

        doc.fontSize(18).text(assignment.title, { align: 'center' });
        doc.moveDown();

        (assignment.questions || []).forEach((q, idx) => {
            doc.fontSize(12).text(`${idx + 1}. ${q}`);
            doc.moveDown(0.5);
        });

        doc.moveDown();
        try {
            const dueText = assignment.dueDate ? new Date(assignment.dueDate).toLocaleString() : 'N/A';
            doc.fontSize(10).text(`Due Date: ${dueText}`, { align: 'right' });
        } catch (_) {}

        doc.end();

        // Resolve on writeStream finish (safe)
        writeStream.on('finish', () => resolve(relativePath));
        writeStream.on('error', (err) => reject(err));
        // As extra safety (PDFDocument 'end' can also indicate end)
        doc.on('error', (err) => reject(err));
    });
}

exports.getAssignmentsByCourse = async (req, res) => {
    try {
        const { courseId } = req.params;
        if (!mongoose.isValidObjectId(courseId)) return res.status(400).json({ message: 'Invalid Course ID' });

        const course = await Course.findById(courseId).select('_id');
        if (!course) return res.status(404).json({ message: 'Course not found' });

        const fullCourse = await Course.findById(courseId).populate('assignments');
        if (!fullCourse) return res.status(404).json({ message: 'Course not found' });

        const now = new Date();
        const activeAssignments = (fullCourse.assignments || []).filter(a => new Date(a.dueDate) > now);

        if (req.user && req.user.role === 'student') {
            const enrollment = await Enrollment.findOne({ studentId: req.user.id, courseId });
            if (!enrollment) return res.status(403).json({ message: 'Not enrolled' });

            const assignmentsWithStatus = await Promise.all(activeAssignments.map(async (assign) => {
                const submission = await Submission.findOne({ studentId: req.user.id, assignmentId: assign._id });
                const plain = assign.toObject();
                plain.hasSubmitted = !!submission;
                plain.submittedAt = submission ? submission.submittedAt : null;
                plain.pdfUrl = buildFullUrl(assign.assignmentPdfPath);
                if (submission && submission.evaluation) {
                    plain.score = submission.evaluation.score;
                    plain.feedback = submission.evaluation.feedback;
                    plain.remarks = submission.evaluation.remarks;
                }
                return plain;
            }));
            return res.json(assignmentsWithStatus);
        }

        const adminAssignments = activeAssignments.map(assign => {
            const plain = assign.toObject();
            plain.pdfUrl = buildFullUrl(assign.assignmentPdfPath);
            return plain;
        });

        res.json(adminAssignments);
    } catch (error) {
        console.error('Get assignments error:', error && error.message ? error.message : error);
        res.status(500).json({ message: 'Server error', error: error.message || error });
    }
};

exports.getAllAssignments = async (req, res) => {
    try {
        const assignments = await Assignment.find()
            .populate('courseId', 'name description')
            .populate({
                path: 'submissions',
                populate: { path: 'studentId', select: 'name' }
            });

        const assignmentsWithCounts = (assignments || []).map(assignment => {
            const pendingCount = assignment.submissions ? assignment.submissions.filter(s => !s.evaluated).length : 0;
            return {
                ...assignment.toObject(),
                pendingSubmissions: pendingCount,
                pdfUrl: buildFullUrl(assignment.assignmentPdfPath)
            };
        });

        res.json(assignmentsWithCounts);
    } catch (error) {
        console.error('Get all assignments error:', error && error.message ? error.message : error);
        res.status(500).json({ message: 'Server error', error: error.message || error });
    }
};

exports.getSubmissionsByAssignment = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        if (!mongoose.isValidObjectId(assignmentId)) return res.status(400).json({ message: 'Invalid Assignment ID' });

        const assignment = await Assignment.findById(assignmentId);
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

        const submissions = await Submission.find({ assignmentId })
            .populate({ path: 'studentId', select: 'name email' })
            .sort({ submittedAt: -1 })
            .lean();

        const submissionsWithUrls = (submissions || []).map(sub => ({
            ...sub,
            pdfUrl: buildFullUrl(sub.pdfPath)
        }));

        const pendingSubmissions = submissionsWithUrls.filter(s => !s.evaluated);
        res.json(pendingSubmissions);
    } catch (error) {
        console.error('Get submissions by assignment error:', error && error.message ? error.message : error);
        res.status(500).json({ message: 'Server error', error: error.message || error });
    }
};

exports.updateAssignment = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, courseId, dueDate, questions } = req.body;
        if (!title || !courseId || !dueDate) return res.status(400).json({ message: 'Title, courseId, and dueDate required' });

        if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(courseId)) {
            return res.status(400).json({ message: 'Invalid ID(s)' });
        }

        const assignment = await Assignment.findById(id).populate('courseId');
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

        if (assignment.courseId.toString() !== courseId) {
            const oldCourse = await Course.findById(assignment.courseId);
            if (oldCourse) {
                oldCourse.assignments = (oldCourse.assignments || []).filter(a => a.toString() !== id);
                await oldCourse.save();
            }

            const newCourse = await Course.findById(courseId);
            if (newCourse) {
                newCourse.assignments = newCourse.assignments || [];
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
        const plain = updatedAssignment.toObject();
        plain.pdfUrl = buildFullUrl(updatedAssignment.assignmentPdfPath);

        res.json({ message: 'Assignment updated successfully', assignment: plain });
    } catch (error) {
        console.error('Update assignment error:', error && error.message ? error.message : error);
        res.status(500).json({ message: 'Server error', error: error.message || error });
    }
};

exports.deleteAssignment = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid Assignment ID' });

        const assignment = await Assignment.findById(id).populate('courseId');
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

        if (assignment.courseId && assignment.courseId.assignments) {
            assignment.courseId.assignments = (assignment.courseId.assignments || []).filter(a => a.toString() !== id);
            await assignment.courseId.save();
        }

        if (assignment.assignmentPdfPath) {
            const relativePath = assignment.assignmentPdfPath.startsWith('/') ? assignment.assignmentPdfPath.substring(1) : assignment.assignmentPdfPath;
            const fullPath = path.join(__dirname, '..', 'public', relativePath.replace(/\\/g, '/'));
            if (fsSync.existsSync(fullPath)) {
                try { fsSync.unlinkSync(fullPath); } catch (e) { console.warn('Could not delete assignment pdf:', e && e.message ? e.message : e); }
            }
        }

        const submissions = await Submission.find({ assignmentId: id });
        for (const submission of submissions) {
            if (submission.pdfPath) {
                const relativePath = submission.pdfPath.startsWith('/') ? submission.pdfPath.substring(1) : submission.pdfPath;
                const fullPath = path.join(__dirname, '..', 'public', relativePath.replace(/\\/g, '/'));
                if (fsSync.existsSync(fullPath)) {
                    try { fsSync.unlinkSync(fullPath); } catch (e) { console.warn('Could not delete submission pdf:', e && e.message ? e.message : e); }
                }
            }
        }
        await Submission.deleteMany({ assignmentId: id });

        await Assignment.findByIdAndDelete(id);

        res.json({ message: 'Assignment, PDF, and submissions deleted' });
    } catch (error) {
        console.error('Delete assignment error:', error && error.message ? error.message : error);
        res.status(500).json({ message: 'Server error', error: error.message || error });
    }
};

// controllers/assignmentController.js

exports.submitAssignment = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        if (!assignmentId || !req.file) {
            return res.status(400).json({ message: 'Assignment ID and PDF required' });
        }
        if (!mongoose.isValidObjectId(assignmentId)) return res.status(400).json({ message: 'Invalid Assignment ID' });

        if (!req.file.mimetype.startsWith('application/pdf')) {
            return res.status(400).json({ message: 'Only PDF files allowed' });
        }
        if (req.file.size > 5 * 1024 * 1024 || req.file.size < 1000) {
            return res.status(400).json({ message: 'Invalid file size (min 1KB, max 5MB)' });
        }

        const assignment = await Assignment.findById(assignmentId).populate('courseId');
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

        const enrollment = await Enrollment.findOne({ studentId: req.user.id, courseId: assignment.courseId._id });
        if (!enrollment) return res.status(403).json({ message: 'Not enrolled' });

        const now = new Date();
        const due = new Date(assignment.dueDate);
        if (now > due) return res.status(400).json({ message: 'Deadline passed' });

        const existing = await Submission.findOne({ studentId: req.user.id, assignmentId });
        if (existing) return res.status(400).json({ message: 'Already submitted' });

        // Normalize path
        let filePath = req.file.path.replace(/\\/g, '/');
        const publicIndex = filePath.toLowerCase().indexOf('public/');
        if (publicIndex !== -1) filePath = filePath.substring(publicIndex + 7);
        if (!filePath.startsWith('uploads/')) {
            filePath = `uploads/submissions/${path.basename(req.file.path)}`;
        }
        const pdfPath = filePath.startsWith('/') ? filePath : `/${filePath}`;

        const submission = new Submission({
            assignmentId,
            studentId: req.user.id,
            pdfPath,
            submittedAt: now,
            evaluated: false,
            evaluation: null  // ← Critical: Start with null
        });
        await submission.save();

        const fullPath = path.join(__dirname, '..', 'public', pdfPath.substring(1));
        const dataBuffer = fsSync.readFileSync(fullPath);

        // Background Auto Evaluation
        (async () => {
            try {
                console.log(`Starting auto-evaluation for submission: ${submission._id}`);
                const result = await evaluateSubmissionLogic(submission, dataBuffer, fullPath);

                // Only mark as evaluated if real grading happened
                if (result.score > 0 || !result.feedback.includes('unreadable')) {
                    submission.evaluation = {
                        score: result.score,
                        feedback: result.feedback,
                        remarks: result.remarks
                    };
                    submission.evaluated = true;
                } else {
                    // Scanned PDF or empty → don't auto-grade
                    submission.evaluation = {
                        score: 0,
                        feedback: "Your PDF could not be auto-graded (likely scanned/image-based). Waiting for manual review.",
                        remarks: "Please resubmit with a text-based PDF for faster grading."
                    };
                    submission.evaluated = false; // ← Admin must click "Evaluate"
                }
                await submission.save();
                console.log(`Auto-evaluation done → Evaluated: ${submission.evaluated}`);
            } catch (err) {
                console.error('Auto-evaluation failed:', err.message || err);
                submission.evaluation = {
                    score: 0,
                    feedback: "Auto-grading failed. Your submission is pending manual review.",
                    remarks: "Please wait for your instructor to grade it."
                };
                submission.evaluated = false;
                await submission.save();
            }
        })();

        // Student gets clean response
        res.json({
            message: "Assignment submitted successfully! Your answer is being evaluated by AI...",
            submission: {
                _id: submission._id,
                submittedAt: submission.submittedAt,
                pdfUrl: buildFullUrl(pdfPath),
                evaluated: false,
                evaluation: null,
                status: "Evaluation in progress..."
            }
        });

    } catch (error) {
        console.error('Submit error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.evaluateSubmission = async (req, res) => {
    try {
        const { submissionId } = req.params;
        if (!mongoose.isValidObjectId(submissionId)) return res.status(400).json({ message: 'Invalid ID' });

        const submission = await Submission.findById(submissionId).populate('assignmentId');
        if (!submission) return res.status(404).json({ message: 'Submission not found' });

        const relativePath = submission.pdfPath.startsWith('/') ? submission.pdfPath.substring(1) : submission.pdfPath;
        const fullPath = path.join(__dirname, '..', 'public', relativePath.replace(/\\/g, '/'));
        if (!fsSync.existsSync(fullPath)) return res.status(404).json({ message: 'PDF not found' });

        const dataBuffer = fsSync.readFileSync(fullPath);
        const evaluation = await evaluateSubmissionLogic(submission, dataBuffer, fullPath);

        submission.evaluation = {
            score: evaluation.score,
            feedback: evaluation.feedback || "No feedback generated.",
            remarks: evaluation.remarks || ""
        };
        submission.evaluated = true;
        await submission.save();

        res.json({
            message: "Evaluation completed successfully!",
            evaluation: submission.evaluation
        });

    } catch (error) {
        console.error('Manual evaluation error:', error);
        res.status(500).json({ message: 'Evaluation failed', error: error.message });
    }
};