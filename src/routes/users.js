/**
 * 用户路由
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { query, transaction } = require('../models/db');
const { auth, adminAuth } = require('../middleware/auth');
const response = require('../utils/response');

const router = express.Router();

/**
 * GET /api/users/profile
 * 获取个人资料
 */
router.get('/profile', auth, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, account, email, nickname, avatar, gender, role, signature,
                    coin_balance, diamond_balance,
                    text_price, image_price, video_price,
                    created_at, last_login_at
             FROM users WHERE id = $1`,
            [req.user.id]
        );
        
        if (result.rows.length === 0) {
            return response.notFound(res, '用户不存在');
        }
        
        return response.success(res, result.rows[0]);
    } catch (error) {
        console.error('Get profile error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * PUT /api/users/profile
 * 更新个人资料
 */
router.put('/profile', auth, async (req, res) => {
    try {
        const { nickname, avatar, signature, gender } = req.body;
        const updates = [];
        const values = [];
        let paramCount = 1;
        
        if (nickname !== undefined) {
            updates.push(`nickname = $${paramCount++}`);
            values.push(nickname);
        }
        
        if (avatar !== undefined) {
            updates.push(`avatar = $${paramCount++}`);
            values.push(avatar);
        }
        
        if (signature !== undefined) {
            updates.push(`signature = $${paramCount++}`);
            values.push(signature);
        }

        if (gender !== undefined) {
            if (!["male", "female", "unknown"].includes(gender)) {
                return response.badRequest(res, "Invalid gender");
            }
            updates.push(`gender = $${paramCount++}`);
            values.push(gender);
        }
        
        if (updates.length === 0) {
            return response.badRequest(res, '没有需要更新的字段');
        }
        
        values.push(req.user.id);
        
        const result = await query(
            `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
             WHERE id = $${paramCount}
             RETURNING id, account, email, nickname, avatar, gender, role, signature,
                       coin_balance, diamond_balance, text_price, image_price, video_price`,
            values
        );
        
        return response.success(res, result.rows[0], '更新成功');
    } catch (error) {
        console.error('Update profile error:', error);
        return response.serverError(res, '更新失败');
    }
});

/**
 * PUT /api/users/pricing
 * 设置异性聊天定价（女性用户）
 */
router.put('/pricing', auth, async (req, res) => {
    try {
        const { text_price, image_price, video_price } = req.body;
        
        // 只有女性用户可以设置定价
        if (req.user.gender !== 'female') {
            return response.forbidden(res, '只有女性用户可以设置聊天定价');
        }
        
        const result = await query(
            `UPDATE users SET 
                text_price = COALESCE($1, text_price),
                image_price = COALESCE($2, image_price),
                video_price = COALESCE($3, video_price),
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $4
             RETURNING id, text_price, image_price, video_price`,
            [text_price, image_price, video_price, req.user.id]
        );
        
        return response.success(res, result.rows[0], '定价更新成功');
    } catch (error) {
        console.error('Update pricing error:', error);
        return response.serverError(res, '更新失败');
    }
});

/**
 * PUT /api/users/gender/:userId
 * 修改用户性别（管理员）
 */
router.put('/gender/:userId', auth, adminAuth, async (req, res) => {
    try {
        const { userId } = req.params;
        const { gender } = req.body;
        
        if (!['male', 'female', 'unknown'].includes(gender)) {
            return response.badRequest(res, '性别值不正确');
        }
        
        const result = await query(
            `UPDATE users SET gender = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
             RETURNING id, account, nickname, gender`,
            [gender, userId]
        );
        
        if (result.rows.length === 0) {
            return response.notFound(res, '用户不存在');
        }
        
        return response.success(res, result.rows[0], '性别修改成功');
    } catch (error) {
        console.error('Update gender error:', error);
        return response.serverError(res, '修改失败');
    }
});

/**
 * PUT /api/users/ban/:userId
 * 禁用/启用用户（管理员）
 */
router.put('/ban/:userId', auth, adminAuth, async (req, res) => {
    try {
        const { userId } = req.params;
        const { is_banned } = req.body;
        
        // 不能禁用自己
        if (userId === req.user.id) {
            return response.badRequest(res, '不能禁用自己');
        }
        
        const result = await query(
            `UPDATE users SET is_banned = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
             RETURNING id, account, nickname, is_banned`,
            [is_banned, userId]
        );
        
        if (result.rows.length === 0) {
            return response.notFound(res, '用户不存在');
        }
        
        return response.success(res, result.rows[0], is_banned ? '用户已禁用' : '用户已启用');
    } catch (error) {
        console.error('Ban user error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * PUT /api/users/role/:userId
 * 修改用户角色（管理员）
 */
router.put('/role/:userId', auth, adminAuth, async (req, res) => {
    try {
        const { userId } = req.params;
        const { role } = req.body;
        
        if (!['user', 'host', 'agent', 'admin'].includes(role)) {
            return response.badRequest(res, '角色值不正确');
        }
        
        // 不能修改自己的角色
        if (userId === req.user.id) {
            return response.badRequest(res, '不能修改自己的角色');
        }
        
        await transaction(async (client) => {
            // 更新用户角色
            const result = await client.query(
                `UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2
                 RETURNING id, account, nickname, role`,
                [role, userId]
            );
            
            // 如果设置为代理，创建代理记录
            if (role === 'agent') {
                await client.query(
                    `INSERT INTO agents (user_id, distribute_password_hash, coin_pool)
                     VALUES ($1, $2, 0)
                     ON CONFLICT (user_id) DO NOTHING`,
                    [userId, await bcrypt.hash('123456', 10)]
                );
            }
            
            return result;
        });
        
        return response.success(res, null, '角色修改成功');
    } catch (error) {
        console.error('Update role error:', error);
        return response.serverError(res, '修改失败');
    }
});

/**
 * GET /api/users/search
 * 按账号/ID搜索用户
 */
router.get('/search', auth, async (req, res) => {
    try {
        const { account, keyword } = req.query;
        const searchTerm = account || keyword;
        
        if (!searchTerm || searchTerm.trim() === '') {
            return response.badRequest(res, '搜索内容不能为空');
        }
        
        // 支持按账号或昵称模糊搜索
        const result = await query(
            `SELECT id, account, nickname, avatar, gender, role, signature, created_at
             FROM users 
             WHERE (account ILIKE $1 OR nickname ILIKE $1) AND is_banned = false
             LIMIT 20`,
            [\`%\${searchTerm.trim()}%\`]
        );
        
        return response.success(res, result.rows);
    } catch (error) {
        console.error('Search user error:', error);
        return response.serverError(res, '搜索失败');
    }
});

/**
 * GET /api/users/:userId
 * 获取其他用户公开信息
 */
router.get('/:userId', auth, async (req, res) => {
    try {
        const { userId } = req.params;
        
        const result = await query(
            `SELECT id, nickname, avatar, gender, role, signature, created_at
             FROM users WHERE id = $1 AND is_banned = false`,
            [userId]
        );
        
        if (result.rows.length === 0) {
            return response.notFound(res, '用户不存在');
        }
        
        return response.success(res, result.rows[0]);
    } catch (error) {
        console.error('Get user error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * GET /api/users
 * 获取用户列表（管理员）
 */
router.get('/', auth, adminAuth, async (req, res) => {
    try {
        const { page = 1, limit = 20, role, gender, keyword } = req.query;
        const offset = (page - 1) * limit;
        
        let whereClause = 'WHERE 1=1';
        const values = [];
        let paramCount = 1;
        
        if (role) {
            whereClause += ` AND role = $${paramCount++}`;
            values.push(role);
        }
        
        if (gender) {
            whereClause += ` AND gender = $${paramCount++}`;
            values.push(gender);
        }
        
        if (keyword) {
            whereClause += ` AND (account ILIKE $${paramCount} OR nickname ILIKE $${paramCount})`;
            values.push(`%${keyword}%`);
            paramCount++;
        }
        
        // 获取总数
        const countResult = await query(
            `SELECT COUNT(*) FROM users ${whereClause}`,
            values
        );
        const total = parseInt(countResult.rows[0].count);
        
        // 获取列表
        values.push(limit, offset);
        const result = await query(
            `SELECT id, account, email, nickname, avatar, gender, role, signature,
                    coin_balance, diamond_balance, is_banned, created_at, last_login_at
             FROM users ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
            values
        );
        
        return response.success(res, {
            list: result.rows,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            total_pages: Math.ceil(total / limit),
        });
    } catch (error) {
        console.error('Get users error:', error);
        return response.serverError(res, '获取失败');
    }
});

module.exports = router;

