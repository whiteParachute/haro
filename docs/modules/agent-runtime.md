# Agent Runtime 设计

## 概述

Agent Runtime 负责把单条任务串成一次完整的 Agent 执行：选择 Provider/Model、创建 session、消费事件流、记录 continuation、更新跨 session 状态，并在成功结束后触发记忆 wrapup。

当前 Phase 0 已有一条可运行的单 Agent 主循环实现，核心代码位于：

- `packages/core/src/runtime/runner.ts`
- `packages/core/src/runtime/selection.ts`
- `packages/core/src/runtime/types.ts`

并通过以下导出面暴露：

- `@haro/core`
- `@haro/core/runtime`

## 最小 Agent 定义

Phase 0 的 Agent 定义仍然保持最小集合：

```ts
interface AgentConfig {
  id: string
  name: string
  systemPrompt: string
  tools?: string[]
  defaultProvider?: string
  defaultModel?: string
}
```

推迟到 Phase 1+ 的人格/岗位式字段（`role` / `goal` / `backstory` 等）依然不进入配置面。

## 运行流程

`AgentRunner.run({ task, agentId, ...overrides })` 的主路径如下：

```text
加载 Agent
  → resolveSelection() 解析 provider/model（agent > project > global > 默认规则）
  → 创建 sessions 记录
  → 如有 retryOfSessionId，写入 session_retry synthetic event
  → 加载 continuation context
  → 调用 provider.query()
  → 逐条写入 session_events
  → result 时写入 sessions.context_ref
  → 成功：更新 agent state + 触发 memory-wrapup
  → 失败：按 fallback 条件写 provider_fallback_log，继续下一个候选
```

## 选择规则引擎

规则优先级与 FEAT-005 保持一致：

1. Agent 硬绑定（`defaultProvider` / `defaultModel`）
2. 项目级 `.haro/selection-rules.yaml`
3. 全局 `~/.haro/selection-rules.yaml`
4. 内置默认规则

当规则没有直接 pin `model` 时，运行时通过 `provider.listModels()` 按 `modelSelection` 即时解析。

支持的选择策略：

- `provider-default`
- `quality-priority`
- `cost-priority`
- `largest-context`

## Session 数据存储

SQLite 会话层当前结构为：

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  context_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed'))
);

CREATE TABLE session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE provider_fallback_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  original_provider TEXT NOT NULL,
  original_model TEXT NOT NULL,
  fallback_provider TEXT NOT NULL,
  fallback_model TEXT NOT NULL,
  trigger TEXT NOT NULL,
  rule_id TEXT,
  created_at TEXT NOT NULL
);
```

其中：

- `sessions.context_ref` 用于存 provider-specific continuation state（Phase 0 先承载 Codex `previousResponseId`）
- `session_events` 记录所有 `AgentEvent`
- `provider_fallback_log` 记录 fallback 触发链路

## 跨 Session 状态文件

跨 session 状态位于 `~/.haro/agents/{agentId}/state.json`，当前结构是：

```json
{
  "taskContext": {
    "lastTaskPreview": "列出当前目录下的 TypeScript 文件",
    "lastSessionId": "sess_xxx",
    "updatedAt": "2026-04-20T00:00:00.000Z",
    "provider": "codex",
    "model": "gpt-5.4"
  },
  "executionHistory": [
    {
      "sessionId": "sess_xxx",
      "timestamp": "2026-04-20T00:00:00.000Z",
      "taskPreview": "列出当前目录下的 TypeScript 文件",
      "outcome": "completed"
    }
  ],
  "keyDecisions": [
    {
      "timestamp": "2026-04-20T00:00:00.000Z",
      "ruleId": "default",
      "provider": "codex",
      "model": "gpt-5.4"
    }
  ],
  "pendingWork": []
}
```

注意：

- `executionHistory` 记录 `taskPreview`，不做 intent 推断
- 失败任务会把 `taskPreview` 放入 `pendingWork`
- 成功任务会从 `pendingWork` 中移除对应 preview

## Continuation 与超时

- Continuation 恢复优先读取最近成功 session 的 `context_ref`
- `context_ref` 缺失时，Runner 会回退到最近成功 `result.responseId`
- 超时在 Runner 层统一处理；默认 10 分钟，可由 `HARO_TASK_TIMEOUT_MS` 或 `runtime.taskTimeoutMs` 覆盖
- 超时时写入 `AgentErrorEvent { code: 'timeout', retryable: true }`

## Memory wrapup 边界

- 仅在 session 成功时触发 `memoryWrapupHook`
- `noMemory` override 会显式跳过 wrapup
- 未接入 wrapup hook 时只记 debug log，不阻塞主循环
- 全部 fallback 失败时不会写记忆

## 当前边界

当前 Runtime 文档只覆盖 FEAT-005 单 Agent 执行循环。

以下能力仍不在本文范围：

- CLI / REPL / slash 命令（FEAT-006）
- 通用 Channel 抽象与外部 adapter（FEAT-008 / FEAT-009）
- 多 Agent / Team Orchestrator（Phase 1）
