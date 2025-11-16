const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true }, // Assume Student model
    pdfPath: { type: String, required: true }, // Relative path to uploaded PDF
    submittedAt: { type: Date, default: Date.now },
    evaluated: { type: Boolean, default: false },
    evaluation: {
        score: { type: Number }, // Out of 100
        feedback: { type: String },
        remarks: { type: String }
    }
}, { timestamps: true });

// Index for queries
submissionSchema.index({ assignmentId: 1, studentId: 1 });
submissionSchema.index({ evaluated: 1 });

module.exports = mongoose.model('Submission', submissionSchema);