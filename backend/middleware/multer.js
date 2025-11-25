// middleware/multer.js - Clean version: Only multer config, no controller exports
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure directories exist (absolute paths from project root)
const projectRoot = path.resolve(__dirname, '..'); // backend root
const videoDir = path.join(projectRoot, 'public', 'uploads', 'videos');
const submissionDir = path.join(projectRoot, 'public', 'uploads', 'submissions');

if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
if (!fs.existsSync(submissionDir)) fs.mkdirSync(submissionDir, { recursive: true });

// Existing: For video uploads
const videoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, videoDir); // Absolute path
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const uploadVideo = multer({
  storage: videoStorage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!'), false);
    }
  },
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// Updated: For PDF submissions (absolute destination, better filename)
const pdfStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, submissionDir); // Absolute path
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname)); // No user.id to avoid issues if missing
  }
});

const uploadPDF = multer({
  storage: pdfStorage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit for PDFs
});

module.exports = { uploadVideo, uploadPDF };