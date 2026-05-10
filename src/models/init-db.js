/**
 * 数据库自动初始化 - 启动时检查并创建表 + 运行迁移
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
            console.log('✅ 数据库表已存在，运行迁移检查...');
            await runMigrations();
            return;
        }
        
        console.log('🔄 首次启动，开始初始化数据库...');
        
        // 读取并执行schema
        const schemaPath = path.join(__dirname, '../../docs/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        await pool.query(schema);
        console.log('✅ Schema 创建完成');
        
        // 创建测试账号
        await createTestAccounts();
        
        console.log('🎉 数据库初始化完成！');
    } catch (error) {
        console.error('❌ 数据库初始化失败:', error.message);
    }
}

async function runMigrations() {
    try {
        // 检查并添加 is_banned 列
        const colCheck = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_banned'"
        );
        if (colCheck.rows.length === 0) {
            await pool.query('ALTER TABLE users ADD COLUMN is_banned BOOLEAN DEFAULT FALSE');
            console.log('✅ 迁移：添加 is_banned 列');
        }
        
        // 检查并添加 signature 列
        const sigCheck = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'signature'"
        );
        if (sigCheck.rows.length === 0) {
            await pool.query("ALTER TABLE users ADD COLUMN signature VARCHAR(200) DEFAULT ''");
            console.log('✅ 迁移：添加 signature 列');
        }
        
        
        // 确保管理员账号密码正确
        const adminPassword = await bcrypt.hash('admin123', 10);
        await pool.query(
            'UPDATE users SET password_hash = $1 WHERE account = \'A100001\'',
            [adminPassword]
        );
        console.log('✅ 管理员密码已同步');

        console.log('✅ 迁移检查完成');
    } catch (error) {
        console.error('❌ 迁移失败:', error.message);
    }
}

async function createTestAccounts() {
    // 创建管理员账号
    const adminPassword = await bcrypt.hash('admin123', 10);
    await pool.query(
        `INSERT INTO users (account, password_hash, nickname, role, gender, email, coin_balance)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (account) DO NOTHING`,
        ['A100001', adminPassword, 'Administrator', 'admin', 'unknown', 'admin@hiu.app', 1000000]
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
    console.log('✅ 代理账号: AG001 / agent123');
    
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
}

module.exports = { initDatabase };
