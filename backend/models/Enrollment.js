const mongoose = require('mongoose');

const enrollmentSchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    courseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: true
    },

    /** --------------------------
     *  COURSE PROGRESS SYSTEM
     * -------------------------- */

    videosWatched: [{ type: String }],  // video IDs user ne dekh li
    totalVideos: { type: Number, default: 0 },  // course ki total videos
    videosCompleted: { type: Number, default: 0 }, // <-- NEW FIELD ADDED

    status: {
        type: String,
        enum: ['enrolled', 'in-progress', 'completed'],
        default: 'enrolled'
    },
    progress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },

    enrolledAt: {
        type: Date,
        default: Date.now
    },
    completedAt: {
        type: Date
    }
}, { timestamps: true });

// UNIQUE: Student cannot enroll in same course twice
enrollmentSchema.index({ studentId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model("Enrollment", enrollmentSchema);
