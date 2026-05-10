/**
 * JWT认证工具
 */
const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * 生成Token
 */
const generateToken = (userId, role) => {
    return jwt.sign(
        { userId, role },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
    );
};

/**
 * 生成刷新Token
 */
const generateRefreshToken = (userId) => {
    return jwt.sign(
        { userId, type: 'refresh' },
        config.jwt.secret,
        { expiresIn: config.jwt.refreshExpiresIn }
    );
};

/**
 * 验证Token
 */
const verifyToken = (token) => {
    try {
        return jwt.verify(token, config.jwt.secret);
    } catch (error) {
        return null;
    }
};

/**
 * 解码Token(不验证)
 */
const decodeToken = (token) => {
    return jwt.decode(token);
};

module.exports = {
    generateToken,
    generateRefreshToken,
    verifyToken,
    decodeToken,
};
