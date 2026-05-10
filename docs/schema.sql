-- =============================================
-- HIU 语音房 App 数据库 Schema
-- PostgreSQL
-- =============================================

-- 启用UUID扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- 1. 用户表 (users)
-- =============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account VARCHAR(20) UNIQUE NOT NULL,           -- 账号，如 U100001
    password_hash VARCHAR(255) NOT NULL,          -- 密码哈希(bcrypt)
    email VARCHAR(100) UNIQUE,                     -- 邮箱(可选)
    nickname VARCHAR(50) DEFAULT '',              -- 昵称
    avatar VARCHAR(500) DEFAULT '',                -- 头像URL
    gender VARCHAR(10) DEFAULT 'unknown' CHECK (gender IN ('male', 'female', 'unknown')),
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'host', 'agent', 'admin')),
    signature VARCHAR(200) DEFAULT '',             -- 个性签名
    
    -- 货币余额
    coin_balance DECIMAL(18,2) DEFAULT 0,          -- 金币余额
    diamond_balance DECIMAL(18,2) DEFAULT 0,       -- 钻石余额
    
    -- 异性聊天定价(女性用户设置)
    text_price DECIMAL(10,2) DEFAULT 1,           -- 文字消息价格(金币/条)
    image_price DECIMAL(10,2) DEFAULT 5,           -- 图片消息价格(金币/张)
    video_price DECIMAL(10,2) DEFAULT 10,          -- 视频通话价格(金币/分钟)
    
    -- 状态
    is_banned BOOLEAN DEFAULT FALSE,               -- 是否被禁用
    last_login_at TIMESTAMP,                        -- 最后登录时间
    
    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 用户索引
CREATE INDEX idx_users_account ON users(account);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_gender ON users(gender);

-- =============================================
-- 2. 语音房间表 (rooms)
-- =============================================
CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,                    -- 房间名称
    cover VARCHAR(500) DEFAULT '',                  -- 房间封面URL
    description VARCHAR(500) DEFAULT '',           -- 房间描述
    is_public BOOLEAN DEFAULT TRUE,                -- 是否公开
    password VARCHAR(100) DEFAULT '',               -- 房间密码(私密房间)
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'closed', 'locked')),
    max_seats INTEGER DEFAULT 8,                   -- 最大麦位数
    current_count INTEGER DEFAULT 0,               -- 当前在线人数
    tags VARCHAR(200) DEFAULT '',                  -- 房间标签，逗号分隔
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 房间索引
CREATE INDEX idx_rooms_owner ON rooms(owner_id);
CREATE INDEX idx_rooms_status ON rooms(status);
CREATE INDEX idx_rooms_is_public ON rooms(is_public);
CREATE INDEX idx_rooms_created ON rooms(created_at);

-- =============================================
-- 3. 麦位表 (room_seats)
-- =============================================
CREATE TABLE IF NOT EXISTS room_seats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    seat_index INTEGER NOT NULL CHECK (seat_index >= 0 AND seat_index < 8),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_muted BOOLEAN DEFAULT TRUE,                 -- 是否闭麦
    is_locked BOOLEAN DEFAULT FALSE,               -- 是否锁定
    is_speaking BOOLEAN DEFAULT FALSE,             -- 是否正在说话
    join_at TIMESTAMP,                             -- 上麦时间
    
    UNIQUE(room_id, seat_index),
    UNIQUE(room_id, user_id)
);

-- 麦位索引
CREATE INDEX idx_seats_room ON room_seats(room_id);
CREATE INDEX idx_seats_user ON room_seats(user_id);

-- =============================================
-- 4. 房间参与者表 (room_participants)
-- =============================================
CREATE TABLE IF NOT EXISTS room_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_muted BOOLEAN DEFAULT FALSE,               -- 是否被禁言
    join_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(room_id, user_id)
);

CREATE INDEX idx_participants_room ON room_participants(room_id);
CREATE INDEX idx_participants_user ON room_participants(user_id);

-- =============================================
-- 5. 聊天消息表 (messages)
-- =============================================
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) DEFAULT 'text' CHECK (type IN ('text', 'image', 'gift', 'system')),
    content TEXT NOT NULL,                         -- 消息内容或图片URL
    gift_id UUID,                                   -- 如果是礼物消息
    gift_count INTEGER DEFAULT 1,                  -- 礼物数量
    receiver_id UUID,                              -- 接收者ID(用于房间内私聊或1对1聊天)
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_messages_room ON messages(room_id);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_created ON messages(created_at);
CREATE INDEX idx_messages_type ON messages(type);

