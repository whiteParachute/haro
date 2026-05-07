# MCP 工具层（@haro/mcp-tools）

**Spec**：[`specs/phase-1.5/FEAT-032-mcp-tool-layer.md`](../../specs/phase-1.5/FEAT-032-mcp-tool-layer.md)（2026-05-06 实现交付）

`@haro/mcp-tools` 是 Haro Agent 的 "动手做事" 工具层。它把"发消息 / 查记忆 / 写记忆 / 调度任务"这四个跨模块动作封装为标准 MCP 工具，让 agent 可以在主循环之外显式调用平台原生能力，同时把每次调用都过 permission 守门 + 写 audit 日志。

## 边界

- **per-session spawn**（D1 / R10）：AgentRunner 启动一次 session 就 spawn 一个独立的 MCP server 子进程，session 终止时 SIGTERM（5 s grace）→ SIGKILL；不在多 session 之间复用。
- **stdio + JSON-RPC**（R2）：不开额外 HTTP 端口，只通过 stdio 与子进程通信，自实现轻量 dispatcher（无新依赖）。
- **per-tool timeout**（D2 / R6.1）：每个工具在 registry 注册时必须显式声明 `timeoutMs`；缺省直接 `throw`，registry 拒绝默认值。
- **不做工具组合**（D3）：平台层不提供 workflow DSL；agent 自己多次调用，每次调用都独立守门、独立审计。
- **dimension 对齐 aria-memory**（D4）：`memory_remember` 的 `dimension` 取值与 aria-memory 4 类（`user` / `feedback` / `project` / `reference`）完全一致，缺省时由 Memory Fabric 推断。

## 4 个内置工具

| Tool | 作用 | timeoutMs | 关键守门 |
|------|------|-----------|----------|
| `send_message` | 把文本/Markdown 消息投递到 Channel session | 30 000 | 跨 channel → `external-service` 审批；channel 必须 enabled |
| `memory_query` | 走 `MemoryFabric.searchMemoryFiles` 读记忆，按 `dimension` 过滤 | 5 000 | 只读，默认 allow |
| `memory_remember` | 走 `MemoryFabric.writeEntry` 写记忆 + 在 Evolution Asset Registry 记录 `proposed` 事件 | 5 000 | scope=shared/platform → `write-shared` 审批；scope=agent allow |
| `schedule_task` | 走 `services.cron.createJob` 注册 cron / once 任务 | 1 000 | 默认 allow；非法 cron / 过期 ISO → `INVALID_PARAMS` |

错误码统一来自 `error.ts`：`PERMISSION_DENIED` / `NEEDS_APPROVAL` / `INVALID_PARAMS` / `TARGET_NOT_FOUND` / `TARGET_DISABLED` / `TOOL_TIMEOUT` / `INTERNAL_ERROR`，retryable 矩阵：仅 `TOOL_TIMEOUT` / `INTERNAL_ERROR` 为 `true`，其他显式 `false`。

## 守门链（registry.invoke）

```
agent → tools/call (JSON-RPC)
   │
   ▼
ToolRegistry.invoke({ name, rawParams, session, deps })
   │
   ├─ permission.evaluate(toolName, params, session)
   │    ├─ allow      → 进入 schema parse
   │    ├─ deny       → audit{decision:denied, errorCode:PERMISSION_DENIED}
   │    └─ approval   → audit{decision:needs-approval, status:pending}
   │
   ├─ tool.inputSchema.parse(params)
   │    └─ ZodError   → audit{errorCode:INVALID_PARAMS}
   │
   ├─ Promise.race([tool.execute, timeout(toolDef.timeoutMs)])
   │    └─ 超时       → audit{errorCode:TOOL_TIMEOUT}
   │
   └─ audit.append({sessionId, agentId, tool, params_hash, decision, status, latency, errorCode})
```

每条路径都写 `tool_invocation_log` 一行；payload 字段只入 `sha256(JSON.stringify(params)).slice(0,32)`，**绝不入原文**（R8 / AC7）。

## 已知缺口（2026-05-06 实现交付）

