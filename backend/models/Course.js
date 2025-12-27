const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  subject: { type: String, required: true },
  comment: { type: String, required: true },
  rating: { type: Number, min: 1, max: 5 },
  createdAt: { type: Date, default: Date.now }
});

const feedbackSchema = new mongoose.Schema({
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String },
  isCourse: { type: Boolean, default: false },
  videoId: { type: mongoose.Schema.Types.ObjectId, refPath: 'feedbacks.isCourse ? "courses._id" : "courses.videos._id"' },
  createdAt: { type: Date, default: Date.now }
});

const courseSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    topics: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Topic' }], // Reference to topics
    assignments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Assignment' }], // Reference to assignments
    videos: [{
        topic: { type: String, required: true },
        url: { type: String },
        type: { type: String, enum: ['single', 'playlist'], default: 'single' },
        isFile: { type: Boolean, default: false },
        path: { type: String }
    }],
    resources: [{
        type: { type: String, enum: ['pdf', 'url'] },
        url: { type: String, required: true },
        name: { type: String }
    }],
    comments: [commentSchema],
    feedbacks: [feedbackSchema],
    averageRating: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    ragNotes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RAGNote'
    }]
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

// Virtual for populated topics
courseSchema.virtual('populatedTopics', {
  ref: 'Topic',
  localField: 'topics',
  foreignField: '_id'
});

// Ensure virtuals in JSON
courseSchema.set('toJSON', { virtuals: true });
courseSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Course', courseSchema);