const multer = require('multer');
const path = require('path');

// Existing: For video uploads
const videoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/Uploads/videos/');
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

// New: For PDF submissions (assignments)
const pdfStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/Uploads/submissions/'); // New folder for submissions
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + req.user?.id + path.extname(file.originalname)); // Include user ID for uniqueness
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

module.exports = { uploadVideo, uploadPDF }; // Export both