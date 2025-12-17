// controllers/topicController.js - COMPLETE VERSION
// Fixed: Removed multer configs, using global multer
// Added: All required functions with proper error handling

const mongoose = require('mongoose');
const Topic = require('../models/Topic');
const Course = require('../models/Course');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

// YouTube API setup
const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

// ========== HELPER FUNCTIONS ==========

// Generate content summary for AI prompts
function generateContentSummary(topic) {
    try {
        let summary = topic.description || '';
        
        if (topic.videos && topic.videos.length > 0) {
            const videoTopics = topic.videos.map(v => v.topic).filter(t => t && t.trim()).join(', ');
            if (videoTopics) {
                summary += ` Videos cover: ${videoTopics}.`;
            }
        }
        
        if (topic.resources && topic.resources.length > 0) {
            const resourceNames = topic.resources.map(r => r.name || r.type || 'Resource').filter(n => n).join(', ');
            if (resourceNames) {
                summary += ` Resources: ${resourceNames}.`;
            }
        }
        
        return summary.substring(0, 500); // Limit length
    } catch (error) {
        console.error('Error generating content summary:', error);
        return topic.description || '';
    }
}

// Auto-update content summary
const autoSummary = async (topic) => {
    try {
        topic.contentSummary = generateContentSummary(topic);
    } catch (error) {
        console.error('Error in autoSummary:', error);
    }
};

// Check if URL is a playlist
function isPlaylistUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.searchParams.has('list');
    } catch {
        return false;
    }
}

// Extract playlist ID from URL
function extractPlaylistId(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.searchParams.get('list');
    } catch {
        return null;
    }
}

// Fetch videos from YouTube playlist
async function fetchPlaylistVideos(playlistId) {
    try {
        if (!process.env.YOUTUBE_API_KEY) {
            throw new Error('YOUTUBE_API_KEY missing in environment variables');
        }
        
        console.log(`Fetching playlist videos for ID: ${playlistId}`);
        
        const response = await youtube.playlistItems.list({
            part: 'snippet',
            playlistId: playlistId,
            maxResults: 50
        });
        
        const items = response.data.items || [];
        console.log(`Fetched ${items.length} videos from playlist`);
        
        return items.map((item, idx) => ({
            topic: item.snippet.title || `Video ${idx + 1}`,
            url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
            isFile: false,
            order: idx,
            duration: 'N/A'
        }));
    } catch (error) {
        console.error('YouTube API Error:', error.response?.data || error.message);
        throw new Error(`Failed to fetch playlist: ${error.message}`);
    }
}

// Group videos into topics
async function identifyTopicsFromVideos(videos) {
    try {
        const groups = {};
        
        videos.forEach((video, index) => {
            const title = video.topic.toLowerCase();
            
            // Extract main topic from title (remove episode/part numbers)
            let mainTopic = title
                .replace(/(episode|part|lecture|lec|ch|chapter)\s*\d+/gi, '')
                .replace(/[^a-z0-9\s]/g, ' ')
                .trim()
                .split(/\s+/)
                .slice(0, 3)
                .join(' ');
            
            if (!mainTopic || mainTopic.length < 3) {
                mainTopic = `Topic ${index + 1}`;
            }
            
            if (!groups[mainTopic]) {
                groups[mainTopic] = {
                    name: mainTopic.charAt(0).toUpperCase() + mainTopic.slice(1),
                    videos: []
                };
            }
            
            groups[mainTopic].videos.push({
                ...video,
                order: groups[mainTopic].videos.length
            });
        });
        
        return Object.values(groups).map((group, idx) => ({
            name: group.name,
            description: `Auto-generated topic containing ${group.videos.length} video(s)`,
            order: idx,
            status: 'draft',
            videos: group.videos,
            contentSummary: `Covers ${group.name} with ${group.videos.length} video lessons`
        }));
    } catch (error) {
        console.error('Error identifying topics:', error);
        throw error;
    }
}

// Process uploaded files
function processUploadedFiles(req) {
    const result = {
        videos: [],
        resources: []
    };
    
    try {
        // Process video files
        if (req.files && req.files.videoFiles) {
            result.videos = req.files.videoFiles.map((file, index) => ({
                topic: file.originalname.replace(/\.[^/.]+$/, "") || `Video ${index + 1}`,
                url: `/uploads/videos/${file.filename}`,
                isFile: true,
                order: index,
                duration: 'N/A'
            }));
        }
        
        // Process resource files
        if (req.files && req.files.resourceFiles) {
            result.resources = req.files.resourceFiles.map((file, index) => ({
                type: 'pdf',
                url: `/uploads/resources/${file.filename}`,
                name: file.originalname.replace(/\.[^/.]+$/, "") || `Resource ${index + 1}`,
                uploadedAt: new Date()
            }));
        }
        
        return result;
    } catch (error) {
        console.error('Error processing uploaded files:', error);
        return result;
    }
}

