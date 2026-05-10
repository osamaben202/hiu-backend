/**
 * 声网(Agora)服务
 * 用于生成RTC Token
 */
const { Pool } = require('pg');
const config = require('../config');

// Agora SDK (可选，如果安装了agora-access_token包)
let AccessToken;
try {
    AccessToken = require('../utils/AccessToken');
} catch (e) {
    console.warn('Agora AccessToken SDK not found, using manual implementation');
}

/**
 * 生成声网RTC Token
 * @param {string} channelName - 频道名
 * @param {string} uid - 用户ID
 * @param {string} userAccount - 用户账户名
 * @returns {string} - Token
 */
const generateAgoraToken = async (channelName, uid, userAccount = '') => {
    const appId = config.agora.appId;
    const appCertificate = config.agora.appCertificate;
    
    // 如果没有配置声网，返回模拟token
    if (!appId || !appCertificate) {
        console.warn('Agora not configured, returning mock token');
        return 'mock_token_' + Date.now();
    }
    
    // 使用SDK生成Token
    if (AccessToken) {
        const expirationTimeInSeconds = 3600; // 1小时
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;
        
        const token = new AccessToken(appId, appCertificate, channelName, uid);
        
        token.addPrivilage(AccessToken.priviledges.kJoinChannel, privilegeExpiredTs);
        token.addPrivilage(AccessToken.priviledges.kPublishAudioStream, privilegeExpiredTs);
        token.addPrivilage(AccessToken.priviledges.kPublishVideoStream, privilegeExpiredTs);
        token.addPrivilage(AccessToken.priviledges.kPublishDataStream, privilegeExpiredTs);
        
        return token.build();
    }
    
    // 如果没有SDK，返回模拟token
    return 'mock_token_' + Date.now();
};

/**
 * 生成房间语音频道Token
 */
const generateRoomToken = async (roomId, userId, userName) => {
    return generateAgoraToken(roomId, userId, userName);
};

/**
 * 生成视频通话Token
 */
const generateVideoCallToken = async (channelName, userId, userName) => {
    return generateAgoraToken(channelName, userId, userName);
};

module.exports = {
    generateAgoraToken,
    generateRoomToken,
    generateVideoCallToken,
};
