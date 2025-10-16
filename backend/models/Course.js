const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String },
    instructorName: { type: String, required: true },
    instructorImage: { type: String },
    category: { type: String, required: true },
    price: { type: Number, required: true, default: 0 },
    image: { type: String },
    rating: { type: Number, default: 0 },
    reviews: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Course', courseSchema);