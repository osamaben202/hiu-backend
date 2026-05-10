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
const adminRoutes = require('./routes/admin');

// 导入Socket.IO
const { initSocket } = require('./socket');

// 导入数据库初始化
const { initDatabase } = require('./models/init-db');

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

// 根路径 - API状态页面
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
    <html>
    <head><title>HIU Backend</title></head>
    <body style="font-family:sans-serif;max-width:600px;margin:50px auto;padding:20px">
    <h1 style="color:#6C5CE7">🎤 HIU Voice Room App</h1>
    <p>Backend is running!</p>
    <h3>API Endpoints:</h3>
    <ul>
    <li><code>POST /api/auth/register</code> - Auto register</li>
    <li><code>POST /api/auth/login</code> - Login</li>
    <li><code>GET /api/rooms</code> - Room list</li>
    <li><code>GET /api/gifts</code> - Gift list</li>
    <li><code>GET /api/admin/*</code> - Admin APIs</li>
    </ul>
    <h3>Test Accounts:</h3>
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse">
    <tr><th>Account</th><th>Password</th><th>Role</th></tr>
    <tr><td>A100001</td><td>admin123</td><td>Admin</td></tr>
    <tr><td>AG001</td><td>agent123</td><td>Agent</td></tr>
    <tr><td>H100001</td><td>host123</td><td>Host</td></tr>
    <tr><td>U100001</td><td>user123</td><td>User</td></tr>
    </table>
    <p style="margin-top:20px;color:gray">Powered by HIU Backend</p>
    </body></html>`);
});

// 健康检查
app.get('/health', (req, res) => {

// API health check (used by Flutter app)});
    res.json({ status: 'ok', timestamp: new Date().toISOString() });

// API health check (used by Flutter app)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
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
app.use('/api/admin', adminRoutes);

// 文件上传接口
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
    limits: { fileSize: 5 * 1024 * 1024 },
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

app.post('/api/upload/avatar', upload.single('avatar'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ code: -1, message: 'No file uploaded' });
    }
    res.json({ code: 0, message: 'Upload success', data: { url: `/uploads/${req.file.filename}` } });
});

app.post('/api/upload/image', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ code: -1, message: 'No file uploaded' });
    }
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
            console.log('');
            console.log('╔════════════════════════════════════════════════════════════╗');
            console.log('║   🎤  HIU Voice Room App Server                            ║');
            console.log(`║   🌐  Server running on port: ${PORT}                         ║`);
            console.log(`║   📦  Environment: ${config.env}                                ║`);
            console.log('╚════════════════════════════════════════════════════════════╝');
            console.log('');
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

