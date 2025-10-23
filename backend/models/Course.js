const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  category: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Category', 
    required: true 
  },
  image: { type: String },
  rating: { type: Number, default: 0 },
  reviews: { type: Number, default: 0 },
  videos: [{
    topic: { type: String, required: true },
    path: { type: String }, // For uploaded video files
    url: { type: String }   // For YouTube URLs
  }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Course', courseSchema);