// ========== CONTROLLER FUNCTIONS ==========

// Create topic
exports.createTopic = async (req, res) => {
    try {
        const { name, courseId, description = '', status = 'draft', videos: videosJson, resources: resourcesJson } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'Topic name is required' });
        }
        
        if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Valid course ID is required' });
        }
        
        // Check if course exists
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }
        
        // Process uploaded files
        const uploadedFiles = processUploadedFiles(req);
        
        // Parse JSON arrays if provided
        let parsedVideos = [];
        let parsedResources = [];
        
        if (videosJson) {
            try {
                parsedVideos = JSON.parse(videosJson);
            } catch (parseError) {
                return res.status(400).json({ message: 'Invalid videos JSON format' });
            }
        }
        
        if (resourcesJson) {
            try {
                parsedResources = JSON.parse(resourcesJson);
            } catch (parseError) {
                return res.status(400).json({ message: 'Invalid resources JSON format' });
            }
        }
        
        // Combine uploaded videos with parsed videos
        const allVideos = [
            ...uploadedFiles.videos,
            ...parsedVideos.filter(v => v.url && !v.isFile) // Only external URLs from JSON
        ];
        
        // Combine uploaded resources with parsed resources
        const allResources = [
            ...uploadedFiles.resources,
            ...parsedResources.filter(r => r.url && r.type !== 'file') // Only external URLs from JSON
        ];
        
        // Create topic
        const topic = new Topic({
            name: name.trim(),
            courseId,
            description: description.trim(),
            status,
            videos: allVideos,
            resources: allResources,
            order: course.topics ? course.topics.length : 0
        });
        
        // Generate content summary
        await autoSummary(topic);
        
        // Save topic
        await topic.save();
        
        // Update course topics
        course.topics = course.topics || [];
        course.topics.push(topic._id);
        await course.save();
        
        res.status(201).json({
            message: 'Topic created successfully',
            topic: {
                _id: topic._id,
                name: topic.name,
                courseId: topic.courseId,
                description: topic.description,
                contentSummary: topic.contentSummary,
                videos: topic.videos,
                resources: topic.resources,
                order: topic.order,
                status: topic.status
            }
        });
        
    } catch (error) {
        console.error('Create topic error:', error);
        res.status(500).json({ 
            message: 'Failed to create topic', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
        });
    }
};

// Update topic
exports.updateTopic = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid topic ID' });
        }
        
        const topic = await Topic.findById(id);
        if (!topic) {
            return res.status(404).json({ message: 'Topic not found' });
        }
        
        // Process uploaded files
        const uploadedFiles = processUploadedFiles(req);
        
        // Update basic fields
        if (updates.name && updates.name.trim()) {
            topic.name = updates.name.trim();
        }
        
        if (updates.description !== undefined) {
            topic.description = updates.description.trim();
        }
        
        if (updates.status && ['draft', 'published'].includes(updates.status)) {
            topic.status = updates.status;
        }
        
        if (updates.order !== undefined) {
            topic.order = parseInt(updates.order) || 0;
        }
        
        // Update videos if provided
        if (updates.videos || uploadedFiles.videos.length > 0) {
            let parsedVideos = [];
            
            if (updates.videos) {
                try {
                    parsedVideos = JSON.parse(updates.videos);
                } catch (parseError) {
                    return res.status(400).json({ message: 'Invalid videos JSON format' });
                }
            }
            
            // Combine existing videos (excluding replaced ones) with new ones
            const existingVideos = topic.videos.filter(v => v.isFile === false); // Keep external videos
            topic.videos = [
                ...existingVideos,
                ...uploadedFiles.videos,
                ...parsedVideos.filter(v => v.url && !v.isFile)
            ];
        }
        
        // Update resources if provided
        if (updates.resources || uploadedFiles.resources.length > 0) {
            let parsedResources = [];
            
            if (updates.resources) {
                try {
                    parsedResources = JSON.parse(updates.resources);
                } catch (parseError) {
                    return res.status(400).json({ message: 'Invalid resources JSON format' });
                }
            }
            
            // Combine existing resources (excluding file resources) with new ones
            const existingResources = topic.resources.filter(r => r.type !== 'pdf'); // Keep non-PDF resources
            topic.resources = [
                ...existingResources,
                ...uploadedFiles.resources,
                ...parsedResources.filter(r => r.url && r.type !== 'file')
            ];
        }
        
        // Update content summary
        await autoSummary(topic);
        
        await topic.save();
        
        // Sort videos by order
        topic.videos.sort((a, b) => (a.order || 0) - (b.order || 0));
        
        res.json({
            message: 'Topic updated successfully',
            topic: {
                _id: topic._id,
                name: topic.name,
                description: topic.description,
                contentSummary: topic.contentSummary,
                videos: topic.videos,
                resources: topic.resources,
                order: topic.order,
                status: topic.status
            }
        });
        
    } catch (error) {
        console.error('Update topic error:', error);
        res.status(500).json({ 
            message: 'Failed to update topic', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
        });
    }
};

