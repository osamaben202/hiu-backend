/**
 * 房间路由
 */
const express = require('express');
const { query, transaction } = require('../models/db');
const { auth, adminAuth } = require('../middleware/auth');
const response = require('../utils/response');
const { generateAgoraToken } = require('../services/agoraService');

const router = express.Router();

/**
 * GET /api/rooms
 * 获取房间列表
 */
router.get('/', auth, async (req, res) => {
    try {
        const { page = 1, limit = 20, keyword, sort = 'created', is_public } = req.query;
        const offset = (page - 1) * limit;
        
        let orderBy = 'r.created_at DESC';
        if (sort === 'hot') {
            orderBy = 'r.current_count DESC';
        }
        
        let whereClause = "WHERE r.status = 'active'";
        const values = [];
        let paramCount = 1;
        
        if (keyword) {
            whereClause += ` AND r.name ILIKE $${paramCount++}`;
            values.push(`%${keyword}%`);
        }
        
        if (is_public !== undefined) {
            whereClause += ` AND r.is_public = $${paramCount++}`;
            values.push(is_public === 'true');
        }
        
        // 获取总数
        const countResult = await query(
            `SELECT COUNT(*) FROM rooms r ${whereClause}`,
            values
        );
        const total = parseInt(countResult.rows[0].count);
        
        // 获取列表
        values.push(limit, offset);
        const result = await query(
            `SELECT r.id, r.name, r.cover, r.description, r.is_public, r.status,
                    r.max_seats, r.current_count, r.tags, r.owner_id,
                    u.nickname as owner_nickname, u.avatar as owner_avatar,
                    r.created_at
             FROM rooms r
             LEFT JOIN users u ON r.owner_id = u.id
             ${whereClause}
             ORDER BY ${orderBy}
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
        console.error('Get rooms error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * GET /api/rooms/:roomId
 * 获取房间详情
 */
router.get('/:roomId', auth, async (req, res) => {
    try {
        const { roomId } = req.params;
        
        const roomResult = await query(
            `SELECT r.*, u.nickname as owner_nickname, u.avatar as owner_avatar
             FROM rooms r
             LEFT JOIN users u ON r.owner_id = u.id
             WHERE r.id = $1`,
            [roomId]
        );
        
        if (roomResult.rows.length === 0) {
            return response.notFound(res, '房间不存在');
        }
        
        // 获取麦位信息
        const seatsResult = await query(
            `SELECT rs.*, u.nickname, u.avatar, u.gender
             FROM room_seats rs
             LEFT JOIN users u ON rs.user_id = u.id
             WHERE rs.room_id = $1
             ORDER BY rs.seat_index`,
            [roomId]
        );
        
        // 获取在线人数
        const countResult = await query(
            'SELECT COUNT(*) FROM room_participants WHERE room_id = $1',
            [roomId]
        );
        
        return response.success(res, {
            ...roomResult.rows[0],
            seats: seatsResult.rows,
            online_count: parseInt(countResult.rows[0].count),
        });
    } catch (error) {
        console.error('Get room error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * POST /api/rooms
 * 创建房间
 */
router.post('/', auth, async (req, res) => {
    try {
        const { name, cover, description, is_public, password, tags } = req.body;
        
        if (!name || name.trim() === '') {
            return response.badRequest(res, '房间名称不能为空');
        }
        
        const result = await transaction(async (client) => {
            // 创建房间
            const roomResult = await client.query(
                `INSERT INTO rooms (owner_id, name, cover, description, is_public, password, tags)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
                [
                    req.user.id,
                    name.trim(),
                    cover || '',
                    description || '',
                    is_public !== false,
                    password || '',
                    tags || ''
                ]
            );
            
            const room = roomResult.rows[0];
            
            // 初始化8个麦位
            for (let i = 0; i < 8; i++) {
                await client.query(
                    `INSERT INTO room_seats (room_id, seat_index, is_locked)
                     VALUES ($1, $2, $3)`,
                    [room.id, i, i === 0] // 第一个麦位默认锁定给房主
                );
            }
            
            // 房主上第一个麦位
            await client.query(
                `UPDATE room_seats SET user_id = $1, join_at = CURRENT_TIMESTAMP
                 WHERE room_id = $2 AND seat_index = 0`,
                [req.user.id, room.id]
            );
            
            // 房主加入房间
            await client.query(
                `INSERT INTO room_participants (room_id, user_id)
                 VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
                [room.id, req.user.id]
            );
            
            // 更新房间人数
            await client.query(
                'UPDATE rooms SET current_count = current_count + 1 WHERE id = $1',
                [room.id]
            );
            
            return room;
        });
        
        // 广播新房间创建事件给所有在线用户
        try {
            const io = req.app.get('io');
            if (io) {
                const roomData = {
                    id: result.id,
                    name: result.name,
                    cover: result.cover,
                    description: result.description,
                    is_public: result.is_public,
                    owner_id: result.owner_id,
                    owner_nickname: req.user.nickname,
                    owner_avatar: req.user.avatar,
                    current_count: 1,
                    created_at: result.created_at,
                };
                io.emit('new_room', roomData);
                console.log(`[Rooms] Broadcasted new_room event for room ${result.id}`);
            }
        } catch (broadcastError) {
            console.error('[Rooms] Failed to broadcast new_room:', broadcastError);
        }
        
        return response.created(res, result, '房间创建成功');
    } catch (error) {
        console.error('Create room error:', error);
        return response.serverError(res, '创建失败');
    }
});

/**
 * PUT /api/rooms/:roomId
 * 更新房间信息（房主）
 */
router.put('/:roomId', auth, async (req, res) => {
    try {
        const { roomId } = req.params;
        const { name, cover, description, is_public, password, tags } = req.body;
        
        // 检查是否是房主
        const roomCheck = await query(
            'SELECT owner_id FROM rooms WHERE id = $1',
            [roomId]
        );
        
        if (roomCheck.rows.length === 0) {
            return response.notFound(res, '房间不存在');
        }
        
        if (roomCheck.rows[0].owner_id !== req.user.id && req.user.role !== 'admin') {
            return response.forbidden(res, '只有房主可以修改房间信息');
        }
        
        const updates = [];
        const values = [];
        let paramCount = 1;
        
        if (name !== undefined) {
            updates.push(`name = $${paramCount++}`);
            values.push(name);
        }
        if (cover !== undefined) {
            updates.push(`cover = $${paramCount++}`);
            values.push(cover);
        }
        if (description !== undefined) {
            updates.push(`description = $${paramCount++}`);
            values.push(description);
        }
        if (is_public !== undefined) {
            updates.push(`is_public = $${paramCount++}`);
            values.push(is_public);
        }
        if (password !== undefined) {
            updates.push(`password = $${paramCount++}`);
            values.push(password);
        }
        if (tags !== undefined) {
            updates.push(`tags = $${paramCount++}`);
            values.push(tags);
        }
        
        if (updates.length === 0) {
            return response.badRequest(res, '没有需要更新的字段');
        }
        
        values.push(roomId);
        
        const result = await query(
            `UPDATE rooms SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
             WHERE id = $${paramCount}
             RETURNING *`,
            values
        );
        
        return response.success(res, result.rows[0], '更新成功');
    } catch (error) {
        console.error('Update room error:', error);
        return response.serverError(res, '更新失败');
    }
});

/**
 * DELETE /api/rooms/:roomId
 * 关闭房间（房主或管理员）
 */
router.delete('/:roomId', auth, async (req, res) => {
    try {
        const { roomId } = req.params;
        
        // 检查房间
        const roomCheck = await query(
            'SELECT owner_id, status FROM rooms WHERE id = $1',
            [roomId]
        );
        
        if (roomCheck.rows.length === 0) {
            return response.notFound(res, '房间不存在');
        }
        
        const isOwner = roomCheck.rows[0].owner_id === req.user.id;
        const isAdmin = req.user.role === 'admin';
        
        if (!isOwner && !isAdmin) {
            return response.forbidden(res, '只有房主或管理员可以关闭房间');
        }
        
        // 关闭房间
        await transaction(async (client) => {
            // 更新房间状态
            await client.query(
                `UPDATE rooms SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [roomId]
            );
            
            // 清理麦位
            await client.query('DELETE FROM room_seats WHERE room_id = $1', [roomId]);
            
            // 清理参与者
            await client.query('DELETE FROM room_participants WHERE room_id = $1', [roomId]);
        });
        
        // 广播房间关闭事件
        try {
            const io = req.app.get('io');
            if (io) {
                io.to(`room:${roomId}`).emit('room_closed', {
                    room_id: roomId,
                    closed_by: req.user.nickname,
                });
                io.emit('room_deleted', { room_id: roomId });
            }
        } catch (broadcastError) {
            console.error('[Rooms] Failed to broadcast room_closed:', broadcastError);
        }
        
        return response.success(res, null, '房间已关闭');
    } catch (error) {
        console.error('Close room error:', error);
        return response.serverError(res, '关闭失败');
    }
});

