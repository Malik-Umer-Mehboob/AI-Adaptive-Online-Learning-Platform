// models/Topic.js - No changes needed, already good with resources type including 'url'.
const mongoose = require('mongoose');

const topicSchema = new mongoose.Schema({
  name: { type: String, required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  description: { type: String, default: '' },
  order: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  resources: [{
    type: { type: String, enum: ['pdf', 'url', 'quiz', 'assignment'] }, // Added 'url' for external
    url: { type: String, required: true },
    name: { type: String }
  }],
  videos: [{
    topic: { type: String, required: true },
    url: { type: String },
    isFile: { type: Boolean, default: false },
    duration: { type: String },
    order: { type: Number, default: 0 }
  }]
}, { timestamps: true });

// Indexes for performance
topicSchema.index({ courseId: 1, order: 1 });
topicSchema.index({ courseId: 1, status: 1 });

// Cascade: Remove from course topics on delete
topicSchema.pre('remove', async function(next) {
  const Course = mongoose.model('Course');
  const course = await Course.findById(this.courseId);
  if (course) {
    course.topics = course.topics.filter(t => t.toString() !== this._id.toString());
    await course.save();
  }
  next();
});

module.exports = mongoose.model('Topic', topicSchema);