// Get topics by course
exports.getTopicsByCourse = async (req, res) => {
    try {
        const { courseId } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Invalid course ID' });
        }
        
        const topics = await Topic.find({ courseId })
            .sort({ order: 1, createdAt: 1 })
            .select('-__v');
        
        // Add full URLs to files
        const topicsWithUrls = topics.map(topic => {
            const topicObj = topic.toObject();
            
            // Add base URL to video and resource files
            if (topicObj.videos) {
                topicObj.videos = topicObj.videos.map(video => ({
                    ...video,
                    fullUrl: video.isFile ? `${req.protocol}://${req.get('host')}${video.url}` : video.url
                }));
                topicObj.videos.sort((a, b) => (a.order || 0) - (b.order || 0));
            }
            
            if (topicObj.resources) {
                topicObj.resources = topicObj.resources.map(resource => ({
                    ...resource,
                    fullUrl: resource.type === 'pdf' ? `${req.protocol}://${req.get('host')}${resource.url}` : resource.url
                }));
            }
            
            return topicObj;
        });
        
        res.json(topicsWithUrls);
        
    } catch (error) {
        console.error('Get topics by course error:', error);
        res.status(500).json({ 
            message: 'Failed to fetch topics', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
        });
    }
};

// Get single topic
exports.getTopic = async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid topic ID' });
        }
        
        const topic = await Topic.findById(id)
            .populate('courseId', 'name')
            .select('-__v');
        
        if (!topic) {
            return res.status(404).json({ message: 'Topic not found' });
        }
        
        const topicObj = topic.toObject();
        
        // Add full URLs to files
        if (topicObj.videos) {
            topicObj.videos = topicObj.videos.map(video => ({
                ...video,
                fullUrl: video.isFile ? `${req.protocol}://${req.get('host')}${video.url}` : video.url
            }));
            topicObj.videos.sort((a, b) => (a.order || 0) - (b.order || 0));
        }
        
        if (topicObj.resources) {
            topicObj.resources = topicObj.resources.map(resource => ({
                ...resource,
                fullUrl: resource.type === 'pdf' ? `${req.protocol}://${req.get('host')}${resource.url}` : resource.url
            }));
        }
        
        res.json(topicObj);
        
    } catch (error) {
        console.error('Get topic error:', error);
        res.status(500).json({ 
            message: 'Failed to fetch topic', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
        });
    }
};

// Delete topic
exports.deleteTopic = async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid topic ID' });
        }
        
        const topic = await Topic.findById(id);
        if (!topic) {
            return res.status(404).json({ message: 'Topic not found' });
        }
        
        // Delete associated files
        if (topic.videos) {
            topic.videos.forEach(video => {
                if (video.isFile && video.url) {
                    const filePath = path.join(__dirname, '..', 'public', video.url);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                }
            });
        }
        
        if (topic.resources) {
            topic.resources.forEach(resource => {
                if (resource.type === 'pdf' && resource.url) {
                    const filePath = path.join(__dirname, '..', 'public', resource.url);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                }
            });
        }
        
        // Remove topic from course
        const course = await Course.findById(topic.courseId);
        if (course) {
            course.topics = course.topics.filter(t => t.toString() !== id);
            await course.save();
        }
        
        // Delete topic
        await Topic.findByIdAndDelete(id);
        
        res.json({ 
            message: 'Topic deleted successfully',
            deletedId: id
        });
        
    } catch (error) {
        console.error('Delete topic error:', error);
        res.status(500).json({ 
            message: 'Failed to delete topic', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
        });
    }
};

