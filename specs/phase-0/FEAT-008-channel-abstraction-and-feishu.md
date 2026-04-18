---
id: FEAT-008
title: Channel 抽象层 + 飞书 adapter（复用 lark-bridge）
status: draft
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-18
related:
  - ../channel-protocol.md
  - ../../docs/modules/channel-layer.md
  - ./FEAT-006-cli-entry-and-cli-channel.md
  - ../../roadmap/phases.md#p0-8channel-抽象层--飞书-adapter
---

# Channel 抽象层 + 飞书 adapter

## 1. Context / 背景

FEAT-006 已交付 `cli` channel 作为首个 adapter。本 spec 正式落地 [Channel 接入协议](../channel-protocol.md)：`MessageChannel` 接口、`ChannelRegistry`、`haro channel` 命令族，并交付飞书 adapter（复用已有 lark-bridge 项目作为底层 SDK）。这是 Haro 第一次对接外部消息入口，为后续 Telegram（FEAT-009）和 Phase 1 的 Slack/Web 铺路。

## 2. Goals / 目标

- G1: `MessageChannel` 接口、`ChannelRegistry`、`ChannelContext` 落地
- G2: `haro channel` 命令族：`list / enable / disable / remove / doctor / setup`
- G3: 飞书 adapter 基于 lark-bridge 的飞书 SDK 薄封装实现
- G4: 严格遵守 [可插拔原则](../../docs/architecture/overview.md#设计原则)：核心零硬编码 channelId

## 3. Non-Goals / 不做的事

- 不实现 Telegram（FEAT-009 单独交付）
- 不做 Slack / Web / Email（Phase 1）
- 不做 webhook 回调模式（Phase 0 仅 long-polling，webhook 推迟）
- 不做 lark-bridge 项目本身的改动；如需 lark-bridge 暴露公共 API，以独立 PR 方式进行
- 不做 Channel 级进化评估（Phase 2）

## 4. Requirements / 需求项

- R1: `MessageChannel` 接口实现：`id / start / stop / send / capabilities / healthCheck`（见 [channel-protocol](../channel-protocol.md)）
- R2: `ChannelRegistry` 提供 `register / get / list / enable / disable / remove`
- R3: `haro channel` 命令族实现：
  - `list`：列出已注册 channel + 启用状态
  - `enable <id>` / `disable <id>` / `remove <id>`
  - `doctor <id>`：Channel 级健康检查
  - `setup <id>`：调用对应 adapter 的交互式接入向导（飞书走 `lark-setup` skill）
- R4: 飞书 adapter（`@haro/channel-feishu`）：复用 lark-bridge 的飞书 SDK 部分，实现 `FeishuChannel implements MessageChannel`
- R5: 飞书 adapter 支持 long-polling 模式；`sessionScope` 配置 `per-chat` / `per-user`
- R6: Channel session 映射存储在 `~/.haro/channels/<id>/sessions.sqlite`（独立于主 DB）
- R7: 核心模块（Agent Runtime / Scenario Router 等）不得出现 `channelId === 'feishu'` 特判；所有差异通过 `capabilities()` 暴露
- R8: 入站消息 `InboundMessage.content` **保留原文**，不得压缩为摘要（遵守多 Agent 约束①）
- R9: 移除 `@haro/channel-feishu` 包后，核心启动正常 + cli channel 仍可用

## 5. Design / 设计要点

**目录**

```
~/.haro/channels/
├── feishu/
│   ├── state.json            # lark-bridge 的 offset/订阅元数据
│   └── sessions.sqlite       # chat_id → Haro sessionId 映射
└── ...
```

**lark-bridge 的复用方式**

Phase 0 不强求 lark-bridge 发布独立 npm 包。两种可选接入形式（择一）：

1. **Git submodule / workspace 依赖**：把 lark-bridge 核心部分作为本仓库的子模块
2. **HTTP/IPC 调用**：Haro 通过本地 socket 调 lark-bridge daemon

本 spec 推荐方案 1（方案 2 延迟高、依赖外部进程）。具体路径见 Open Questions Q2。

**命令行向导（setup）**

`haro channel setup feishu` → 调用 `lark-setup` skill（FEAT-010 预装），skill 内部交互问 App ID / App Secret / 模式后写回 `~/.haro/config.yaml`。

**可插拔检测**

Phase 0 提供简化 grep 规则：
```
grep -rE "channelId\s*===|channel\.id\s*===" packages/core packages/cli
```
必须为 0 行；后续 Phase 1 升级为 lint 规则。

## 6. Acceptance Criteria / 验收标准

- AC1: `haro channel list` 输出当前 registry 中所有 channel + 启用状态（cli + feishu）（对应 R2、R3）
- AC2: `haro channel setup feishu` 走完向导后，`~/.haro/config.yaml` 的 `channels.feishu.enabled` 变为 true 且凭据正确填入（对应 R3）
- AC3: 启动 Haro 后从飞书发一条消息 → Agent 收到原文任务 → 处理完 → 回发到同一飞书会话（对应 R4、R5、R8）
- AC4: `InboundMessage.content` 的日志显示完整原文，未出现任何摘要或截断（对应 R8）
- AC5: `haro channel disable feishu` 后从飞书发消息无响应；`haro channel enable feishu` 后恢复（对应 R3）
- AC6: 运行 `grep -rE "channelId\s*===|channel\.id\s*===" packages/core packages/cli` 返回 0 行（对应 R7）
- AC7: 移除 `@haro/channel-feishu` 依赖后，`haro run` 在 CLI 中仍然可用（对应 R9）
- AC8: `haro channel doctor feishu` 在凭据错误时返回非零状态码并打印原因（对应 R3）

## 7. Test Plan / 测试计划

- 单元测试：
  - `channel-registry.test.ts` — register/get/list/enable/disable/remove
  - `feishu-inbound-mapping.test.ts` — lark-bridge 事件 → InboundMessage
  - `session-mapping.test.ts` — chat_id → sessionId 策略（per-chat / per-user）
- 集成测试：
  - `channel-command.e2e.test.ts` — `haro channel list/enable/disable`（mock adapter）
  - `feishu-roundtrip.live.test.ts`（需要真实飞书应用） — AC3 端到端
  - `pluggability.test.ts` — AC6 + AC7
- 手动验证：
  - AC2 交互向导体验

## 8. Open Questions / 待定问题

- Q1: sessions.sqlite 是否 WAL？独立 DB 与主 DB 的一致性需求其实很低，SQLite 默认就够
- Q2: lark-bridge 的接入形式：submodule 还是独立包？需要查 lark-bridge 当前是否已 npm 化
- Q3: 飞书 adapter 是否要在 Phase 0 支持富文本（Card）？建议先支持 Markdown 文本，Card 作为 Phase 1
- Q4: 当 `capabilities.streaming = true` 时飞书使用 edit_message 节流策略，节流时间默认 500ms 是否合理？
- Q5: 安全性：`~/.haro/channels/feishu/state.json` 是否需要加密（含飞书 tenant_access_token）？

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
