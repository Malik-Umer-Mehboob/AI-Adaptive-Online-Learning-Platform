const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'admin', enum: ['admin'] },
    registrationDate: { type: Date, default: Date.now },
    profileImage: { type: String, default: null },
    phoneNumber: { type: String },
    bio: { type: String },
    dob: { type: Date },
    age: { type: Number },
    resetOtp: { type: String },
    otpExpires: { type: Date }
});

adminSchema.pre('save', async function (next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    next();
});

adminSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('Admin', adminSchema);