-- =============================================
-- 6. 1对1私信表 (private_messages)
-- =============================================
CREATE TABLE IF NOT EXISTS private_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) DEFAULT 'text' CHECK (type IN ('text', 'image')),
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    cost_coins DECIMAL(18,2) DEFAULT 0,            -- 发送花费的金币
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_private_sender ON private_messages(sender_id);
CREATE INDEX idx_private_receiver ON private_messages(receiver_id);
CREATE INDEX idx_private_created ON private_messages(created_at);

-- =============================================
-- 7. 礼物定义表 (gifts)
-- =============================================
CREATE TABLE IF NOT EXISTS gifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL,                     -- 礼物名称
    name_en VARCHAR(50) NOT NULL,                  -- 英文名
    icon VARCHAR(200) DEFAULT '',                  -- 礼物图标URL
    animation VARCHAR(200) DEFAULT '',              -- 动画效果URL
    price INTEGER NOT NULL,                        -- 价格(金币)
    is_active BOOLEAN DEFAULT TRUE,                -- 是否上架
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 插入默认礼物
INSERT INTO gifts (name, name_en, icon, price) VALUES
    ('花朵', 'Flower', '', 10),
    ('爱心', 'Heart', '', 50),
    ('礼盒', 'Gift Box', '', 100),
    ('奖杯', 'Trophy', '', 500),
    ('火箭', 'Rocket', '', 1000),
    ('皇冠', 'Crown', '', 5000)
ON CONFLICT DO NOTHING;

-- =============================================
-- 8. 礼物记录表 (gift_records)
-- =============================================
CREATE TABLE IF NOT EXISTS gift_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gift_id UUID NOT NULL REFERENCES gifts(id),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
    count INTEGER DEFAULT 1,                       -- 礼物数量
    total_coins DECIMAL(18,2) NOT NULL,            -- 总消耗金币
    total_diamonds DECIMAL(18,2) NOT NULL,         -- 主播获得钻石
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_gift_sender ON gift_records(sender_id);
CREATE INDEX idx_gift_receiver ON gift_records(receiver_id);
CREATE INDEX idx_gift_room ON gift_records(room_id);
CREATE INDEX idx_gift_created ON gift_records(created_at);

-- =============================================
-- 9. 金币流水表 (coin_transactions)
-- =============================================
CREATE TABLE IF NOT EXISTS coin_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL CHECK (type IN ('income', 'expense', 'distribute')),
    category VARCHAR(30) NOT NULL,                 -- income/distribute/gift/video_chat/text_chat/image_chat
    amount DECIMAL(18,2) NOT NULL,
    balance_after DECIMAL(18,2) NOT NULL,          -- 变动后余额
    related_user_id UUID,                          -- 关联用户(对方)
    related_room_id UUID,                          -- 关联房间
    description VARCHAR(200) DEFAULT '',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_coin_user ON coin_transactions(user_id);
CREATE INDEX idx_coin_type ON coin_transactions(type);
CREATE INDEX idx_coin_created ON coin_transactions(created_at);

-- =============================================
-- 10. 钻石流水表 (diamond_transactions)
-- =============================================
CREATE TABLE IF NOT EXISTS diamond_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL CHECK (type IN ('income', 'withdraw', 'deduct')),
    category VARCHAR(30) NOT NULL,                 -- gift/video_chat/text_chat/image_chat/withdraw/deduct
    amount DECIMAL(18,2) NOT NULL,
    balance_after DECIMAL(18,2) NOT NULL,
    related_user_id UUID,
    description VARCHAR(200) DEFAULT '',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_diamond_user ON diamond_transactions(user_id);
CREATE INDEX idx_diamond_type ON diamond_transactions(type);
CREATE INDEX idx_diamond_created ON diamond_transactions(created_at);

