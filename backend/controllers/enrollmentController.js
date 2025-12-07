const Enrollment = require("../models/Enrollment");
const Course = require("../models/Course");

const MAX_ENROLL = 5; // Maximum active (non-completed) courses a student can have

exports.enrollInCourse = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { courseId } = req.body;

        // Check if course exists
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: "Course not found" });
        }

        // Check if already enrolled (in any status)
        const already = await Enrollment.findOne({ studentId, courseId });
        if (already) {
            return res.status(400).json({ message: "Already enrolled in this course" });
        }

        // NEW LIMIT CHECK: Count only non-completed enrollments
        const activeCount = await Enrollment.countDocuments({
            studentId,
            status: { $ne: "completed" }
        });

        if (activeCount >= MAX_ENROLL) {
            return res.status(400).json({
                message: `You can have a maximum of ${MAX_ENROLL} active (enrolled or in-progress) courses at a time. Complete some to enroll in new ones.`
            });
        }

        // Create new enrollment
        const enroll = new Enrollment({
            studentId,
            courseId,
            status: "enrolled"
        });

        await enroll.save();

        return res.status(201).json({
            message: "Enrolled successfully",
            data: enroll
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server error", error: err.message });
    }
};