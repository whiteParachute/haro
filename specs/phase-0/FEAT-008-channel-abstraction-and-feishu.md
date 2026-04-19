---
id: FEAT-008
title: Channel 抽象层 + 飞书 adapter（复用 lark-bridge）
status: approved
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-19
related:
  - ../channel-protocol.md
  - ../../docs/modules/channel-layer.md
  - ./FEAT-006-cli-entry-and-cli-channel.md
  - ../../roadmap/phases.md#p0-8channel-抽象层--飞书-adapter
---

# Channel 抽象层 + 飞书 adapter

## 1. Context / 背景

FEAT-006 已交付 `cli` channel 作为首个 adapter。本 spec 正式落地 [Channel 接入协议](../channel-protocol.md)：`MessageChannel` 接口、`ChannelRegistry`、`haro channel` 命令族，并交付飞书 adapter。当前本机已有 `lark-bridge-service` 仓库与可复用的 `FeishuClient` 路径，因此本 spec 以**固定来源 + 薄封装**为 Phase 0 方案，避免等待 lark-bridge 先发布稳定 SDK。

## 2. Goals / 目标

- G1: `MessageChannel` 接口、`ChannelRegistry`、`ChannelContext` 落地
- G2: `haro channel` 命令族：`list / enable / disable / remove / doctor / setup`
- G3: 飞书 adapter 基于 `lark-bridge-service` 已验证的 client 代码路径做薄封装实现
- G4: 严格遵守 [可插拔原则](../../docs/architecture/overview.md#设计原则)：核心零硬编码 `channelId`

## 3. Non-Goals / 不做的事

- 不实现 Telegram（FEAT-009 单独交付）
- 不做 Slack / Web / Email（Phase 1）
- 不做 webhook 回调模式（Phase 0 统一走飞书 websocket 事件流）
- 不在 lark-bridge 仓库内做架构改造；如后续需要共享 SDK，Phase 1 再抽公共包
- 不做飞书 Card 富文本与增量编辑（Phase 1）

## 4. Requirements / 需求项

- R1: `MessageChannel` 接口实现：`id / start / stop / send / capabilities / healthCheck`（见 [channel-protocol](../channel-protocol.md)）
- R2: `ChannelRegistry` 提供 `register / get / list / enable / disable / remove`
- R3: `haro channel` 命令族实现：
  - `list`：列出已注册 channel + 启用状态
  - `enable <id>` / `disable <id>` / `remove <id>`
  - `doctor <id>`：Channel 级健康检查
  - `setup <id>`：调用对应 adapter 的交互式接入向导
- R4: 飞书 adapter（`@haro/channel-feishu`）以固定 commit 引用的 `lark-bridge-service` `FeishuClient` 代码路径为实现基线，封装为 Haro 内部 package；不要求 lark-bridge 先发布 npm SDK
- R5: 飞书 transport 采用 websocket；配置支持 `sessionScope = per-chat | per-user`
- R6: Channel session 映射存储在 `~/.haro/channels/<id>/sessions.sqlite`，默认启用 WAL；若运行环境不支持 WAL，降级到 SQLite 默认模式并记录 warn
- R7: 核心模块（Agent Runtime / Router 等）不得出现 `channelId === 'feishu'` 特判；所有差异通过 `capabilities()` 暴露
- R8: 入站消息 `InboundMessage.content` **保留原文**，不得压缩为摘要；`meta.raw` 可携带飞书原始事件 JSON 引用
- R9: 移除 `@haro/channel-feishu` 包后，核心启动正常 + cli channel 仍可用
- R10: Phase 0 `FeishuChannel.capabilities()` 返回 `streaming=false`、`richText=false`、`attachments=true`、`threading=false`、`requiresWebhook=false`
- R11: `~/.haro/channels/feishu/state.json` 不得持久化 `tenant_access_token` / `appSecret` 等敏感信息，仅允许存最近连接时间、水位、transport 元数据

## 5. Design / 设计要点

**目录**

```
~/.haro/channels/
├── feishu/
│   ├── state.json            # 非敏感运行态（lastConnectedAt 等）
│   └── sessions.sqlite       # chat_id / open_id → Haro sessionId 映射
└── ...
```

**实现边界**

- Haro 侧拥有 `@haro/channel-feishu`
- 其内部复用 `lark-bridge-service` 已验证的飞书连接/消息解析思路
- Phase 0 接受 source-copy / pinned-reference 方案；Phase 1 再看是否抽公共 SDK

**输出策略**

- Phase 0 只发送最终结果（文本/Markdown 降级）
- 即便上游 provider 产生 delta，飞书 channel 也先在本地 buffer，终态一次性发出

**可插拔检测**

```bash
grep -rE "channelId\s*===|channel\.id\s*===" packages/core packages/cli packages/channels  # 结果必须为 0 行
```

## 6. Acceptance Criteria / 验收标准

- AC1: `haro channel list` 输出当前 registry 中所有 channel + 启用状态（cli + feishu）（对应 R2、R3）
- AC2: `haro channel setup feishu` 走完向导后，`~/.haro/config.yaml` 的 `channels.feishu.enabled` 变为 true 且凭据正确填入（对应 R3）
- AC3: 启动 Haro 后从飞书发一条消息 → Agent 收到原文任务 → 处理完 → 回发到同一飞书会话（对应 R4、R5、R8）
- AC4: `InboundMessage.content` 的日志显示完整原文，未出现任何摘要或截断（对应 R8）
- AC5: `haro channel disable feishu` 后从飞书发消息无响应；`haro channel enable feishu` 后恢复（对应 R3）
- AC6: 运行 grep 确认核心无 `channelId` 特判（对应 R7）
- AC7: 移除 `@haro/channel-feishu` 依赖后，`haro run` 在 CLI 中仍然可用（对应 R9）
- AC8: `haro channel doctor feishu` 在凭据错误时返回非零状态码并打印原因（对应 R3）
- AC9: `state.json` 不出现 `tenant_access_token` / `appSecret` 等敏感字段（对应 R11）

## 7. Test Plan / 测试计划

- 单元测试：
  - `channel-registry.test.ts` — register/get/list/enable/disable/remove
  - `feishu-inbound-mapping.test.ts` — 飞书事件 → `InboundMessage`
  - `session-mapping.test.ts` — chat/open_id → sessionId 策略（per-chat / per-user）
  - `state-redaction.test.ts` — `state.json` 无敏感字段
- 集成测试：
  - `channel-command.e2e.test.ts` — `haro channel list/enable/disable`
  - `feishu-roundtrip.live.test.ts`（真实飞书应用） — AC3
  - `pluggability.test.ts` — AC6 + AC7
- 手动验证：
  - AC2 交互向导体验

## 8. Open Questions / 待定问题

全部已关闭（见 Changelog 2026-04-19 决策条）。

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
- 2026-04-19: whiteParachute — 关闭 Open Questions → approved
  - Q1 → `sessions.sqlite` 默认 WAL；若底层 FS 不支持则自动降级并记录 warn
  - Q2 → 不等待 lark-bridge 发布 npm SDK；Phase 0 采用固定 commit 的 `lark-bridge-service` client 代码路径做内部封装
  - Q3 → 飞书 Card / rich text 推迟到 Phase 1；Phase 0 统一 Markdown/文本降级
  - Q4 → Phase 0 不做飞书增量编辑；`capabilities.streaming = false`，规避未验证的 edit 节流策略
  - Q5 → `state.json` 禁止持久化 access token；凭据只从 config/env 读取