/**
 * POST /api/rooms/:roomId/join
 * 加入房间
 */
router.post('/:roomId/join', auth, async (req, res) => {
    try {
        const { roomId } = req.params;
        const { password } = req.body;
        
        // 检查房间
        const roomCheck = await query(
            `SELECT r.*, u.nickname as owner_nickname, u.avatar as owner_avatar
             FROM rooms r
             LEFT JOIN users u ON r.owner_id = u.id
             WHERE r.id = $1`,
            [roomId]
        );
        
        if (roomCheck.rows.length === 0) {
            return response.notFound(res, '房间不存在');
        }
        
        const room = roomCheck.rows[0];
        
        if (room.status !== 'active') {
            return response.badRequest(res, '房间已关闭');
        }
        
        // 检查密码
        if (!room.is_public && room.password && room.password !== password) {
            return response.unauthorized(res, '房间密码错误');
        }
        
        // 加入房间
        await query(
            `INSERT INTO room_participants (room_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [roomId, req.user.id]
        );
        
        // 更新房间人数
        await query(
            'UPDATE rooms SET current_count = current_count + 1 WHERE id = $1',
            [roomId]
        );
        
        // 生成 Agora Token
        const agoraToken = generateAgoraToken(roomId, req.user.id, req.user.nickname);
        
        return response.success(res, {
            agora_token: agoraToken,
            channel_name: roomId,
            room: room,
        }, '加入成功');
    } catch (error) {
        console.error('Join room error:', error);
        return response.serverError(res, '加入失败');
    }
});

/**
 * POST /api/rooms/:roomId/leave
 * 离开房间
 */
router.post('/:roomId/leave', auth, async (req, res) => {
    try {
        const { roomId } = req.params;
        
        // 检查房间
        const roomCheck = await query(
            'SELECT owner_id FROM rooms WHERE id = $1',
            [roomId]
        );
        
        if (roomCheck.rows.length === 0) {
            return response.notFound(res, '房间不存在');
        }
        
        // 房主不能直接离开，需要先关闭或转移
        if (roomCheck.rows[0].owner_id === req.user.id) {
            return response.badRequest(res, '房主不能直接离开房间，请先关闭或转移房间');
        }
        
        // 离开房间
        await transaction(async (client) => {
            // 下麦（如果还在麦上）
            await client.query(
                'UPDATE room_seats SET user_id = NULL, join_at = NULL WHERE room_id = $1 AND user_id = $2',
                [roomId, req.user.id]
            );
            
            // 移除参与者
            await client.query(
                'DELETE FROM room_participants WHERE room_id = $1 AND user_id = $2',
                [roomId, req.user.id]
            );
            
            // 更新房间人数
            await client.query(
                'UPDATE rooms SET current_count = GREATEST(current_count - 1, 0) WHERE id = $1',
                [roomId]
            );
        });
        
        return response.success(res, null, '已离开房间');
    } catch (error) {
        console.error('Leave room error:', error);
        return response.serverError(res, '离开失败');
    }
});

/**
 * POST /api/rooms/:roomId/seat/:seatIndex/join
 * 上麦
 */
router.post('/:roomId/seat/:seatIndex/join', auth, async (req, res) => {
    try {
        const { roomId, seatIndex } = req.params;
        const seatIndexNum = parseInt(seatIndex);
        
        if (seatIndexNum < 0 || seatIndexNum >= 8) {
            return response.badRequest(res, '麦位序号不正确');
        }
        
        // 检查房间
        const roomCheck = await query(
            'SELECT owner_id FROM rooms WHERE id = $1 AND status = $2',
            [roomId, 'active']
        );
        
        if (roomCheck.rows.length === 0) {
            return response.notFound(res, '房间不存在');
        }
        
        // 检查麦位
        const seatCheck = await query(
            'SELECT * FROM room_seats WHERE room_id = $1 AND seat_index = $2',
            [roomId, seatIndexNum]
        );
        
        if (seatCheck.rows.length === 0) {
            return response.notFound(res, '麦位不存在');
        }
        
        const seat = seatCheck.rows[0];
        
        if (seat.is_locked) {
            return response.forbidden(res, '该麦位已锁定');
        }
        
        if (seat.user_id) {
            return response.badRequest(res, '该麦位已有人');
        }
        
        // 上麦
        await query(
            `UPDATE room_seats SET user_id = $1, join_at = CURRENT_TIMESTAMP, is_muted = false
             WHERE room_id = $2 AND seat_index = $3`,
            [req.user.id, roomId, seatIndexNum]
        );
        
        return response.success(res, null, '上麦成功');
    } catch (error) {
        console.error('Join seat error:', error);
        return response.serverError(res, '上麦失败');
    }
});

/**
 * POST /api/rooms/:roomId/seat/:seatIndex/leave
 * 下麦
 */
router.post('/:roomId/seat/:seatIndex/leave', auth, async (req, res) => {
    try {
        const { roomId, seatIndex } = req.params;
        const seatIndexNum = parseInt(seatIndex);
        
        // 检查麦位是否是自己的
        const seatCheck = await query(
            'SELECT user_id FROM room_seats WHERE room_id = $1 AND seat_index = $2',
            [roomId, seatIndexNum]
        );
        
        if (seatCheck.rows.length === 0) {
            return response.notFound(res, '麦位不存在');
        }
        
        if (seatCheck.rows[0].user_id !== req.user.id) {
            return response.forbidden(res, '这不是您的麦位');
        }
        
        await query(
            'UPDATE room_seats SET user_id = NULL, join_at = NULL, is_muted = true WHERE room_id = $1 AND seat_index = $2',
            [roomId, seatIndexNum]
        );
        
        return response.success(res, null, '下麦成功');
    } catch (error) {
        console.error('Leave seat error:', error);
        return response.serverError(res, '下麦失败');
    }
});

/**
 * POST /api/rooms/:roomId/seat/:seatIndex/kick
 * 踢人下麦（房主或管理员）
 */
router.post('/:roomId/seat/:seatIndex/kick', auth, async (req, res) => {
    try {
        const { roomId, seatIndex } = req.params;
        const seatIndexNum = parseInt(seatIndex);
        
        // 检查房间
        const roomCheck = await query(
            'SELECT owner_id FROM rooms WHERE id = $1',
            [roomId]
        );
        
        if (roomCheck.rows.length === 0) {
            return response.notFound(res, '房间不存在');
        }
        
        const isOwner = roomCheck.rows[0].owner_id === req.user.id;
        const isAdmin = req.user.role === 'admin';
        
        if (!isOwner && !isAdmin) {
            return response.forbidden(res, '只有房主或管理员可以踢人');
        }
        
        // 获取麦位上的人
        const seatCheck = await query(
            'SELECT user_id FROM room_seats WHERE room_id = $1 AND seat_index = $2',
            [roomId, seatIndexNum]
        );
        
        if (seatCheck.rows.length === 0) {
            return response.notFound(res, '麦位不存在');
        }
        
        const kickedUserId = seatCheck.rows[0].user_id;
        
        // 不能踢房主自己
        if (kickedUserId === req.user.id) {
            return response.badRequest(res, '不能踢自己下麦');
        }
        
        // 踢人
        await query(
            'UPDATE room_seats SET user_id = NULL, join_at = NULL WHERE room_id = $1 AND seat_index = $2',
            [roomId, seatIndexNum]
        );
        
        return response.success(res, { kicked_user_id: kickedUserId }, '已踢人下麦');
    } catch (error) {
        console.error('Kick user error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * PUT /api/rooms/:roomId/seat/:seatIndex/mute
 * 闭麦/开麦（房主或自己）
 */
router.put('/:roomId/seat/:seatIndex/mute', auth, async (req, res) => {
    try {
        const { roomId, seatIndex } = req.params;
        const { is_muted } = req.body;
        const seatIndexNum = parseInt(seatIndex);
        
        // 检查房间
        const roomCheck = await query(
            'SELECT owner_id FROM rooms WHERE id = $1',
            [roomId]
        );
        
        if (roomCheck.rows.length === 0) {
            return response.notFound(res, '房间不存在');
        }
        
        // 检查麦位
        const seatCheck = await query(
            'SELECT user_id FROM room_seats WHERE room_id = $1 AND seat_index = $2',
            [roomId, seatIndexNum]
        );
        
        if (seatCheck.rows.length === 0) {
            return response.notFound(res, '麦位不存在');
        }
        
        const seat = seatCheck.rows[0];
        const isOwner = roomCheck.rows[0].owner_id === req.user.id;
        const isAdmin = req.user.role === 'admin';
        const isSelf = seat.user_id === req.user.id;
        
        // 只有本人、房主或管理员可以操作
        if (!isSelf && !isOwner && !isAdmin) {
            return response.forbidden(res, '无权操作');
        }
        
        await query(
            'UPDATE room_seats SET is_muted = $1 WHERE room_id = $2 AND seat_index = $3',
            [is_muted, roomId, seatIndexNum]
        );
        
        return response.success(res, null, is_muted ? '已闭麦' : '已开麦');
    } catch (error) {
        console.error('Mute seat error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * PUT /api/rooms/:roomId/seat/:seatIndex/lock
 * 锁定/解锁麦位（房主）
 */
router.put('/:roomId/seat/:seatIndex/lock', auth, async (req, res) => {
    try {
        const { roomId, seatIndex } = req.params;
        const { is_locked } = req.body;
        const seatIndexNum = parseInt(seatIndex);
        
        // 检查是否是房主
        const roomCheck = await query(
            'SELECT owner_id FROM rooms WHERE id = $1',
            [roomId]
        );
        
        if (roomCheck.rows.length === 0) {
            return response.notFound(res, '房间不存在');
        }
        
        if (roomCheck.rows[0].owner_id !== req.user.id && req.user.role !== 'admin') {
            return response.forbidden(res, '只有房主可以锁定麦位');
        }
        
        // 如果麦位有人，不能锁定
        if (is_locked) {
            const seatCheck = await query(
                'SELECT user_id FROM room_seats WHERE room_id = $1 AND seat_index = $2',
                [roomId, seatIndexNum]
            );
            if (seatCheck.rows[0]?.user_id) {
                return response.badRequest(res, '麦位有人时不能锁定');
            }
        }
        
        await query(
            'UPDATE room_seats SET is_locked = $1 WHERE room_id = $2 AND seat_index = $3',
            [is_locked, roomId, seatIndexNum]
        );
        
        return response.success(res, null, is_locked ? '已锁定麦位' : '已解锁麦位');
    } catch (error) {
        console.error('Lock seat error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * POST /api/rooms/:roomId/ban
 * 禁言用户（房主或管理员）
 */
router.post('/:roomId/ban', auth, async (req, res) => {
    try {
        const { roomId } = req.params;
        const { user_id, reason, duration } = req.body; // duration: 分钟，null表示永久
        
        // 检查房间
        const roomCheck = await query(
            'SELECT owner_id FROM rooms WHERE id = $1',
            [roomId]
        );
        
        if (roomCheck.rows.length === 0) {
            return response.notFound(res, '房间不存在');
        }
        
        if (roomCheck.rows[0].owner_id !== req.user.id && req.user.role !== 'admin') {
            return response.forbidden(res, '只有房主或管理员可以禁言');
        }
        
        // 不能禁言自己
        if (user_id === req.user.id) {
            return response.badRequest(res, '不能禁言自己');
        }
        
        const expiresAt = duration ? new Date(Date.now() + duration * 60000) : null;
        
        await query(
            `INSERT INTO room_bans (room_id, user_id, banned_by, reason, expires_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (room_id, user_id) DO UPDATE SET reason = $4, expires_at = $5, banned_by = $3`,
            [roomId, user_id, req.user.id, reason || '', expiresAt]
        );
        
        return response.success(res, null, '禁言成功');
    } catch (error) {
        console.error('Ban user error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * DELETE /api/rooms/:roomId/ban/:userId
 * 解除禁言
 */
router.delete('/:roomId/ban/:userId', auth, async (req, res) => {
    try {
        const { roomId, userId } = req.params;
        
        // 检查房间
        const roomCheck = await query(
            'SELECT owner_id FROM rooms WHERE id = $1',
            [roomId]
        );
        
        if (roomCheck.rows.length === 0) {
            return response.notFound(res, '房间不存在');
        }
        
        if (roomCheck.rows[0].owner_id !== req.user.id && req.user.role !== 'admin') {
            return response.forbidden(res, '只有房主或管理员可以解除禁言');
        }
        
        await query(
            'DELETE FROM room_bans WHERE room_id = $1 AND user_id = $2',
            [roomId, userId]
        );
        
        return response.success(res, null, '已解除禁言');
    } catch (error) {
        console.error('Unban user error:', error);
        return response.serverError(res, '操作失败');
    }
});

/**
 * GET /api/rooms/:roomId/bans
 * 获取禁言列表
 */
router.get('/:roomId/bans', auth, async (req, res) => {
    try {
        const { roomId } = req.params;
        
        // 检查房间权限
        const roomCheck = await query(
            'SELECT owner_id FROM rooms WHERE id = $1',
            [roomId]
        );
        
        if (roomCheck.rows.length === 0) {
            return response.notFound(res, '房间不存在');
        }
        
        if (roomCheck.rows[0].owner_id !== req.user.id && req.user.role !== 'admin') {
            return response.forbidden(res, '无权查看');
        }
        
        const result = await query(
            `SELECT rb.*, u.nickname, u.avatar, u.account,
                    bu.nickname as banned_by_nickname
             FROM room_bans rb
             LEFT JOIN users u ON rb.user_id = u.id
             LEFT JOIN users bu ON rb.banned_by = bu.id
             WHERE rb.room_id = $1 AND (rb.expires_at IS NULL OR rb.expires_at > CURRENT_TIMESTAMP)
             ORDER BY rb.created_at DESC`,
            [roomId]
        );
        
        return response.success(res, result.rows);
    } catch (error) {
        console.error('Get bans error:', error);
        return response.serverError(res, '获取失败');
    }
});

/**
 * POST /api/rooms/:roomId/transfer-owner
 * 转移房主
 */
router.post('/:roomId/transfer-owner', auth, async (req, res) => {
    try {
        const { roomId } = req.params;
        const { new_owner_id } = req.body;
        
        if (!new_owner_id) {
            return response.badRequest(res, '新房主ID不能为空');
        }
        
        // 检查房间
        const roomCheck = await query(
            'SELECT owner_id, status FROM rooms WHERE id = $1',
            [roomId]
        );
        
        if (roomCheck.rows.length === 0) {
            return response.notFound(res, '房间不存在');
        }
        
        if (roomCheck.rows[0].owner_id !== req.user.id) {
            return response.forbidden(res, '只有房主可以转移权限');
        }
        
        if (roomCheck.rows[0].status !== 'active') {
            return response.badRequest(res, '房间已关闭');
        }
        
        // 检查新房主是否在房间里
        const participantCheck = await query(
            'SELECT user_id FROM room_participants WHERE room_id = $1 AND user_id = $2',
            [roomId, new_owner_id]
        );
        
        if (participantCheck.rows.length === 0) {
            return response.badRequest(res, '新房主需要在房间里');
        }
        
        // 检查新房主是否存在
        const userCheck = await query(
            'SELECT id FROM users WHERE id = $1 AND is_banned = false',
            [new_owner_id]
        );
        
        if (userCheck.rows.length === 0) {
            return response.notFound(res, '用户不存在');
        }
        
        // 转移房主
        await query(
            'UPDATE rooms SET owner_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [new_owner_id, roomId]
        );
        
        return response.success(res, { new_owner_id }, '房主转移成功');
    } catch (error) {
        console.error('Transfer owner error:', error);
        return response.serverError(res, '操作失败');
    }
});

module.exports = router;
