/**
 * 礼物路由
 */
const express = require('express');
const { query, transaction } = require('../models/db');
const { auth } = require('../middleware/auth');
const response = require('../utils/response');

const router = express.Router();

/**
 * GET /api/gifts
 * 获取礼物列表
 */
router.get('/', auth, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, name, name_en, icon, animation, price
             FROM gifts WHERE is_active = true
             ORDER BY price ASC`
        );
        
        return response.success(res, result.rows);
    } catch (error) {
        console.error('Get gifts error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * POST /api/gifts
 * 创建礼物（管理员）
 */
router.post('/', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return response.forbidden(res, '需要管理员权限');
        }
        
        const { name, name_en, icon, animation, price } = req.body;
        
        if (!name || !price) {
            return response.badRequest(res, '礼物名称和价格不能为空');
        }
        
        if (price < 1) {
            return response.badRequest(res, '价格不能小于1');
        }
        
        const result = await query(
            `INSERT INTO gifts (name, name_en, icon, animation, price)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [name, name_en || name, icon || '', animation || '', price]
        );
        
        return response.created(res, result.rows[0], '创建成功');
    } catch (error) {
        console.error('Create gift error:', error);
        return response.serverError(res, '创建失败');
    }
});

/**
 * PUT /api/gifts/:giftId
 * 更新礼物（管理员）
 */
router.put('/:giftId', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return response.forbidden(res, '需要管理员权限');
        }
        
        const { giftId } = req.params;
        const { name, name_en, icon, animation, price, is_active } = req.body;
        
        const updates = [];
        const values = [];
        let paramCount = 1;
        
        if (name !== undefined) {
            updates.push(`name = $${paramCount++}`);
            values.push(name);
        }
        if (name_en !== undefined) {
            updates.push(`name_en = $${paramCount++}`);
            values.push(name_en);
        }
        if (icon !== undefined) {
            updates.push(`icon = $${paramCount++}`);
            values.push(icon);
        }
        if (animation !== undefined) {
            updates.push(`animation = $${paramCount++}`);
            values.push(animation);
        }
        if (price !== undefined) {
            if (price < 1) {
                return response.badRequest(res, '价格不能小于1');
            }
            updates.push(`price = $${paramCount++}`);
            values.push(price);
        }
        if (is_active !== undefined) {
            updates.push(`is_active = $${paramCount++}`);
            values.push(is_active);
        }
        
        if (updates.length === 0) {
            return response.badRequest(res, '没有需要更新的字段');
        }
        
        values.push(giftId);
        
        const result = await query(
            `UPDATE gifts SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
             WHERE id = $${paramCount}
             RETURNING *`,
            values
        );
        
        if (result.rows.length === 0) {
            return response.notFound(res, '礼物不存在');
        }
        
        return response.success(res, result.rows[0], '更新成功');
    } catch (error) {
        console.error('Update gift error:', error);
        return response.serverError(res, '更新失败');
    }
});

/**
 * DELETE /api/gifts/:giftId
 * 删除礼物（管理员）
 */
router.delete('/:giftId', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return response.forbidden(res, '需要管理员权限');
        }
        
        const { giftId } = req.params;
        
        const result = await query(
            'DELETE FROM gifts WHERE id = $1 RETURNING id',
            [giftId]
        );
        
        if (result.rows.length === 0) {
            return response.notFound(res, '礼物不存在');
        }
        
        return response.success(res, null, '删除成功');
    } catch (error) {
        console.error('Delete gift error:', error);
        return response.serverError(res, '删除失败');
    }
});

/**
 * POST /api/gifts/:giftId/send
 * 发送礼物
 */
