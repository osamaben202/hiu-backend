/**
 * 数据库自动初始化 - 启动时检查并创建表
 */
const { pool } = require('./db');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

async function initDatabase() {
    try {
        // 检查users表是否存在
        const checkResult = await pool.query(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')"
        );
        
        if (checkResult.rows[0].exists) {
            console.log('✅ 数据库表已存在，跳过初始化');
            return;
        }
        
        console.log('🔄 首次启动，开始初始化数据库...');
        
        // 读取并执行schema
        const schemaPath = path.join(__dirname, '../../docs/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        await pool.query(schema);
        console.log('✅ Schema 创建完成');
        
        // 创建管理员账号
        const adminPassword = await bcrypt.hash('admin123', 10);
        await pool.query(
            `INSERT INTO users (account, password_hash, nickname, role, gender, email)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (account) DO NOTHING`,
            ['A100001', adminPassword, 'Administrator', 'admin', 'unknown', 'admin@hiu.app']
        );
        
        await pool.query(
            `UPDATE users SET coin_balance = 1000000 WHERE account = 'A100001'`
        );
        console.log('✅ 管理员账号: A100001 / admin123');
        
        // 创建测试代理
        const agentPassword = await bcrypt.hash('agent123', 10);
        const agentDistPassword = await bcrypt.hash('dist123', 10);
        
        await pool.query(
            `INSERT INTO users (account, password_hash, nickname, role, gender)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (account) DO NOTHING`,
            ['AG001', agentPassword, 'Test Agent', 'agent', 'male']
        );
        
        await pool.query(
            `INSERT INTO agents (user_id, distribute_password_hash, coin_pool)
             SELECT id, $1, 50000 FROM users WHERE account = 'AG001'
             ON CONFLICT (user_id) DO NOTHING`,
            [agentDistPassword]
        );
        console.log('✅ 代理账号: AG001 / agent123 / 分配密码: dist123');
        
        // 创建测试主播
        const hostPassword = await bcrypt.hash('host123', 10);
        await pool.query(
            `INSERT INTO users (account, password_hash, nickname, role, gender, diamond_balance)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (account) DO NOTHING`,
            ['H100001', hostPassword, 'Test Host', 'host', 'female', 1000]
        );
        console.log('✅ 主播账号: H100001 / host123');
        
        // 创建测试用户
        const userPassword = await bcrypt.hash('user123', 10);
        await pool.query(
            `INSERT INTO users (account, password_hash, nickname, role, gender, coin_balance)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (account) DO NOTHING`,
            ['U100001', userPassword, 'Test User', 'user', 'male', 5000]
        );
        console.log('✅ 用户账号: U100001 / user123');
        
        console.log('🎉 数据库初始化完成！');
    } catch (error) {
        console.error('❌ 数据库初始化失败:', error.message);
        // 不抛出错误，允许服务器继续启动
    }
}

module.exports = { initDatabase };
