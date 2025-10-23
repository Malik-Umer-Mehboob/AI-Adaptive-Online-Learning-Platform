const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  description: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Pre-hook for cascade deletion: Category delete hone par related courses delete
categorySchema.pre('deleteOne', { document: true, query: false }, async function (next) {
  try {
    await mongoose.model('Course').deleteMany({ category: this._id });
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('Category', categorySchema);