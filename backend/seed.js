const mongoose = require('mongoose');
const Admin = require('./models/Admin');
const dotenv = require('dotenv');

dotenv.config({ path: './.env' });

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error(err));

async function seedAdmin() {
    try {
        const existingAdmin = await Admin.findOne({ email: 'malik.umerkhan97@gmail.com' });
        if (!existingAdmin) {
            const admin = new Admin({
                name: 'Super Admin',
                email: 'malik.umerkhan97@gmail.com',
                password: 'malikawan97',
                role: 'admin'
            });
            await admin.save();
            console.log('Admin seeded successfully with email: malik.umerkhan97@gmail.com');
        } else {
            console.log('Admin already exists with email: malik.umerkhan97@gmail.com');
        }
    } catch (err) {
        console.error('Error seeding admin:', err);
    } finally {
        mongoose.connection.close();
    }
}

seedAdmin();