/**
 * 后端配置文件
 */
require('dotenv').config();

module.exports = {
    // 服务器配置
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
    
    // 数据库配置
    db: {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'hiu_app',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
    },
    
    // JWT配置
    jwt: {
        secret: process.env.JWT_SECRET || 'hiu-app-secret-key-2024',
        expiresIn: '7d', // 7天
        refreshExpiresIn: '30d', // 30天
    },
    
    // CORS配置
    cors: {
        origin: process.env.CORS_ORIGIN || '*',
        credentials: true,
    },
    
    // Agora配置
    agora: {
        appId: process.env.AGORA_APP_ID || '',
        appCertificate: process.env.AGORA_APP_CERTIFICATE || '',
    },
    
    // AWS S3配置
    s3: {
        endpoint: process.env.S3_ENDPOINT || '',
        region: process.env.S3_REGION || 'us-east-1',
        accessKeyId: process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || '',
        bucket: process.env.S3_BUCKET || 'hiu-app',
    },
    
    // 管理员初始密码(用于创建第一个管理员)
    admin: {
        defaultPassword: 'admin123',
    },
};