-- =============================================
-- 11. 代理表 (agents)
-- =============================================
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    distribute_password_hash VARCHAR(255) NOT NULL, -- 分配密码哈希
    coin_pool DECIMAL(18,2) DEFAULT 0,             -- 金币池
    total_distributed DECIMAL(18,2) DEFAULT 0,     -- 已分发总额
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'frozen')),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_agents_user ON agents(user_id);
CREATE INDEX idx_agents_status ON agents(status);

-- =============================================
-- 12. 金币分发记录表 (coin_distributions)
-- =============================================
CREATE TABLE IF NOT EXISTS coin_distributions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    from_user_id UUID REFERENCES users(id),        -- 来源(管理员或上级代理)
    to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL(18,2) NOT NULL,
    distribute_password VARCHAR(50),               -- 分配密码(加密)
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dist_agent ON coin_distributions(agent_id);
CREATE INDEX idx_dist_from ON coin_distributions(from_user_id);
CREATE INDEX idx_dist_to ON coin_distributions(to_user_id);
CREATE INDEX idx_dist_created ON coin_distributions(created_at);

-- =============================================
-- 13. 提现申请表 (withdraw_requests)
-- =============================================
CREATE TABLE IF NOT EXISTS withdraw_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL(18,2) NOT NULL,                 -- 钻石数量
    exchange_rate DECIMAL(10,4) NOT NULL,          -- 提现时的汇率
    usdt_amount DECIMAL(18,4) NOT NULL,            -- 兑换的USD金额
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
    payment_method VARCHAR(50) DEFAULT 'usdt',     -- 支付方式
    payment_address VARCHAR(200),                  -- 收款地址(USDT地址等)
    admin_note VARCHAR(500),                       -- 管理员备注
    processed_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_withdraw_user ON withdraw_requests(user_id);
CREATE INDEX idx_withdraw_status ON withdraw_requests(status);
CREATE INDEX idx_withdraw_created ON withdraw_requests(created_at);

-- =============================================
-- 14. 异性聊天定价表 (private_chat_pricing) - 可扩展，为每个用户独立定价
-- =============================================
CREATE TABLE IF NOT EXISTS private_chat_pricing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text_price DECIMAL(10,2) DEFAULT 1,           -- 文字消息价格
    image_price DECIMAL(10,2) DEFAULT 5,          -- 图片价格
    video_price DECIMAL(10,2) DEFAULT 10,         -- 视频通话价格/分钟
    
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- 15. 系统配置表 (system_config)
-- =============================================
CREATE TABLE IF NOT EXISTS system_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(50) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    description VARCHAR(200),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 插入默认配置
INSERT INTO system_config (key, value, description) VALUES
    ('withdraw_exchange_rate', '10000', '提现汇率：X钻石 = 1 USD'),
    ('min_withdraw_amount', '1000', '最小提现钻石数量'),
    ('app_name', 'HIU', 'App名称'),
    ('agora_app_id', '', '声网App ID'),
    ('agora_app_certificate', '', '声网App Certificate')
ON CONFLICT (key) DO NOTHING;

-- =============================================
-- 16. 视频通话记录表 (video_calls)
-- =============================================
CREATE TABLE IF NOT EXISTS video_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    caller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_name VARCHAR(100) NOT NULL,           -- Agora频道名
    status VARCHAR(20) DEFAULT 'calling' CHECK (status IN ('calling', 'accepted', 'rejected', 'ended', 'cancelled')),
    duration INTEGER DEFAULT 0,                    -- 通话时长(秒)
    total_cost DECIMAL(18,2) DEFAULT 0,            -- 产生的费用
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_video_caller ON video_calls(caller_id);
CREATE INDEX idx_video_receiver ON video_calls(receiver_id);
CREATE INDEX idx_video_status ON video_calls(status);

-- =============================================
-- 17. 房间禁言记录表 (room_bans)
-- =============================================
CREATE TABLE IF NOT EXISTS room_bans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    banned_by UUID NOT NULL REFERENCES users(id),
    reason VARCHAR(200) DEFAULT '',
    expires_at TIMESTAMP,                          -- NULL表示永久
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(room_id, user_id)
);

CREATE INDEX idx_bans_room ON room_bans(room_id);
CREATE INDEX idx_bans_user ON room_bans(user_id);

-- =============================================
-- 触发器：更新updated_at
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rooms_updated_at BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_gifts_updated_at BEFORE UPDATE ON gifts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_withdraw_updated_at BEFORE UPDATE ON withdraw_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
