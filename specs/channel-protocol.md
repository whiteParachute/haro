# Channel 接入协议规范

## 概述

本文档定义 Haro Channel Abstraction 的核心接口协议。Channel 是 Haro 对接外部消息入口（飞书、Telegram、Slack、Web、邮件…）的抽象层，和 [Provider Abstraction Layer](./provider-protocol.md) 并列，分别抽象"谁在回答"和"从哪里来"。

所有 Channel 实现必须遵守此协议，并符合 [可插拔原则](../docs/architecture/overview.md#设计原则)（No-Intrusion Plugin Principle）。

## 核心接口定义

### MessageChannel

```typescript
/**
 * 所有消息渠道必须实现此接口
 */
interface MessageChannel {
  /** Channel 唯一标识符，如 'feishu' | 'telegram' */
  readonly id: string

  /** 启动渠道（建立连接、订阅事件、注册 webhook 等） */
  start(ctx: ChannelContext): Promise<void>

  /** 停止渠道（断开连接、注销 webhook） */
  stop(): Promise<void>

  /** 向指定会话发送消息（由 Agent Runtime 回调） */
  send(sessionId: string, msg: OutboundMessage): Promise<void>

  /** 返回此 Channel 的能力矩阵 */
  capabilities(): ChannelCapabilities

  /** 健康检查（凭据有效、服务可达） */
  healthCheck(): Promise<boolean>
}
```

### ChannelContext

```typescript
/**
 * 启动时由 Haro 注入的宿主能力。Channel 通过它向上层推送消息、
 * 拿到配置、写日志，不得直接 import Agent Runtime 等核心模块。
 */
interface ChannelContext {
  /** 读取渠道私有配置（从 ~/.haro/config.yaml 的 channels.<id>） */
  config: Record<string, unknown>

  /** 向 Haro 投递入站消息（由 Scenario Router 接手分发） */
  onInbound(msg: InboundMessage): Promise<void>

  /** 结构化日志句柄 */
  logger: Logger
}
```

### ChannelCapabilities

```typescript
/**
 * Channel 能力矩阵（超集设计，允许 Channel 特有能力暴露）
 */
interface ChannelCapabilities {
  /** 是否支持流式/增量消息推送 */
  streaming: boolean

  /** 是否支持富文本（Markdown / Card） */
  richText: boolean

  /** 是否支持文件/图片上传下载 */
  attachments: boolean

  /** 是否支持会话级别的 thread/reply */
  threading: boolean

  /** 是否需要 webhook 公网回调 */
  requiresWebhook: boolean

  /** Channel 特有扩展能力 */
  extended?: Record<string, unknown>
}
```

### InboundMessage / OutboundMessage

```typescript
/**
 * 入站消息：外部系统 → Haro
 */
interface InboundMessage {
  /** 渠道会话标识（如飞书 chat_id、Telegram chat_id） */
  sessionId: string
  /** 渠道用户标识 */
  userId: string
  /** 渠道来源（Channel.id） */
  channelId: string
  /** 消息类型 */
  type: 'text' | 'file' | 'image' | 'command' | 'event'
  /** 原始内容（不做压缩，遵守约束①传原文） */
  content: unknown
  /** 时间戳 */
  timestamp: string
  /** Channel 特有元数据（线程 ID、回复目标等） */
  meta?: Record<string, unknown>
}

/**
 * 出站消息：Haro → 外部系统
 */
interface OutboundMessage {
  type: 'text' | 'markdown' | 'card' | 'file' | 'image'
  content: unknown
  /** 是否是流式增量片段（仅 streaming channel 有效） */
  delta?: boolean
  /** 回复的目标消息 ID（Thread） */
  replyTo?: string
}
```

## 首期必须支持的 Channel

| Channel | 实现方式 | 认证 |
|---------|---------|------|
| `feishu` | 复用现有 [lark-bridge](https://github.com/...) 作为底层 SDK，包装成 Haro Channel | 飞书应用凭据（App ID + App Secret） |
| `telegram` | 基于 `node-telegram-bot-api` 或 `grammy` | Bot Token |

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
# ~/.haro/config.yaml
channels:
  feishu:
    enabled: true
    appId: "${FEISHU_APP_ID}"
    appSecret: "${FEISHU_APP_SECRET}"
    # 复用 lark-bridge 的现有配置格式
    mode: "long-polling"   # long-polling | webhook

  telegram:
    enabled: true
    botToken: "${TELEGRAM_BOT_TOKEN}"
    # 公网不可达时可用 long-polling 模式
    mode: "long-polling"
```

## 可插拔与零侵入约束

遵守全局 [可插拔原则](../docs/architecture/overview.md#设计原则)：

1. **独立生命周期**：每个 Channel 独立 `start() / stop()`，彼此隔离
2. **核心模块零硬编码**：Agent Runtime / Scenario Router / Evolution Engine 不得出现 `if channelId === 'feishu'` 这类分支
3. **特有能力通过 `capabilities()` 暴露**：调用方查询后再决定使用
4. **可卸载**：`haro channel disable <id>` 应立即停止对应 Channel，核心功能不受影响

## 入站消息流

```
外部系统（飞书 / Telegram / …）
    ↓
MessageChannel.start() 建立连接
    ↓
捕获消息 → 构造 InboundMessage（保留原文）
    ↓
调用 ctx.onInbound(msg)
    ↓
Haro Scenario Router 根据 sessionId / userId / content 路由到合适的 Agent / Team
    ↓
Agent 执行（Agent Runtime 不感知 channelId，只看到原始任务）
    ↓
输出结果 → ChannelRegistry.get(channelId).send(sessionId, out)
    ↓
MessageChannel.send() 将结果写回外部系统
```

## 违规检测

Channel Registry 在注册 / 运行时检测：

| 违规行为 | 检测方式 | 处理 |
|---------|---------|------|
| Channel 直接 import Agent Runtime | 静态依赖扫描（lint 规则） | 拒绝加载 |
| InboundMessage 传摘要而非原文 | 在协议层无法检测，由代码评审保证 | 评审清单 |
| 核心模块出现 `channelId` 特判 | lint 规则 + PR 检查 | 拒绝合并 |
