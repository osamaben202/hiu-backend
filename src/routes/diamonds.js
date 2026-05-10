/**
 * 钻石路由
 */
const express = require('express');
const { query, transaction } = require('../models/db');
const { auth, adminAuth } = require('../middleware/auth');
const response = require('../utils/response');

const router = express.Router();

/**
 * GET /api/diamonds/balance
 * 获取钻石余额
 */
router.get('/balance', auth, async (req, res) => {
    try {
        const result = await query(
            'SELECT diamond_balance FROM users WHERE id = $1',
            [req.user.id]
        );
        
        return response.success(res, {
            diamond_balance: result.rows[0].diamond_balance,
        });
    } catch (error) {
        console.error('Get balance error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * GET /api/diamonds/transactions
 * 获取钻石流水
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
            `SELECT COUNT(*) FROM diamond_transactions ${whereClause}`,
            values
        );
        const total = parseInt(countResult.rows[0].count);
        
        // 获取列表
        values.push(limit, offset);
        const result = await query(
            `SELECT dt.*,
                    u.nickname as related_nickname, u.avatar as related_avatar
             FROM diamond_transactions dt
             LEFT JOIN users u ON dt.related_user_id = u.id
             ${whereClause}
             ORDER BY dt.created_at DESC
             LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
            values
        );
        
        return response.success(res, {
            list: result.rows,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            balance: req.user.diamond_balance,
        });
    } catch (error) {
        console.error('Get transactions error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * GET /api/diamonds/withdraw/rate
 * 获取提现汇率
 */
router.get('/withdraw/rate', auth, async (req, res) => {
    try {
        const result = await query(
            `SELECT value FROM system_config WHERE key = 'withdraw_exchange_rate'`
        );
        
        const rate = result.rows.length > 0 ? parseInt(result.rows[0].value) : 10000;
        
        return response.success(res, {
            exchange_rate: rate,
            description: `${rate} 钻石 = 1 USD`,
        });
    } catch (error) {
        console.error('Get rate error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * GET /api/diamonds/withdraw/min
 * 获取最小提现额
 */
router.get('/withdraw/min', auth, async (req, res) => {
    try {
        const result = await query(
            `SELECT value FROM system_config WHERE key = 'min_withdraw_amount'`
        );
        
        const minAmount = result.rows.length > 0 ? parseInt(result.rows[0].value) : 1000;
        
        return response.success(res, {
            min_withdraw_amount: minAmount,
        });
    } catch (error) {
        console.error('Get min amount error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * POST /api/diamonds/withdraw
 * 申请提现
 */
router.post('/withdraw', auth, async (req, res) => {
    try {
        const { amount, payment_method, payment_address } = req.body;
        
        if (!amount || !payment_address) {
            return response.badRequest(res, '请填写完整信息');
        }
        
        const amountNum = parseFloat(amount);
        
        // 获取提现汇率
        const rateResult = await query(
            `SELECT value FROM system_config WHERE key = 'withdraw_exchange_rate'`
        );
        const exchangeRate = rateResult.rows.length > 0 ? parseInt(rateResult.rows[0].value) : 10000;
        
        // 获取最小提现额
        const minResult = await query(
            `SELECT value FROM system_config WHERE key = 'min_withdraw_amount'`
        );
        const minAmount = minResult.rows.length > 0 ? parseInt(minResult.rows[0].value) : 1000;
        
        if (amountNum < minAmount) {
            return response.badRequest(res, `最小提现金额为${minAmount}钻石`);
        }
        
        // 检查余额
        if (parseFloat(req.user.diamond_balance) < amountNum) {
            return response.insufficientBalance(res, '钻石余额不足');
        }
        
        // 计算USD金额
        const usdtAmount = amountNum / exchangeRate;
        
        // 检查是否有待处理的提现申请
        const pendingCheck = await query(
            `SELECT id FROM withdraw_requests 
             WHERE user_id = $1 AND status = 'pending'`,
            [req.user.id]
        );
        
        if (pendingCheck.rows.length > 0) {
            return response.badRequest(res, '您有待处理的提现申请，请等待处理完成');
        }
        
        // 创建提现申请
        await transaction(async (client) => {
            // 冻结钻石
            await client.query(
                'UPDATE users SET diamond_balance = diamond_balance - $1 WHERE id = $2',
                [amountNum, req.user.id]
            );
            
            // 获取新余额
            const balanceResult = await client.query(
                'SELECT diamond_balance FROM users WHERE id = $1',
                [req.user.id]
            );
            
            // 记录流水
            await client.query(
                `INSERT INTO diamond_transactions (user_id, type, category, amount, balance_after, description)
                 VALUES ($1, 'withdraw', 'withdraw', $2, $3, $4)`,
                [req.user.id, -amountNum, balanceResult.rows[0].diamond_balance, `申请提现 ${usdtAmount} USD`]
            );
            
            // 创建提现申请
            await client.query(
                `INSERT INTO withdraw_requests (user_id, amount, exchange_rate, usdt_amount, payment_method, payment_address)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [req.user.id, amountNum, exchangeRate, usdtAmount, payment_method || 'usdt', payment_address]
            );
        });
        
        return response.success(res, {
            amount: amountNum,
            usdt_amount: usdtAmount,
            exchange_rate: exchangeRate,
        }, '提现申请已提交');
    } catch (error) {
        console.error('Withdraw error:', error);
        return response.serverError(res, '提现失败');
    }
});

