const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const teacherSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'teacher', enum: ['teacher'] },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    otp: { type: String },
    otpExpires: { type: Date },
    registrationDate: { type: Date, default: Date.now },
    profileImage: { type: String, default: null }, // Default null for grey image
    phoneNumber: { type: String },
    bio: { type: String },
    dob: { type: Date },
    age: { type: Number },
    education: [{ degree: String, institution: String, year: String }],
    experience: [{ title: String, company: String, years: String }],
});

teacherSchema.pre('save', async function (next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    next();
});

teacherSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('Teacher', teacherSchema);