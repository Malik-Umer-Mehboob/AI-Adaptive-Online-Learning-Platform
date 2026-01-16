const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
    assignmentId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Assignment', 
        required: true 
    },
    studentId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: true 
    },
    pdfPath: { 
        type: String,
        default: null
    },
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
        evaluatedAt: {
            type: Date,
            default: null
        },
        aiGenerated: {
            type: Boolean,
            default: false
        }
    }
}, {
    timestamps: true
});

// Indexes
submissionSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });
submissionSchema.index({ assignmentId: 1 });
submissionSchema.index({ studentId: 1 });
submissionSchema.index({ evaluated: 1 });

module.exports = mongoose.model('Submission', submissionSchema);