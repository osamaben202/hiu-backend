/**
 * JWT认证中间件
 */
const { verifyToken } = require('../utils/jwt');
const { query } = require('../models/db');
const response = require('../utils/response');

/**
 * 验证Token中间件
 */
const auth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return response.unauthorized(res, '请先登录');
        }
        
        const token = authHeader.substring(7);
        const decoded = verifyToken(token);
        
        if (!decoded) {
            return response.unauthorized(res, 'Token已过期');
        }
        
        // 查询用户信息
        const result = await query(
            'SELECT id, account, nickname, avatar, gender, role, coin_balance, diamond_balance, is_banned FROM users WHERE id = $1',
            [decoded.userId]
        );
        
        if (result.rows.length === 0) {
            return response.unauthorized(res, '用户不存在');
        }
        
        const user = result.rows[0];
        
        // 检查用户是否被禁用
        if (user.is_banned) {
            return response.forbidden(res, '账号已被禁用');
        }
        
        // 将用户信息挂载到request
        req.user = user;
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return response.serverError(res, '认证失败');
    }
};

/**
 * 可选认证中间件(不强制登录)
 */
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return next();
        }
        
        const token = authHeader.substring(7);
        const decoded = verifyToken(token);
        
        if (decoded) {
            const result = await query(
                'SELECT id, account, nickname, avatar, gender, role, coin_balance, diamond_balance, is_banned FROM users WHERE id = $1',
                [decoded.userId]
            );
            
            if (result.rows.length > 0 && !result.rows[0].is_banned) {
                req.user = result.rows[0];
            }
        }
        
        next();
    } catch (error) {
        next();
    }
};

/**
 * 管理员权限中间件
 */
const adminAuth = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return response.forbidden(res, '需要管理员权限');
    }
    next();
};

/**
 * 代理权限中间件
 */
const agentAuth = (req, res, next) => {
    if (!req.user || (req.user.role !== 'agent' && req.user.role !== 'admin')) {
        return response.forbidden(res, '需要代理权限');
    }
    next();
};

/**
 * 主播权限中间件
 */
const hostAuth = (req, res, next) => {
    if (!req.user || (req.user.role !== 'host' && req.user.role !== 'admin')) {
        return response.forbidden(res, '需要主播权限');
    }
    next();
};

module.exports = {
    auth,
    optionalAuth,
    adminAuth,
    agentAuth,
    hostAuth,
};
