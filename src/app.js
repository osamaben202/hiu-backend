/**
 * HIU 语音房 App 后端入口
 */
require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const EventEmitter = require('events');
const config = require('./config');

// 导入路由
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const roomRoutes = require('./routes/rooms');
const giftRoutes = require('./routes/gifts');
const friendRoutes = require('./routes/friends');
const coinRoutes = require('./routes/coins');
const diamondRoutes = require('./routes/diamonds');
const chatRoutes = require('./routes/chat');
const videoRoutes = require('./routes/video');
const adminRoutes = require('./routes/admin');

// 导入Socket.IO
const { initSocket } = require('./socket');

// 导入数据库初始化
const { initDatabase } = require('./models/init-db');

// 事件发射器用于 Socket 通知
const eventEmitter = new EventEmitter();

const app = express();
const server = http.createServer(app);

// Socket.IO 配置 - 添加必要的 transports 和 allowEIO3
const io = new Server(server, {
    cors: {
        origin: config.cors.origin,
        credentials: config.cors.credentials,
        methods: ['GET', 'POST'],
    },
    transports: ['polling', 'websocket'],  // 允许轮询和websocket
    allowEIO3: true,  // 允许 Engine.IO v3 协议
    pingTimeout: 60000,
    pingInterval: 25000,
});

// 将 io 和 eventEmitter 附加到 app
app.set('io', io);
app.set('eventEmitter', eventEmitter);

// 中间件
app.use(cors(config.cors));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 请求日志
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// 根路径
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
    <html>
    <head><title>HIU Backend</title></head>
    <body style="font-family:sans-serif;max-width:600px;margin:50px auto;padding:20px">
    <h1 style="color:#6C5CE7">🎤 HIU Voice Room App</h1>
    <p>Backend is running!</p>
    </body></html>`);
});

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API health check (used by Flutter app)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API路由
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/gifts', giftRoutes);
app.use('/api/friends', (req, res, next) => {
    // 包装 res.json 来触发 socket 事件
    const originalJson = res.json.bind(res);
    res.json = function(data) {
        const io = req.app.get('io');
        if (io && data && data.code === 0) {
            // 好友申请通知
            if (req.path === '/request' && data.data && data.data.friend_id) {
                const friendId = data.data.friend_id;
                console.log(`[Socket] Emitting friend_request to user:${friendId}`);
                io.to(`user:${friendId}`).emit('friend_request', {
                    requester_id: req.user?.id,
                    requester_nickname: req.user?.nickname,
                    requester_avatar: req.user?.avatar,
                    request_id: data.data.request_id,
                });
            }
            // 好友接受通知
            if (req.path.startsWith('/accept/') && data.data && data.data.requester_id) {
                const requesterId = data.data.requester_id;
                console.log(`[Socket] Emitting friend_accepted to user:${requesterId}`);
                io.to(`user:${requesterId}`).emit('friend_accepted', {
                    friend_id: req.user?.id,
                    friend_nickname: req.user?.nickname,
                    friend_avatar: req.user?.avatar,
                });
            }
        }
        return originalJson(data);
    };
    next();
});
app.use('/api/friends', friendRoutes);
app.use('/api/coins', coinRoutes);
app.use('/api/diamonds', diamondRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/admin', adminRoutes);

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });

// 文件上传接口
const multer = require('multer');

const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, 'uploads/'); },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    },
});

const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) return cb(null, true);
        cb(new Error('Only image files are allowed'));
    },
});

app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ code: -1, message: 'No file uploaded' });
    res.json({ code: 0, message: 'Upload success', data: { url: `/uploads/${req.file.filename}` } });
});

app.post('/api/upload/image', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ code: -1, message: 'No file uploaded' });
    res.json({ code: 0, message: 'Upload success', data: { url: `/uploads/${req.file.filename}` } });
});

app.use('/uploads', express.static('uploads'));

// Admin Dashboard 静态文件
app.use('/admin', express.static(path.join(__dirname, '../public'), { index: 'admin.html' }));

// 404处理
app.use((req, res) => {
    res.status(404).json({ code: -404, message: 'Not found' });
});

// 错误处理
app.use((err, req, res, next) => {
    console.error('[Error]', err);
    res.status(500).json({ code: -500, message: err.message || 'Internal server error' });
});

// 初始化Socket.IO
initSocket(io);

// 启动服务器
const PORT = config.port;

async function startServer() {
    try {
        await initDatabase();
        server.listen(PORT, () => {
            console.log(`🎤 HIU Server running on port: ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => { process.exit(0); });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => { process.exit(0); });
});

module.exports = { app, server, io };
