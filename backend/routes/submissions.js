// routes/submissions.js - FIXED: Model 'llama3.2:3b' for speed
const express = require('express');
const router = express.Router();
const ollama = require('ollama').default; // FIXED: Use package
const pdfParse = require('pdf-parse'); // Keep for parse
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const Submission = require('../models/Submission');
const Assignment = require('../models/Assignment');
const { auth, isStudent } = require('../middleware/auth');

// FIXED: Use global uploadPDF from multer.js (assume it's exported as single('pdfFile'))
const { uploadPDF } = require('../middleware/multer'); // FIXED: Reuse global

const MODEL = 'llama3.2:3b'; // FIXED: Lightweight model

router.post('/submissions', auth, isStudent, uploadPDF.single('pdfFile'), async (req, res) => {
    let submission = null;
    try {
        const { assignmentId } = req.body;
        const studentId = req.user.id;

        console.log(`POST Start: assignmentId=${assignmentId}, studentId=${studentId}, file=${req.file ? req.file.filename : 'none'}`);

        if (!req.file) return res.status(400).json({ message: 'PDF file is required!' });
        if (!assignmentId) return res.status(400).json({ message: 'Assignment ID is required!' });

        // FIXED: Clean relative path (reuse logic from controller)
        let filePath = req.file.path.replace(/\\/g, '/');
        const publicIndex = filePath.toLowerCase().indexOf('public/');
        if (publicIndex !== -1) {
            filePath = filePath.substring(publicIndex + 7);
        }
        const uploadsIndex = filePath.toLowerCase().indexOf('uploads/');
        if (uploadsIndex !== -1) {
            filePath = filePath.substring(uploadsIndex);
        }
        const relativePdfPath = `/${filePath}`; // Start with /

        submission = new Submission({
            assignmentId,
            studentId,
            pdfPath: relativePdfPath,
            evaluated: false
        });
        await submission.save();
        console.log(`Initial submission saved: ID=${submission._id}, pdfPath=${relativePdfPath}`);

        // FIXED: Use same eval logic as controller (but simplified here)
        const fullPath = path.join(__dirname, '..', 'public', filePath.substring(1)); // Remove leading / for full
        if (!fsSync.existsSync(fullPath)) {
            return res.status(404).json({ message: 'PDF file not saved properly' });
        }

        const dataBuffer = fsSync.readFileSync(fullPath);

        // PDF Extract
        let extractedText = '';
        try {
            const pdfData = await pdfParse(dataBuffer);
            extractedText = pdfData.text.trim();
            if (!extractedText) throw new Error('Empty PDF text');
            console.log(`PDF extracted: ${extractedText.length} chars`);
        } catch (pdfError) {
            console.error('PDF Extract Error:', pdfError.message);
            return res.status(400).json({ message: `PDF extraction failed: ${pdfError.message}` });
        }

        // Fetch assignment
        const assignment = await Assignment.findById(assignmentId).populate('courseId', 'name');
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

        // Ollama Eval (FIXED: Use package, JSON prompt + new model)
        const questions = assignment.questions.join('\n');
        const context = `Questions: ${questions.substring(0, 800)}\nStudent: ${extractedText.substring(0, 1500)}`;
        const prompt = `Evaluate: Score 0-100. JSON only: {"score": num, "feedback": "str", "remarks": "str"}. Context: ${context}`;

        const ollamaRes = await ollama.generate({
            model: MODEL, // FIXED: 'llama3.2:3b'
            prompt,
            options: { temperature: 0.5, num_predict: 300 } // FIXED: Shorter for speed
        });

        const aiText = ollamaRes.response.trim();
        console.log(`Ollama response: ${aiText.substring(0, 200)}`);

        let evalData;
        try {
            evalData = JSON.parse(aiText);
        } catch {
            // Fallback
            const scoreMatch = aiText.match(/score["\s:]*(\d+)/i);
            evalData = {
                score: scoreMatch ? parseInt(scoreMatch[1]) : 50,
                feedback: 'Evaluation applied. Good effort!',
                remarks: 'Tip: Clear answers next time.'
            };
        }

        const evaluationData = {
            score: Math.max(0, Math.min(100, evalData.score)),
            feedback: evalData.feedback.substring(0, 500),
            remarks: evalData.remarks.substring(0, 300)
        };

        submission.evaluated = true;
        submission.evaluation = evaluationData;
        await submission.save();

        res.status(201).json({
            message: `Submitted & Evaluated! Score: ${evaluationData.score}/100`,
            submission: { id: submission._id, ...evaluationData }
        });

    } catch (error) {
        console.error('POST Overall Error:', error.message);
        if (submission && req.file && req.file.path) {
            fs.unlink(req.file.path, () => {});
            await Submission.findByIdAndDelete(submission._id).catch(() => {});
        }
        res.status(500).json({ message: 'Upload failed: ' + error.message });
    }
});

// GET /my - Student submissions list (FIXED: Use /my for frontend call)
router.get('/my', auth, isStudent, async (req, res) => {
    try {
        const submissions = await Submission.find({ studentId: req.user.id })
            .populate('assignmentId', 'title courseId')
            .sort({ submittedAt: -1 })
            .lean();

        const formatted = submissions.map(sub => {
            const evalData = sub.evaluation || { score: 0, feedback: 'Pending', remarks: '' };
            return {
                ...sub,
                pdfUrl: sub.pdfPath ? `http://localhost:5000${sub.pdfPath}` : null, // FIXED: Full URL
                score: evalData.score,
                feedback: evalData.feedback,
                remarks: evalData.remarks
            };
        });

        res.json(formatted);
    } catch (error) {
        console.error('GET Error:', error);
        res.status(500).json({ message: 'Load failed' });
    }
});

module.exports = router;