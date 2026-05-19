/**
 * Socket.IO 事件处理器
 * 处理房间聊天、麦位状态等实时事件
 */
const { verifyToken } = require('../utils/jwt');
const { query } = require('../models/db');

/**
 * 初始化Socket.IO
 * @param {Server} io - Socket.IO服务器实例
 */
let _io = null;

const initSocket = (io) => {
    _io = io;
    // JWT认证中间件
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token || socket.handshake.query.token;
            console.log('[Socket Auth] Connection attempt from:', socket.id, 'has auth.token:', !!socket.handshake.auth.token, 'has query.token:', !!socket.handshake.query.token);
            
            if (!token) {
                console.log('[Socket Auth] REJECTED: No token provided');
                return next(new Error('Authentication required'));
            }
            
            const decoded = verifyToken(token);
            if (!decoded) {
                return next(new Error('Invalid token'));
            }
            
            // 获取用户信息
            const result = await query(
                'SELECT id, account, nickname, avatar, gender, role FROM users WHERE id = $1 AND is_banned = false',
                [decoded.userId]
            );
            
            if (result.rows.length === 0) {
                return next(new Error('User not found'));
            }
            
            socket.user = result.rows[0];
            // 保存用户ID到socket映射，方便后续推送消息给特定用户
            socket.userId = socket.user.id;
            next();
        } catch (error) {
            next(new Error('Authentication error'));
        }
    });

    io.on('connection', (socket) => {
        console.log(`[Socket] User connected: ${socket.user.nickname} (${socket.user.id}), socket.id: ${socket.id}, transport: ${socket.conn.transport.name}`);
        
        // 将用户socket加入用户房间，便于推送通知
        socket.join(`user:${socket.user.id}`);
        
        // 加入房间
        socket.on('join_room', async (data) => {
            try {
                const { room_id } = data;
                
                // 离开之前的房间
                const rooms = Array.from(socket.rooms);
                rooms.forEach(room => {
                    if (room !== socket.id && !room.startsWith('user:')) {
                        socket.leave(room);
                    }
                });
                
                // 加入新房间
                socket.join(room_id);
                socket.currentRoom = room_id;
                
                // 广播用户加入
                io.to(room_id).emit('user_joined', {
                    user_id: socket.user.id,
                    nickname: socket.user.nickname,
                    avatar: socket.user.avatar,
                    gender: socket.user.gender,
                });
                
                console.log(`[Socket] ${socket.user.nickname} joined room ${room_id}`);
            } catch (error) {
                console.error('[Socket] Join room error:', error);
                socket.emit('error', { message: 'Failed to join room' });
            }
        });

        // 离开房间
        socket.on('leave_room', async (data) => {
            try {
                const { room_id } = data;
                
                socket.leave(room_id);
                socket.currentRoom = null;
                
                // 广播用户离开
                io.to(room_id).emit('user_left', {
                    user_id: socket.user.id,
                    nickname: socket.user.nickname,
                });
                
                console.log(`[Socket] ${socket.user.nickname} left room ${room_id}`);
            } catch (error) {
                console.error('[Socket] Leave room error:', error);
            }
        });

        // 发送聊天消息
        socket.on('chat_message', async (data) => {
            try {
                const { room_id, content, type = 'text' } = data;
                
                if (!room_id || !content) {
                    return socket.emit('error', { message: 'Invalid message' });
                }
                
                // 检查是否被禁言
                const banCheck = await query(
                    `SELECT id FROM room_bans 
                     WHERE room_id = $1 AND user_id = $2 
                     AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
                    [room_id, socket.user.id]
                );
                
                if (banCheck.rows.length > 0) {
                    return socket.emit('error', { message: 'You are muted in this room' });
                }
                
                // 保存消息到数据库
                const messageResult = await query(
                    `INSERT INTO messages (room_id, sender_id, type, content)
                     VALUES ($1, $2, $3, $4)
                     RETURNING id, created_at`,
                    [room_id, socket.user.id, type, content]
                );
                
                // 广播消息到房间内所有用户
                const messageData = {
                    id: messageResult.rows[0].id,
                    room_id,
                    sender_id: socket.user.id,
                    sender_nickname: socket.user.nickname,
                    sender_avatar: socket.user.avatar,
                    type,
                    content,
                    created_at: messageResult.rows[0].created_at,
                };
                
                io.to(room_id).emit('chat_message', messageData);
            } catch (error) {
                console.error('[Socket] Chat message error:', error);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        // 麦位状态更新
        socket.on('seat_update', async (data) => {
            try {
                const { room_id, seat_index, action, is_muted } = data;
                
                // action: 'join', 'leave', 'mute', 'unmute', 'speaking', 'stopped_speaking'
                
                const seatData = {
                    seat_index,
                    user_id: socket.user.id,
                    nickname: socket.user.nickname,
                    avatar: socket.user.avatar,
                    action,
                    is_muted,
                };
                
                // 广播麦位更新
                io.to(room_id).emit('seat_update', seatData);
            } catch (error) {
                console.error('[Socket] Seat update error:', error);
            }
        });

        // 上麦申请 - 用户发送申请
        socket.on('seat_request', async (data) => {
            try {
                const { room_id, seat_index } = data;
                
                // 获取房间信息
                const roomResult = await query(
                    'SELECT owner_id FROM rooms WHERE id = $1',
                    [room_id]
                );
                
                if (roomResult.rows.length === 0) {
                    return socket.emit('error', { message: 'Room not found' });
                }
                
                const ownerId = roomResult.rows[0].owner_id;
                
                // 发送申请通知给房主
                io.to(`user:${ownerId}`).emit('seat_request', {
                    room_id,
                    seat_index,
                    requester_id: socket.user.id,
                    requester_nickname: socket.user.nickname,
                    requester_avatar: socket.user.avatar,
                });
                
                // 确认申请已发送
                socket.emit('seat_request_sent', {
                    room_id,
                    seat_index,
                });
                
                console.log(`[Socket] Seat request from ${socket.user.nickname} for seat ${seat_index} in room ${room_id}`);
            } catch (error) {
                console.error('[Socket] Seat request error:', error);
                socket.emit('error', { message: 'Failed to send seat request' });
            }
        });

        // 同意上麦申请 - 房主操作
        socket.on('approve_seat', async (data) => {
            try {
                const { room_id, seat_index, requester_id } = data;
                
                // 检查是否是房主
                const roomResult = await query(
                    'SELECT owner_id FROM rooms WHERE id = $1',
                    [room_id]
                );
                
                if (roomResult.rows.length === 0) {
                    return socket.emit('error', { message: 'Room not found' });
                }
                
                if (roomResult.rows[0].owner_id !== socket.user.id) {
                    return socket.emit('error', { message: 'Only room owner can approve seat requests' });
                }
                
                // 检查麦位是否可用
                const seatCheck = await query(
                    'SELECT * FROM room_seats WHERE room_id = $1 AND seat_index = $2',
                    [room_id, seat_index]
                );
                
                if (seatCheck.rows.length === 0) {
                    return socket.emit('error', { message: 'Seat not found' });
                }
                
                const seat = seatCheck.rows[0];
                
                if (seat.is_locked) {
                    return socket.emit('error', { message: 'Seat is locked' });
                }
                
                if (seat.user_id) {
                    return socket.emit('error', { message: 'Seat is already occupied' });
                }
                
                // 上麦
                await query(
                    `UPDATE room_seats SET user_id = $1, join_at = CURRENT_TIMESTAMP, is_muted = false
                     WHERE room_id = $2 AND seat_index = $3`,
                    [requester_id, room_id, seat_index]
                );
                
                // 通知申请人上麦成功
                io.to(`user:${requester_id}`).emit('seat_approved', {
                    room_id,
                    seat_index,
                });
                
                // 广播麦位更新给房间内所有人
                io.to(room_id).emit('seat_update', {
                    seat_index,
                    user_id: requester_id,
                    nickname: socket.user.nickname,
                    avatar: socket.user.avatar,
                    action: 'join',
                    is_muted: false,
                });
                
                console.log(`[Socket] Seat ${seat_index} approved for user ${requester_id} in room ${room_id}`);
            } catch (error) {
                console.error('[Socket] Approve seat error:', error);
                socket.emit('error', { message: 'Failed to approve seat request' });
            }
        });

        // 拒绝上麦申请
        socket.on('reject_seat', async (data) => {
            try {
                const { room_id, seat_index, requester_id } = data;
                
                // 检查是否是房主
                const roomResult = await query(
                    'SELECT owner_id FROM rooms WHERE id = $1',
                    [room_id]
                );
                
                if (roomResult.rows.length === 0) {
                    return socket.emit('error', { message: 'Room not found' });
                }
                
                if (roomResult.rows[0].owner_id !== socket.user.id) {
                    return socket.emit('error', { message: 'Only room owner can reject seat requests' });
                }
                
                // 通知申请人被拒绝
                io.to(`user:${requester_id}`).emit('seat_rejected', {
                    room_id,
                    seat_index,
                });
                
                console.log(`[Socket] Seat ${seat_index} rejected for user ${requester_id} in room ${room_id}`);
            } catch (error) {
                console.error('[Socket] Reject seat error:', error);
            }
        });

        // 房间管理操作
        socket.on('room_action', async (data) => {
            try {
                const { room_id, action, target_user_id, reason } = data;
                
                // action: 'kick', 'ban', 'unban', 'mute_user', 'unmute_user'
                
                switch (action) {
                    case 'kick':
                        // 踢人
                        io.to(room_id).emit('user_kicked', {
                            user_id: target_user_id,
                            reason,
                            kicked_by: socket.user.nickname,
                        });
                        break;
                        
                    case 'ban':
                        // 禁言
                        io.to(room_id).emit('user_banned', {
                            user_id: target_user_id,
                            reason,
                            banned_by: socket.user.nickname,
                        });
                        break;
                        
                    case 'mute_user':
                        // 禁言用户
                        io.to(room_id).emit('user_muted', {
                            user_id: target_user_id,
                            muted_by: socket.user.nickname,
                        });
                        break;
                }
            } catch (error) {
                console.error('[Socket] Room action error:', error);
            }
        });

        // 礼物消息
        socket.on('gift_sent', async (data) => {
            try {
                const { room_id, gift_id, receiver_id, count, gift_name, sender_nickname, sender_avatar } = data;
                
                // 广播礼物消息
                io.to(room_id).emit('gift_received', {
                    room_id,
                    gift_id,
                    receiver_id,
                    count,
                    gift_name,
                    sender_id: socket.user.id,
                    sender_nickname: socket.user.nickname,
                    sender_avatar: socket.user.avatar,
                });
            } catch (error) {
                console.error('[Socket] Gift sent error:', error);
            }
        });

        // 断开连接
        socket.on('disconnect', async () => {
            console.log(`[Socket] User disconnected: ${socket.user.nickname}`);
            
            try {
                // 如果在房间里，离开房间
                if (socket.currentRoom) {
                    const roomId = socket.currentRoom;
                    io.to(roomId).emit('user_left', {
                        user_id: socket.user.id,
                        nickname: socket.user.nickname,
                    });
                    
                    // 减少房间人数
                    await query(
                        'UPDATE rooms SET current_count = GREATEST(current_count - 1, 0) WHERE id = $1',
                        [roomId]
                    );
                    await query(
                        'DELETE FROM room_participants WHERE room_id = $1 AND user_id = $2',
                        [roomId, socket.user.id]
                    );
                    // 释放麦位
                    await query(
                        'UPDATE room_seats SET user_id = NULL, join_at = NULL WHERE room_id = $1 AND user_id = $2',
                        [roomId, socket.user.id]
                    );
                    io.to(roomId).emit('seat_update', { room_id: roomId });
                }
                
                // 检查该用户是否是某个房间的房主，如果是则关闭房间
                const ownedRooms = await query(
                    "SELECT id, name FROM rooms WHERE owner_id = $1 AND status = 'active'",
                    [socket.user.id]
                );
                
                for (const room of ownedRooms.rows) {
                    console.log(`[Socket] Closing room ${room.name} - owner disconnected`);
                    
                    // 通知房间内所有人房间已关闭
                    io.to(room.id).emit('room_closed', {
                        room_id: room.id,
                        message: '房主已离线，房间已关闭',
                    });
                    
                    // 清理房间参与者
                    await query(
                        'DELETE FROM room_participants WHERE room_id = $1',
                        [room.id]
                    );
                    // 清理麦位
                    await query(
                        'UPDATE room_seats SET user_id = NULL, join_at = NULL WHERE room_id = $1',
                        [room.id]
                    );
                    // 关闭房间
                    await query(
                        "UPDATE rooms SET status = 'closed', current_count = 0 WHERE id = $1",
                        [room.id]
                    );
                    
                    // 让所有人离开 socket room
                    const sockets = await io.in(room.id).fetchSockets();
                    for (const s of sockets) {
                        s.leave(room.id);
                        s.currentRoom = null;
                    }
                    
                    // 广播房间列表更新
                    io.emit('room_update', { action: 'close', room_id: room.id });
                }
            } catch (error) {
                console.error('[Socket] Disconnect handler error:', error);
            }
        });
    });
};

// 获取在线socket状态
const getOnlineStatus = () => {
    const sockets = [];
    if (_io) {
        const connectedSockets = _io.sockets.sockets;
        connectedSockets.forEach((socket) => {
            sockets.push({
                id: socket.id,
                userId: socket.userId || socket.user?.id,
                nickname: socket.user?.nickname,
                rooms: Array.from(socket.rooms || []),
            });
        });
    }
    return {
        totalConnections: sockets.length,
        sockets: sockets,
    };
};

module.exports = { initSocket, getOnlineStatus };
