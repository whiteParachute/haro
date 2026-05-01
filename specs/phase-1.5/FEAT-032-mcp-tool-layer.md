---
id: FEAT-032
title: MCP 工具层 + 4 个核心工具
status: draft
phase: phase-1.5
owner: whiteParachute
created: 2026-05-01
updated: 2026-05-01
related:
  - ../phase-1/FEAT-021-memory-fabric-v1.md
  - ../phase-1/FEAT-022-evolution-asset-registry.md
  - ../phase-1/FEAT-023-permission-token-budget-guard.md
  - ../phase-1.5/FEAT-031-web-channel.md
  - ../phase-1.5/FEAT-033-scheduled-tasks.md
  - ../channel-protocol.md
  - ../../docs/architecture/overview.md
  - ../../docs/planning/redesign-2026-05-01.md
---

# MCP 工具层 + 4 个核心工具

## 1. Context / 背景

Haro Phase 0 / Phase 1 主要让 Codex Agent 通过 SDK 内置工具与外界交互（读写文件、执行命令）。但 agent 无法**显式发消息到任意 channel**、**显式写记忆与查记忆**、**显式调度任务**——这些动作要么藏在 agent 主循环里、要么完全没接通。结果是：

1. agent 只能在主对话流中被动回复，无法在长时间任务后再回到 IM 通知用户
2. agent 不能用记忆作为工作面（只能在 session 内查上下文，不能跨 session 显式 remember/recall）
3. agent 不能自己安排"X 小时后再做 Y"

happyclaw 通过 11 个内置 MCP 工具解决了这个问题，让 agent 真正"动手做事"。Haro Phase 1.5 引入 MCP 工具层 + 4 个最核心的工具，覆盖**消息路由 / 记忆读写 / 任务调度**三大缺口；其他工具按需在 Phase 2.0+ 增补。

## 2. Goals / 目标

- G1: 新增内置 MCP server，agent 可通过 MCP 协议调用 Haro 平台原生能力。
- G2: 实现 4 个核心 MCP 工具：`send_message`、`memory_query`、`memory_remember`、`schedule_task`。
- G3: 工具调用必须经 FEAT-023 Permission/Budget Guard 守门，敏感动作（跨 channel 发消息、写 platform-scope 记忆）需要分级审批。
- G4: MCP server 与 channel/memory/scheduled-task 等核心模块解耦，新增工具不必动核心代码（保持可插拔原则）。
- G5: 工具调用必须被 FEAT-040 Self-Monitor 捕获（埋点），为 Phase 2.0 进化感知层喂数据。

## 3. Non-Goals / 不做的事

- 不实现 happyclaw 全部 11 个工具；本 spec 只做核心 4 个。`send_image` / `send_file` / `pause_task` / `resume_task` / `cancel_task` / `register_group` 等留给 Phase 1.5/2.0 后续 spec。
- 不实现 MCP **client**（agent 端调用对方 MCP server 的能力），只实现 MCP **server**（agent 端调用 Haro 自身能力）。
- 不实现 MCP server 跨进程暴露给第三方 agent；仅供 Haro 内置 agent runtime 通过 IPC 文件通道调用。
- 不引入 vector search 工具；`memory_query` 走现有 FTS5。
- 不做工具版本协商；Phase 1.5 只支持单版本，工具增删通过 release notes 公告。

## 4. Requirements / 需求项

- R1: 新建 `packages/mcp-tools/` 包，包含 MCP server 启动器和 4 个核心工具实现。
- R2: MCP server 必须通过 stdio + JSON-RPC（MCP 标准协议）与 agent runtime 通信，不引入额外 HTTP 端口。
- R3: 工具描述（name / description / inputSchema）必须以 Zod schema 维护，自动转换为 JSON Schema 对外暴露给 agent。
- R4: `send_message` 工具：参数 `{ channelId, sessionId, content, attachments? }`；调用前必须校验 channelId 已 enabled、sessionId 属于当前调用方、content 非空；跨 channel 发送（即调用方不在 sessionId 所属 channel）需要 FEAT-023 `external-service` 权限。
- R5: `memory_query` 工具：参数 `{ query, scope?, limit? }`；scope 默认 agent；返回结构化 hits（id / scope / excerpt / score / sourceRef）；FTS5 走 Memory Fabric `read-model`。
- R6: `memory_remember` 工具：参数 `{ content, scope, dimension?, sourceRef? }`；scope 写 platform / shared 需要 `write-shared` 权限审批；走 Memory Fabric write API + FEAT-022 Evolution Asset Registry 记录 asset。
- R7: `schedule_task` 工具：参数 `{ when, taskSpec }`，`when` 支持 ISO timestamp（一次性）或 cron 表达式；`taskSpec` 复用 FEAT-033 task DTO；调用前必须校验 cron 合法、when 非过期。
- R8: 所有工具调用必须写 `tool_invocation_log`：调用方 / 工具 / 参数 hash / 结果状态 / 耗时；payload 不入日志，避免记录敏感内容。
- R9: 工具失败必须返回结构化错误 `{ code, message, retryable, remediation? }`，code 取自工具规范的 error catalog。
- R10: MCP server 必须由 agent runtime 在 session 启动时 spawn / attach，session 终止时 graceful shutdown；不允许 leak 子进程。

