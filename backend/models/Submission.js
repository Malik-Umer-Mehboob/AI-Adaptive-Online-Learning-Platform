// models/Submission.js (Updated: No changes needed, but confirming field names for reference)
const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true }, // Assume Student model
    pdfPath: { type: String, required: true }, // Relative path to uploaded PDF
    submittedAt: { type: Date, default: Date.now },
    evaluated: { type: Boolean, default: false },
    evaluation: {
        score: { type: Number, min: 0, max: 100 }, // Out of 100, with validation
        feedback: { type: String },
        remarks: { type: String }
    }
}, { timestamps: true });

// Index for queries
submissionSchema.index({ assignmentId: 1, studentId: 1 });
submissionSchema.index({ evaluated: 1 });
submissionSchema.index({ submittedAt: -1 });  // New index for sorting by submission date

module.exports = mongoose.model('Submission', submissionSchema);