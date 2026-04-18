# Agent Runtime 设计

## 概述

Agent Runtime 负责 Agent 的生命周期管理、单次执行、跨 session 状态维护。Phase 0 采用单进程多 Agent 模型。

## 最小 Agent 定义

Phase 0 的 Agent 定义精简为以下最小集合：

```typescript
/**
 * Agent 配置（Phase 0 最小定义）
 */
interface AgentConfig {
  // Day 1 必须
  id: string
  name: string
  systemPrompt: string

  // Day 1 可选
  tools?: string[]              // 启用的工具名称列表（不填则使用 SDK 内置工具）

  // Provider 由选择规则引擎决定，以下字段为可选覆盖
  defaultProvider?: string      // 覆盖选择规则，如 'claude' | 'codex'
  defaultModel?: string         // 覆盖选择规则的模型选择
}
```

**推迟到 Phase 1+ 的字段**：
- `role` / `goal` / `backstory`（CrewAI 式角色）
- `identity` / `personality`（IDENTITY.md / PERSONALITY.md）
- `triggers` / `constraints` / `preferences`
- `activeLearnings`
- `sharedMemory`
- `evolvedFrom` / `version`（进化追踪）

## 进程模型：单进程多 Agent

Phase 0 采用单进程多 Agent 模型：所有 Agent 在同一个 Node.js 进程内，通过 async 调度。

**理由**：
- 足够简单，Phase 0 没有多用户需求
- 避免 IPC 开销

**Phase 1 升级路径**：引入 Actor 模型 + 消息驱动，支持 Worker Threads 隔离密集计算。

## Agent 配置存储

Agent 配置以 YAML 文件形式存储在 `~/.haro/agents/` 目录下：

```
~/.haro/agents/
├── haro-assistant.yaml      # 通用助手 Agent
├── code-reviewer.yaml       # 代码审查 Agent
└── doc-writer.yaml          # 文档写作 Agent
```

**示例配置文件**：

```yaml
# ~/.haro/agents/code-reviewer.yaml
id: code-reviewer
name: 代码审查员
systemPrompt: |
  你是一个专注代码质量的审查 Agent。你的任务是：
  1. 找出代码中的 bug 和潜在问题
  2. 提出改进建议
  3. 不直接修改代码，只提供审查意见

tools:
  - read
  - bash

# 可选：覆盖 Provider 选择规则
defaultProvider: claude
defaultModel: claude-opus-4-5
```

## 执行循环

```
接收任务
  → 查询选择规则引擎（确定 Provider + Model）
  → 加载 Agent 系统提示词
  → 构建 AgentQueryParams
  → 调用 Provider.query()
  → 消费 AgentEvent 流
  → session 结束后写入记忆
  → 返回结果
```

## 跨 Session 状态文件

Agent 维护跨 session 的状态文件，包含以下四类信息：

```json
// ~/.haro/agents/{name}/state.json
{
  "agentId": "code-reviewer",
  "lastUpdated": "2026-04-18T08:00:00Z",
  
  "taskContext": {
    "description": "当前任务描述",
    "goals": ["目标1", "目标2"],
    "constraints": ["约束1"]
  },
  
  "executionHistory": [
    {
      "sessionId": "sess_xxx",
      "timestamp": "2026-04-18T07:00:00Z",
      "action": "review",
      "target": "src/provider.ts",
      "outcome": "found_issues"
    }
  ],
  
  "keyDecisions": [
    {
      "decision": "选择超集接口设计",
      "reasoning": "因封号顾虑需要区分 Provider 行为",
      "timestamp": "2026-04-18T06:00:00Z"
    }
  ],
  
  "pendingWork": [
    {
      "description": "实现 Codex Provider 的流式适配",
      "priority": "high",
      "blockedBy": null
    }
  ]
}
```

## Session 数据存储

会话历史、事件流存储在 SQLite（`~/.haro/haro.db`）：

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL  -- 'running' | 'completed' | 'failed'
);

CREATE TABLE session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data TEXT NOT NULL,  -- JSON
  created_at TEXT NOT NULL
);
```

## 生命周期

```
创建（从 YAML 加载配置）
  → 就绪（Provider 选择完成）
  → 运行（执行任务）
  → 完成（写入记忆、更新状态文件）
  → 空闲（等待下一任务）
```
