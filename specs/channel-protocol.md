# Channel 接入协议规范

## 概述

本文档定义 Haro Channel Abstraction 的核心接口协议。Channel 是 Haro 对接外部消息入口（飞书、Telegram、Slack、Web、邮件…）的抽象层，和 [Provider Abstraction Layer](./provider-protocol.md) 并列，分别抽象"谁在回答"和"从哪里来"。

所有 Channel 实现必须遵守此协议，并符合 [可插拔原则](../docs/architecture/overview.md#设计原则)（No-Intrusion Plugin Principle）。

## 核心接口定义

### MessageChannel

```typescript
interface MessageChannel {
  readonly id: string
  start(ctx: ChannelContext): Promise<void>
  stop(): Promise<void>
  send(sessionId: string, msg: OutboundMessage): Promise<void>
  capabilities(): ChannelCapabilities
  healthCheck(): Promise<boolean>
}
```

### ChannelContext

```typescript
interface ChannelContext {
  config: Record<string, unknown>
  onInbound(msg: InboundMessage): Promise<void>
  logger: Logger
}
```

### ChannelCapabilities

```typescript
interface ChannelCapabilities {
  streaming: boolean
  richText: boolean
  attachments: boolean
  threading: boolean
  requiresWebhook: boolean
  extended?: Record<string, unknown>
}
```

### InboundMessage / OutboundMessage

```typescript
interface InboundMessage {
  sessionId: string
  userId: string
  channelId: string
  type: 'text' | 'file' | 'image' | 'command' | 'event'
  content: unknown
  timestamp: string
  meta?: Record<string, unknown>
}

interface OutboundMessage {
  type: 'text' | 'markdown' | 'card' | 'file' | 'image'
  content: unknown
  delta?: boolean
  replyTo?: string
}
```

## 首期必须支持的 Channel

| Channel | 实现方式 | 认证 |
|---------|---------|------|
| `feishu` | 基于 `lark-bridge-service` 已验证的飞书 client 代码路径，封装为 Haro Channel | 飞书应用凭据（App ID + App Secret） |
| `telegram` | 基于 `grammy` + 官方插件生态 | Bot Token |
| `cli` | Haro 内置 | 无 |

## 注册机制

```typescript
class ChannelRegistry {
  private channels = new Map<string, MessageChannel>()

  register(channel: MessageChannel): void {
    this.channels.set(channel.id, channel)
  }

  get(id: string): MessageChannel {
    const ch = this.channels.get(id)
    if (!ch) throw new Error(`Channel '${id}' not registered`)
    return ch
  }

  list(): MessageChannel[] {
    return Array.from(this.channels.values())
  }
}
```

## 配置示例

```yaml
channels:
  feishu:
    enabled: true
    appId: "${FEISHU_APP_ID}"
    appSecret: "${FEISHU_APP_SECRET}"
    transport: websocket
    sessionScope: per-chat

  telegram:
    enabled: true
    botToken: "${TELEGRAM_BOT_TOKEN}"
    transport: long-polling
    allowedUpdates:
      - message
      - callback_query
```

约定：
- `transport` 是 Channel 侧连接方式，不是上层协议差异
- Channel 若不需要该字段，可在实现层忽略；但配置/日志应回显真实 transport

## 可插拔与零侵入约束

遵守全局 [可插拔原则](../docs/architecture/overview.md#设计原则)：

1. **独立生命周期**：每个 Channel 独立 `start() / stop()`，彼此隔离
2. **核心模块零硬编码**：Agent Runtime / Scenario Router / Evolution Engine 不得出现 `if channelId === 'feishu'` 这类分支
3. **特有能力通过 `capabilities()` 暴露**：调用方查询后再决定使用
4. **可卸载**：`haro channel disable <id>` 应立即停止对应 Channel，核心功能不受影响
5. **不落秘密到 state 文件**：凭据只来自 config / env，Channel 私有状态文件不得落 access token / app secret / bot token

## 入站消息流

```
外部系统（飞书 / Telegram / CLI / …）
    ↓
MessageChannel.start() 建立连接
    ↓
捕获消息 → 构造 InboundMessage（保留原文）
    ↓
调用 ctx.onInbound(msg)
    ↓
Haro Scenario Router / Runner 根据 sessionId / userId / content 路由
    ↓
输出结果 → ChannelRegistry.get(channelId).send(sessionId, out)
    ↓
MessageChannel.send() 将结果写回外部系统
```

## 目录与状态约束

- Channel 私有状态位于 `~/.haro/channels/<id>/`
- `sessions.sqlite` 用于 `chat_id/user_id → Haro sessionId` 映射
- `state.json` 仅允许存放非敏感运行态（最近连接时间、offset、水位、transport 元数据等）
- 若某 Channel 没有独立状态文件需求，可以省略 `state.json`

## 违规检测

Channel Registry 在注册 / 运行时检测：

| 违规行为 | 检测方式 | 处理 |
|---------|---------|------|
| Channel 直接 import Agent Runtime | 静态依赖扫描（lint / grep） | 拒绝加载 |
| InboundMessage 传摘要而非原文 | 协议层无法自动检测，由代码评审 + fixture 校验保证 | 评审拦截 |
| 核心模块出现 `channelId` 特判 | lint / grep + PR 检查 | 拒绝合并 |
| state 文件持久化凭据 | fixture/集成测试检查 `state.json` | 拒绝合并 |
