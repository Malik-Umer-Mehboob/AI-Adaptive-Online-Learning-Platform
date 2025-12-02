// controllers/dashboardController.js - FIXED: Use Enrollment (single 'l'), complete functions
const Enrollment = require('../models/Enrollment'); // FIXED: Single 'l'
const Course = require('../models/Course');

// ... (Other dashboard functions like getEnrollments, etc. - same)

exports.enrollInCourse = async (req, res) => {
    try {
        const { courseId } = req.body;
        if (!courseId) {
            return res.status(400).json({ message: 'Course ID required' });
        }

        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        // Check if already enrolled (unique index will throw error, but explicit check better)
        const existingEnrollment = await Enrollment.findOne({ 
            studentId: req.user.id, 
            courseId 
        });
        if (existingEnrollment) {
            return res.status(400).json({ message: 'Already enrolled in this course' });
        }

        // Create new enrollment
        const enrollment = new Enrollment({
            studentId: req.user.id,
            courseId,
            status: 'enrolled',  // Matches model default
            progress: 0  // Starts at 0
        });
        await enrollment.save();

        // Optional: Add student to course's enrolledStudents array if exists
        if (course.enrolledStudents) {
            if (!course.enrolledStudents.includes(req.user.id)) {
                course.enrolledStudents.push(req.user.id);
                await course.save();
            }
        }

        res.status(201).json({ 
            message: 'Enrolled successfully!', 
            enrollment 
        });
    } catch (error) {
        console.error('Enroll error:', error);
        // Handle unique index error specifically
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Already enrolled in this course' });
        }
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Optional: Update progress (call from video complete or quiz)
exports.updateProgress = async (req, res) => {
    try {
        const { enrollmentId, progress } = req.body;
        if (!enrollmentId || progress === undefined) {
            return res.status(400).json({ message: 'Enrollment ID and progress required' });
        }

        const enrollment = await Enrollment.findOne({ 
            _id: enrollmentId, 
            studentId: req.user.id 
        });
        if (!enrollment) {
            return res.status(404).json({ message: 'Enrollment not found' });
        }

        enrollment.progress = Math.min(Math.max(progress, 0), 100);  // Clamp 0-100
        await enrollment.save();

        res.json({ message: 'Progress updated', enrollment });
    } catch (error) {
        console.error('Update progress error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Get student's enrollments (already there, but confirm)
exports.getStudentEnrollments = async (req, res) => {
    try {
        const enrollments = await Enrollment.find({ studentId: req.user.id })
            .populate('courseId', 'name description price')
            .sort({ enrolledAt: -1 });
        res.json(enrollments);
    } catch (error) {
        console.error('Get enrollments error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};