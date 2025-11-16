const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema({
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    title: { type: String, required: true },
    questions: [{ type: String }], // AI generated or manual questions array
    dueDate: { type: Date, required: true }, // Submission deadline
    generatedByAI: { type: Boolean, default: false },
    promptUsed: { type: String }, // Admin's prompt for AI generation
    type: { type: String, enum: ['mcq', 'descriptive', 'mixed'], default: 'mixed' },
    numQuestions: { type: Number, default: 5 }
}, { timestamps: true });

// Index for queries
assignmentSchema.index({ courseId: 1 });
assignmentSchema.index({ dueDate: 1 });

module.exports = mongoose.model('Assignment', assignmentSchema);