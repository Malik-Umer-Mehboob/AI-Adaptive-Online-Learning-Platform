const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const { 
    enrollInCourse, 
    getEnrollmentStats,  // Added for debugging
    getEnrolledCourses 
} = require("../controllers/enrollmentController");

// Enrollment routes
router.post("/enroll", auth, enrollInCourse);
router.get("/stats", auth, getEnrollmentStats); // Debug route
router.get("/my-courses", auth, getEnrolledCourses);

module.exports = router;