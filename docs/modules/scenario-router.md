# Scenario Router 设计

## 概述

Scenario Router 是 Haro 的第三层，负责感知输入场景，动态选择和编排工作流，并通过有状态图 + Checkpointing 保证推理链的连续性。

## 核心职责

```
输入（任务/事件）
  → 场景感知（识别任务类型）
  → 动态 Workflow 选择（选择编排模式）
  → 有状态图执行（LangGraph Checkpointing）
  → 结果输出
```

## 场景感知

Scenario Router 分析输入，识别以下场景维度：

| 维度 | 选项 |
|------|------|
| 任务类型 | `code` / `analysis` / `research` / `design` / `quick` |
| 复杂度 | `simple` / `moderate` / `complex` |
| 是否需要多 Agent | `single` / `team` |
| 时间敏感性 | `realtime` / `batch` |

**场景标签**影响：
1. Provider/Model 选择（通过 `specs/provider-selection.md` 的规则引擎）
2. 编排模式选择（单 Agent 直调 vs Team Orchestrator 的哪种模式）

## 有状态图设计

基于 LangGraph Checkpointing 思路，所有工作流以有状态图表示：

```typescript
interface WorkflowGraph {
  /** 图的唯一标识 */
  id: string

  /** 节点列表 */
  nodes: WorkflowNode[]

  /** 边（转换条件） */
  edges: WorkflowEdge[]

  /** 当前状态（Checkpoint） */
  state: WorkflowState
}

interface WorkflowNode {
  id: string
  type: 'agent' | 'team' | 'tool' | 'decision' | 'merge'
  /** 执行此节点的 Agent 或 Tool */
  executor: string
}

interface WorkflowEdge {
  from: string
  to: string | string[]  // string[] 表示分叉
  condition?: string     // 转换条件表达式
}
```

## Checkpointing（断点续传）

每个工作流节点执行完成后自动创建 Checkpoint，存储于 SQLite：

```sql
CREATE TABLE workflow_checkpoints (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  state TEXT NOT NULL,  -- JSON 序列化的完整状态
  created_at TEXT NOT NULL
);
```

**推理链连续性保证**（遵守约束②）：
- 所有分支（fork）结果必须回流到同一 merge 节点才能继续
- Checkpoint 记录完整状态，不压缩
- 恢复时从最后一个 Checkpoint 重放，而非从头开始

## 工作流选择逻辑

```typescript
function selectWorkflow(
  task: Task,
  sceneTags: string[]
): WorkflowTemplate {
  // 单 Agent 直调（Phase 0 默认）
  if (sceneTags.includes('simple') || !sceneTags.includes('team')) {
    return SINGLE_AGENT_WORKFLOW
  }

  // 并行覆盖（搜索空间探索）
  if (sceneTags.includes('research') || sceneTags.includes('analysis')) {
    return PARALLEL_COVERAGE_WORKFLOW
  }

  // 对抗性辩论（决策/验证）
  if (sceneTags.includes('design') || sceneTags.includes('review')) {
    return DEBATE_WORKFLOW
  }

  // 默认：单 Agent
  return SINGLE_AGENT_WORKFLOW
}
```

## 与其他层的关系

```
Human Interface（输入）
  ↓
Scenario Router（场景感知 + Workflow 选择）
  ↓
Agent & Team Runtime（执行编排）
  ↓
Provider Abstraction Layer（选择 Provider + Model）
  ↓
Tool & Service Layer（工具执行）
```

**重要**：Scenario Router 不引入推理链断裂。图模型天然确保所有分支结果回流到同一编排节点后再进行下一步（遵守约束②）。
