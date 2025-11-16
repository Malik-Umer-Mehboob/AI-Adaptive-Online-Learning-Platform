// models/Course.js - Added assignments field for linking to Assignment model.
const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  subject: { type: String, required: true },
  comment: { type: String, required: true },
  rating: { type: Number, min: 1, max: 5 }, // Added rating field
  createdAt: { type: Date, default: Date.now }
  // Removed topics from here - it was misplaced
});

const feedbackSchema = new mongoose.Schema({
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String },
  isCourse: { type: Boolean, default: false },
  videoId: { type: mongoose.Schema.Types.ObjectId, refPath: 'feedbacks.isCourse ? "courses._id" : "courses.videos._id"' }, // Flexible ref for course/video
  createdAt: { type: Date, default: Date.now }
});

const courseSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    topics: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Topic' }], // Added: Reference to topics
    assignments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Assignment' }], // New: Reference to assignments
    videos: [{
        topic: { type: String, required: true },
        url: { type: String }, // YouTube URL یا فائل کا path
        type: { type: String, enum: ['single', 'playlist'], default: 'single' }, // New: For playlist detection
        isFile: { type: Boolean, default: false },
        path: { type: String } // فائل کا اصل path (اگر اپ لوڈ کی گئی ہو)
    }], // Keep for backward compatibility, but prefer topics.videos
    resources: [{ // Added for course-level resources
        type: { type: String, enum: ['pdf', 'url'] },
        url: { type: String, required: true },
        name: { type: String }
    }],
    comments: [commentSchema], // Embedded comments array
    feedbacks: [feedbackSchema], // Embedded feedbacks array
    averageRating: { type: Number, default: 0 }, // Computed average from comments
    createdAt: { type: Date, default: Date.now }
});

// Pre-save hook to compute averageRating from comments
courseSchema.pre('save', function(next) {
  if (this.comments && this.comments.length > 0) {
    const ratedComments = this.comments.filter(c => c.rating);
    if (ratedComments.length > 0) {
      this.averageRating = (ratedComments.reduce((sum, c) => sum + c.rating, 0) / ratedComments.length).toFixed(1);
    }
  }
  next();
});

// Virtual for populated topics (optional, for easy access)
courseSchema.virtual('populatedTopics', {
  ref: 'Topic',
  localField: 'topics',
  foreignField: '_id'
});

// Ensure virtuals in JSON
courseSchema.set('toJSON', { virtuals: true });
courseSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Course', courseSchema);