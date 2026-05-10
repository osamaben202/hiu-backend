/**
 * 1对1聊天路由
 */
const express = require('express');
const { query, transaction } = require('../models/db');
const { auth } = require('../middleware/auth');
const response = require('../utils/response');
const { generateAgoraToken } = require('../services/agoraService');

const router = express.Router();

/**
 * GET /api/chat/conversations
 * 获取会话列表
 */
router.get('/conversations', auth, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        
        // 获取与当前用户有聊天的用户列表
        const result = await query(
            `SELECT DISTINCT ON (other_user_id) 
                    other_user_id,
                    pm.id as last_message_id,
                    pm.type as last_message_type,
                    pm.content as last_message_content,
                    pm.created_at as last_message_time,
                    pm.is_read,
                    u.nickname, u.avatar, u.gender, u.role
             FROM (
                 SELECT receiver_id as other_user_id, id, type, content, created_at, is_read
                 FROM private_messages WHERE sender_id = $1
                 UNION ALL
                 SELECT sender_id as other_user_id, id, type, content, created_at, is_read
                 FROM private_messages WHERE receiver_id = $1
             ) pm
             JOIN users u ON pm.other_user_id = u.id
             ORDER BY other_user_id, pm.created_at DESC`,
            [req.user.id]
        );
        
        // 获取每个会话的未读数
        const conversations = await Promise.all(
            result.rows.map(async (conv) => {
                const unreadResult = await query(
                    `SELECT COUNT(*) FROM private_messages 
                     WHERE sender_id = $1 AND receiver_id = $2 AND is_read = false`,
                    [conv.other_user_id, req.user.id]
                );
                return {
                    user_id: conv.other_user_id,
                    nickname: conv.nickname,
                    avatar: conv.avatar,
                    gender: conv.gender,
                    role: conv.role,
                    last_message: {
                        id: conv.last_message_id,
                        type: conv.last_message_type,
                        content: conv.last_message_content,
                        created_at: conv.last_message_time,
                    },
                    unread_count: parseInt(unreadResult.rows[0].count),
                };
            })
        );
        
        // 按最后消息时间排序
        conversations.sort((a, b) => 
            new Date(b.last_message?.created_at || 0) - new Date(a.last_message?.created_at || 0)
        );
        
        return response.success(res, {
            list: conversations,
            total: conversations.length,
        });
    } catch (error) {
        console.error('Get conversations error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * GET /api/chat/messages/:userId
 * 获取与某个用户的聊天记录
 */
router.get('/messages/:userId', auth, async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;
        
        // 检查对方是否存在
        const userCheck = await query(
            'SELECT id, nickname, avatar, gender FROM users WHERE id = $1 AND is_banned = false',
            [userId]
        );
        
        if (userCheck.rows.length === 0) {
            return response.notFound(res, '用户不存在');
        }
        
        // 获取消息
        const result = await query(
            `SELECT pm.*, 
                    sender.nickname as sender_nickname, sender.avatar as sender_avatar,
                    receiver.nickname as receiver_nickname, receiver.avatar as receiver_avatar
             FROM private_messages pm
             LEFT JOIN users sender ON pm.sender_id = sender.id
             LEFT JOIN users receiver ON pm.receiver_id = receiver.id
             WHERE (pm.sender_id = $1 AND pm.receiver_id = $2)
                OR (pm.sender_id = $2 AND pm.receiver_id = $1)
             ORDER BY pm.created_at DESC
             LIMIT $3 OFFSET $4`,
            [req.user.id, userId, limit, offset]
        );
        
        // 标记已读
        await query(
            `UPDATE private_messages SET is_read = true
             WHERE sender_id = $1 AND receiver_id = $2 AND is_read = false`,
            [userId, req.user.id]
        );
        
        return response.success(res, {
            list: result.rows.reverse(), // 按时间正序返回
            user: userCheck.rows[0],
        });
    } catch (error) {
        console.error('Get messages error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * POST /api/chat/send
 * 发送消息
 */
router.post('/send', auth, async (req, res) => {
    try {
        const { receiver_id, type, content } = req.body;
        
        if (!receiver_id || !content) {
            return response.badRequest(res, '请填写完整信息');
        }
        
        if (!['text', 'image'].includes(type)) {
            return response.badRequest(res, '消息类型不正确');
        }
        
        // 检查接收者
        const receiverCheck = await query(
            'SELECT id, gender, role, nickname, text_price, image_price FROM users WHERE id = $1 AND is_banned = false',
            [receiver_id]
        );
        
        if (receiverCheck.rows.length === 0) {
            return response.notFound(res, '接收者不存在');
        }
        
        const receiver = receiverCheck.rows[0];
        
        // 不能给自己发消息
        if (receiver_id === req.user.id) {
            return response.badRequest(res, '不能给自己发消息');
        }
        
        let cost = 0;
        let diamondEarned = 0;
        
        // 判断是否需要收费：男性用户发给女性用户时收费
        if (req.user.gender === 'male' && receiver.gender === 'female') {
            if (type === 'text') {
                cost = parseFloat(receiver.text_price) || 1;
            } else if (type === 'image') {
                cost = parseFloat(receiver.image_price) || 5;
            }
            
            // 检查余额
            if (parseFloat(req.user.coin_balance) < cost) {
                return response.insufficientBalance(res, `金币余额不足，需要${cost}金币`);
            }
            
            diamondEarned = cost;
        }
        
        // 发送消息
        const message = await transaction(async (client) => {
            if (cost > 0) {
                // 扣除发送者金币
                await client.query(
                    'UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2',
                    [cost, req.user.id]
                );
                
                // 获取发送者新余额
                const senderBalance = await client.query(
                    'SELECT coin_balance FROM users WHERE id = $1',
                    [req.user.id]
                );
                
                // 记录发送者金币流水
                await client.query(
                    `INSERT INTO coin_transactions (user_id, type, category, amount, balance_after, related_user_id, description)
                     VALUES ($1, 'expense', $2, $3, $4, $5, $6)`,
                    [req.user.id, type === 'text' ? 'text_chat' : 'image_chat', cost, senderBalance.rows[0].coin_balance, receiver_id, `发送${type === 'text' ? '文字' : '图片'}消息`]
                );
                
                // 增加接收者钻石
                await client.query(
                    'UPDATE users SET diamond_balance = diamond_balance + $1 WHERE id = $2',
                    [diamondEarned, receiver_id]
                );
                
                // 获取接收者新余额
                const receiverBalance = await client.query(
                    'SELECT diamond_balance FROM users WHERE id = $1',
                    [receiver_id]
                );
                
                // 记录接收者钻石流水
                await client.query(
                    `INSERT INTO diamond_transactions (user_id, type, category, amount, balance_after, related_user_id, description)
                     VALUES ($1, 'income', $2, $3, $4, $5, $6)`,
                    [receiver_id, type === 'text' ? 'text_chat' : 'image_chat', diamondEarned, receiverBalance.rows[0].diamond_balance, req.user.id, `收到${type === 'text' ? '文字' : '图片'}消息`]
                );
            }
            
            // 创建消息
            const msgResult = await client.query(
                `INSERT INTO private_messages (sender_id, receiver_id, type, content, cost_coins)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [req.user.id, receiver_id, type, content, cost]
            );
            
            return msgResult.rows[0];
        });
        
        return response.success(res, {
            message: {
                id: message.id,
                type: message.type,
                content: message.content,
                created_at: message.created_at,
            },
            cost,
            sender_coin_balance: parseFloat(req.user.coin_balance) - cost,
        }, '发送成功');
    } catch (error) {
        console.error('Send message error:', error);
        return response.serverError(res, '发送失败');
    }
});

/**
 * GET /api/chat/pricing/:userId
 * 获取用户定价
 */
router.get('/pricing/:userId', auth, async (req, res) => {
    try {
        const { userId } = req.params;
        
        const result = await query(
            'SELECT id, text_price, image_price, video_price FROM users WHERE id = $1 AND gender = $2',
            [userId, 'female']
        );
        
        if (result.rows.length === 0) {
            return response.notFound(res, '该用户未设置聊天定价');
        }
        
        return response.success(res, result.rows[0]);
    } catch (error) {
        console.error('Get pricing error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * PUT /api/chat/messages/read/:userId
 * 标记消息为已读
 */
router.put('/messages/read/:userId', auth, async (req, res) => {
    try {
        const { userId } = req.params;
        
        await query(
            `UPDATE private_messages SET is_read = true
             WHERE sender_id = $1 AND receiver_id = $2 AND is_read = false`,
            [userId, req.user.id]
        );
        
        return response.success(res, null, '已标记为已读');
    } catch (error) {
        console.error('Mark read error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * GET /api/chat/unread
 * 获取未读消息数
 */
router.get('/unread', auth, async (req, res) => {
    try {
        const result = await query(
            'SELECT COUNT(*) FROM private_messages WHERE receiver_id = $1 AND is_read = false',
            [req.user.id]
        );
        
        return response.success(res, {
            unread_count: parseInt(result.rows[0].count),
        });
    } catch (error) {
        console.error('Get unread error:', error);
        return response.serverError(res, '获取失败');
    }
});

module.exports = router;
