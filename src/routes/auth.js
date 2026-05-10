/**
 * 认证路由
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../models/db');
const { generateToken, generateRefreshToken, verifyToken } = require('../utils/jwt');
const { generateAccount, generatePassword } = require('../utils/accountGenerator');
const { auth } = require('../middleware/auth');
const response = require('../utils/response');

const router = express.Router();

/**
 * POST /api/auth/register
 * 自动注册账号
 */
router.post('/register', async (req, res) => {
    try {
        // 生成账号和密码
        const account = await generateAccount(query);
        const password = generatePassword();
        const passwordHash = await bcrypt.hash(password, 10);
        
        // 创建用户
        const result = await query(
            `INSERT INTO users (account, password_hash, nickname, role)
             VALUES ($1, $2, $3, $4)
             RETURNING id, account, nickname, role, created_at`,
            [account, passwordHash, `User${account.substring(1)}`, 'user']
        );
        
        const user = result.rows[0];
        
        // 生成Token
        const token = generateToken(user.id, user.role);
        const refreshToken = generateRefreshToken(user.id);
        
        return response.created(res, {
            user: {
                id: user.id,
                account: user.account,
                nickname: user.nickname,
                role: user.role,
                created_at: user.created_at,
            },
            token,
            refreshToken,
            // 返回明文密码
            password,
        }, '注册成功');
    } catch (error) {
        console.error('Register error:', error);
        return response.serverError(res, '注册失败');
    }
});

/**
 * POST /api/auth/login
 * 登录
 */
router.post('/login', async (req, res) => {
    try {
        const { account, password, email } = req.body;
        
        if (!account && !email) {
            return response.badRequest(res, '请输入账号或邮箱');
        }
        
        if (!password) {
            return response.badRequest(res, '请输入密码');
        }
        
        // 根据账号或邮箱查询用户
        let result;
        if (account) {
            result = await query(
                'SELECT * FROM users WHERE account = $1',
                [account]
            );
        } else {
            result = await query(
                'SELECT * FROM users WHERE email = $1',
                [email]
            );
        }
        
        if (result.rows.length === 0) {
            return response.unauthorized(res, '账号或密码错误');
        }
        
        const user = result.rows[0];
        
        // 验证密码
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            return response.unauthorized(res, '账号或密码错误');
        }
        
        // 检查是否被禁用
        if (user.is_banned) {
            return response.forbidden(res, '账号已被禁用');
        }
        
        // 更新最后登录时间
        await query(
            'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
            [user.id]
        );
        
        // 生成Token
        const token = generateToken(user.id, user.role);
        const refreshToken = generateRefreshToken(user.id);
        
        return response.success(res, {
            user: {
                id: user.id,
                account: user.account,
                email: user.email,
                nickname: user.nickname,
                avatar: user.avatar,
                gender: user.gender,
                role: user.role,
                coin_balance: user.coin_balance,
                diamond_balance: user.diamond_balance,
                signature: user.signature,
                text_price: user.text_price,
                image_price: user.image_price,
                video_price: user.video_price,
            },
            token,
            refreshToken,
        }, '登录成功');
    } catch (error) {
        console.error('Login error:', error);
        return response.serverError(res, '登录失败');
    }
});

/**
 * POST /api/auth/refresh
 * 刷新Token
 */
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        
        if (!refreshToken) {
            return response.badRequest(res, '缺少refreshToken');
        }
        
        const decoded = verifyToken(refreshToken);
        if (!decoded || decoded.type !== 'refresh') {
            return response.unauthorized(res, 'refreshToken无效');
        }
        
        // 查询用户
        const result = await query(
            'SELECT id, role, is_banned FROM users WHERE id = $1',
            [decoded.userId]
        );
        
        if (result.rows.length === 0 || result.rows[0].is_banned) {
            return response.unauthorized(res, '用户不存在或已禁用');
        }
        
        const user = result.rows[0];
        
        // 生成新Token
        const token = generateToken(user.id, user.role);
        const newRefreshToken = generateRefreshToken(user.id);
        
        return response.success(res, {
            token,
            refreshToken: newRefreshToken,
        });
    } catch (error) {
        console.error('Refresh error:', error);
        return response.serverError(res, '刷新失败');
    }
});

/**
 * POST /api/auth/bind-email
 * 绑定邮箱
 */
router.post('/bind-email', auth, async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email) {
            return response.badRequest(res, '请输入邮箱');
        }
        
        // 验证邮箱格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return response.badRequest(res, '邮箱格式不正确');
        }
        
        // 验证密码
        const isValid = await bcrypt.compare(password, req.user.password_hash || '');
        if (!isValid) {
            return response.unauthorized(res, '密码错误');
        }
        
        // 检查邮箱是否已被使用
        const existing = await query(
            'SELECT id FROM users WHERE email = $1 AND id != $2',
            [email, req.user.id]
        );
        
        if (existing.rows.length > 0) {
            return response.badRequest(res, '邮箱已被使用');
        }
        
        // 绑定邮箱
        await query(
            'UPDATE users SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [email, req.user.id]
        );
        
        return response.success(res, null, '邮箱绑定成功');
    } catch (error) {
        console.error('Bind email error:', error);
        return response.serverError(res, '绑定失败');
    }
});

/**
 * GET /api/auth/me
 * 获取当前用户信息
 */
router.get('/me', auth, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, account, email, nickname, avatar, gender, role, signature,
                    coin_balance, diamond_balance,
                    text_price, image_price, video_price,
                    created_at, last_login_at
             FROM users WHERE id = $1`,
            [req.user.id]
        );
        
        if (result.rows.length === 0) {
            return response.notFound(res, '用户不存在');
        }
        
        const user = result.rows[0];
        
        // 检查是否是代理
        let agentInfo = null;
        if (user.role === 'agent' || user.role === 'admin') {
            const agentResult = await query(
                'SELECT coin_pool, total_distributed, status FROM agents WHERE user_id = $1',
                [user.id]
            );
            if (agentResult.rows.length > 0) {
                agentInfo = agentResult.rows[0];
            }
        }
        
        return response.success(res, {
            ...user,
            agent_info: agentInfo,
        });
    } catch (error) {
        console.error('Get user info error:', error);
        return response.serverError(res, '获取失败');
    }
});

module.exports = router;
