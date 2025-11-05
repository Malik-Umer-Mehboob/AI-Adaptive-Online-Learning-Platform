// models/Enrollment.js - example schema (aapka same hoga, bas ref change karo)
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const enrollmentSchema = new Schema({
    studentId: {
        type: Schema.Types.ObjectId,
        ref: 'Student',  // Ye 'User' se 'Student' kar do
        required: true
    },
    courseId: {
        type: Schema.Types.ObjectId,
        ref: 'Course',
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'completed'],
        default: 'active'
    },
    enrolledAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Enrollment', enrollmentSchema);