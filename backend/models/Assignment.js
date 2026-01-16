const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema({
    courseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    questions: [{
        questionText: {
            type: String,
            required: true
        },
        expectedPoints: [{
            type: String
        }],
        marks: {
            type: Number,
            default: 10
        },
        difficulty: {
            type: String,
            enum: ['easy', 'medium', 'hard'],
            default: 'medium'
        }
    }],
    dueDate: {
        type: Date,
        required: true
    },
    numQuestions: {
        type: Number,
        default: 5,
        min: 1,
        max: 5 // ✅ MAX 5 QUESTIONS ONLY
    },
    generatedByAI: {
        type: Boolean,
        default: false
    },
   // models/Assignment.js
generationMethod: {
    type: String,
    enum: ['notes', 'custom-prompt', 'auto-course-creation'], // ✅ YEH LINE UPDATE KAREN
    default: 'custom-prompt'
},
    promptUsed: {
        type: String,
        default: ''
    },
    assignmentPdfPath: {
        type: String,
        default: ''
    },
    pdfUrl: {
        type: String,
        default: ''
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
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

// Update timestamp on save
assignmentSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Virtual for PDF view URL
assignmentSchema.virtual('viewPdfUrl').get(function() {
    return `http://localhost:5000/api/assignments/${this._id}/pdf`;
});

// Virtual for PDF download URL
assignmentSchema.virtual('downloadPdfUrl').get(function() {
    return `http://localhost:5000/api/assignments/${this._id}/pdf?download=true`;
});

module.exports = mongoose.models.Assignment || mongoose.model('Assignment', assignmentSchema);