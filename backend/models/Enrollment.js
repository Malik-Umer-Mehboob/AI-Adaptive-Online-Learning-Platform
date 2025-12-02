    // models/Enrollment.js - FIXED: Standard spelling (single 'l'), complete schema
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

    // Index for faster queries
    enrollmentSchema.index({ studentId: 1, courseId: 1 }, { unique: true });
    enrollmentSchema.index({ status: 1 });
    enrollmentSchema.index({ progress: 1 });

    module.exports = mongoose.model('Enrollment', enrollmentSchema);