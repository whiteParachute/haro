---
id: FEAT-032
title: MCP 工具层 + 4 个核心工具
status: done
phase: phase-1.5
owner: whiteParachute
created: 2026-05-01
updated: 2026-05-06
related:
  - ../phase-1/FEAT-022-evolution-asset-registry.md
  - ../phase-1/FEAT-023-permission-token-budget-guard.md
  - ../phase-1.5/FEAT-031-web-channel.md
  - ../phase-1.5/FEAT-033-scheduled-tasks.md
  - ../channel-protocol.md
  - ../../docs/architecture/overview.md
  - ../../docs/planning/archive/redesign-2026-05-01.md
---

# MCP 工具层 + 4 个核心工具

## 1. Context / 背景

Haro Phase 0 / Phase 1 主要让 Codex Agent 通过 SDK 内置工具与外界交互（读写文件、执行命令）。但 agent 无法**显式发消息到任意 channel**、**显式写记忆与查记忆**、**显式调度任务**——这些动作要么藏在 agent 主循环里、要么完全没接通。结果是：

1. agent 只能在主对话流中被动回复，无法在长时间任务后再回到 IM 通知用户
2. agent 不能用记忆作为工作面（只能在 session 内查上下文，不能跨 session 显式 remember/recall）
3. agent 不能自己安排"X 小时后再做 Y"

happyclaw 通过 11 个内置 MCP 工具解决了这个问题，让 agent 真正"动手做事"。Haro Phase 1.5 引入 MCP 工具层 + 4 个最核心的工具，覆盖**消息路由 / 记忆读写 / 任务调度**三大缺口；其他工具按需在 sidecar-era 增补。

## 2. Goals / 目标

- G1: 新增内置 MCP server，agent 可通过 MCP 协议调用 Haro 平台原生能力。
- G2: 实现 4 个核心 MCP 工具：`send_message`、`memory_query`、`memory_remember`、`schedule_task`。
- G3: 工具调用必须经 FEAT-023 Permission/Budget Guard 守门，敏感动作（跨 channel 发消息、写 platform-scope 记忆）需要分级审批。
- G4: MCP server 与 channel / scheduled-task 等核心模块解耦；memory 工具为历史兼容，sidecar 新路径由 AgentDock 提供，新增工具不必动核心代码（保持可插拔原则）。
- G5: 工具调用必须被 sidecar observation pipeline 捕获（埋点），为 sidecar observation/proposal pipeline 喂数据。

## 3. Non-Goals / 不做的事

- 不实现 happyclaw 全部 11 个工具；本 spec 只做核心 4 个。`send_image` / `send_file` / `pause_task` / `resume_task` / `cancel_task` / `register_group` 等留给 Phase 1.5/2.0 后续 spec。
- 不实现 MCP **client**（agent 端调用对方 MCP server 的能力），只实现 MCP **server**（agent 端调用 Haro 自身能力）。
- 不实现 MCP server 跨进程暴露给第三方 agent；仅供 Haro 内置 agent runtime 通过 IPC 文件通道调用。
- 不引入 vector search 工具；`memory_query` 是历史 Haro workbench 兼容工具；sidecar 新路径走 AgentDock memory MCP/API，不引 FTS5、不引向量索引。
- 不做工具版本协商；Phase 1.5 只支持单版本，工具增删通过 release notes 公告。

## 4. Requirements / 需求项

