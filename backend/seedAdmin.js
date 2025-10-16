// seedAdmin.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const Admin = require('./models/Admin');

dotenv.config({ path: './.env' });

(async function seedAdmin() {
  try {
    // ✅ Connect to MongoDB (no deprecated options)
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');

    const email = 'malik.umerkhan97@gmail.com';
    const password = 'malikawan97'; // apna password yahan rakho

    // ⚙️ Delete any existing admin with same email
    await Admin.deleteOne({ email });

    const admin = new Admin({
      name: 'Super Admin',
      email,
      password, // plain password pass kiya, model khud hash kare ga
      role: 'admin',
    });

    await admin.save();
    console.log('✅ Admin seeded successfully!');
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
  } catch (err) {
    console.error('❌ Error seeding admin:', err);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed.');
  }
})();