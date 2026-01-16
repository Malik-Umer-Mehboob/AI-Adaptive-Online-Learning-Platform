const mongoose = require('mongoose');
const Enrollment = require("../models/Enrollment");
const Course = require("../models/Course");

// DEBUG MODE: Temporary increase limit
const MAX_ENROLL = 100; // Changed from 5 to 100

/**
 * Enroll in a course - FIXED VERSION
 */
exports.enrollInCourse = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { courseId } = req.body;

        console.log(`🔍 [ENROLL DEBUG] User: ${studentId}, Course: ${courseId}`);

        // Check if course exists
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ 
                success: false,
                message: "Course not found" 
            });
        }

        // Check if already enrolled (in any status)
        const already = await Enrollment.findOne({ studentId, courseId });
        if (already) {
            console.log(`⚠️ Already enrolled - Status: ${already.status}`);
            return res.status(400).json({ 
                success: false,
                message: "Already enrolled in this course" 
            });
        }

        // DEBUG: Check current enrollment counts
        const currentEnrollments = await Enrollment.find({ studentId });
        console.log(`📊 Current total enrollments: ${currentEnrollments.length}`);
        
        const activeEnrollments = currentEnrollments.filter(e => 
            e.status === 'enrolled' || e.status === 'in-progress'
        );
        
        console.log(`📊 Active enrollments: ${activeEnrollments.length}`);
        
        currentEnrollments.forEach((enroll, index) => {
            console.log(`  ${index+1}. Course: ${enroll.courseId}, Status: ${enroll.status}, Progress: ${enroll.progress}%`);
        });

        // Check only ACTIVE courses (enrolled/in-progress)
        // But first, let's see what's being counted
        const dbActiveCount = await Enrollment.countDocuments({
            studentId,
            status: { $in: ["enrolled", "in-progress"] }
        });

        console.log(`📊 DB Active count: ${dbActiveCount}`);
        console.log(`📊 MAX_ENROLL limit: ${MAX_ENROLL}`);

        // TEMPORARY: Remove limit check for debugging
        if (dbActiveCount >= MAX_ENROLL) {
            return res.status(400).json({
                success: false,
                message: `You can have a maximum of ${MAX_ENROLL} active (enrolled or in-progress) courses at a time. Complete some to enroll in new ones.`,
                debug: {
                    activeCount: dbActiveCount,
                    limit: MAX_ENROLL,
                    totalEnrollments: currentEnrollments.length
                }
            });
        }

        // Create new enrollment
        const enroll = new Enrollment({
            studentId,
            courseId,
            status: "enrolled",
            totalVideos: course.videos ? course.videos.length : 0
        });

        await enroll.save();

        console.log(`✅ Enrollment successful: ${enroll._id}`);

        return res.status(201).json({
            success: true,
            message: "Enrolled successfully",
            data: enroll
        });

    } catch (err) {
        console.error("❌ Enrollment error:", err);
        
        // Handle duplicate key error
        if (err.code === 11000) {
            return res.status(400).json({ 
                success: false,
                message: "Already enrolled in this course" 
            });
        }
        
        return res.status(500).json({ 
            success: false,
            message: "Server error", 
            error: err.message 
        });
    }
};

/**
 * Debug endpoint - Get enrollment statistics
 */
exports.getEnrollmentStats = async (req, res) => {
    try {
        const studentId = req.user.id;
        
        console.log(`📊 Getting stats for user: ${studentId}`);
        
        // All enrollments with course details
        const allEnrollments = await Enrollment.find({ studentId })
            .populate({
                path: 'courseId',
                select: 'name description'
            })
            .lean();
        
        console.log(`📊 Found ${allEnrollments.length} total enrollments`);
        
        // Count by status
        const statusCounts = {
            enrolled: 0,
            "in-progress": 0,
            completed: 0,
            total: allEnrollments.length
        };
        
        // Calculate counts
        allEnrollments.forEach(enroll => {
            if (enroll.status && statusCounts[enroll.status] !== undefined) {
                statusCounts[enroll.status]++;
            }
        });
        
        // Active courses count (enrolled + in-progress)
        const activeCount = statusCounts.enrolled + statusCounts["in-progress"];
        
        res.json({
            success: true,
            studentId,
            counts: statusCounts,
            activeCount: activeCount,
            limit: MAX_ENROLL,
            canEnrollMore: activeCount < MAX_ENROLL,
            enrollments: allEnrollments.map(e => ({
                _id: e._id,
                courseName: e.courseId?.name || 'Unknown',
                courseId: e.courseId?._id || e.courseId,
                status: e.status,
                progress: e.progress,
                videosCompleted: e.videosCompleted,
                totalVideos: e.totalVideos,
                enrolledAt: e.enrolledAt
            })),
            message: `You have ${activeCount} active courses (${statusCounts.enrolled} enrolled + ${statusCounts["in-progress"]} in-progress) out of ${MAX_ENROLL} limit.`
        });
        
    } catch (err) {
        console.error("❌ Stats error:", err);
        res.status(500).json({ 
            success: false,
            message: "Server error", 
            error: err.message 
        });
    }
};

/**
 * Get enrolled courses for dashboard
 */
exports.getEnrolledCourses = async (req, res) => {
    try {
        const studentId = req.user.id;
        
        // Get all enrollments with course details
        const enrollments = await Enrollment.find({ studentId })
            .populate({
                path: 'courseId',
                select: 'name description category videos thumbnail duration',
                populate: {
                    path: 'category',
                    select: 'name'
                }
            })
            .sort({ enrolledAt: -1 });
        
        // Format response
        const courses = enrollments.map(enrollment => {
            const course = enrollment.courseId;
            
            return {
                _id: course._id,
                name: course.name,
                description: course.description,
                category: course.category,
                thumbnail: course.thumbnail || 'assets/img/course/course-placeholder.jpg',
                videoCount: course.videos ? course.videos.length : 0,
                duration: course.duration || 'Self-paced',
                enrollmentId: enrollment._id,
                enrollmentStatus: enrollment.status,
                progress: enrollment.progress,
                videosCompleted: enrollment.videosCompleted,
                totalVideos: enrollment.totalVideos,
                enrolledAt: enrollment.enrolledAt
            };
        });
        
        res.json({
            success: true,
            count: courses.length,
            courses: courses
        });
        
    } catch (err) {
        console.error("❌ Get enrolled courses error:", err);
        res.status(500).json({ 
            success: false,
            message: "Server error", 
            error: err.message 
        });
    }
};

/**
 * TEMPORARY: Force enroll without checking limit (Admin/Testing only)
 */
exports.forceEnroll = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { courseId } = req.body;

        // Check if course exists
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ 
                success: false,
                message: "Course not found" 
            });
        }

        // Check if already enrolled
        const already = await Enrollment.findOne({ studentId, courseId });
        if (already) {
            return res.status(400).json({ 
                success: false,
                message: "Already enrolled in this course" 
            });
        }

        // Force enroll without checking limit
        const enroll = new Enrollment({
            studentId,
            courseId,
            status: "enrolled",
            totalVideos: course.videos ? course.videos.length : 0
        });

        await enroll.save();

        console.log(`✅ FORCE Enrollment successful: ${enroll._id}`);

        return res.status(201).json({
            success: true,
            message: "Force enrolled successfully (limit bypassed)",
            data: enroll
        });

    } catch (err) {
        console.error("❌ Force enroll error:", err);
        return res.status(500).json({ 
            success: false,
            message: "Server error", 
            error: err.message 
        });
    }
};