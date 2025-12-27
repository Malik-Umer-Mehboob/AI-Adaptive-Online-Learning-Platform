// models/Submission.js - COMPLETE FIXED VERSION
const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
    assignmentId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Assignment', 
        required: true 
    },
    studentId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', // ✅ Change from 'Student' to 'User'
        required: true 
    },
    // ✅ FIX: Make pdfPath optional (remove required: true)
    pdfPath: { 
        type: String,
        // ❌ REMOVE: required: true
        default: null // ✅ Add default value
    },
    // ✅ ADD: textAnswer field for text submissions
    textAnswer: {
        type: String,
        default: null
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
            max: 100,
            default: null
        },
        feedback: { 
            type: String,
            default: null
        },
        remarks: { 
            type: String,
            default: null
        },
        strengths: [{ 
            type: String 
        }],
        weaknesses: [{ 
            type: String 
        }],
        evaluatedAt: {  // ✅ FIX: Add evaluatedAt field
            type: Date,
            default: null
        },
        aiGenerated: {  // ✅ ADD: Track if AI evaluated
            type: Boolean,
            default: false
        }
    },
    // ✅ FIX: Move these outside evaluation object
    createdAt: { 
        type: Date, 
        default: Date.now 
    },
    updatedAt: { 
        type: Date, 
        default: Date.now 
    }
}, {
    timestamps: true // ✅ Use mongoose timestamps
});

// Indexes for performance
submissionSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });
submissionSchema.index({ assignmentId: 1 });
submissionSchema.index({ studentId: 1 });
submissionSchema.index({ evaluated: 1 });
submissionSchema.index({ submittedAt: -1 });
submissionSchema.index({ 'evaluation.score': 1 });

// ✅ FIXED: Update timestamp on save
submissionSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    
    // Auto-set evaluatedAt when evaluation is added
    if (this.evaluated && this.evaluation && !this.evaluation.evaluatedAt) {
        this.evaluation.evaluatedAt = new Date();
    }
    
    next();
});

// ✅ ADD: Virtual property for PDF URL
submissionSchema.virtual('pdfUrl').get(function() {
    if (this.pdfPath) {
        return `http://localhost:5000${this.pdfPath}`;
    }
    return null;
});

// ✅ ADD: Method to check if submission has content
submissionSchema.methods.hasContent = function() {
    return !!(this.pdfPath || this.textAnswer);
};

// ✅ ADD: Method to get answer text
submissionSchema.methods.getAnswerText = function() {
    if (this.textAnswer) {
        return this.textAnswer;
    }
    // If only PDF, we'll need to extract text (handled elsewhere)
    return '';
};

module.exports = mongoose.model('Submission', submissionSchema);