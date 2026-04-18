# Channel Layer 设计

## 概述

Channel Layer 是 Haro 的消息渠道抽象，负责对接外部消息入口（飞书、Telegram、Slack、Web、邮件…），将外部消息统一转成 `InboundMessage` 投递给 Scenario Router，并把 Agent 的执行结果反向回写。

**Channel Layer 与 Provider Abstraction Layer 的区分**：
- **PAL** 抽象"**谁在回答**"（Claude / Codex / …）
- **Channel** 抽象"**从哪里来**"（飞书 / Telegram / …）

两层均受 [可插拔原则](../architecture/overview.md#设计原则) 约束，对 Haro 核心模块零侵入。

## 与五层架构的关系

Channel 层位于 Tool & Service Layer 之上、Agent & Team Runtime 之下，是新增的第六层：

```
┌─────────────────────────────────────────────┐
│            Human Interface                   │
├─────────────────────────────────────────────┤
│            Evolution Engine                  │
├─────────────────────────────────────────────┤
│            Scenario Router                   │
├─────────────────────────────────────────────┤
│         Agent & Team Runtime                 │
├─────────────────────────────────────────────┤
│       Provider Abstraction Layer             │
├─────────────────────────────────────────────┤
│    Channel Abstraction Layer  ★ 新增         │
│    Feishu / Telegram / Web / CLI / Email    │
├─────────────────────────────────────────────┤
│         Tool & Service Layer                 │
└─────────────────────────────────────────────┘
```

CLI 本身也被视为一个特殊的 Channel（`cli` channel），这样 REPL 交互和消息渠道在上层看来完全同构。

## 核心职责

- **连接管理**：建立/断开与外部系统的连接，处理重连
- **消息转换**：外部格式 ↔ Haro 统一 `InboundMessage` / `OutboundMessage`
- **会话映射**：外部 `chat_id` / `user_id` ↔ Haro `sessionId`
- **富文本渲染**：把 Agent 输出按 Channel 能力渲染（Markdown / Feishu Card / Telegram HTML / 纯文本降级）
- **事件回调**：流式 delta、工具调用进度、错误，按 Channel 能力暴露

## 首期 Channel（Phase 0）

| Channel | 实现 | 复用基础 | 认证 |
|---------|------|---------|------|
| `cli` | Haro 内置 | 无 | 无 |
| `feishu` | 包装现有 [lark-bridge](https://github.com/...) | lark-bridge 的飞书 SDK + 长轮询 | App ID + App Secret |
| `telegram` | 新实现 | `grammy` 或 `node-telegram-bot-api` | Bot Token |

## 与 lark-bridge 的关系

lark-bridge 是一个独立项目，当前作为 Claude Code 扩展使用。Haro 将其作为飞书 Channel 的底层 SDK 复用：

- **不直接 import lark-bridge 内部实现**，而是把 lark-bridge 的飞书 API 封装部分抽为可被 Haro 使用的 npm 包
- Haro 侧只写薄封装：`FeishuChannel` 实现 `MessageChannel` 接口，内部调用 lark-bridge 的 feishu client
- 未来 lark-bridge 可以反过来升级成"基于 Haro 的飞书 Agent 应用"，形成互用

## Channel 配置

```yaml
# ~/.haro/config.yaml
channels:
  cli:
    enabled: true   # CLI 默认启用

  feishu:
    enabled: false  # 需要配置凭据后启用
    appId: "${FEISHU_APP_ID}"
    appSecret: "${FEISHU_APP_SECRET}"
    mode: "long-polling"   # long-polling | webhook
    # 继承 lark-bridge 的会话映射规则
    sessionScope: "per-chat"  # per-chat | per-user

  telegram:
    enabled: false
    botToken: "${TELEGRAM_BOT_TOKEN}"
    mode: "long-polling"
    allowedUpdates:
      - message
      - callback_query
```

## 目录结构

Channel 相关配置与运行态数据：

```
~/.haro/
├── channels/
│   ├── feishu/
│   │   ├── state.json         # 订阅 offset、webhook 回调地址等
│   │   └── sessions.sqlite    # 外部 chat_id → Haro sessionId 映射
│   └── telegram/
│       ├── state.json
│       └── sessions.sqlite
└── logs/
    └── channel-<id>.log
```

## Session 映射

外部 channel 的 `chat_id` / `user_id` 必须映射到 Haro 的 `sessionId`，规则由 `sessionScope` 配置决定：

| sessionScope | 映射规则 | 适用场景 |
|--------------|---------|---------|
| `per-chat` | 每个外部群聊/私聊对应一个 Haro session | 群机器人 |
| `per-user` | 每个外部用户对应一个 Haro session（跨群共享） | 个人助手 |
| `per-thread` | 每个外部 thread 一个 session | 需隔离话题的群 |

Session 映射存储在 `channels/<id>/sessions.sqlite`，不与主 Haro SQLite 混合，方便 Channel 独立卸载。

## 流式消息处理

不同 Channel 对流式输出的支持差异大：

| Channel | 流式支持 | 策略 |
|---------|---------|------|
| `cli` | 原生支持 | 直接打印 delta |
| `feishu` | 编辑消息 | 首条发送后定时 `edit_message`，节流 500ms |
| `telegram` | 编辑消息 | 同上 |

Channel 能力通过 `capabilities().streaming` 暴露，Agent Runtime 不感知具体策略。

## 入站命令路由

Channel 收到的 `/haro ...` 或 @机器人 消息按统一规则路由：

```
InboundMessage
  ↓
Channel 侧预处理（去 @ 前缀、解析 slash 命令）
  ↓
标准化为 command 类型或 text 类型
  ↓
ctx.onInbound(msg) → Scenario Router
  ↓
Scenario Router 判断：内置命令 / Agent 任务 / Team 任务
```

**内置 slash 命令**（所有 channel 共享）：

| 命令 | 作用 |
|------|------|
| `/new` | 新建 session |
| `/agent <id>` | 切换 Agent |
| `/model <provider> [<model>]` | 切换 Provider / Model |
| `/status` | 当前 session 状态 |
| `/help` | 命令帮助 |

## 可插拔与卸载

```bash
haro channel list                 # 列出所有已注册 channel
haro channel enable feishu        # 启用
haro channel disable telegram     # 停用（stop + 保留配置）
haro channel remove telegram      # 移除（stop + 删除配置 + 归档 session 映射）
haro channel doctor feishu        # Channel 级健康检查
```

移除 Channel 不得影响其他 Channel 和核心功能；session 映射数据归档到 `~/.haro/archive/channels/<id>-<timestamp>/`，可回滚。

## 违规检测

| 违规行为 | 检测方式 | 处理 |
|---------|---------|------|
| Channel 直接 import Agent Runtime 内部 | 静态依赖扫描 | 拒绝加载 |
| 核心模块出现 `channelId` 特判 | lint + PR 检查 | 拒绝合并 |
| Channel 把消息压缩成摘要后投递 | 代码评审 | 评审清单 |
| Channel 自行存储业务数据到主 DB | DB schema owner 检查 | 拒绝 |

## 路线

| Phase | Channel 交付 |
|-------|-------------|
| Phase 0 | Channel 抽象层 + `cli` / `feishu` / `telegram` 三个 adapter |
| Phase 1 | Slack / Web chat / Email channel |
| Phase 2 | Evolution-aware 消息路由（按场景切换最合适 channel） |

## 参考规范

- [Channel 接入协议规范](../../specs/channel-protocol.md)
- [可插拔原则](../architecture/overview.md#设计原则)
- [多 Agent 设计约束规范](../../specs/multi-agent-design-constraints.md)