// Add videos to topic
exports.addVideosToTopic = async (req, res) => {
    try {
        const { id } = req.params;
        const { videos: videosJson } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid topic ID' });
        }
        
        const topic = await Topic.findById(id);
        if (!topic) {
            return res.status(404).json({ message: 'Topic not found' });
        }
        
        // Process uploaded video files
        const uploadedVideos = [];
        if (req.files && req.files.length > 0) {
            uploadedVideos.push(...req.files.map((file, index) => ({
                topic: file.originalname.replace(/\.[^/.]+$/, "") || `Video ${topic.videos.length + index + 1}`,
                url: `/uploads/videos/${file.filename}`,
                isFile: true,
                order: topic.videos.length + index,
                duration: 'N/A'
            })));
        }
        
        // Parse JSON videos
        let parsedVideos = [];
        if (videosJson) {
            try {
                parsedVideos = JSON.parse(videosJson);
            } catch (parseError) {
                return res.status(400).json({ message: 'Invalid videos JSON format' });
            }
        }
        
        // Filter only external URLs from JSON
        const externalVideos = parsedVideos.filter(v => v.url && !v.isFile);
        
        // Combine all videos
        const newVideos = [...uploadedVideos, ...externalVideos];
        
        if (newVideos.length === 0) {
            return res.status(400).json({ message: 'No valid videos provided' });
        }
        
        // Add videos to topic
        topic.videos = [...topic.videos, ...newVideos];
        
        // Update content summary
        await autoSummary(topic);
        await topic.save();
        
        // Sort videos
        topic.videos.sort((a, b) => (a.order || 0) - (b.order || 0));
        
        res.json({
            message: `${newVideos.length} video(s) added successfully`,
            addedCount: newVideos.length,
            videos: newVideos.map(v => ({
                topic: v.topic,
                url: v.isFile ? `${req.protocol}://${req.get('host')}${v.url}` : v.url,
                isFile: v.isFile,
                order: v.order
            }))
        });
        
    } catch (error) {
        console.error('Add videos to topic error:', error);
        res.status(500).json({ 
            message: 'Failed to add videos', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
        });
    }
};

// Add resources to topic
// controllers/topicController.js - example addResourcesToTopic function
exports.addResourcesToTopic = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if files were uploaded
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No PDF files uploaded' });
        }
        
        const topic = await Topic.findById(id);
        if (!topic) {
            return res.status(404).json({ message: 'Topic not found' });
        }
        
        // Process each PDF file
        const resources = req.files.map(file => {
            return {
                name: file.originalname,
                path: `/uploads/resources/${file.filename}`,
                type: 'pdf',
                uploadedAt: new Date()
            };
        });
        
        // Add to topic resources
        topic.resources = topic.resources || [];
        topic.resources.push(...resources);
        
        await topic.save();
        
        res.status(200).json({
            message: `${resources.length} PDF resource(s) added successfully`,
            resources: resources.map(r => ({
                name: r.name,
                url: `${process.env.BASE_URL || 'http://localhost:5000'}${r.path}`,
                type: r.type
            }))
        });
        
    } catch (error) {
        console.error('Add resources error:', error);
        res.status(500).json({ message: 'Failed to add resources', error: error.message });
    }
};

// Delete video from topic
exports.deleteVideoFromTopic = async (req, res) => {
    try {
        const { id, videoId } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid topic ID' });
        }
        
        const topic = await Topic.findById(id);
        if (!topic) {
            return res.status(404).json({ message: 'Topic not found' });
        }
        
        // Find video
        const videoIndex = topic.videos.findIndex(v => v._id.toString() === videoId);
        if (videoIndex === -1) {
            return res.status(404).json({ message: 'Video not found in topic' });
        }
        
        const video = topic.videos[videoIndex];
        
        // Delete file if it's an uploaded file
        if (video.isFile && video.url) {
            const filePath = path.join(__dirname, '..', 'public', video.url);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        
        // Remove video from array
        topic.videos.splice(videoIndex, 1);
        
        // Reorder remaining videos
        topic.videos.forEach((v, index) => {
            v.order = index;
        });
        
        // Update content summary
        await autoSummary(topic);
        await topic.save();
        
        res.json({ 
            message: 'Video deleted successfully',
            deletedVideoId: videoId
        });
        
    } catch (error) {
        console.error('Delete video from topic error:', error);
        res.status(500).json({ 
            message: 'Failed to delete video', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
        });
    }
};

