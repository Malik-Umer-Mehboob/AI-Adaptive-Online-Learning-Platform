// common-thumbnail.js - UPDATED
function getVideoThumbnail(video) {
    if (!video) {
        return 'https://cdn.prod.website-files.com/6424a84a1a908839d5724077/674db4b94f6966c47d740174_video-thumbnails-1.webp';
    }
    
    // 1. Use thumbnail from backend if available
    if (video.thumbnail) {
        // Fix thumbnail path
        let thumbnailPath = video.thumbnail;
        
        // Agar relative path hai to fix karo
        if (thumbnailPath && !thumbnailPath.startsWith('http')) {
            // Remove leading slash if present
            if (thumbnailPath.startsWith('/')) {
                thumbnailPath = thumbnailPath.substring(1);
            }
            
            // Try multiple possible locations
            const possiblePaths = [
                `http://localhost:5000/uploads/${thumbnailPath}`,
                `http://localhost:5000/public/uploads/${thumbnailPath}`,
                `http://localhost:5000/${thumbnailPath}`,
                thumbnailPath // Original path
            ];
            
            // Return the first one that might work
            return possiblePaths[0];
        }
        
        return thumbnailPath;
    }
    
    // 2. YouTube video
    const url = video.url || '';
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        const videoId = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
        if (videoId && videoId[1]) {
            return `https://img.youtube.com/vi/${videoId[1]}/hqdefault.jpg`;
        }
    }
    
    // 3. Default
    return 'https://cdn.prod.website-files.com/6424a84a1a908839d5724077/674db4b94f6966c47d740174_video-thumbnails-1.webp';
}

// Export function for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getVideoThumbnail };
}