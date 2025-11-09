// models/Enrollment.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const enrollmentSchema = new Schema({
    studentId: {
        type: Schema.Types.ObjectId,
        ref: 'Student',  // Ref to Student model
        required: true
    },
    courseId: {
        type: Schema.Types.ObjectId,
        ref: 'Course',
        required: true
    },
    status: {
        type: String,
        enum: ['enrolled', 'active', 'completed'],  // <-- FIX: Added 'enrolled' to enum
        default: 'enrolled'  // <-- Default to 'enrolled' for new enrollments
    },
    progress: {  // <-- FIX: Added missing progress field
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    enrolledAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// <-- FIX: Add unique index to prevent duplicate enrollments (student + course)
enrollmentSchema.index({ studentId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model('Enrollment', enrollmentSchema);