// Delete resource from topic
exports.deleteResourceFromTopic = async (req, res) => {
    try {
        const { id, resourceId } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid topic ID' });
        }
        
        const topic = await Topic.findById(id);
        if (!topic) {
            return res.status(404).json({ message: 'Topic not found' });
        }
        
        // Find resource
        const resourceIndex = topic.resources.findIndex(r => r._id.toString() === resourceId);
        if (resourceIndex === -1) {
            return res.status(404).json({ message: 'Resource not found in topic' });
        }
        
        const resource = topic.resources[resourceIndex];
        
        // Delete file if it's a PDF
        if (resource.type === 'pdf' && resource.url) {
            const filePath = path.join(__dirname, '..', 'public', resource.url);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        
        // Remove resource from array
        topic.resources.splice(resourceIndex, 1);
        
        // Update content summary
        await autoSummary(topic);
        await topic.save();
        
        res.json({ 
            message: 'Resource deleted successfully',
            deletedResourceId: resourceId
        });
        
    } catch (error) {
        console.error('Delete resource from topic error:', error);
        res.status(500).json({ 
            message: 'Failed to delete resource', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
        });
    }
};

// Auto-create topics from YouTube playlist
exports.autoCreateTopicsFromPlaylist = async (req, res) => {
    try {
        const { playlistUrl, courseId } = req.body;
        
        if (!playlistUrl || !playlistUrl.trim()) {
            return res.status(400).json({ message: 'Playlist URL is required' });
        }
        
        if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Valid course ID is required' });
        }
        
        // Check if course exists
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }
        
        // Extract playlist ID
        const playlistId = extractPlaylistId(playlistUrl);
        if (!playlistId) {
            return res.status(400).json({ message: 'Invalid YouTube playlist URL' });
        }
        
        // Fetch videos from playlist
        const videos = await fetchPlaylistVideos(playlistId);
        if (videos.length === 0) {
            return res.status(400).json({ message: 'No videos found in playlist' });
        }
        
        // Group videos into topics
        const topicsData = await identifyTopicsFromVideos(videos);
        
        // Create topics
        const createdTopics = [];
        for (const topicData of topicsData) {
            const topic = new Topic({
                name: topicData.name,
                courseId,
                description: topicData.description,
                contentSummary: topicData.contentSummary,
                videos: topicData.videos,
                order: course.topics.length + createdTopics.length,
                status: 'draft'
            });
            
            await topic.save();
            createdTopics.push(topic);
            
            // Add to course
            course.topics.push(topic._id);
        }
        
        await course.save();
        
        res.json({
            message: `${createdTopics.length} topic(s) created from playlist`,
            createdCount: createdTopics.length,
            topics: createdTopics.map(t => ({
                _id: t._id,
                name: t.name,
                description: t.description,
                videoCount: t.videos.length
            }))
        });
        
    } catch (error) {
        console.error('Auto-create topics error:', error);
        
        let errorMessage = 'Failed to create topics from playlist';
        if (error.message.includes('API key')) {
            errorMessage = 'YouTube API key is missing or invalid';
        } else if (error.message.includes('quota')) {
            errorMessage = 'YouTube API quota exceeded';
        }
        
        res.status(500).json({ 
            message: errorMessage,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get topic content summary for AI
exports.getTopicSummary = async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid topic ID' });
        }
        
        const topic = await Topic.findById(id)
            .select('name description contentSummary videos resources')
            .lean();
        
        if (!topic) {
            return res.status(404).json({ message: 'Topic not found' });
        }
        
        // Generate summary if not exists
        if (!topic.contentSummary) {
            topic.contentSummary = generateContentSummary(topic);
        }
        
        // Prepare AI-friendly summary
        const aiSummary = {
            topicName: topic.name,
            description: topic.description || '',
            contentSummary: topic.contentSummary,
            videoCount: topic.videos ? topic.videos.length : 0,
            resourceCount: topic.resources ? topic.resources.length : 0,
            videoTopics: topic.videos ? topic.videos.map(v => v.topic).filter(t => t) : [],
            resourceTypes: topic.resources ? [...new Set(topic.resources.map(r => r.type))] : []
        };
        
        res.json(aiSummary);
        
    } catch (error) {
        console.error('Get topic summary error:', error);
        res.status(500).json({ 
            message: 'Failed to get topic summary', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
        });
    }
};