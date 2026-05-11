/**
 * 好友路由
 * 处理好友申请、好友列表、拉黑等功能
 */
const express = require('express');
const { query, transaction } = require('../models/db');
const { auth } = require('../middleware/auth');
const response = require('../utils/response');

const router = express.Router();

// 所有路由都需要认证
router.use(auth);

/**
 * GET /api/friends
 * 获取好友列表
 */
router.get('/', async (req, res) => {
    try {
        const { status = 'accepted' } = req.query;
        
        let statusFilter = "f.status = 'accepted'";
        if (status === 'pending') {
            statusFilter = "f.status = 'pending' AND f.friend_id = $1";
        } else if (status === 'blocked') {
            statusFilter = "f.status = 'blocked'";
        }
        
        let sql;
        let values;
        
        if (status === 'pending') {
            // 待处理的好友申请（我是接收方）
            sql = `
                SELECT f.id, f.status, f.created_at,
                       u.id as user_id, u.account, u.nickname, u.avatar, u.gender, u.signature
                FROM friendships f
                JOIN users u ON f.user_id = u.id
                WHERE f.friend_id = $1 AND f.status = 'pending'
                ORDER BY f.created_at DESC
            `;
            values = [req.user.id];
        } else {
            // 已接受的好友或我发起的申请
            sql = `
                SELECT f.id, f.status, f.created_at,
                       u.id as user_id, u.account, u.nickname, u.avatar, u.gender, u.signature
                FROM friendships f
                JOIN users u ON 
                    CASE 
                        WHEN f.user_id = $1 THEN f.friend_id
                        ELSE f.user_id
                    END = u.id
                WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'
                ORDER BY f.created_at DESC
            `;
            values = [req.user.id];
        }
        
        const result = await query(sql, values);
        return response.success(res, result.rows);
    } catch (error) {
        console.error('Get friends error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * GET /api/friends/sent
 * 获取我发起的申请列表
 */
router.get('/sent', async (req, res) => {
    try {
        const result = await query(`
            SELECT f.id, f.status, f.created_at,
                   u.id as user_id, u.account, u.nickname, u.avatar, u.gender, u.signature
            FROM friendships f
            JOIN users u ON f.friend_id = u.id
            WHERE f.user_id = $1 AND f.status = 'pending'
            ORDER BY f.created_at DESC
        `, [req.user.id]);
        
        return response.success(res, result.rows);
    } catch (error) {
        console.error('Get sent requests error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * POST /api/friends/request
 * 发送好友申请
 */
router.post('/request', async (req, res) => {
    try {
        const { user_id } = req.body;
        
        if (!user_id) {
            return response.badRequest(res, '用户ID不能为空');
        }
        
        if (user_id === req.user.id) {
            return response.badRequest(res, '不能添加自己为好友');
        }
        
        // 检查目标用户是否存在
        const userCheck = await query(
            'SELECT id FROM users WHERE id = $1 AND is_banned = false',
            [user_id]
        );
        
        if (userCheck.rows.length === 0) {
            return response.notFound(res, '用户不存在');
        }
        
        // 检查是否已经是好友或已有申请
        const existingCheck = await query(`
            SELECT id, status FROM friendships 
            WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)
        `, [req.user.id, user_id]);
        
        if (existingCheck.rows.length > 0) {
            const existing = existingCheck.rows[0];
            if (existing.status === 'accepted') {
                return response.badRequest(res, '已经是好友了');
            }
            if (existing.status === 'pending') {
                return response.badRequest(res, '已经发送过申请了');
            }
            if (existing.status === 'blocked') {
                return response.badRequest(res, '无法添加该用户');
            }
        }
        
        // 创建好友申请
        await query(`
            INSERT INTO friendships (user_id, friend_id, status)
            VALUES ($1, $2, 'pending')
        `, [req.user.id, user_id]);
        
        return response.created(res, null, '申请已发送');
    } catch (error) {
        console.error('Send friend request error:', error);
        return response.serverError(res, '发送失败');
    }
});

/**
 * POST /api/friends/accept/:id
 * 接受好友申请
 */
router.post('/accept/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // 检查申请是否存在且是发给当前用户的
        const requestCheck = await query(`
            SELECT id FROM friendships 
            WHERE id = $1 AND friend_id = $2 AND status = 'pending'
        `, [id, req.user.id]);
        
        if (requestCheck.rows.length === 0) {
            return response.notFound(res, '申请不存在或已处理');
        }
        
        // 更新为已接受
        await query(`
            UPDATE friendships SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [id]);
        
        return response.success(res, null, '已接受好友申请');
    } catch (error) {
        console.error('Accept friend request error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * POST /api/friends/reject/:id
 * 拒绝好友申请
 */
router.post('/reject/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // 检查申请是否存在且是发给当前用户的
        const requestCheck = await query(`
            SELECT id FROM friendships 
            WHERE id = $1 AND friend_id = $2 AND status = 'pending'
        `, [id, req.user.id]);
        
        if (requestCheck.rows.length === 0) {
            return response.notFound(res, '申请不存在或已处理');
        }
        
        // 删除申请
        await query('DELETE FROM friendships WHERE id = $1', [id]);
        
        return response.success(res, null, '已拒绝申请');
    } catch (error) {
        console.error('Reject friend request error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * POST /api/friends/block/:userId
 * 拉黑用户
 */
router.post('/block/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (userId === req.user.id) {
            return response.badRequest(res, '不能拉黑自己');
        }
        
        // 检查目标用户是否存在
        const userCheck = await query(
            'SELECT id FROM users WHERE id = $1',
            [userId]
        );
        
        if (userCheck.rows.length === 0) {
            return response.notFound(res, '用户不存在');
        }
        
        // 使用事务处理
        await transaction(async (client) => {
            // 删除现有关系
            await client.query(`
                DELETE FROM friendships 
                WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)
            `, [req.user.id, userId]);
            
            // 创建拉黑关系
            await client.query(`
                INSERT INTO friendships (user_id, friend_id, status)
                VALUES ($1, $2, 'blocked')
            `, [req.user.id, userId]);
        });
        
        return response.success(res, null, '已拉黑用户');
    } catch (error) {
        console.error('Block user error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * POST /api/friends/unblock/:userId
 * 解除拉黑
 */
router.post('/unblock/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        await query(`
            DELETE FROM friendships 
            WHERE user_id = $1 AND friend_id = $2 AND status = 'blocked'
        `, [req.user.id, userId]);
        
        return response.success(res, null, '已解除拉黑');
    } catch (error) {
        console.error('Unblock user error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * DELETE /api/friends/:friendId
 * 删除好友
 */
router.delete('/:friendId', async (req, res) => {
    try {
        const { friendId } = req.params;
        
        await query(`
            DELETE FROM friendships 
            WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
            AND status = 'accepted'
        `, [req.user.id, friendId]);
        
        return response.success(res, null, '已删除好友');
    } catch (error) {
        console.error('Delete friend error:', error);
        return response.serverError(res, '删除失败');
    }
});

/**
 * GET /api/friends/blocked
 * 获取黑名单
 */
router.get('/blocked', async (req, res) => {
    try {
        const result = await query(`
            SELECT f.id, f.created_at,
                   u.id as user_id, u.account, u.nickname, u.avatar, u.gender, u.signature
            FROM friendships f
            JOIN users u ON f.friend_id = u.id
            WHERE f.user_id = $1 AND f.status = 'blocked'
            ORDER BY f.created_at DESC
        `, [req.user.id]);
        
        return response.success(res, result.rows);
    } catch (error) {
        console.error('Get blocked users error:', error);
        return response.serverError(res, '获取失败');
    }
});

module.exports = router;
