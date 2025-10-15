const mongoose = require('mongoose');

// Course Schema
const courseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  image: { type: String },
  instructorName: { type: String, required: true },
  instructorImage: { type: String },
  category: { type: String, required: true },
  price: { type: Number, required: true },
  rating: { type: Number, default: 4.5 },
  reviews: { type: Number, default: 0 },
  discount: { type: Number, default: 0 }
});

// Quiz Schema
const quizSchema = new mongoose.Schema({
  title: { type: String, required: true }
});

// Enrollment Schema
const enrollmentSchema = new mongoose.Schema({
  userId: { type: String, required: true }, // From JWT
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  status: { type: String, enum: ['active', 'completed'], default: 'active' },
  enrolledAt: { type: Date, default: Date.now }
});

// QuizAttempt Schema
const quizAttemptSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
  correct: { type: Number, required: true },
  total: { type: Number, required: true },
  date: { type: Date, default: Date.now }
});

const Course = mongoose.model('Course', courseSchema);
const Quiz = mongoose.model('Quiz', quizSchema);
const Enrollment = mongoose.model('Enrollment', enrollmentSchema);
const QuizAttempt = mongoose.model('QuizAttempt', quizAttemptSchema);

module.exports = { Course, Quiz, Enrollment, QuizAttempt }; 