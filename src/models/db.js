/**
 * 数据库连接池
 */
const { Pool } = require('pg');
const config = require('../config');

// Railway provides DATABASE_URL, use it if available
const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
    : new Pool(config.db);

// 连接测试
pool.on('connect', () => {
    console.log('📦 数据库连接成功');
});

pool.on('error', (err) => {
    console.error('❌ 数据库连接错误:', err);
});

// 封装查询方法
const query = async (text, params) => {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        if (config.env === 'development') {
            console.log('📝 SQL查询:', { text: text.substring(0, 100), duration, rows: result.rowCount });
        }
        return result;
    } catch (error) {
        console.error('❌ SQL错误:', error.message);
        throw error;
    }
};

// 事务封装
const transaction = async (callback) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    pool,
    query,
    transaction,
};
