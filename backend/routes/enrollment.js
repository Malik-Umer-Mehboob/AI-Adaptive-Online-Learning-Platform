const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");  // ← Destructure karo, object se auth function nikalo
const { enrollInCourse } = require("../controllers/enrollmentController");

router.post("/enroll", auth, enrollInCourse);

module.exports = router;