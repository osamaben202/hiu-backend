/**
 * 金币路由
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { query, transaction } = require('../models/db');
const { auth, adminAuth, agentAuth } = require('../middleware/auth');
const response = require('../utils/response');

const router = express.Router();

/**
 * GET /api/coins/balance
 * 获取金币余额
 */
router.get('/balance', auth, async (req, res) => {
    try {
        const result = await query(
            'SELECT coin_balance FROM users WHERE id = $1',
            [req.user.id]
        );
        
        return response.success(res, {
            coin_balance: result.rows[0].coin_balance,
        });
    } catch (error) {
        console.error('Get balance error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * GET /api/coins/transactions
 * 获取金币流水
 */
router.get('/transactions', auth, async (req, res) => {
    try {
        const { page = 1, limit = 20, category } = req.query;
        const offset = (page - 1) * limit;
        
        let whereClause = 'WHERE user_id = $1';
        const values = [req.user.id];
        let paramCount = 2;
        
        if (category) {
            whereClause += ` AND category = $${paramCount++}`;
            values.push(category);
        }
        
        // 获取总数
        const countResult = await query(
            `SELECT COUNT(*) FROM coin_transactions ${whereClause}`,
            values
        );
        const total = parseInt(countResult.rows[0].count);
        
        // 获取列表
        values.push(limit, offset);
        const result = await query(
            `SELECT ct.*, 
                    u.nickname as related_nickname, u.avatar as related_avatar
             FROM coin_transactions ct
             LEFT JOIN users u ON ct.related_user_id = u.id
             ${whereClause}
             ORDER BY ct.created_at DESC
             LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
            values
        );
        
        return response.success(res, {
            list: result.rows,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            balance: req.user.coin_balance,
        });
    } catch (error) {
        console.error('Get transactions error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * POST /api/coins/distribute
 * 代理分发金币给用户
 */
router.post('/distribute', auth, async (req, res) => {
    try {
        const { account, amount, distribute_password } = req.body;
        
        // 检查是否是代理
        if (req.user.role !== 'agent' && req.user.role !== 'admin') {
            return response.forbidden(res, '需要代理权限');
        }
        
        if (!account || !amount || !distribute_password) {
            return response.badRequest(res, '请填写完整信息');
        }
        
        const amountNum = parseFloat(amount);
        if (amountNum <= 0) {
            return response.badRequest(res, '金额必须大于0');
        }
        
        // 获取代理信息
        let agentInfo;
        if (req.user.role === 'admin') {
            // 管理员有无限金币
            agentInfo = { coin_pool: Infinity };
        } else {
            const agentResult = await query(
                'SELECT * FROM agents WHERE user_id = $1 AND status = $2',
                [req.user.id, 'active']
            );
            
            if (agentResult.rows.length === 0) {
                return response.notFound(res, '代理信息不存在');
            }
            
            agentInfo = agentResult.rows[0];
        }
        
        // 验证分配密码
        const isValidPassword = await bcrypt.compare(distribute_password, agentInfo.distribute_password_hash);
        if (!isValidPassword) {
            return response.unauthorized(res, '分配密码错误');
        }
        
        // 检查代理金币池余额
        if (agentInfo.coin_pool !== Infinity && parseFloat(agentInfo.coin_pool) < amountNum) {
            return response.insufficientBalance(res, '代理金币池余额不足');
        }
        
        // 查找目标用户
        const targetUser = await query(
            'SELECT id, coin_balance FROM users WHERE account = $1',
            [account]
        );
        
        if (targetUser.rows.length === 0) {
            return response.notFound(res, '目标用户不存在');
        }
        
        const targetId = targetUser.rows[0].id;
        
        // 不能给自己分发
        if (targetId === req.user.id) {
            return response.badRequest(res, '不能给自己分发金币');
        }
        
        // 执行分发
        await transaction(async (client) => {
            if (req.user.role !== 'admin') {
                // 扣除代理金币池
                await client.query(
                    `UPDATE agents SET coin_pool = coin_pool - $1, total_distributed = total_distributed + $1
                     WHERE user_id = $2`,
                    [amountNum, req.user.id]
                );
            }
            
            // 增加用户金币
            await client.query(
                'UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2',
                [amountNum, targetId]
            );
            
            // 获取用户新余额
            const userBalance = await client.query(
                'SELECT coin_balance FROM users WHERE id = $1',
                [targetId]
            );
            
            // 记录金币流水
            await client.query(
                `INSERT INTO coin_transactions (user_id, type, category, amount, balance_after, description)
                 VALUES ($1, 'income', 'distribute', $2, $3, $4)`,
                [targetId, amountNum, userBalance.rows[0].coin_balance, '代理分发']
            );
            
            // 记录分发记录
            await client.query(
                `INSERT INTO coin_distributions (agent_id, from_user_id, to_user_id, amount, distribute_password)
                 VALUES ($1, $2, $3, $4, $5)`,
                [agentInfo.id || null, req.user.id, targetId, amountNum, distribute_password]
            );
            
            return { new_balance: userBalance.rows[0].coin_balance };
        });
        
        return response.success(res, {
            amount: amountNum,
            target_account: account,
        }, '分发成功');
    } catch (error) {
        console.error('Distribute error:', error);
        return response.serverError(res, '分发失败');
    }
});

/**
 * POST /api/coins/admin/allocate
 * 管理员分配金币给代理
 */
router.post('/admin/allocate', auth, adminAuth, async (req, res) => {
    try {
        const { agent_account, amount } = req.body;
        
        if (!agent_account || !amount) {
            return response.badRequest(res, '请填写完整信息');
        }
        
        const amountNum = parseFloat(amount);
        if (amountNum <= 0) {
            return response.badRequest(res, '金额必须大于0');
        }
        
        // 检查管理员余额
        if (parseFloat(req.user.coin_balance) < amountNum) {
            return response.insufficientBalance(res, '余额不足');
        }
        
        // 查找代理
        const agentResult = await query(
            `SELECT a.*, u.id as user_id FROM agents a
             JOIN users u ON a.user_id = u.id
             WHERE u.account = $1`,
            [agent_account]
        );
        
        if (agentResult.rows.length === 0) {
            return response.notFound(res, '代理不存在');
        }
        
        const agent = agentResult.rows[0];
        
        // 执行分配
        await transaction(async (client) => {
            // 扣除管理员金币
            await client.query(
                'UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2',
                [amountNum, req.user.id]
            );
            
            // 增加代理金币池
            await client.query(
                'UPDATE agents SET coin_pool = coin_pool + $1 WHERE user_id = $2',
                [amountNum, agent.user_id]
            );
            
            // 记录管理员金币流水
            await client.query(
                `INSERT INTO coin_transactions (user_id, type, category, amount, balance_after, related_user_id, description)
                 VALUES ($1, 'expense', 'allocate', $2, $3, $4, $5)`,
                [req.user.id, amountNum, parseFloat(req.user.coin_balance) - amountNum, agent.user_id, `分配金币给代理 ${agent_account}`]
            );
            
            // 记录分发记录
            await client.query(
                `INSERT INTO coin_distributions (agent_id, from_user_id, to_user_id, amount)
                 VALUES ($1, $2, $3, $4)`,
                [agent.id, req.user.id, agent.user_id, amountNum]
            );
        });
        
        return response.success(res, {
            amount: amountNum,
            agent_account,
        }, '分配成功');
    } catch (error) {
        console.error('Admin allocate error:', error);
        return response.serverError(res, '分配失败');
    }
});

/**
 * GET /api/coins/distributions
 * 获取金币分发记录（代理或管理员）
 */
router.get('/distributions', auth, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        
        let whereClause = '';
        const values = [];
        let paramCount = 1;
        
        if (req.user.role === 'agent') {
            // 代理只能看自己的分发记录
            const agentResult = await query(
                'SELECT id FROM agents WHERE user_id = $1',
                [req.user.id]
            );
            
            if (agentResult.rows.length === 0) {
                return response.notFound(res, '代理信息不存在');
            }
            
            whereClause = `WHERE cd.agent_id = $${paramCount++}`;
            values.push(agentResult.rows[0].id);
        } else if (req.user.role !== 'admin') {
            return response.forbidden(res, '无权查看');
        }
        
        // 获取总数
        const countResult = await query(
            `SELECT COUNT(*) FROM coin_distributions cd ${whereClause}`,
            values
        );
        const total = parseInt(countResult.rows[0].count);
        
        // 获取列表
        values.push(limit, offset);
        const result = await query(
            `SELECT cd.*,
                    u_from.account as from_account, u_from.nickname as from_nickname,
                    u_to.account as to_account, u_to.nickname as to_nickname
             FROM coin_distributions cd
             LEFT JOIN users u_from ON cd.from_user_id = u_from.id
             LEFT JOIN users u_to ON cd.to_user_id = u_to.id
             ${whereClause}
             ORDER BY cd.created_at DESC
             LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
            values
        );
        
        return response.success(res, {
            list: result.rows,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
        });
    } catch (error) {
        console.error('Get distributions error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * PUT /api/agents/password
 * 修改分配密码
 */
router.put('/agents/password', auth, async (req, res) => {
    try {
        const { old_password, new_password } = req.body;
        
        if (req.user.role !== 'agent' && req.user.role !== 'admin') {
            return response.forbidden(res, '需要代理权限');
        }
        
        if (!old_password || !new_password) {
            return response.badRequest(res, '请填写完整信息');
        }
        
        if (new_password.length < 6) {
            return response.badRequest(res, '新密码长度不能少于6位');
        }
        
        // 获取代理信息
        const agentResult = await query(
            'SELECT * FROM agents WHERE user_id = $1',
            [req.user.id]
        );
        
        if (agentResult.rows.length === 0) {
            return response.notFound(res, '代理信息不存在');
        }
        
        // 验证旧密码
        const isValid = await bcrypt.compare(old_password, agentResult.rows[0].distribute_password_hash);
        if (!isValid) {
            return response.unauthorized(res, '原密码错误');
        }
        
        // 更新密码
        const newHash = await bcrypt.hash(new_password, 10);
        await query(
            'UPDATE agents SET distribute_password_hash = $1 WHERE user_id = $2',
            [newHash, req.user.id]
        );
        
        return response.success(res, null, '密码修改成功');
    } catch (error) {
        console.error('Update password error:', error);
        return response.serverError(res, '修改失败');
    }
});

module.exports = router;
