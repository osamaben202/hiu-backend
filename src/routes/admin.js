/**
 * 管理后台路由
 */
const express = require('express');
const { query, transaction } = require('../models/db');
const { auth, adminAuth } = require('../middleware/auth');
const response = require('../utils/response');
const bcrypt = require('bcryptjs');

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
        const { page = 1, limit = 20, role, banned } = req.query;
        const offset = (page - 1) * limit;
        
        let whereSql = 'WHERE 1=1';
        const params = [];
        
        if (role) {
            params.push(role);
            whereSql += ` AND role = $${params.length}`;
        }
        
        if (banned === 'active') {
            whereSql += ' AND is_banned = false';
        } else if (banned === 'banned') {
            whereSql += ' AND is_banned = true';
        }
        
        // Count total (no ORDER BY)
        const countResult = await query(`SELECT COUNT(*) as count FROM users ${whereSql}`, params);
        const total = parseInt(countResult.rows[0].count);
        
        // Get users with pagination
        params.push(parseInt(limit), parseInt(offset));
        const result = await query(
            `SELECT id, account, nickname, gender, role, coin_balance, diamond_balance, is_banned, created_at FROM users ${whereSql} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        
        return response.success(res, {
            list: result.rows,
            page: parseInt(page),
            limit: parseInt(limit),
            total: total,
            totalPages: Math.ceil(total / limit),
        });
    } catch (error) {
        console.error('Failed to get users:', error.message);
        return response.serverError(res, 'Failed to get users');
    }
});

/**
 * POST /api/admin/users/create
 * 创建用户
 */
router.post('/users/create', auth, adminAuth, async (req, res) => {
    try {
        const { account, password, nickname, role, gender, coins, diamonds } = req.body;
        
        // 验证必填参数
        if (!account || !password) {
            return response.badRequest(res, '账号和密码不能为空');
        }
        
        // 验证角色
        const validRoles = ['user', 'host', 'agent', 'admin'];
        if (role && !validRoles.includes(role)) {
            return response.badRequest(res, '无效的角色');
        }
        
        // 验证性别
        const validGenders = ['male', 'female', 'unknown'];
        if (gender && !validGenders.includes(gender)) {
            return response.badRequest(res, '无效的性别');
        }
        
        // 检查账号是否已存在
        const existing = await query('SELECT id FROM users WHERE account = $1', [account]);
        if (existing.rows.length > 0) {
            return response.badRequest(res, '账号已存在');
        }
        
        // 加密密码
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 使用事务创建用户
        const result = await transaction(async (client) => {
            const userResult = await client.query(
                `INSERT INTO users (account, password_hash, nickname, role, gender, coin_balance, diamond_balance, is_banned, created_at) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, false, CURRENT_TIMESTAMP) 
                 RETURNING id, account, nickname, role, gender, coin_balance, diamond_balance, is_banned, created_at`,
                [account, hashedPassword, nickname || account, role || 'user', gender || 'unknown', coins || 0, diamonds || 0]
            );
            
            const newUser = userResult.rows[0];
            
            // 如果角色是agent，自动创建agent记录
            if (role === 'agent') {
                const agentPassword = '123456'; // 代理默认密码
                const hashedAgentPassword = await bcrypt.hash(agentPassword, 10);
                await client.query(
                    `INSERT INTO agents (user_id, distribute_password_hash, status, created_at) VALUES ($1, $2, 'active', CURRENT_TIMESTAMP)`,
                    [newUser.id, hashedAgentPassword]
                );
            }
            
            return newUser;
        });
        
        return response.success(res, result, '用户创建成功');
    } catch (error) {
        console.error('Create user error:', error);
        console.error('Failed to create user:', error.message);
        return response.serverError(res, 'Failed to create user');
    }
});

/**
 * PUT /api/admin/users/:id/reset-password
 * 重置用户密码
 */
router.put('/users/:id/reset-password', auth, adminAuth, async (req, res) => {
    try {
        const { new_password } = req.body;
        
        if (!new_password) {
            return response.badRequest(res, '新密码不能为空');
        }
        
        const hashedPassword = await bcrypt.hash(new_password, 10);
        await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, req.params.id]);
        
        return response.success(res, null, '密码重置成功');
    } catch (error) {
        console.error('Reset password error:', error);
        return response.serverError(res, 'Failed to reset password');
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

/**
 * POST /api/admin/migrate
 * 手动触发数据库迁移
 */
router.post('/migrate', auth, adminAuth, async (req, res) => {
    try {
        const { pool } = require('../models/db');
        
        // 检查并添加 is_banned 列
        const colCheck = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_banned'"
        );
        if (colCheck.rows.length === 0) {
            await pool.query('ALTER TABLE users ADD COLUMN is_banned BOOLEAN DEFAULT FALSE');
            console.log('✅ 迁移：添加 is_banned 列');
        }
        
        // 检查并添加 signature 列
        const sigCheck = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'signature'"
        );
        if (sigCheck.rows.length === 0) {
            await pool.query("ALTER TABLE users ADD COLUMN signature VARCHAR(200) DEFAULT ''");
            console.log('✅ 迁移：添加 signature 列');
        }
        
        return response.success(res, { message: '迁移完成' });
    } catch (error) {
        console.error('迁移失败:', error.message);
        return response.serverError(res, '迁移失败: ' + error.message);
    }
});
