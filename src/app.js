/**
 * HIU 语音房 App 后端入口
 */
require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const config = require('./config');

// 导入路由
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const roomRoutes = require('./routes/rooms');
const giftRoutes = require('./routes/gifts');
const coinRoutes = require('./routes/coins');
const diamondRoutes = require('./routes/diamonds');
const chatRoutes = require('./routes/chat');
const videoRoutes = require('./routes/video');

// 导入Socket.IO
const { initSocket } = require('./socket');

const app = express();
const server = http.createServer(app);

// Socket.IO 配置
const io = new Server(server, {
    cors: {
        origin: config.cors.origin,
        credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
});

// 中间件
app.use(cors(config.cors));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 请求日志
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API路由
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/gifts', giftRoutes);
app.use('/api/coins', coinRoutes);
app.use('/api/diamonds', diamondRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/video', videoRoutes);

// 文件上传接口（示例）
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    },
});

const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed'));
    },
});

// 上传头像
app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ code: -1, message: 'No file uploaded' });
    }
    
    const avatarUrl = `/uploads/${req.file.filename}`;
    res.json({ 
        code: 0, 
        message: 'Upload success',
        data: { url: avatarUrl }
    });
});

// 上传聊天图片
app.post('/api/upload/image', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ code: -1, message: 'No file uploaded' });
    }
    
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ 
        code: 0, 
        message: 'Upload success',
        data: { url: imageUrl }
    });
});

// 静态文件服务
app.use('/uploads', express.static('uploads'));

// 404处理
app.use((req, res) => {
    res.status(404).json({ code: -404, message: 'Not found' });
});

// 错误处理
app.use((err, req, res, next) => {
    console.error('[Error]', err);
    res.status(500).json({ 
        code: -500, 
        message: err.message || 'Internal server error' 
    });
});

// 初始化Socket.IO
initSocket(io);

// 启动服务器
const PORT = config.port;
server.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                                                            ║');
    console.log('║   🎤  HIU Voice Room App Server                            ║');
    console.log('║                                                            ║');
    console.log(`║   🌐  Server running on port: ${PORT}                         ║`);
    console.log(`║   📦  Environment: ${config.env}                                ║`);
    console.log('║                                                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

module.exports = { app, server, io };
