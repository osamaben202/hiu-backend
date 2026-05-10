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
const initSocket = (io) => {
    // JWT认证中间件
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token || socket.handshake.query.token;
            
            if (!token) {
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
            next();
        } catch (error) {
            next(new Error('Authentication error'));
        }
    });

    io.on('connection', (socket) => {
        console.log(`[Socket] User connected: ${socket.user.nickname} (${socket.user.id})`);
        
        // 加入房间
        socket.on('join_room', async (data) => {
            try {
                const { room_id } = data;
                
                // 离开之前的房间
                const rooms = Array.from(socket.rooms);
                rooms.forEach(room => {
                    if (room !== socket.id) {
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
                
                // 广播消息
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
        socket.on('disconnect', () => {
            console.log(`[Socket] User disconnected: ${socket.user.nickname}`);
            
            // 如果在房间里，广播离开
            if (socket.currentRoom) {
                io.to(socket.currentRoom).emit('user_left', {
                    user_id: socket.user.id,
                    nickname: socket.user.nickname,
                });
            }
        });
    });
};

module.exports = { initSocket };
