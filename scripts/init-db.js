/**
 * 数据库初始化脚本
 * 运行: node scripts/init-db.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// Railway provides DATABASE_URL, use it if available
const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
    : new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'hiu_app',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
    });

async function initDatabase() {
    const client = await pool.connect();
    
    try {
        console.log('🔄 开始初始化数据库...');
        
        // 读取并执行schema
        const schemaPath = path.join(__dirname, '../docs/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        await client.query(schema);
        console.log('✅ Schema 创建完成');
        
        // 创建管理员账号
        const adminPassword = await bcrypt.hash('admin123', 10);
        await client.query(
            `INSERT INTO users (account, password_hash, nickname, role, gender, email)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (account) DO NOTHING`,
            ['A100001', adminPassword, 'Administrator', 'admin', 'unknown', 'admin@hiu.app']
        );
        console.log('✅ 管理员账号已创建: A100001 / admin123');
        
        // 更新管理员金币池
        await client.query(
            `UPDATE users SET coin_balance = 1000000 WHERE account = 'A100001'`
        );
        
        // 创建测试代理账号
        const agentPassword = await bcrypt.hash('agent123', 10);
        const agentDistributePassword = await bcrypt.hash('dist123', 10);
        
        await client.query(
            `INSERT INTO users (account, password_hash, nickname, role, gender)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (account) DO NOTHING`,
            ['AG001', agentPassword, 'Test Agent', 'agent', 'male']
        );
        
        // 创建代理记录
        await client.query(
            `INSERT INTO agents (user_id, distribute_password_hash, coin_pool)
             SELECT id, $1, 50000 FROM users WHERE account = 'AG001'
             ON CONFLICT (user_id) DO NOTHING`,
            [agentDistributePassword]
        );
        console.log('✅ 测试代理账号已创建: AG001 / agent123 / 分配密码: dist123');
        
        // 创建测试主播账号
        const hostPassword = await bcrypt.hash('host123', 10);
        await client.query(
            `INSERT INTO users (account, password_hash, nickname, role, gender, diamond_balance)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (account) DO NOTHING`,
            ['H100001', hostPassword, 'Test Host', 'host', 'female', 1000]
        );
        console.log('✅ 测试主播账号已创建: H100001 / host123');
        
        // 创建测试用户账号
        const userPassword = await bcrypt.hash('user123', 10);
        await client.query(
            `INSERT INTO users (account, password_hash, nickname, role, gender, coin_balance)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (account) DO NOTHING`,
            ['U100001', userPassword, 'Test User', 'user', 'male', 5000]
        );
        console.log('✅ 测试用户账号已创建: U100001 / user123');
        
        console.log('\n🎉 数据库初始化完成！');
        console.log('\n测试账号汇总:');
        console.log('┌─────────────┬────────────┬──────────────┬─────────────────┐');
        console.log('│ 账号        │ 密码       │ 角色         │ 备注            │');
        console.log('├─────────────┼────────────┼──────────────┼─────────────────┤');
        console.log('│ A100001     │ admin123   │ 管理员       │ 最高权限        │');
        console.log('│ AG001       │ agent123   │ 代理         │ 分配密码: dist123│');
        console.log('│ H100001     │ host123    │ 主播(女)     │ 1000钻石        │');
        console.log('│ U100001     │ user123    │ 用户(男)     │ 5000金币        │');
        console.log('└─────────────┴────────────┴──────────────┴─────────────────┘');
        
    } catch (error) {
        console.error('❌ 初始化失败:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 运行
initDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