- R1: 新建 `packages/mcp-tools/` 包，包含 MCP server 启动器和 4 个核心工具实现。
- R2: MCP server 必须通过 stdio + JSON-RPC（MCP 标准协议）与 agent runtime 通信，不引入额外 HTTP 端口。
- R3: 工具描述（name / description / inputSchema）必须以 Zod schema 维护，自动转换为 JSON Schema 对外暴露给 agent。
- R4: `send_message` 工具：参数 `{ channelId, sessionId, content, attachments? }`；调用前必须校验 channelId 已 enabled、sessionId 属于当前调用方、content 非空；跨 channel 发送（即调用方不在 sessionId 所属 channel）需要 FEAT-023 `external-service` 权限。
- R5: `memory_query` 工具：参数 `{ query, scope?, dimension?, limit? }`；scope 默认 agent；`dimension` 取值同 R6（`user` / `feedback` / `project` / `reference`，缺省即不过滤）；返回结构化 hits（id / scope / dimension / excerpt / score / sourceRef）；历史兼容层可读旧 Haro MemoryFabric，sidecar 新路径应调用 AgentDock memory MCP/API。
- R6: `memory_remember` 工具：参数 `{ content, scope, dimension?, sourceRef? }`；`dimension` 取 `user` / `feedback` / `project` / `reference`（aria-memory 4 类），缺省时由历史兼容层按 aria-memory 推断规则兜底；scope 写 platform / shared 需要 `write-shared` 权限审批；sidecar 修订后不再写 Haro EvolutionAsset `kind=memory`。
- R6.1: 工具 timeout 按工具维度声明。每个工具在 registry 注册时必须给出 `timeoutMs`（D2）：建议默认 `send_message: 30_000` / `memory_query: 5_000` / `memory_remember: 5_000` / `schedule_task: 1_000`；超时返回 `TOOL_TIMEOUT`，由 audit 记录 decision = `timeout`。
- R7: `schedule_task` 工具（工具名保留，对应 happyclaw 兼容契约）：参数 `{ when, taskSpec }`，`when` 支持 ISO timestamp（一次性）或 cron 表达式；`taskSpec` 复用 FEAT-033 cron job DTO；调用前必须校验 cron 合法、when 非过期；内部走 `services.cron.create(...)`。
- R8: 所有工具调用必须写 `tool_invocation_log`：调用方 / 工具 / 参数 hash / 结果状态 / 耗时；payload 不入日志，避免记录敏感内容。
- R9: 工具失败必须返回结构化错误 `{ code, message, retryable, remediation? }`，code 取自工具规范的 error catalog。
- R10: MCP server 生命周期为 **per-session spawn**（D1）：agent runtime 在每个 session 启动时 spawn 独立的 MCP server 子进程，session 终止时 graceful shutdown；不允许 leak 子进程；不在多 session 之间复用同一个 server 实例。

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
- `memory_query` → 历史 Haro MemoryFabric 兼容查询；sidecar 新路径走 AgentDock memory MCP/API
- `memory_remember` → 历史 Haro MemoryFabric 兼容写入；sidecar 修订后不再记录 `kind=memory` asset
- `schedule_task` → `services.cron.create(...)` → `CronManager.create(...)`（FEAT-033）

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
- AC2: `memory_query` 对一个已写入的 platform-scope 记忆能返回命中，excerpt / score / dimension 字段非空；用 `dimension: 'feedback'` 过滤后只返回 feedback 类条目（对应 R5、D4）。
- AC3: `memory_remember` 写 platform-scope 时返回 `needs-approval`，写 agent-scope 直接成功；落到 frontmatter 的 `type` 字段等于调用方传入的 `dimension`，缺省时由历史兼容层按 aria-memory 推断规则兜底；sidecar 修订后不再创建 memory asset。
- AC4: `schedule_task` 注册 `cron: "0 * * * *"` 任务后，FEAT-033 `CronManager` 列表能查到该任务（对应 R7）。
- AC5: 工具调用失败时返回结构化 `{ code, message, retryable, remediation }`；调用方 retry 逻辑能正确分支（对应 R9）。
- AC6: 关闭 agent session 后 MCP server 子进程在 5 秒内退出，无 leak（对应 R10）。
- AC7: `tool_invocation_log` 表包含本次会话所有工具调用记录，params 字段是 hash 而非原文（对应 R8）。

## 7. Test Plan / 测试计划

- 单元测试：每个工具的 input validation / permission 决策 / 错误码分支；至少 6 用例 / 工具。
- 集成测试：MCP server 启动 → agent 走 JSON-RPC 调用 → 守门链 → 实际效果（消息到达 / 记忆写入 / 任务注册）。
- 安全测试：跨 session 越权调用 / 跨 scope 写记忆 / cron 注入攻击；至少 5 negative case。
- 性能：单工具调用 P95 latency 不超过 50ms（不含外部 IM API 调用时间）。
- 回归：历史 MemoryFabric 兼容层 / FEAT-022 Asset Registry / FEAT-023 Permission Guard / FEAT-031 Web Channel / FEAT-033 Cron Jobs 已有用例。

## 8. Resolved Decisions / 已决议（原 Open Questions）

- D1（原 Q1，MCP server 生命周期）：**per-session spawn**。每个 agent session 启动时 spawn 一个独立 MCP server 子进程，session 终止时 graceful shutdown。隔离边界清晰、调试和审计直观，启动开销作为已知成本由 sidecar observation pipeline 后续观察；如出现性能瓶颈再以独立 spec 评估 long-lived shared 方案。
- D2（原 Q2，工具 timeout）：**按工具维度配置**。每个工具在 registry 中声明自己的 `timeoutMs`（例如 `send_message: 30_000` / `memory_query: 5_000` / `memory_remember: 5_000` / `schedule_task: 1_000`），不设统一默认值；超时返回 `TOOL_TIMEOUT` 错误码。新增工具时必须显式给出 timeout，registry 拒绝接受省略 `timeoutMs` 的工具描述。
- D3（原 Q3，工具组合 / 链式调用）：**不做组合层**。让 agent 自行通过多次工具调用编排，平台不提供 workflow DSL 或 A→B 链式包装。避免引入隐式控制流，保持每次工具调用都被 Permission Guard / audit 独立守门。
- D4（原 Q4，`memory_remember` 是否暴露 `dimension`）：**完全参考 aria-memory 设计**。`memory_remember` 暴露 `dimension` 参数，取值对齐 aria-memory（历史兼容层落到 frontmatter `type` 的 4 类）：`user` / `feedback` / `project` / `reference`。语义、判定准则与 wrapup / sleep 行为一律照搬 aria-memory 既有约定（参见 `aria-memory:remember` skill 的 type 决策表），Haro 不另立一套。`dimension` 缺省时由历史兼容层按 `aria-memory` 推断规则兜底，保持与 owner 在外部 runtime 使用 `aria-memory:remember` 时**完全一致的写入语义**。

