# Channel Layer 设计

## 概述

Channel Layer 是 Haro 的消息渠道抽象，负责对接外部消息入口（飞书、Telegram、Slack、Web、邮件…），将外部消息统一转成 `InboundMessage` 投递给 Runner/Router，并把 Agent 的执行结果反向回写。

**Channel Layer 与 Provider Abstraction Layer 的区分**：
- **PAL** 抽象“谁在回答”（Claude / Codex / …）
- **Channel** 抽象“从哪里来”（飞书 / Telegram / CLI / …）

两层均受 [可插拔原则](../architecture/overview.md#设计原则) 约束，对 Haro 核心模块零侵入。

## 六层架构中的位置

Channel 层位于 Tool & Service Layer 之上、Agent & Team Runtime 之下，是六层架构中的接入层。

## 核心职责

- **连接管理**：建立/断开与外部系统的连接，处理重连
- **消息转换**：外部格式 ↔ Haro 统一 `InboundMessage` / `OutboundMessage`
- **会话映射**：外部 `chat_id` / `user_id` ↔ Haro `sessionId`
- **渲染降级**：按 Channel 能力决定 Markdown / 纯文本 / 渐进输出
- **事件回调**：delta、工具调用进度、错误，按 Channel 能力暴露

## 首期 Channel（Phase 0）

| Channel | 实现 | 连接方式 | 备注 |
|---------|------|---------|------|
| `cli` | Haro 内置 | 本地 stdin/stdout | 首个 adapter |
| `feishu` | 基于 `lark-bridge-service` 已验证 client 路径的薄封装 | websocket | Phase 0 只发最终结果 |
| `telegram` | 新实现 | long-polling | 私聊支持流式，群聊降级 |

## 与 lark-bridge 的关系

- Phase 0 **不等待** lark-bridge 先发布稳定 npm SDK
- Haro 直接以 `lark-bridge-service` 已验证的 Feishu client 代码路径为基线封装 `@haro/channel-feishu`
- Phase 1 再决定是否抽共享 SDK 包

## Channel 配置

```yaml
channels:
  cli:
    enabled: true

  feishu:
    enabled: false
    appId: "${FEISHU_APP_ID}"
    appSecret: "${FEISHU_APP_SECRET}"
    transport: websocket
    sessionScope: per-chat

  telegram:
    enabled: false
    botToken: "${TELEGRAM_BOT_TOKEN}"
    transport: long-polling
    allowedUpdates:
      - message
      - callback_query
```

## 目录结构

```
~/.haro/
├── channels/
│   ├── feishu/
│   │   ├── state.json         # 非敏感运行态
│   │   └── sessions.sqlite    # 外部会话 → Haro session 映射
│   └── telegram/
│       ├── state.json
│       └── sessions.sqlite
└── logs/
    └── channel-<id>.log
```

> 约束：`state.json` 不得落 access token / app secret / bot token。

## Session 映射

| sessionScope | 映射规则 | 适用场景 |
|--------------|---------|---------|
| `per-chat` | 每个外部群聊/私聊对应一个 Haro session | 群机器人 |
| `per-user` | 每个外部用户对应一个 Haro session（跨群共享） | 个人助手 |
| `per-thread` | 每个外部 thread 一个 session | 需隔离话题的群 |

## 流式消息处理

| Channel | 流式支持 | 策略 |
|---------|---------|------|
| `cli` | 原生支持 | 直接打印 delta |
| `feishu` | Phase 0 关闭 | 本地 buffer，终态一次性发送 |
| `telegram` | 私聊支持 | `@grammyjs/stream` + `@grammyjs/auto-retry` |

## 入站命令路由

- 纯文本消息：转成 `InboundMessage(type='text')`
- Channel 原生命令：转成 `InboundMessage(type='command')`
- CLI slash：仅在 CLI 本地消费，不跨 Channel 传播

## 可插拔与卸载

```bash
haro channel list
haro channel enable feishu
haro channel disable telegram
haro channel remove telegram
haro channel doctor feishu
```

移除 Channel 不得影响其他 Channel 和核心功能；session 映射数据归档到 `~/.haro/archive/channels/<id>-<timestamp>/`，可回滚。

## 违规检测

| 违规行为 | 检测方式 | 处理 |
|---------|---------|------|
| Channel 直接 import Agent Runtime 内部 | 静态依赖扫描 | 拒绝加载 |
| 核心模块出现 `channelId` 特判 | grep / lint | 拒绝合并 |
| Channel 把消息压缩成摘要后投递 | fixture + 代码评审 | 拒绝合并 |
| state 文件持久化敏感凭据 | 集成测试 | 拒绝合并 |
