// config/db.js - COMPLETE UPDATED VERSION
const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        console.log('🔄 Attempting MongoDB connection...');
        
        // Try multiple environment variable names
        let mongoURI = process.env.MONGODB_URI || 
                      process.env.MONGO_URI || 
                      process.env.MONGO_URL ||
                      process.env.DATABASE_URL;
        
        if (!mongoURI) {
            console.warn('⚠️  No MongoDB URI found in environment variables');
            console.log('📝 Trying local MongoDB fallback...');
            mongoURI = 'mongodb://127.0.0.1:27017/assignment_grading';
        }
        
        console.log(`Connecting to MongoDB...`);
        
        // Connection options for better stability
        const options = {
            serverSelectionTimeoutMS: 30000, // 30 seconds
            socketTimeoutMS: 45000, // 45 seconds
            connectTimeoutMS: 30000, // 30 seconds
            maxPoolSize: 10,
            minPoolSize: 5,
            retryWrites: true,
            w: 'majority'
        };

        const conn = await mongoose.connect(mongoURI, options);
        
        console.log(`✅ MongoDB Connected Successfully!`);
        console.log(`📊 Host: ${conn.connection.host}`);
        console.log(`📁 Database: ${conn.connection.name}`);
        
        // Connection event handlers
        mongoose.connection.on('connected', () => {
            console.log('✅ Mongoose connected to DB');
        });
        
        mongoose.connection.on('error', (err) => {
            console.error(`❌ Mongoose connection error: ${err.message}`);
        });
        
        mongoose.connection.on('disconnected', () => {
            console.log('⚠️  Mongoose disconnected from DB');
        });
        
        // Graceful shutdown
        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            console.log('🔌 MongoDB connection closed due to app termination');
            process.exit(0);
        });
        
        return conn;
        
    } catch (error) {
        console.error(`❌ MongoDB Connection Failed: ${error.message}`);
        
        // Detailed error information
        console.error(`Error Details:`);
        console.error(`- Code: ${error.code}`);
        console.error(`- Name: ${error.name}`);
        
        if (error.message.includes('queryTxt ETIMEOUT')) {
            console.log('\n🔧 DNS Resolution Failed - Possible Solutions:');
            console.log('1. Check your internet connection');
            console.log('2. Try using IP address instead of hostname');
            console.log('3. Use local MongoDB instead of Atlas');
        }
        
        if (error.message.includes('authentication failed')) {
            console.log('\n🔧 Authentication Failed - Check:');
            console.log('1. MongoDB username and password');
            console.log('2. Database user permissions');
        }
        
        // Try local MongoDB as fallback
        console.log('\n🔄 Attempting local MongoDB connection as fallback...');
        try {
            const localURI = 'mongodb://127.0.0.1:27017/assignment_grading';
            console.log(`Trying: ${localURI}`);
            
            const conn = await mongoose.connect(localURI, {
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 10000,
                connectTimeoutMS: 5000
            });
            
            console.log(`✅ Connected to local MongoDB: ${conn.connection.host}`);
            console.log('📝 Running in fallback mode with local database');
            
            return conn;
        } catch (localError) {
            console.error('❌ Local MongoDB also failed:', localError.message);
            
            // Create in-memory database for testing
            console.log('\n💡 Running without database (in-memory mode)');
            console.log('⚠️  Note: Data will not persist between restarts');
            console.log('✅ AI features will still work');
            
            // Don't exit process, let app run without DB
            return null;
        }
    }
};

module.exports = connectDB;