## 9. Changelog / 变更记录

- 2026-05-01: whiteParachute — 初稿（Phase 1.5 自用底座补完批次 1）
- 2026-05-06: whiteParachute — 收敛 Open Questions Q1–Q4 为 D1–D4（owner 决策：MCP per-session spawn / timeout 按工具维度配置 / 不做工具组合层让 agent 自行编排 / `memory_remember` 的 `dimension` 完全参考 aria-memory 4 类设计）。
- 2026-05-06: whiteParachute — **实现交付**。新建 `packages/mcp-tools/` 包：`McpServer`（stdio + JSON-RPC，无新依赖）+ `ToolRegistry`（per-tool `timeoutMs` 强制、permission/audit 守门链）+ 4 个工具（`send_message` / `memory_query` / `memory_remember` / `schedule_task`）；新增 `tool_invocation_log` 表（`packages/core/src/db/schema.ts`，仅 sha256 hash params）+ `services.mcp.listInvocations` 只读视图 + AgentRunner `mcpSessionFactory` 钩子（`packages/core/src/runtime/mcp-session.ts`，per-session subprocess SIGTERM 5 s → SIGKILL）。验证：`pnpm lint` 全绿、`pnpm test` 12 个包 683 用例全绿（含 `@haro/mcp-tools` 56 用例 + `@haro/core` `mcp-session.test.ts` 3 用例）、`pnpm build` 全部包 dist 产出、`pnpm smoke` ok（5 项 AC）。AC 覆盖：AC1（send_message 通过 ChannelRegistry 投递并记录）、AC2（memory_query dimension 过滤）、AC3（memory_remember 写入 + 4 类 dimension + EvolutionAssetRegistry 事件）、AC4（schedule_task 走 services.cron.createJob）、AC5（结构化错误码 + retryable 矩阵）、AC6（subprocess 5 s graceful shutdown）、AC7（params_hash 不入原文）。
- 2026-05-06: whiteParachute — Codex fresh-context review 修复：
  - registry 调度顺序改为 parse → permission → execute（避免畸形 params 被记为 NEEDS_APPROVAL 污染审批队列）；
  - `runWithTimeout` 在超时分支调 `AbortController.abort()`，`ToolExecutionContext.signal` 暴露给工具做协作式取消（best-effort，参见 `docs/modules/mcp-tools.md` "已知缺口"）；
  - `schedule_task` 用与 `cron/manager.ts` 同样的 `ISO8601_STRICT` 正则前置校验；`createJob` 抛 `HaroError` 时映射为 `INVALID_PARAMS` / `PERMISSION_DENIED`，避免泄漏 `INTERNAL_ERROR`；
  - `memory_remember` 移除"缺省 dimension='project'"硬编码，省略时让 fabric 推断，并把 `EvolutionAssetRegistry.recordEvent` 失败降级为 stderr warn（不再静默吞）；
  - `transport.ts` 解析失败发 JSON-RPC `-32700` parse-error 而非抛错终止 `run()`；
  - `audit.hashParams` 改用完整 SHA-256 + 可选 `HARO_TOOL_AUDIT_SALT` env 加盐；
  - `server.ts` `parseToolCallParams` 错误分支补 `remediation` 字段，AC5 错误结构对齐；
  - `bin/server-entry.ts` 注册 SIGTERM/SIGINT 后 `process.exit(0)`（避免 5 s SIGKILL 兜底），并显式 stderr 警告 ChannelRegistry 在子进程内为空；
  - `McpSessionHandle.child` 暴露 `ChildProcess` 句柄，为后续 provider wiring 留接口；
  - 已知缺口（仍待后续 FEAT 跟进）：provider SDK `mcpServers` 配置尚未把 spawn 的子进程接通到 `agent.query` 上，agent 当前用法仍以 in-process 嵌入 `McpServer` 为主；subprocess 内 ChannelRegistry 留空；详见 `docs/modules/mcp-tools.md` "已知缺口"。
