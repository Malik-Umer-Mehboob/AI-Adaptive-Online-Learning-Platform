// models/Submission.js - Complete with plagiarism detection fields
const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
    assignmentId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Assignment', 
        required: true 
    },
    studentId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Student', 
        required: true 
    },
    pdfPath: { 
        type: String, 
        required: true 
    },
    submittedAt: { 
        type: Date, 
        default: Date.now 
    },
    evaluated: { 
        type: Boolean, 
        default: false 
    },
    evaluation: {
        score: { 
            type: Number, 
            min: 0, 
            max: 100 
        },
        feedback: { 
            type: String 
        },
        remarks: { 
            type: String 
        },
        strengths: [{ 
            type: String 
        }],
        weaknesses: [{ 
            type: String 
        }],
        plagiarism: {
            plagiarismScore: { type: Number },
            isSuspicious: { type: Boolean },
            aiGenerated: { type: Boolean },
            confidence: { type: Number },
            similarityFound: { type: Boolean },
            similarText: { type: String }
        },
        extractedText: { type: String },
        evaluatedAt: { type: Date }
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    },
    updatedAt: { 
        type: Date, 
        default: Date.now 
    }
});

// Indexes for performance
submissionSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });
submissionSchema.index({ assignmentId: 1 });
submissionSchema.index({ studentId: 1 });
submissionSchema.index({ evaluated: 1 });
submissionSchema.index({ submittedAt: -1 });
submissionSchema.index({ 'evaluation.score': 1 });

// Update timestamp on save
submissionSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    if (this.evaluation && !this.evaluation.evaluatedAt) {
        this.evaluation.evaluatedAt = new Date();
    }
    next();
});

module.exports = mongoose.model('Submission', submissionSchema);