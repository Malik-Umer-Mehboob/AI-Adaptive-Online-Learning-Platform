const OpenAI = require("openai");
const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");

class OpenAIService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
        console.log('✅ OpenAIService initialized');
    }

    /* =====================================================
       📄 FILE EXTRACTION FUNCTIONS - ALL FIXED
    ===================================================== */
    
    // ✅ Extract text from any file (PDF/TXT)
    async extractTextFromFile(filePath) {
        try {
            console.log('📄 Extracting text from file:', filePath);
            
            if (!fs.existsSync(filePath)) {
                console.log('❌ File not found:', filePath);
                return "";
            }

            const ext = path.extname(filePath).toLowerCase();
            
            if (ext === '.pdf') {
                return await this.extractTextFromPDFFile(filePath);
            } else if (ext === '.txt') {
                const text = fs.readFileSync(filePath, 'utf-8');
                console.log('✅ TXT extracted, length:', text.length);
                return text;
            } else {
                console.log('❌ Unsupported file type:', ext);
                return "";
            }
        } catch (error) {
            console.error("❌ File extract error:", error);
            return "";
        }
    }

    // ✅ Extract text from PDF
    async extractTextFromPDFFile(filePath) {
        try {
            console.log('📄 Extracting text from PDF:', filePath);
            
            if (!fs.existsSync(filePath)) {
                console.log('❌ PDF file not found:', filePath);
                return "";
            }

            const buffer = fs.readFileSync(filePath);
            const data = await pdfParse(buffer);
            
            const text = data.text || "";
            console.log('✅ PDF text extracted, length:', text.length);
            console.log('📝 First 200 chars:', text.substring(0, 200));
            
            return text;
        } catch (error) {
            console.error('❌ PDF extract error:', error);
            return "";
        }
    }

    /* =====================================================
       📝 5 DESCRIPTIVE QUESTIONS GENERATION (FROM NOTES)
    ===================================================== */
    async generateAssignmentFromText(textContext, numQuestions = 5) {
        try {
            console.log('🤖 Generating assignment from text, length:', textContext.length);
            
            const prompt = `
You are an expert university professor. Generate exactly ${numQuestions} descriptive questions based on the following notes:

NOTES:
"${textContext.substring(0, 8000)}" ...[truncated]

Requirements:
1. Generate EXACTLY ${numQuestions} descriptive questions
2. Each question must test deep understanding of the notes
3. Questions should cover different aspects of the content
4. Each question worth 10 marks
5. Include expected answer points for evaluation

Return STRICT JSON format ONLY:
{
  "questions": [
    {
      "id": 1,
      "questionText": "Clear descriptive question here?",
      "expectedPoints": ["Point 1", "Point 2", "Point 3", "Point 4"],
      "marks": 10,
      "difficulty": "medium"
    }
  ]
}

Important: Only generate descriptive questions. No MCQs.`;

            const res = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo-16k",
                messages: [
                    { 
                        role: "system", 
                        content: "You are a university professor creating descriptive exam questions from course notes. Be precise and thorough." 
                    },
                    { role: "user", content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 4000,
            });

            const content = res.choices[0].message.content;
            console.log('🤖 OpenAI response received, length:', content.length);
            
            const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
            
            try {
                const parsed = JSON.parse(cleanContent);
                
                // Ensure exactly 'numQuestions' questions
                const finalQuestions = parsed.questions.slice(0, numQuestions);
                
                console.log(`✅ Generated ${finalQuestions.length} questions`);
                
                return {
                    success: true,
                    questions: finalQuestions,
                    count: finalQuestions.length
                };

            } catch (parseError) {
                console.error("❌ JSON parse error:", parseError);
                console.log("Raw content:", content.substring(0, 500));
                return {
                    success: false,
                    error: "Failed to parse generated questions"
                };
            }
        } catch (error) {
            console.error("❌ Assignment generation from text error:", error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /* =====================================================
       📝 5 DESCRIPTIVE QUESTIONS GENERATION (FROM PROMPT)
    ===================================================== */
    async generateAssignmentFromPrompt(customPrompt, numQuestions = 5) {
        try {
            console.log('🤖 Generating assignment from prompt:', customPrompt.substring(0, 100));
            
            const prompt = `
You are an expert university professor. Generate exactly ${numQuestions} descriptive questions based on this topic/instruction:

TOPIC/INSTRUCTION:
"${customPrompt}"

Requirements:
1. Generate EXACTLY ${numQuestions} descriptive questions
2. Each question must be comprehensive and test understanding
3. Include expected answer points for evaluation
4. Each question worth 10 marks (total 50 marks)

Return STRICT JSON format ONLY:
{
  "questions": [
    {
      "id": 1,
      "questionText": "Clear descriptive question here?",
      "expectedPoints": ["Point 1", "Point 2", "Point 3", "Point 4"],
      "marks": 10,
      "difficulty": "medium"
    }
  ]
}`;

            const res = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo-16k",
                messages: [
                    { 
                        role: "system", 
                        content: "You are a university professor creating descriptive exam questions. Be precise and thorough." 
                    },
                    { role: "user", content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 4000,
            });

            const content = res.choices[0].message.content;
            console.log('🤖 OpenAI response received, length:', content.length);
            
            const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
            
            try {
                const parsed = JSON.parse(cleanContent);
                
                // Ensure exactly 'numQuestions' questions
                const finalQuestions = parsed.questions.slice(0, numQuestions);
                
                console.log(`✅ Generated ${finalQuestions.length} questions`);
                
                return {
                    success: true,
                    questions: finalQuestions,
                    count: finalQuestions.length
                };

            } catch (parseError) {
                console.error("❌ JSON parse error:", parseError);
                return {
                    success: false,
                    error: "Failed to parse generated questions"
                };
            }
        } catch (error) {
            console.error("❌ Assignment generation from prompt error:", error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /* =====================================================
       📊 ANSWER EVALUATION FOR DESCRIPTIVE QUESTIONS - FIXED
    ===================================================== */
    async evaluateDescriptiveAnswers(questions, studentText) {
        try {
            console.log('📊 Evaluating descriptive answers');
            console.log('📝 Questions count:', questions.length);
            console.log('📝 Student text length:', studentText.length);
            
            // Format questions for prompt
            const questionsText = questions.map((q, index) => 
                `Question ${index + 1} (${q.marks || 10} marks): ${q.questionText}
Expected Points: ${(q.expectedPoints && q.expectedPoints.join(', ')) || "Complete answer expected"}`
            ).join('\n\n');

            const prompt = `
EVALUATE STUDENT ANSWERS FOR DESCRIPTIVE QUESTIONS:

QUESTIONS:
${questionsText}

STUDENT'S ANSWER:
"${studentText.substring(0, 6000)}" ${studentText.length > 6000 ? '...[truncated]' : ''}

Evaluation Instructions:
1. For EACH question, find if the student answered it
2. Evaluate quality based on expected points
3. Give score out of 10 for each question
4. Provide specific feedback for each question
5. Calculate total score (out of ${questions.length * 10})

Return STRICT JSON format:
{
  "totalScore": 0-${questions.length * 10},
  "percentage": 0-100,
  "questionWiseEvaluation": [
    {
      "questionId": 1,
      "questionText": "Question text",
      "studentAnswer": "Extracted answer text",
      "score": 0-10,
      "maxScore": 10,
      "feedback": "Detailed feedback",
      "coveredPoints": ["point1", "point2"],
      "missingPoints": ["point3", "point4"],
      "strengths": ["strength1"],
      "improvements": ["improvement1"]
    }
  ],
  "overallFeedback": "Overall performance feedback",
  "strengths": ["Overall strength 1", "Strength 2"],
  "improvements": ["Overall improvement 1", "Improvement 2"]
}

Important: Be fair but strict. Provide constructive feedback.`;

            console.log('🤖 Sending to GPT-4 for evaluation...');
            
            const res = await this.openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                    { 
                        role: "system", 
                        content: "You are a fair but strict university examiner. Evaluate descriptive answers thoroughly and provide constructive feedback. Always return valid JSON." 
                    },
                    { role: "user", content: prompt }
                ],
                temperature: 0.2,
                max_tokens: 4000,
            });

            const content = res.choices[0].message.content;
            console.log('✅ GPT-4 response received');
            
            const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
            
            try {
                const result = JSON.parse(cleanContent);
                console.log('✅ Evaluation parsed successfully');
                console.log('📊 Total score:', result.totalScore);
                console.log('📊 Percentage:', result.percentage);
                
                return result;
            } catch (parseError) {
                console.error("❌ Evaluation JSON parse error:", parseError);
                console.log("Raw response:", content.substring(0, 500));
                return this.fallbackEvaluation(questions, studentText);
            }
        } catch (error) {
            console.error("❌ Answer evaluation error:", error);
            return this.fallbackEvaluation(questions, studentText);
        }
    }

    // Fallback evaluation
    fallbackEvaluation(questions, studentText) {
        console.log('⚠️ Using fallback evaluation');
        
        const questionWiseEvaluation = questions.map((q, index) => {
            // Simple keyword matching
            const lowerAnswer = studentText.toLowerCase();
            const expectedPoints = q.expectedPoints || ["Complete answer expected"];
            const lowerExpected = expectedPoints.map(p => p.toLowerCase());
            
            let covered = 0;
            const coveredPoints = [];
            const missingPoints = [];
            
            lowerExpected.forEach(point => {
                if (lowerAnswer.includes(point.toLowerCase().substring(0, 20))) {
                    covered++;
                    coveredPoints.push(point);
                } else {
                    missingPoints.push(point);
                }
            });
            
            const coverageRatio = covered / Math.max(lowerExpected.length, 1);
            const score = Math.round(coverageRatio * 10);
            
            return {
                questionId: index + 1,
                questionText: q.questionText,
                studentAnswer: "Answer extracted from submission",
                score: score,
                maxScore: 10,
                feedback: `Covered ${covered}/${lowerExpected.length} expected points`,
                coveredPoints: coveredPoints,
                missingPoints: missingPoints,
                strengths: coveredPoints.length > 0 ? ["Good coverage of key points"] : ["Attempted the question"],
                improvements: missingPoints.length > 0 ? ["Add more details"] : ["Good answer"]
            };
        });
        
        const totalScore = questionWiseEvaluation.reduce((sum, q) => sum + q.score, 0);
        const percentage = Math.round((totalScore / (questions.length * 10)) * 100);
        
        return {
            totalScore: totalScore,
            percentage: percentage,
            questionWiseEvaluation: questionWiseEvaluation,
            overallFeedback: `Scored ${totalScore} out of ${questions.length * 10}. Fallback evaluation used.`,
            strengths: ["Submission completed"],
            improvements: ["Review expected points for better scores"]
        };
    }

    /* =====================================================
       📤 COMPLETE EVALUATION PIPELINE - FIXED RETURN FORMAT
    ===================================================== */
    async evaluateAssignmentSubmission(assignmentQuestions, studentAnswerText) {
        try {
            console.log('🚀 Starting evaluation pipeline');
            console.log('📝 Student answer length:', studentAnswerText.length);
            
            // Parse questions if stored as JSON string
            let questions = [];
            try {
                if (typeof assignmentQuestions === 'string') {
                    questions = JSON.parse(assignmentQuestions);
                } else if (Array.isArray(assignmentQuestions)) {
                    questions = assignmentQuestions;
                } else {
                    console.log('❌ Invalid questions format');
                    questions = [];
                }
            } catch (e) {
                console.log("❌ Could not parse questions:", e.message);
                // Create default questions structure
                if (Array.isArray(assignmentQuestions)) {
                    questions = assignmentQuestions.map((q, i) => ({
                        id: i + 1,
                        questionText: typeof q === 'string' ? q : q.questionText || `Question ${i + 1}`,
                        expectedPoints: q.expectedPoints || ["Complete answer expected"],
                        marks: q.marks || 10
                    }));
                } else {
                    questions = [];
                }
            }

            if (questions.length === 0) {
                console.log('❌ No questions to evaluate');
                return {
                    success: false,
                    error: "No questions found for evaluation",
                    evaluation: {
                        obtainedMarks: 0,
                        totalMarks: 0,
                        percentage: 0,
                        detailedFeedback: "No questions found for evaluation",
                        questionWiseEvaluation: []
                    }
                };
            }

            console.log(`📝 Evaluating ${questions.length} questions`);
            
            // Evaluate answers
            const evaluationResult = await this.evaluateDescriptiveAnswers(questions, studentAnswerText);
            
            // ✅ FIXED RETURN FORMAT - Controller expects evaluation.obtainedMarks
            const response = {
                success: true,
                evaluation: {
                    obtainedMarks: evaluationResult.totalScore || 0,      // ✅ CRITICAL FIX
                    totalMarks: questions.length * 10,
                    percentage: evaluationResult.percentage || 0,
                    detailedFeedback: evaluationResult.overallFeedback || "Evaluation completed",
                    questionWiseEvaluation: evaluationResult.questionWiseEvaluation || [],
                    strengths: evaluationResult.strengths || [],
                    weaknesses: evaluationResult.improvements || [],
                    suggestions: ["Review feedback for each question"]
                }
            };
            
            console.log('✅ Evaluation pipeline complete');
            console.log('📊 Final result:', {
                obtainedMarks: response.evaluation.obtainedMarks,
                totalMarks: response.evaluation.totalMarks,
                percentage: response.evaluation.percentage
            });
            
            return response;
        } catch (error) {
            console.error("❌ Evaluation pipeline error:", error);
            return {
                success: false,
                error: error.message,
                evaluation: {
                    obtainedMarks: 0,
                    totalMarks: 0,
                    percentage: 0,
                    detailedFeedback: "Evaluation failed due to technical error: " + error.message,
                    questionWiseEvaluation: [],
                    strengths: [],
                    weaknesses: ["Technical error occurred"]
                }
            };
        }
    }
}

module.exports = new OpenAIService();