router.post('/:giftId/send', auth, async (req, res) => {
    try {
        const { giftId } = req.params;
        const { room_id, receiver_id, count } = req.body;
        const sendCount = Math.max(1, parseInt(count) || 1);
        
        // 获取礼物信息
        const giftResult = await query(
            'SELECT * FROM gifts WHERE id = $1 AND is_active = true',
            [giftId]
        );
        
        if (giftResult.rows.length === 0) {
            return response.notFound(res, '礼物不存在');
        }
        
        const gift = giftResult.rows[0];
        const totalCoins = gift.price * sendCount;
        const totalDiamonds = totalCoins; // 1金币 = 1钻石
        
        // 检查发送者余额
        if (parseFloat(req.user.coin_balance) < totalCoins) {
            return response.insufficientBalance(res, '金币余额不足');
        }
        
        // 检查接收者是否存在
        if (!receiver_id) {
            return response.badRequest(res, '请选择接收者');
        }
        
        const receiverResult = await query(
            'SELECT id, role FROM users WHERE id = $1 AND is_banned = false',
            [receiver_id]
        );
        
        if (receiverResult.rows.length === 0) {
            return response.notFound(res, '接收者不存在');
        }
        
        const receiver = receiverResult.rows[0];
        
        // 执行转账
        await transaction(async (client) => {
            // 扣除发送者金币
            const senderUpdate = await client.query(
                `UPDATE users SET coin_balance = coin_balance - $1
                 WHERE id = $2 AND coin_balance >= $1
                 RETURNING coin_balance`,
                [totalCoins, req.user.id]
            );
            
            if (senderUpdate.rows.length === 0) {
                throw new Error('余额不足');
            }
            
            const senderBalanceAfter = senderUpdate.rows[0].coin_balance;
            
            // 增加接收者钻石
            await client.query(
                `UPDATE users SET diamond_balance = diamond_balance + $1
                 WHERE id = $2`,
                [totalDiamonds, receiver_id]
            );
            
            // 获取接收者新钻石余额
            const receiverBalance = await client.query(
                'SELECT diamond_balance FROM users WHERE id = $1',
                [receiver_id]
            );
            
            // 记录礼物
            await client.query(
                `INSERT INTO gift_records (gift_id, sender_id, receiver_id, room_id, count, total_coins, total_diamonds)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [giftId, req.user.id, receiver_id, room_id || null, sendCount, totalCoins, totalDiamonds]
            );
            
            // 记录发送者金币流水
            await client.query(
                `INSERT INTO coin_transactions (user_id, type, category, amount, balance_after, related_user_id, related_room_id, description)
                 VALUES ($1, 'expense', 'gift', $2, $3, $4, $5, $6)`,
                [req.user.id, totalCoins, senderBalanceAfter, receiver_id, room_id, `赠送${gift.name}x${sendCount}`]
            );
            
            // 记录接收者钻石流水
            await client.query(
                `INSERT INTO diamond_transactions (user_id, type, category, amount, balance_after, related_user_id, description)
                 VALUES ($1, 'income', 'gift', $2, $3, $4, $5)`,
                [receiver_id, totalDiamonds, receiverBalance.rows[0].diamond_balance, req.user.id, `收到${gift.name}x${sendCount}`]
            );
            
            return { sender_balance: senderBalanceAfter };
        });
        
        return response.success(res, {
            gift: {
                id: gift.id,
                name: gift.name,
                icon: gift.icon,
            },
            count: sendCount,
            total_coins: totalCoins,
            sender_coin_balance: parseFloat(req.user.coin_balance) - totalCoins,
        }, '送礼成功');
    } catch (error) {
        console.error('Send gift error:', error);
        if (error.message === '余额不足') {
            return response.insufficientBalance(res, '金币余额不足');
        }
        return response.serverError(res, '送礼失败');
    }
});

/**
 * GET /api/gifts/records
 * 获取礼物记录
 */
router.get('/records', auth, async (req, res) => {
    try {
        const { page = 1, limit = 20, type } = req.query;
        const offset = (page - 1) * limit;
        
        let whereClause = '';
        const values = [req.user.id];
        let paramCount = 2;
        
        if (type === 'sent') {
            whereClause = 'WHERE gr.sender_id = $1';
        } else if (type === 'received') {
            whereClause = 'WHERE gr.receiver_id = $1';
        } else {
            whereClause = 'WHERE (gr.sender_id = $1 OR gr.receiver_id = $1)';
        }
        
        // 获取总数
        const countResult = await query(
            `SELECT COUNT(*) FROM gift_records gr ${whereClause}`,
            values
        );
        const total = parseInt(countResult.rows[0].count);
        
        // 获取列表
        values.push(limit, offset);
        const result = await query(
            `SELECT gr.*, 
                    g.name as gift_name, g.icon as gift_icon, g.price as gift_price,
                    su.nickname as sender_nickname, su.avatar as sender_avatar,
                    ru.nickname as receiver_nickname, ru.avatar as receiver_avatar,
                    r.name as room_name
             FROM gift_records gr
             LEFT JOIN gifts g ON gr.gift_id = g.id
             LEFT JOIN users su ON gr.sender_id = su.id
             LEFT JOIN users ru ON gr.receiver_id = ru.id
             LEFT JOIN rooms r ON gr.room_id = r.id
             ${whereClause}
             ORDER BY gr.created_at DESC
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
        console.error('Get gift records error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * GET /api/gifts/records/room/:roomId
 * 获取房间礼物记录
 */
router.get('/records/room/:roomId', auth, async (req, res) => {
    try {
        const { roomId } = req.params;
        const { limit = 50 } = req.query;
        
        const result = await query(
            `SELECT gr.*, 
                    g.name as gift_name, g.icon as gift_icon,
                    su.nickname as sender_nickname, su.avatar as sender_avatar,
                    ru.nickname as receiver_nickname, ru.avatar as receiver_avatar
             FROM gift_records gr
             LEFT JOIN gifts g ON gr.gift_id = g.id
             LEFT JOIN users su ON gr.sender_id = su.id
             LEFT JOIN users ru ON gr.receiver_id = ru.id
             WHERE gr.room_id = $1
             ORDER BY gr.created_at DESC
             LIMIT $2`,
            [roomId, limit]
        );
        
        return response.success(res, result.rows);
    } catch (error) {
        console.error('Get room gift records error:', error);
        return response.serverError(res, '获取失败');
    }
});

module.exports = router;
