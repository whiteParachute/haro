---
id: FEAT-009
title: Telegram Channel adapter（grammy + 长轮询）
status: done
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-20
related:
  - ../channel-protocol.md
  - ../../docs/modules/channel-layer.md
  - ./FEAT-008-channel-abstraction-and-feishu.md
  - ../../roadmap/phases.md#p0-9telegram-channel-adapter
---

# Telegram Channel adapter

## 1. Context / 背景

FEAT-008 交付 Channel 抽象和飞书 adapter。Telegram 是第二个外部消息入口（首期两个必须支持的 channel 之一），验证"新 channel 接入不改核心代码"这一可插拔原则。

## 2. Goals / 目标

- G1: `TelegramChannel implements MessageChannel`，通过 `grammy` SDK 对接 Telegram Bot API
- G2: 长轮询模式（公网不可达的环境友好）
- G3: 在**私聊**场景支持增量流式输出，在群聊场景安全降级为最终结果
- G4: 接入向导通过 `haro channel setup telegram` 命令完成，不额外扩大预装 skill 集合

## 3. Non-Goals / 不做的事

- 不实现 webhook 模式（推迟到 Phase 1）
- 不实现 Telegram Bot 的高级功能（inline keyboard、payment 等）
- 不做 Bot 自动注册 / 自动申请 token
- 不做多机器人并发管理

## 4. Requirements / 需求项

- R1: 基于 `grammy` 实现 `TelegramChannel`，`id = 'telegram'`
- R2: `capabilities()` 返回：`{ streaming: true, richText: true, attachments: true, threading: false, requiresWebhook: false, extended: { privateStreamingOnly: true } }`
- R3: 支持长轮询；`allowedUpdates` 至少包含 `message`
- R4: 私聊流式输出使用官方 `@grammyjs/stream` 插件并配合 `@grammyjs/auto-retry`；群聊或非流式 provider 时退化为最终结果一次性发送
- R5: 配置：`channels.telegram.botToken` 从 `~/.haro/config.yaml` 读取，支持 `${TELEGRAM_BOT_TOKEN}` 环境变量插值
- R6: `InboundMessage.content` 保留 Telegram 消息原文；附件消息在 `meta.attachments[]` 中保留 `file_id / file_unique_id / kind`，不把临时下载 URL 作为长期标识
- R7: `healthCheck()` 调用 `getMe()` 验证 token 有效
- R8: 独立 npm 包 `@haro/channel-telegram`，可独立卸载
- R9: `haro channel setup telegram` 内建于 FEAT-008 的 channel 命令族，不新增 `telegram-setup` 预装 skill

## 5. Design / 设计要点

**流式策略**

- 私聊：`ctx.replyWithStream(...)`（官方 stream 插件）
- 群聊：不做渐进编辑，直接最终结果
- 所有 Telegram API 调用挂 `auto-retry`

**session 映射**

- `sessionScope: per-chat`（默认）：`chat.id` → Haro sessionId
- `sessionScope: per-user`：`from.id` → Haro sessionId（跨群共享）

存 `~/.haro/channels/telegram/sessions.sqlite`。

**附件处理**

- Phase 0 不主动下载文件
- 只保留稳定标识（`file_id` / `file_unique_id`）
- 当后续流程明确需要下载时，再调用 `getFile()` 获取**当下有效**的 URL

## 6. Acceptance Criteria / 验收标准

- AC1: `haro channel setup telegram` 走完向导后 `~/.haro/config.yaml::channels.telegram.enabled` 为 true（对应 R5、R9）
- AC2: 从 Telegram 发一条消息 → Agent 回答 → 内容出现在同一 chat（对应 R1、R3、R6）
- AC3: 私聊 + 流式 provider 场景下，Telegram 呈现渐进输出；群聊场景自动降级为最终结果（对应 R4）
- AC4: 非流式 provider（如当前 Codex）时，Telegram 直接一次性收到最终结果（对应 R4）
- AC5: 故意填错 bot token，`haro channel doctor telegram` 返回非零状态码并提示 401/Unauthorized（对应 R7）
- AC6: 用户在群里 @bot 发消息，`sessionScope=per-chat` 时，该群内所有人共享一个 session（对应 per-chat 语义）
- AC7: 移除 `@haro/channel-telegram` 依赖后，飞书 adapter 仍可正常工作，核心启动不报错（对应 R8）
- AC8: 附件消息进入系统时 `meta.attachments` 含 `file_id` 与 `file_unique_id`，而非仅临时 URL（对应 R6）

## 7. Test Plan / 测试计划

- 单元测试：
  - `telegram-inbound.test.ts` — grammy update → `InboundMessage`
  - `stream-mode.test.ts` — 私聊流式 / 群聊降级
  - `session-scope.test.ts` — per-chat / per-user 路由
  - `attachment-meta.test.ts` — 附件稳定标识提取
- 集成测试：
  - `telegram-roundtrip.live.test.ts`（真实 bot + chat） — AC2、AC3
  - `pluggability.test.ts` — AC7
- 手动验证：
  - AC3 流式 UX
  - AC5 错误提示友好度

## 8. Open Questions / 待定问题

全部已关闭（见 Changelog 2026-04-19 决策条）。

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
- 2026-04-19: whiteParachute — 关闭 Open Questions → approved
  - Q1 → 采用 `grammy`；理由：TS 原生、官方插件生态完整、长轮询支持成熟
  - Q2 → 不手写 500ms edit 节流；Phase 0 改为官方 `@grammyjs/stream` + `@grammyjs/auto-retry`，仅在私聊启用
  - Q3 → 不新增 `telegram-setup` 预装 skill；继续由 `haro channel setup telegram` 承担接入向导
  - Q4 → 附件不长期保存临时 URL，只保留 `file_id/file_unique_id`，下载时再临时换取 URL
- 2026-04-20: whiteParachute — done
  - `packages/channel-telegram` 落地 `TelegramChannel`，基于 `grammy` + `@grammyjs/auto-retry` + `@grammyjs/stream` 提供长轮询接入、私聊流式草稿、群聊终态降级、`getMe()` 健康检查，以及 `file_id/file_unique_id` 附件元数据保真
  - `packages/core/src/runtime/{types,runner}.ts` 为 FEAT-009 增加可选事件回调，使流式 text delta 能在不修改 FEAT-005/006 目标边界的前提下经由通用 channel 路径实时透传
  - `packages/cli/src/index.ts` 扩展可选 Telegram 包装载；`packages/cli/test/cli.test.ts` 与 `packages/channel-telegram/test/*.test.ts` 补齐 setup / doctor / pluggability / session-scope / attachment-meta / stream-mode 覆盖
