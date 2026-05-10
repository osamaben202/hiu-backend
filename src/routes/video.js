/**
 * 视频通话路由
 */
const express = require('express');
const { query, transaction } = require('../models/db');
const { auth, adminAuth } = require('../middleware/auth');
const response = require('../utils/response');
const { generateAgoraToken } = require('../services/agoraService');

const router = express.Router();

// 视频通话价格缓存（每分钟价格）
let videoCallPrice = 10;

/**
 * POST /api/video/call
 * 发起视频通话
 */
router.post('/call', auth, async (req, res) => {
    try {
        const { receiver_id } = req.body;
        
        if (!receiver_id) {
            return response.badRequest(res, '请选择通话对象');
        }
        
        if (receiver_id === req.user.id) {
            return response.badRequest(res, '不能给自己打电话');
        }
        
        // 检查接收者
        const receiverCheck = await query(
            'SELECT id, nickname, avatar, gender, is_banned FROM users WHERE id = $1',
            [receiver_id]
        );
        
        if (receiverCheck.rows.length === 0) {
            return response.notFound(res, '用户不存在');
        }
        
        if (receiverCheck.rows[0].is_banned) {
            return response.forbidden(res, '对方账号已被禁用');
        }
        
        const receiver = receiverCheck.rows[0];
        
        // 检查是否有正在进行的通话
        const existingCall = await query(
            `SELECT id FROM video_calls 
             WHERE ((caller_id = $1 AND receiver_id = $2) OR (caller_id = $2 AND receiver_id = $1))
             AND status IN ('calling', 'accepted')`,
            [req.user.id, receiver_id]
        );
        
        if (existingCall.rows.length > 0) {
            return response.badRequest(res, '已有进行中的通话');
        }
        
        // 获取通话价格
        let pricePerMinute = videoCallPrice;
        if (req.user.gender === 'male' && receiver.gender === 'female') {
            pricePerMinute = parseFloat(receiver.video_price) || videoCallPrice;
        }
        
        // 预估1分钟费用，检查余额
        if (req.user.gender === 'male' && receiver.gender === 'female') {
            if (parseFloat(req.user.coin_balance) < pricePerMinute) {
                return response.insufficientBalance(res, `金币余额不足，需要${pricePerMinute}金币/分钟`);
            }
        }
        
        // 生成频道名
        const channelName = `video_${req.user.id}_${receiver_id}_${Date.now()}`;
        
        // 创建通话记录
        const callResult = await query(
            `INSERT INTO video_calls (caller_id, receiver_id, channel_name, status, total_cost)
             VALUES ($1, $2, $3, 'calling', 0)
             RETURNING *`,
            [req.user.id, receiver_id, channelName]
        );
        
        const call = callResult.rows[0];
        
        // 生成声网Token
        const callerToken = await generateAgoraToken(channelName, req.user.id, req.user.nickname || req.user.account);
        const receiverToken = await generateAgoraToken(channelName, receiver_id, receiver.nickname || receiver.account);
        
        return response.success(res, {
            call_id: call.id,
            channel_name: channelName,
            caller_token: callerToken,
            receiver_token: receiverToken,
            receiver: {
                id: receiver.id,
                nickname: receiver.nickname,
                avatar: receiver.avatar,
            },
            price_per_minute: pricePerMinute,
            is_charged: req.user.gender === 'male' && receiver.gender === 'female',
        }, '通话已发起');
    } catch (error) {
        console.error('Start call error:', error);
        return response.serverError(res, '发起通话失败');
    }
});

/**
 * PUT /api/video/call/:callId/accept
 * 接听通话
 */
