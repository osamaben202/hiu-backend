/**
 * 账号生成工具
 */

/**
 * 生成随机账号
 * 格式: U + 6位数字 (如 U100001)
 */
const generateAccount = async (queryFn) => {
    const prefix = 'U';
    const min = 100001;
    const max = 999999;
    
    let account;
    let exists = true;
    let attempts = 0;
    
    // 支持传入query函数或{query}对象
    const q = typeof queryFn === 'function' ? queryFn : queryFn.query;
    
    while (exists && attempts < 10) {
        const number = Math.floor(Math.random() * (max - min + 1)) + min;
        account = prefix + number;
        
        const result = await q(
            'SELECT id FROM users WHERE account = $1',
            [account]
        );
        
        exists = result.rows.length > 0;
        attempts++;
    }
    
    if (exists) {
        account = prefix + (Date.now() % 1000000);
    }
    
    return account;
};

/**
 * 生成随机密码
 * 长度: 8位字母数字混合
 */
const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const length = 8;
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