- **Provider 端工具调用尚未接通**：`@haro/mcp-tools` 的 server / 4 工具 / 守门 / audit 层都已就位；AgentRunner 的 `mcpSessionFactory` 也会在 session 启动时 spawn 子进程并在 finally 5 s 内 graceful shutdown。但 provider SDK（如 Codex / Claude）侧的 `mcpServers` 配置尚未把 spawn 的子进程 stdio 接入，因此 agent 暂时**不会**真的去调用这些工具。本 FEAT 交付的是 "infra 就位 + lifecycle 严格符合 spec"，provider 接入留作后续 FEAT。`McpSessionHandle.child` 已暴露原始 `ChildProcess` 句柄，未来 wiring 直接读它的 stdio 即可。
- **subprocess 内部 ChannelRegistry 为空**：`server-entry.ts` 的子进程目前没有从父进程 IPC 拿到 channel 注册信息（这需要序列化 channel adapter，复杂度高）。短期里 production 路径仍以 in-process 嵌入 `McpServer` 为主：父进程把现成的 `ChannelRegistry` / `MemoryFabric` / cron `ServiceContext` 通过 `ToolDependencies` 直接传给 `createDefaultRegistry({ audit })`。
- **AbortSignal 是协作式取消**：`ToolExecutionContext.signal` 在 timeout 时被 `abort()`；honor 该 signal 的工具会及时停下，否则后台仍会跑完。当前 4 个 builtin 内部不发外部网络调用，超时影响有限；调用方仍以 `TOOL_TIMEOUT` 为准（spec R9 / AC5）。

## per-session 子进程生命周期

`packages/core/src/runtime/mcp-session.ts`：

- `createSubprocessMcpFactory({ serverEntry })` 返回一个 `McpSessionFactory`；调用方传给 `AgentRunnerOptions.mcpSessionFactory`。
- `AgentRunner.run()`：
  1. 创建 `sessionId` 后立刻 `factory({ session, root, dbFile })` spawn 子进程。
  2. 把句柄存到本地变量；session 任何路径退出（成功 / 失败 / 异常）都进入 `finally`。
  3. `finally` 调 `handle.stop({ timeoutMs: 5_000 })`：先 SIGTERM，5 s 没退出就 SIGKILL。
- 默认 `mcpSessionFactory` 为 `undefined`，行为与 FEAT-032 之前完全一致；不影响既有测试。
- 子进程入口：`@haro/mcp-tools/bin/server-entry.js`，接受 `<sessionContextJson>` `<configJson>`，注册默认 4 工具并接管 stdio。

## tool_invocation_log 表

```sql
CREATE TABLE tool_invocation_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allowed','denied','needs-approval')),
  result_status TEXT NOT NULL CHECK (result_status IN ('success','error','pending')),
  latency_ms INTEGER,
  error_code TEXT,
  invoked_at INTEGER NOT NULL
);
```

CLI / Web 通过 `import { mcp } from '@haro/core/services'; mcp.listInvocations(ctx, { sessionId, toolName, limit })` 拿只读视图；写路径仍在 `@haro/mcp-tools`。

## 与其他模块的接合点

- `send_message` → `@haro/channel`（`ChannelRegistry.get(channelId).send(channelSessionId, OutboundMessage)`），FEAT-031 web channel 含 channelSessionId 语义统一。
- `memory_query` / `memory_remember` → `@haro/core/memory`（`MemoryFabric.searchMemoryFiles` / `writeEntry`，FEAT-035 v2，文件存储无 FTS5）。
- `memory_remember` → `@haro/core/evolution`（`EvolutionAssetRegistry.recordEvent({ asset:{kind:'memory', ...}, type:'proposed', actor:'agent' })`，FEAT-022）。
- `schedule_task` → `@haro/core/services` cron 命名空间（`services.cron.createJob`，FEAT-033）。
- 守门 → 内置 `permission.evaluate`（轻量 in-package 表，按 toolName + scope 决策；audit 仍写 `tool_invocation_log`）。

## 拓展工具

```ts
import { ToolRegistry, type ToolDefinition } from '@haro/mcp-tools';

const myTool: ToolDefinition<typeof MyInputSchema, MyOutput> = {
  name: 'my_tool',
  description: '...',
  inputSchema: MyInputSchema,
  timeoutMs: 2_000,           // 必须显式给值，> 0
  async execute(params, ctx) { ... },
};
registry.register(myTool);
```

permission 默认对未知工具返回 `denied`；自定义工具需要在调用方传 `permissionEvaluator` 覆盖默认表，或将其加入内置表（修改 `permission.ts`）。