## 5. Design / 设计要点

### 5.1 包结构

```
packages/mcp-tools/
├── src/
│   ├── server.ts             # MCP server 启动 + JSON-RPC 路由
│   ├── transport.ts          # stdio / IPC 文件通道适配
│   ├── tools/
│   │   ├── send-message.ts
│   │   ├── memory-query.ts
│   │   ├── memory-remember.ts
│   │   └── schedule-task.ts
│   ├── registry.ts           # 工具注册表（动态加载）
│   ├── audit.ts              # tool_invocation_log 写入
│   └── permission.ts         # 调用 FEAT-023 Guard
└── package.json
```

### 5.2 工具调用守门链

```
agent.callTool(name, params)
    │
    ▼
mcp-tools/server  →  JSON-RPC parse
    │
    ▼
permission.evaluate(tool, params, context)
  ├─ allow      → 进入工具实现
  ├─ deny       → 返回 PERMISSION_DENIED
  └─ approval   → 写 needs_approval 队列，agent 等待 / 返回 ASYNC_PENDING
    │
    ▼
tool.execute(params)
    │
    ▼
audit.write({ tool, params_hash, result, latency, decision })
```

### 5.3 工具 schema 示例（send_message）

```ts
const SendMessageSchema = z.object({
  channelId: z.string().regex(/^[a-z0-9_-]+$/),
  sessionId: z.string().min(1),
  content: z.union([z.string().min(1), z.array(MessageBlock)]),
  attachments: z.array(AttachmentRef).max(10).optional(),
});
```

### 5.4 与现有模块的接合点

- `send_message` → `ChannelRegistry.get(channelId).send(...)`（FEAT-008 / FEAT-031）
- `memory_query` → `MemoryFabric.query(...)`（FEAT-021）
- `memory_remember` → `MemoryFabric.write(...)` → `EvolutionAssetRegistry.recordAsset(...)`（FEAT-022）
- `schedule_task` → `ScheduledTaskManager.create(...)`（FEAT-033）

### 5.5 audit 表结构

```sql
CREATE TABLE tool_invocation_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  decision TEXT NOT NULL,        -- allowed / denied / needs-approval
  result_status TEXT NOT NULL,   -- success / error / pending
  latency_ms INTEGER,
  error_code TEXT,
  invoked_at INTEGER NOT NULL
);
```

## 6. Acceptance Criteria / 验收标准

- AC1: agent 在一次 session 中调用 `send_message` 把消息路由到 web channel 另一个 session，消息正确出现在目标 session 流中（对应 R4）。
- AC2: `memory_query` 对一个已写入的 platform-scope 记忆能返回命中，excerpt 与 score 字段非空（对应 R5）。
- AC3: `memory_remember` 写 platform-scope 时返回 `needs-approval`，写 agent-scope 直接成功；FEAT-022 asset 表对应记录被创建（对应 R6）。
- AC4: `schedule_task` 注册 `cron: "0 * * * *"` 任务后，FEAT-033 ScheduledTaskManager 列表能查到该任务（对应 R7）。
- AC5: 工具调用失败时返回结构化 `{ code, message, retryable, remediation }`；调用方 retry 逻辑能正确分支（对应 R9）。
- AC6: 关闭 agent session 后 MCP server 子进程在 5 秒内退出，无 leak（对应 R10）。
- AC7: `tool_invocation_log` 表包含本次会话所有工具调用记录，params 字段是 hash 而非原文（对应 R8）。

## 7. Test Plan / 测试计划

- 单元测试：每个工具的 input validation / permission 决策 / 错误码分支；至少 6 用例 / 工具。
- 集成测试：MCP server 启动 → agent 走 JSON-RPC 调用 → 守门链 → 实际效果（消息到达 / 记忆写入 / 任务注册）。
- 安全测试：跨 session 越权调用 / 跨 scope 写记忆 / cron 注入攻击；至少 5 negative case。
- 性能：单工具调用 P95 latency 不超过 50ms（不含外部 IM API 调用时间）。
- 回归：FEAT-021 Memory Fabric / FEAT-022 Asset Registry / FEAT-023 Permission Guard / FEAT-031 Web Channel / FEAT-033 Scheduled Tasks 已有用例。

## 8. Open Questions / 待定问题

- Q1: MCP server 是 per-session spawn 还是 long-lived shared？倾向 per-session spawn（隔离强、调试简单），但启动开销可能在密集对话中放大；待 FEAT-040 Self-Monitor 数据后回审。
- Q2: 工具 timeout 默认值？倾向 30s，但 `schedule_task` cron 注册类应该 < 1s；按工具维度配置。
- Q3: 是否要支持工具间组合（A → B 链式）？倾向不做，让 agent 自行编排，避免引入 workflow DSL。
- Q4: `memory_remember` 是否暴露 `dimension`？Memory Fabric 现已有 dimension 概念，但 agent 自动选 dimension 容易乱。倾向 Phase 1.5 只暴露 scope，dimension 由 Memory Fabric 内部规则推断。

## 9. Changelog / 变更记录

- 2026-05-01: whiteParachute — 初稿（Phase 1.5 自用底座补完批次 1）
