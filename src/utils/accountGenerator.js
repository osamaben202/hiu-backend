/**
 * 账号生成工具
 */

/**
 * 生成随机账号
 * 格式: U + 6位数字 (如 U100001)
 */
const generateAccount = async (db) => {
    const prefix = 'U';
    const min = 100001;
    const max = 999999;
    
    let account;
    let exists = true;
    let attempts = 0;
    
    while (exists && attempts < 10) {
        const number = Math.floor(Math.random() * (max - min + 1)) + min;
        account = prefix + number;
        
        const result = await db.query(
            'SELECT id FROM users WHERE account = $1',
            [account]
        );
        
        exists = result.rows.length > 0;
        attempts++;
    }
    
    if (exists) {
        // 如果随机生成失败，使用时间戳+随机数
        account = prefix + (Date.now() % 1000000);
    }
    
    return account;
};

/**
 * 生成随机密码
 * 长度: 6-8位字母数字混合
 */
const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const length = Math.floor(Math.random() * 3) + 6; // 6-8位
    let password = '';
    
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return password;
};

/**
 * 生成邀请码
 */
const generateInviteCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let code = '';
    
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return code;
};

module.exports = {
    generateAccount,
    generatePassword,
    generateInviteCode,
};