router.put('/call/:callId/accept', auth, async (req, res) => {
    try {
        const { callId } = req.params;
        
        const callCheck = await query(
            'SELECT * FROM video_calls WHERE id = $1 AND receiver_id = $2',
            [callId, req.user.id]
        );
        
        if (callCheck.rows.length === 0) {
            return response.notFound(res, '通话不存在或您不是接收者');
        }
        
        const call = callCheck.rows[0];
        
        if (call.status !== 'calling') {
            return response.badRequest(res, '通话状态不正确');
        }
        
        // 更新状态
        await query(
            `UPDATE video_calls SET status = 'accepted', started_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [callId]
        );
        
        return response.success(res, null, '已接听');
    } catch (error) {
        console.error('Accept call error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * PUT /api/video/call/:callId/reject
 * 拒绝通话
 */
router.put('/call/:callId/reject', auth, async (req, res) => {
    try {
        const { callId } = req.params;
        
        const callCheck = await query(
            'SELECT * FROM video_calls WHERE id = $1 AND receiver_id = $2',
            [callId, req.user.id]
        );
        
        if (callCheck.rows.length === 0) {
            return response.notFound(res, '通话不存在');
        }
        
        await query(
            `UPDATE video_calls SET status = 'rejected', ended_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [callId]
        );
        
        return response.success(res, null, '已拒绝');
    } catch (error) {
        console.error('Reject call error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * PUT /api/video/call/:callId/end
 * 结束通话
 */
router.put('/call/:callId/end', auth, async (req, res) => {
    try {
        const { callId } = req.params;
        const { duration } = req.body; // 通话时长（秒）
        
        const callCheck = await query(
            'SELECT * FROM video_calls WHERE id = $1 AND (caller_id = $2 OR receiver_id = $2)',
            [callId, req.user.id]
        );
        
        if (callCheck.rows.length === 0) {
            return response.notFound(res, '通话不存在');
        }
        
        const call = callCheck.rows[0];
        
        if (['ended', 'cancelled', 'rejected'].includes(call.status)) {
            return response.badRequest(res, '通话已结束');
        }
        
        const actualDuration = parseInt(duration) || 0;
        
        // 计算费用
        let totalCost = 0;
        
        // 只有男性用户呼叫女性用户时才收费
        const callerCheck = await query(
            'SELECT gender FROM users WHERE id = $1',
            [call.caller_id]
        );
        const receiverGenderCheck = await query(
            'SELECT gender, video_price FROM users WHERE id = $1',
            [call.receiver_id]
        );
        
        if (callerCheck.rows[0]?.gender === 'male' && receiverGenderCheck.rows[0]?.gender === 'female') {
            const pricePerMinute = parseFloat(receiverGenderCheck.rows[0].video_price) || videoCallPrice;
            totalCost = Math.ceil(actualDuration / 60) * pricePerMinute;
        }
        
        // 扣费并记录
        await transaction(async (client) => {
            if (totalCost > 0) {
                // 扣费
                await client.query(
                    'UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2',
                    [totalCost, call.caller_id]
                );
                
                // 获取呼叫者新余额
                const callerBalance = await client.query(
                    'SELECT coin_balance FROM users WHERE id = $1',
                    [call.caller_id]
                );
                
                // 记录呼叫者金币流水
                await client.query(
                    `INSERT INTO coin_transactions (user_id, type, category, amount, balance_after, related_user_id, description)
                     VALUES ($1, 'expense', 'video_chat', $2, $3, $4, $5)`,
                    [call.caller_id, totalCost, callerBalance.rows[0].coin_balance, call.receiver_id, `视频通话${Math.ceil(actualDuration / 60)}分钟`]
                );
                
                // 给接收者加钻石
                await client.query(
                    'UPDATE users SET diamond_balance = diamond_balance + $1 WHERE id = $2',
                    [totalCost, call.receiver_id]
                );
                
                // 获取接收者新余额
                const receiverBalance = await client.query(
                    'SELECT diamond_balance FROM users WHERE id = $1',
                    [call.receiver_id]
                );
                
                // 记录接收者钻石流水
                await client.query(
                    `INSERT INTO diamond_transactions (user_id, type, category, amount, balance_after, related_user_id, description)
                     VALUES ($1, 'income', 'video_chat', $2, $3, $4, $5)`,
                    [call.receiver_id, totalCost, receiverBalance.rows[0].diamond_balance, call.caller_id, `视频通话收入`]
                );
            }
            
            // 更新通话记录
            await client.query(
                `UPDATE video_calls 
                 SET status = 'ended', duration = $1, total_cost = $2, ended_at = CURRENT_TIMESTAMP
                 WHERE id = $3`,
                [actualDuration, totalCost, callId]
            );
        });
        
        return response.success(res, {
            duration: actualDuration,
            total_cost: totalCost,
        }, '通话已结束');
    } catch (error) {
        console.error('End call error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * PUT /api/video/call/:callId/cancel
 * 取消通话（发起者）
 */
router.put('/call/:callId/cancel', auth, async (req, res) => {
    try {
        const { callId } = req.params;
        
        const callCheck = await query(
            'SELECT * FROM video_calls WHERE id = $1 AND caller_id = $2',
            [callId, req.user.id]
        );
        
        if (callCheck.rows.length === 0) {
            return response.notFound(res, '通话不存在');
        }
        
        const call = callCheck.rows[0];
        
        if (call.status !== 'calling') {
            return response.badRequest(res, '通话已开始，无法取消');
        }
        
        await query(
            `UPDATE video_calls SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [callId]
        );
        
        return response.success(res, null, '通话已取消');
    } catch (error) {
        console.error('Cancel call error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * GET /api/video/call/:callId
 * 获取通话详情
 */
router.get('/call/:callId', auth, async (req, res) => {
    try {
        const { callId } = req.params;
        
        const result = await query(
            `SELECT vc.*,
                    caller.nickname as caller_nickname, caller.avatar as caller_avatar,
                    receiver.nickname as receiver_nickname, receiver.avatar as receiver_avatar
             FROM video_calls vc
             LEFT JOIN users caller ON vc.caller_id = caller.id
             LEFT JOIN users receiver ON vc.receiver_id = receiver.id
             WHERE vc.id = $1 AND (vc.caller_id = $2 OR vc.receiver_id = $2)`,
            [callId, req.user.id]
        );
        
        if (result.rows.length === 0) {
            return response.notFound(res, '通话不存在');
        }
        
        return response.success(res, result.rows[0]);
    } catch (error) {
        console.error('Get call error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * GET /api/video/records
 * 获取通话记录
 */
router.get('/records', auth, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        
        const countResult = await query(
            `SELECT COUNT(*) FROM video_calls 
             WHERE caller_id = $1 OR receiver_id = $1`,
            [req.user.id]
        );
        const total = parseInt(countResult.rows[0].count);
        
        const result = await query(
            `SELECT vc.*,
                    caller.nickname as caller_nickname, caller.avatar as caller_avatar,
                    receiver.nickname as receiver_nickname, receiver.avatar as receiver_avatar
             FROM video_calls vc
             LEFT JOIN users caller ON vc.caller_id = caller.id
             LEFT JOIN users receiver ON vc.receiver_id = receiver.id
             WHERE vc.caller_id = $1 OR vc.receiver_id = $1
             ORDER BY vc.created_at DESC
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
        console.error('Get records error:', error);
        return response.serverError(res, '获取失败');
    }
});

module.exports = router;
