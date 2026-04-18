---
id: FEAT-009
title: Telegram Channel adapter（grammy + 长轮询）
status: draft
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-18
related:
  - ../channel-protocol.md
  - ../../docs/modules/channel-layer.md
  - ./FEAT-008-channel-abstraction-and-feishu.md
  - ../../roadmap/phases.md#p0-9telegram-channel-adapter
---

# Telegram Channel adapter

## 1. Context / 背景

FEAT-008 已交付 Channel 抽象和飞书 adapter。Telegram 是第二个外部消息入口（首期两个必须支持的 channel 之一），验证"新 channel 接入不改核心代码"这一可插拔原则。

## 2. Goals / 目标

- G1: `TelegramChannel implements MessageChannel`，通过 `grammy` SDK 对接 Telegram Bot API
- G2: 长轮询模式（公网不可达的环境友好）
- G3: 流式输出通过"编辑消息"节流实现，与飞书 adapter 等价体验
- G4: 接入向导（`haro channel setup telegram`）作为独立 skill

## 3. Non-Goals / 不做的事

- 不实现 webhook 模式（推迟到 Phase 1）
- 不实现 Telegram Bot 的高级功能（inline keyboard、callback_query 深度集成、payment 等）
- 不做 Bot 自动注册 / 自动申请 token
- 不做多机器人并发管理

## 4. Requirements / 需求项

- R1: 基于 `grammy` 实现 `TelegramChannel`，`id = 'telegram'`
- R2: `capabilities()` 返回：`{ streaming: true, richText: true, attachments: true, threading: false, requiresWebhook: false }`
- R3: 支持长轮询；`allowedUpdates` 至少包含 `message`
- R4: 流式输出使用 `editMessageText` 节流（默认 500ms），首条发送后持续 edit 直到 result event 到达
- R5: 配置：`channels.telegram.botToken` 从 `~/.haro/config.yaml` 读取，支持 `${TELEGRAM_BOT_TOKEN}` 环境变量插值
- R6: `InboundMessage.content` 保留 Telegram 消息原文（`message.text`）；附件消息（photo/doc）暂原样传递 URL（Phase 0 不做下载）
- R7: `healthCheck()` 调用 `getMe()` 验证 token 有效
- R8: 独立 npm 包 `@haro/channel-telegram`，可独立卸载
- R9: 新增一个 skill `telegram-setup`（预装候选？见 Q3），或复用 `haro channel setup telegram` 命令完成向导

## 5. Design / 设计要点

**节流的状态机**

```
状态：idle
收到 Runner 的第一个 delta：
  → sendMessage(占位符，如 "⏳ Thinking...")
  → 记录 message_id，状态转 editing
每次 delta（500ms 节流）：
  → editMessageText(累计文本)
收到 result event：
  → 最后一次 edit 写完整内容
  → 状态转 idle
```

**session 映射**

- `sessionScope: per-chat`（默认）：`chat.id` → Haro sessionId
- `sessionScope: per-user`：`from.id` → Haro sessionId（跨群组共享）

存 `~/.haro/channels/telegram/sessions.sqlite`。

**错误**

| 错误 | 处理 |
|------|------|
| 401 Unauthorized | healthCheck false；`/channel setup telegram` 提示重新配置 |
| 429 Too Many Requests | Backoff + 重试（grammy 自带） |
| network | 长轮询自动 reconnect |

## 6. Acceptance Criteria / 验收标准

- AC1: `haro channel setup telegram` 走完向导后 `~/.haro/config.yaml::channels.telegram.enabled` 为 true（对应 R5、R9）
- AC2: 从 Telegram 发一条消息 → Agent 回答 → 内容出现在同一 chat（对应 R1、R3、R6）
- AC3: 开启流式 Provider（Claude）时，Telegram 消息会出现"占位符 → 渐进编辑 → 最终完整"的体验（对应 R4）
- AC4: 非流式 Provider（Codex）时，Telegram 直接一次性收到最终结果，不出现占位符闪现（对应 R4）
- AC5: 故意填错 bot token，`haro channel doctor telegram` 返回非零状态码并提示 401（对应 R7）
- AC6: 用户在群里 @bot 发消息，sessionScope=per-chat 时，该群内所有人共享一个 session（对应 per-chat 语义）
- AC7: 移除 `@haro/channel-telegram` 依赖后，飞书 adapter 仍可正常工作，核心启动不报错（对应 R8）
- AC8: `InboundMessage.content` 在日志里显示完整 `message.text`，未截断（对应 R6）

## 7. Test Plan / 测试计划

- 单元测试：
  - `telegram-inbound.test.ts` — grammy update → InboundMessage 映射
  - `edit-throttle.test.ts` — 节流计时（用 fake timers）
  - `session-scope.test.ts` — per-chat / per-user 路由
- 集成测试：
  - `telegram-roundtrip.live.test.ts`（需要真实 bot + chat） — AC2、AC3
  - `pluggability.test.ts` — AC7
- 手动验证：
  - AC3 流式 UX
  - AC5 错误提示友好度

## 8. Open Questions / 待定问题

- Q1: 是否使用 `grammy`？备选 `node-telegram-bot-api`。grammy 更现代、TS 原生、有插件系统；建议选 grammy
- Q2: 节流时间 500ms 是否太激进？Telegram 的 rate limit 约为 1 msg/s/chat，频繁 edit 会不会被限流？
- Q3: `telegram-setup` 是否纳入 FEAT-010 的 15 个预装 skill？当前不在预装列表，考虑是否要加（会涉及改 FEAT-010 和 docs/modules/skills-system.md）
- Q4: 附件处理：Phase 0 只保留 URL，对下载链接的失效（Telegram URL 有有效期）如何提示用户？

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
