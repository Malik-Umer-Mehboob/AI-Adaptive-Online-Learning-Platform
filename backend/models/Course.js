const mongoose = require('mongoose');

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
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Course', courseSchema);