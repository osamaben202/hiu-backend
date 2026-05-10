/**
 * 管理后台路由
 */
const express = require('express');
const { query } = require('../models/db');
const { auth, adminAuth } = require('../middleware/auth');
const response = require('../utils/response');

const router = express.Router();

/**
 * GET /api/admin/stats
 * 系统统计
 */
router.get('/stats', auth, adminAuth, async (req, res) => {
    try {
        const usersCount = await query('SELECT COUNT(*) as count FROM users');
        const roomsCount = await query('SELECT COUNT(*) as count FROM rooms WHERE status = $1', ['active']);
        const totalCoins = await query('SELECT SUM(coin_balance) as total FROM users WHERE role = $1', ['user']);
        const totalDiamonds = await query('SELECT SUM(diamond_balance) as total FROM users WHERE role = $1', ['host']);
        
        return response.success(res, {
            total_users: parseInt(usersCount.rows[0].count),
            active_rooms: parseInt(roomsCount.rows[0].count),
            total_coins_in_circulation: parseFloat(totalCoins.rows[0].total || 0),
            total_diamonds: parseFloat(totalDiamonds.rows[0].total || 0),
        });
    } catch (error) {
        return response.serverError(res, 'Failed to get stats');
    }
});

/**
 * GET /api/admin/users
 * 用户列表
 */
router.get('/users', auth, adminAuth, async (req, res) => {
    try {
        const { page = 1, limit = 20, role } = req.query;
        const offset = (page - 1) * limit;
        
        let sql = 'SELECT id, account, nickname, gender, role, coin_balance, diamond_balance, is_banned, created_at FROM users';
        const params = [];
        
        if (role) {
            sql += ' WHERE role = $1';
            params.push(role);
        }
        
        sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
        params.push(limit, offset);
        
        const result = await query(sql, params);
        
        return response.success(res, {
            list: result.rows,
            page: parseInt(page),
            limit: parseInt(limit),
        });
    } catch (error) {
        return response.serverError(res, 'Failed to get users');
    }
});

/**
 * PUT /api/admin/users/:id/ban
 * 禁用用户
 */
router.put('/users/:id/ban', auth, adminAuth, async (req, res) => {
    try {
        await query('UPDATE users SET is_banned = true WHERE id = $1', [req.params.id]);
        return response.success(res, null, 'User banned');
    } catch (error) {
        return response.serverError(res, 'Failed to ban user');
    }
});

/**
 * PUT /api/admin/users/:id/unban
 * 解禁用户
 */
router.put('/users/:id/unban', auth, adminAuth, async (req, res) => {
    try {
        await query('UPDATE users SET is_banned = false WHERE id = $1', [req.params.id]);
        return response.success(res, null, 'User unbanned');
    } catch (error) {
        return response.serverError(res, 'Failed to unban user');
    }
});

/**
 * PUT /api/admin/users/:id/role
 * 修改用户角色
 */
router.put('/users/:id/role', auth, adminAuth, async (req, res) => {
    try {
        const { role } = req.body;
        if (!['user', 'host', 'agent', 'admin'].includes(role)) {
            return response.badRequest(res, 'Invalid role');
        }
        await query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
        return response.success(res, null, 'Role updated');
    } catch (error) {
        return response.serverError(res, 'Failed to update role');
    }
});

/**
 * PUT /api/admin/users/:id/gender
 * 修改用户性别
 */
router.put('/users/:id/gender', auth, adminAuth, async (req, res) => {
    try {
        const { gender } = req.body;
        if (!['male', 'female', 'unknown'].includes(gender)) {
            return response.badRequest(res, 'Invalid gender');
        }
        await query('UPDATE users SET gender = $1 WHERE id = $2', [gender, req.params.id]);
        return response.success(res, null, 'Gender updated');
    } catch (error) {
        return response.serverError(res, 'Failed to update gender');
    }
});

/**
 * PUT /api/admin/users/:id/coins
 * 设置用户金币
 */
router.put('/users/:id/coins', auth, adminAuth, async (req, res) => {
    try {
        const { amount } = req.body;
        if (typeof amount !== 'number' || amount < 0) {
            return response.badRequest(res, 'Invalid amount');
        }
        await query('UPDATE users SET coin_balance = $1 WHERE id = $2', [amount, req.params.id]);
        return response.success(res, null, 'Coins updated');
    } catch (error) {
        return response.serverError(res, 'Failed to update coins');
    }
});

/**
 * PUT /api/admin/users/:id/diamonds
 * 清除用户钻石
 */
router.put('/users/:id/diamonds', auth, adminAuth, async (req, res) => {
    try {
        const { amount } = req.body;
        const newAmount = amount || 0;
        await query('UPDATE users SET diamond_balance = $1 WHERE id = $2', [newAmount, req.params.id]);
        return response.success(res, null, 'Diamonds updated');
    } catch (error) {
        return response.serverError(res, 'Failed to update diamonds');
    }
});

/**
 * GET /api/admin/withdraw-requests
 * 获取提现申请列表
 */
router.get('/withdraw-requests', auth, adminAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT w.*, u.account, u.nickname 
             FROM withdraw_requests w 
             JOIN users u ON w.user_id = u.id 
             WHERE w.status = 'pending' 
             ORDER BY w.created_at DESC`
        );
        return response.success(res, { list: result.rows });
    } catch (error) {
        return response.serverError(res, 'Failed to get withdraw requests');
    }
});

/**
 * PUT /api/admin/withdraw-requests/:id
 * 处理提现申请
 */
router.put('/withdraw-requests/:id', auth, adminAuth, async (req, res) => {
    try {
        const { status, admin_note } = req.body;
        if (!['approved', 'rejected', 'completed'].includes(status)) {
            return response.badRequest(res, 'Invalid status');
        }
        await query(
            'UPDATE withdraw_requests SET status = $1, admin_note = $2, processed_at = CURRENT_TIMESTAMP WHERE id = $3',
            [status, admin_note || '', req.params.id]
        );
        return response.success(res, null, 'Withdraw request updated');
    } catch (error) {
        return response.serverError(res, 'Failed to update withdraw request');
    }
});

/**
 * PUT /api/admin/config/:key
 * 更新系统配置
 */
router.put('/config/:key', auth, adminAuth, async (req, res) => {
    try {
        const { value } = req.body;
        await query(
            'UPDATE system_config SET value = $1 WHERE key = $2',
            [value, req.params.key]
        );
        return response.success(res, null, 'Config updated');
    } catch (error) {
        return response.serverError(res, 'Failed to update config');
    }
});

module.exports = router;