/**
 * GET /api/diamonds/withdraw/requests
 * 获取我的提现记录
 */
router.get('/withdraw/requests', auth, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        
        const countResult = await query(
            'SELECT COUNT(*) FROM withdraw_requests WHERE user_id = $1',
            [req.user.id]
        );
        const total = parseInt(countResult.rows[0].count);
        
        const result = await query(
            `SELECT * FROM withdraw_requests
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [req.user.id, limit, offset]
        );
        
        return response.success(res, {
            list: result.rows,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
        });
    } catch (error) {
        console.error('Get withdraw requests error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * GET /api/diamonds/withdraw/all
 * 获取所有提现申请（管理员）
 */
router.get('/withdraw/all', auth, adminAuth, async (req, res) => {
    try {
        const { page = 1, limit = 20, status } = req.query;
        const offset = (page - 1) * limit;
        
        let whereClause = '';
        const values = [];
        let paramCount = 1;
        
        if (status) {
            whereClause = `WHERE wr.status = $${paramCount++}`;
            values.push(status);
        }
        
        const countResult = await query(
            `SELECT COUNT(*) FROM withdraw_requests wr ${whereClause}`,
            values
        );
        const total = parseInt(countResult.rows[0].count);
        
        values.push(limit, offset);
        const result = await query(
            `SELECT wr.*, u.account, u.nickname, u.avatar
             FROM withdraw_requests wr
             LEFT JOIN users u ON wr.user_id = u.id
             ${whereClause}
             ORDER BY wr.created_at DESC
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
        console.error('Get all withdraw requests error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * PUT /api/diamonds/withdraw/:requestId/approve
 * 审核通过提现（管理员）
 */
router.put('/withdraw/:requestId/approve', auth, adminAuth, async (req, res) => {
    try {
        const { requestId } = req.params;
        const { admin_note } = req.body;
        
        // 检查申请状态
        const requestCheck = await query(
            'SELECT * FROM withdraw_requests WHERE id = $1',
            [requestId]
        );
        
        if (requestCheck.rows.length === 0) {
            return response.notFound(res, '提现申请不存在');
        }
        
        const request = requestCheck.rows[0];
        
        if (request.status !== 'pending') {
            return response.badRequest(res, '该申请已处理');
        }
        
        // 更新状态
        await query(
            `UPDATE withdraw_requests 
             SET status = 'approved', admin_note = $1, processed_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [admin_note || '', requestId]
        );
        
        return response.success(res, null, '已通过提现申请');
    } catch (error) {
        console.error('Approve withdraw error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * PUT /api/diamonds/withdraw/:requestId/reject
 * 审核拒绝提现（管理员）
 */
router.put('/withdraw/:requestId/reject', auth, adminAuth, async (req, res) => {
    try {
        const { requestId } = req.params;
        const { admin_note } = req.body;
        
        // 检查申请状态
        const requestCheck = await query(
            'SELECT * FROM withdraw_requests WHERE id = $1',
            [requestId]
        );
        
        if (requestCheck.rows.length === 0) {
            return response.notFound(res, '提现申请不存在');
        }
        
        const request = requestCheck.rows[0];
        
        if (request.status !== 'pending') {
            return response.badRequest(res, '该申请已处理');
        }
        
        // 退还钻石
        await transaction(async (client) => {
            await client.query(
                'UPDATE users SET diamond_balance = diamond_balance + $1 WHERE id = $2',
                [request.amount, request.user_id]
            );
            
            // 获取新余额
            const balanceResult = await client.query(
                'SELECT diamond_balance FROM users WHERE id = $1',
                [request.user_id]
            );
            
            // 记录流水
            await client.query(
                `INSERT INTO diamond_transactions (user_id, type, category, amount, balance_after, description)
                 VALUES ($1, 'income', 'refund', $2, $3, $4)`,
                [request.user_id, request.amount, balanceResult.rows[0].diamond_balance, `提现被拒绝，退还钻石`]
            );
            
            // 更新申请状态
            await client.query(
                `UPDATE withdraw_requests 
                 SET status = 'rejected', admin_note = $1, processed_at = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [admin_note || '', requestId]
            );
        });
        
        return response.success(res, null, '已拒绝提现申请，钻石已退还');
    } catch (error) {
        console.error('Reject withdraw error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * PUT /api/diamonds/clear/:userId
 * 清除用户钻石余额（管理员）
 */
router.put('/clear/:userId', auth, adminAuth, async (req, res) => {
    try {
        const { userId } = req.params;
        const { amount, reason } = req.body;
        
        const clearAmount = parseFloat(amount) || 0;
        
        if (clearAmount <= 0) {
            return response.badRequest(res, '清除金额必须大于0');
        }
        
        // 获取用户当前余额
        const userResult = await query(
            'SELECT diamond_balance FROM users WHERE id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return response.notFound(res, '用户不存在');
        }
        
        const currentBalance = parseFloat(userResult.rows[0].diamond_balance);
        const actualClear = Math.min(clearAmount, currentBalance);
        
        // 清除钻石
        await transaction(async (client) => {
            await client.query(
                'UPDATE users SET diamond_balance = diamond_balance - $1 WHERE id = $2',
                [actualClear, userId]
            );
            
            // 获取新余额
            const balanceResult = await client.query(
                'SELECT diamond_balance FROM users WHERE id = $1',
                [userId]
            );
            
            // 记录流水
            await client.query(
                `INSERT INTO diamond_transactions (user_id, type, category, amount, balance_after, description)
                 VALUES ($1, 'deduct', 'deduct', $2, $3, $4)`,
                [userId, -actualClear, balanceResult.rows[0].diamond_balance, `管理员清除钻石: ${reason || ''}`]
            );
        });
        
        return response.success(res, {
            cleared_amount: actualClear,
            remaining_balance: currentBalance - actualClear,
        }, '钻石已清除');
    } catch (error) {
        console.error('Clear diamonds error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * PUT /api/diamonds/config/rate
 * 设置提现汇率（管理员）
 */
router.put('/config/rate', auth, adminAuth, async (req, res) => {
    try {
        const { rate } = req.body;
        
        if (!rate || rate < 1) {
            return response.badRequest(res, '汇率必须大于等于1');
        }
        
        await query(
            `INSERT INTO system_config (key, value, description)
             VALUES ('withdraw_exchange_rate', $1, '提现汇率：X钻石 = 1 USD')
             ON CONFLICT (key) DO UPDATE SET value = $1`,
            [rate.toString()]
        );
        
        return response.success(res, {
            exchange_rate: rate,
        }, '汇率设置成功');
    } catch (error) {
        console.error('Set rate error:', error);
        return response.serverError(res, '设置失败');
    }
});

/**
 * PUT /api/diamonds/config/min
 * 设置最小提现额（管理员）
 */
router.put('/config/min', auth, adminAuth, async (req, res) => {
    try {
        const { min } = req.body;
        
        if (!min || min < 0) {
            return response.badRequest(res, '最小提现额必须大于等于0');
        }
        
        await query(
            `INSERT INTO system_config (key, value, description)
             VALUES ('min_withdraw_amount', $1, '最小提现钻石数量')
             ON CONFLICT (key) DO UPDATE SET value = $1`,
            [min.toString()]
        );
        
        return response.success(res, {
            min_withdraw_amount: min,
        }, '最小提现额设置成功');
    } catch (error) {
        console.error('Set min amount error:', error);
        return response.serverError(res, '设置失败');
    }
});

module.exports = router;
