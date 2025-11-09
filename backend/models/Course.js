const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  subject: { type: String, required: true },
  comment: { type: String, required: true },
  rating: { type: Number, min: 1, max: 5 }, // Added rating field
  createdAt: { type: Date, default: Date.now }
});

const feedbackSchema = new mongoose.Schema({
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String },
  isCourse: { type: Boolean, default: false },
  videoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course.videos' },
  createdAt: { type: Date, default: Date.now }
});

const courseSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },

    videos: [{
        topic: { type: String, required: true },
        url: { type: String }, // YouTube URL یا فائل کا path
        type: { type: String, enum: ['single', 'playlist'], default: 'single' }, // New: For playlist detection
        isFile: { type: Boolean, default: false },
        path: { type: String } // فائل کا اصل path (اگر اپ لوڈ کی گئی ہو)
    }],
    comments: [commentSchema], // Embedded comments array
    feedbacks: [feedbackSchema], // Embedded feedbacks array
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Course', courseSchema);