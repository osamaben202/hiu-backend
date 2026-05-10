# HIU 语音房 App 后端

## 项目介绍

HIU是一款以语音房为核心的社交直播App后端服务，支持多人语音聊天、1对1私密社交、虚拟礼物打赏等功能。

## 技术栈

- **运行环境**: Node.js 16+
- **框架**: Express.js
- **数据库**: PostgreSQL
- **实时通信**: Socket.IO
- **语音引擎**: Agora SDK

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件配置数据库等信息
```

### 3. 初始化数据库

```bash
# 确保 PostgreSQL 已启动
npm run init-db
```

### 4. 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

## API文档

### 认证模块 `/api/auth`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /register | 自动注册 |
| POST | /login | 登录 |
| POST | /refresh | 刷新Token |
| POST | /bind-email | 绑定邮箱 |
| GET | /me | 获取当前用户 |

### 用户模块 `/api/users`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /profile | 获取个人资料 |
| PUT | /profile | 更新个人资料 |
| PUT | /pricing | 设置聊天定价 |
| GET | /:userId | 获取用户信息 |
| GET | / | 获取用户列表(管理员) |

### 房间模块 `/api/rooms`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | / | 获取房间列表 |
| GET | /:roomId | 获取房间详情 |
| POST | / | 创建房间 |
| PUT | /:roomId | 更新房间 |
| DELETE | /:roomId | 关闭房间 |
| POST | /:roomId/join | 加入房间 |
| POST | /:roomId/leave | 离开房间 |
| POST | /:roomId/seat/:index/join | 上麦 |
| POST | /:roomId/seat/:index/leave | 下麦 |
| POST | /:roomId/seat/:index/kick | 踢人下麦 |
| PUT | /:roomId/seat/:index/mute | 闭麦/开麦 |

### 礼物模块 `/api/gifts`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | / | 获取礼物列表 |
| POST | /:giftId/send | 发送礼物 |
| GET | /records | 获取礼物记录 |

### 金币模块 `/api/coins`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /balance | 获取金币余额 |
| GET | /transactions | 获取金币流水 |
| POST | /distribute | 代理分发金币 |
| POST | /admin/allocate | 管理员分配金币 |

### 钻石模块 `/api/diamonds`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /balance | 获取钻石余额 |
| GET | /transactions | 获取钻石流水 |
| POST | /withdraw | 申请提现 |
| GET | /withdraw/all | 获取所有提现申请(管理员) |

### 1对1聊天 `/api/chat`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /conversations | 获取会话列表 |
| GET | /messages/:userId | 获取聊天记录 |
| POST | /send | 发送消息 |

### 视频通话 `/api/video`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /call | 发起通话 |
| PUT | /call/:id/accept | 接听 |
| PUT | /call/:id/reject | 拒绝 |
| PUT | /call/:id/end | 结束通话 |

## Socket.IO 事件

### 客户端发送

- `join_room` - 加入房间
- `leave_room` - 离开房间
- `chat_message` - 发送聊天消息
- `seat_update` - 麦位状态更新
- `room_action` - 房间管理操作
- `gift_sent` - 发送礼物

### 服务器推送

- `user_joined` - 用户加入
- `user_left` - 用户离开
- `chat_message` - 聊天消息
- `seat_update` - 麦位更新
- `user_kicked` - 用户被踢
- `user_banned` - 用户被禁言
- `gift_received` - 收到礼物

## 测试账号

| 账号 | 密码 | 角色 |
|------|------|------|
| A100001 | admin123 | 管理员 |
| AG001 | agent123 | 代理 |
| H100001 | host123 | 主播(女) |
| U100001 | user123 | 用户(男) |

## 目录结构

```
backend/
├── src/
│   ├── config/        # 配置文件
│   ├── middleware/     # 中间件
│   ├── models/        # 数据库模型
│   ├── routes/        # 路由
│   ├── services/      # 服务
│   ├── socket/        # Socket.IO
│   ├── utils/         # 工具函数
│   └── app.js         # 入口文件
├── scripts/           # 脚本
├── docs/              # 文档
└── package.json
```

## License

MIT
# v1.0.1
