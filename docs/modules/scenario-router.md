# Scenario Router 设计

## 概述

Scenario Router 是 Phase 1 的 canonical ingress，负责在任务进入执行层之前完成三件事：

1. 生成可持久化的 `SceneDescriptor`
2. 基于 `RoutingMatrix` 产出 `RoutingDecision`
3. 为后续执行创建 `workflowId`、节点骨架与 checkpoint 恢复入口

当前实现位于：

- `packages/core/src/scenario-router.ts`
- `packages/cli/src/index.ts`（CLI ingress、checkpoint 落盘、team 回退逻辑）

它的职责边界已经和 Phase 0 单 Agent Runtime 分开：Router 决定“走哪条 workflow”，`AgentRunner` 负责 single-agent leaf execution，provider/model 解析继续交给既有选择规则和 ProviderRegistry。

## 当前实现边界

当前代码已经实现了 `SceneClassifier`、`RoutingMatrix`、`ScenarioRouter`、`CheckpointStore` 四部分，但 **Team Orchestrator 仍未实现**。

因此，当前落地行为是：

- Router 仍然可以把某些场景路由成 `executionMode = team`
- CLI 会保留该路由决策并写入 checkpoint
- 但执行时会输出 `WARN [FEAT-014]`，并暂时回退到 `single-agent`
- 该回退会写入 `branchState.fallbackExecutionMode = 'single-agent'` 与 `teamOrchestratorPending = true`

这意味着：**Router 已经是统一入口，但 team workflow 目前仍只保留决策与状态边界，实际执行要等 FEAT-014。**

## 场景描述：`SceneDescriptor`

当前实现使用的场景结构如下：

```ts
interface SceneDescriptor {
  taskType:
    | 'quick'
    | 'code'
    | 'analysis'
    | 'research'
    | 'design'
    | 'review'
    | 'deterministic-toolchain'
  complexity: 'simple' | 'moderate' | 'complex'
  collaborationNeed: 'single-agent' | 'team'
  timeSensitivity: 'realtime' | 'batch'
  validationNeed?: 'none' | 'standard' | 'adversarial'
  tags?: string[]
}
```

和旧版占位文档相比，当前实现已明确补齐两类场景：

- `review`：评审、审查、validate、audit 一类任务
- `deterministic-toolchain`：build / lint / format / compile / package / CI 等确定性工具链任务

分类规则的当前特征：

- `analysis` / `research` / `design` / `review` 的复杂任务默认倾向 `team`
- `deterministic-toolchain + batch` 默认倾向 `team`
- `design` / `review` 默认给出 `validationNeed = 'adversarial'`
- `analysis` / `research` 默认给出 `validationNeed = 'standard'`
- `tags` 保存原始分类标签，后续直接进入 provider hints 和 checkpoint，而不是二次推断

## 路由决策：`RoutingDecision`

Router 当前输出的决策结构如下：

```ts
interface RoutingDecision {
  executionMode: 'single-agent' | 'team'
  orchestrationMode?: 'parallel' | 'debate' | 'pipeline' | 'hub-spoke' | 'evolution-loop'
  workflowTemplateId: string
  providerSelectionHints?: {
    preferredTags?: string[]
    estimatedComplexity?: 'simple' | 'moderate' | 'complex'
    requiresLargeContext?: boolean
  }
  matchedRuleId?: string
}
```

说明：

- Router 只输出抽象 hints，不直接选 provider/model
- `matchedRuleId` 会保留命中的矩阵规则，便于回放和调试
- `evolution-loop` 仍在协议枚举里，但 Phase 1 Router 当前不会产出；若规则返回它，`RoutingMatrix.route()` 会直接抛错

## 工作流选择逻辑：基于 `RoutingMatrix`

当前实现不是“按标签 if/else 随机挑模式”，而是 **按顺序匹配 `RoutingRule[]`**：

- 先匹配具体规则
- 最后才落到 `fallback-single-default`
- 因此语义是 **具体规则优先于 fallback**

当前内建矩阵如下：

| 场景条件 | executionMode | orchestrationMode | workflowTemplateId |
| --- | --- | --- | --- |
| `quick + simple + single-agent` | `single-agent` | — | `single-fast` |
| `code + (simple\|moderate) + single-agent` | `single-agent` | — | `single-code-default` |
| `analysis + (moderate\|complex) + team` | `team` | `hub-spoke` | `hub-spoke-analysis` |
| `research + (moderate\|complex) + team` | `team` | `parallel` | `parallel-research` |
| `design + (moderate\|complex) + team` | `team` | `debate` | `debate-design-review` |
| `review + (moderate\|complex) + team` | `team` | `debate` | `debate-review` |
| `deterministic-toolchain + batch + team` | `team` | `pipeline` | `pipeline-deterministic-tools` |
| 其他未命中场景 | `single-agent` | — | `single-default-fallback` |

额外约束也已经落到实现里：

- `analysis` / `research` / `design` / `review` 属于 reasoning 场景
- 这些 taskType **禁止** 路由到 `pipeline`
- 如果某条规则错误地产出 `pipeline`，`RoutingMatrix.route()` 会直接拒绝

因此，Pipeline 当前只保留给 **确定性工具链**，而不是通用多 Agent 推理链。

## Workflow、leaf session 与 channel session 的边界

当前实现里至少有三个不同层级的标识：

### `workflowId`

- 由 Router 在 ingress 后生成
- 是内部编排主键
- 用来索引 `workflow_checkpoints`
- 是恢复 workflow 的第一入口

### `leaf sessionId`

- 表示某个 leaf executor 的实际执行 session
- single-agent 基线是 `1 workflowId -> 1 leaf sessionId`
- 只有显式 retry、新 leaf node 或新执行轮次，才应扩展为 `1 workflowId -> N leaf sessionId`

### `channel sessionId`

- 表示 transport / conversation continuity
- 来自 CLI / Channel ingress
- 会被 Router 挂在 `ScenarioWorkflow.channelSessionId` 上
- **不等于** `workflowId`，也 **不等于** leaf `sessionId`

当前 `createWorkflow()` 会显式避免把 `channelSessionId` 复用为 `workflowId`；对应测试也验证了：

- `workflowId !== channelSessionId`
- `leafSessionId !== channelSessionId`

## 当前 workflow 结构

Router 当前暴露的 workflow 结构如下：

```ts
interface ScenarioWorkflow {
  workflowId: string
  channelSessionId?: string
  executionMode: 'single-agent' | 'team'
  orchestrationMode?: 'parallel' | 'debate' | 'pipeline' | 'hub-spoke' | 'evolution-loop'
  workflowTemplateId: string
  sceneDescriptor?: SceneDescriptor
  nodes: Array<{ id: string; type: 'router' | 'agent' | 'team' | 'validator' | 'merge' | 'tool' }>
  leafSessionRefs: Array<{
    nodeId: string
    sessionId: string
    continuationRef?: string
    providerResponseId?: string
  }>
  createdAt: string
}
```

当前节点骨架很保守：

- `single-agent`：只创建一个 `leaf-1 / agent`
- `team`：只创建 `dispatch-1 / team` 与 `merge-1 / merge`

也就是说，Router 当前只负责把 team workflow 的入口和 merge 边界固定下来，不在这里展开 FEAT-014 的内部调度图。

## Checkpoint：直接写 SQLite，不依赖 LangGraph

旧版占位文档把“有状态图”写成了 LangGraph 硬依赖，这和当前实现不一致。

当前代码路径是：

- 使用 `better-sqlite3`
- 通过 `initHaroDatabase()` 打开 Haro SQLite
- 直接读写 `workflow_checkpoints` 表
- `state` 字段存完整 JSON 字符串

当前 checkpoint 结构如下：

```ts
interface RawContextRef {
  kind: 'input' | 'artifact' | 'session-event'
  ref: string
}

interface LeafSessionRef {
  nodeId: string
  sessionId: string
  continuationRef?: string
  providerResponseId?: string
}

interface WorkflowCheckpointState {
  workflowId: string
  nodeId: string
  nodeType: 'router' | 'agent' | 'team' | 'validator' | 'merge' | 'tool'
  sceneDescriptor: SceneDescriptor
  routingDecision: RoutingDecision
  rawContextRefs: RawContextRef[]
  branchState: Record<string, unknown>
  leafSessionRefs: LeafSessionRef[]
  createdAt: string
}
```

这里要注意三点：

1. `state` 保存的是 **完整结构化 JSON**，不是摘要
2. `rawContextRefs` 保存的是 **原文引用**，不是压缩后的上游结论
3. `leafSessionRefs` 同时承担 leaf session、continuation 与 provider continuation 的引用边界

## 为什么 `rawContextRefs` 传引用而不是摘要

当前实现遵守的是 “Pass the Source, Not the Summary”：

- checkpoint 中只保存 raw ref，例如 `channel://cli/sessions/<channelSessionId>`
- `rawContextRefs` 的职责是把原始输入、artifact、session event 的来源保留下来
- `CheckpointStore.normalizeState()` 也会把非约定字段清洗掉，避免把 inline payload 混进 checkpoint contract

这意味着 Router 的 contract 偏向“把原文位置保住”，而不是“提前帮下游生成摘要”。

这样做的目的很直接：

- merge / validator / 恢复流程可以重新读取原始材料
- 不会因为上游摘要丢信息而破坏多 Agent 约束
- checkpoint 可以长期作为稳定恢复锚点，而不是一次性 prompt 缓存

## 恢复优先级

当前恢复逻辑在 `CheckpointStore.resolveResume()` 中，顺序是固定的：

1. 先按 `workflowId` 读取最新 checkpoint
2. 在当前 node 对应的 `leafSessionRefs` 中优先找 `continuationRef`
3. 若没有 `continuationRef`，再找 `providerResponseId`
4. 再没有则退回 `node-restart`

也就是说，完整优先级是：

```text
workflow checkpoint
  -> continuationRef
  -> providerResponseId
  -> node restart
```

这里的第一层是“先恢复到哪个 workflow state”，后面三层才是“在该 state 内如何继续 leaf execution”。这和重新分类、重新规划是两回事。

## Provider fallback 的边界

Provider fallback 仍然属于 Phase 0 `AgentRunner` 语义，不属于 Router 的编排职责。

当前边界是：

- fallback 发生在同一个 leaf session 内
- 运行时只写 `provider_fallback_log`
- Router 不创建新的 workflow
- Router 也不因为 provider fallback 生成新的 leaf session

因此，**provider fallback 不是 Router 层的 reroute，也不是 workflow 分叉。**

## Team 请求的当前回退行为

在 FEAT-014 落地前，team 路由的当前执行语义应理解为：

1. Router 正常产出 `executionMode = team` 的 `RoutingDecision`
2. CLI 记录该决策，并把 workflow checkpoint 正常落盘
3. CLI 输出 `WARN [FEAT-014] Team Orchestrator 尚未实现`
4. 同一 workflow 暂时回退到 single-agent 执行
5. checkpoint 里的 `branchState` 记录此次回退，而不是伪装成原本就是 single-agent

这能保留两个层面的真实信息：

- **决策层真实意图**：这个任务本来应该走 team
- **执行层当前现实**：系统暂时只能以 single-agent 跑完 leaf execution

## 与其他模块的关系

### 与 Agent Runtime

- Router 决定 workflow，不直接跑 provider query
- `AgentRunner` 仍是当前唯一已实现的 leaf executor
- single-agent 和 team fallback 最终都复用 Runner 完成实际执行

### 与 Provider Selection

- Router 只输出 `providerSelectionHints`
- 具体 provider/model 解析仍由 Runtime 选择规则引擎处理
- Router 不复制 `provider-selection.md` 的逻辑

### 与 Team Orchestrator

- Router 负责定义 team workflow 的入口、模板和 merge 边界
- Team Orchestrator 的真实执行图、成员调度和 merge payload schema 仍等待 FEAT-014

## 当前结论

Scenario Router 现在已经不是概念占位，而是一个有代码落地的 ingress + checkpoint 模块。它当前真正提供的是：

- 可回放的 scene classification
- 基于 `RoutingMatrix` 的确定性 workflow 选择
- `workflowId` / `leaf sessionId` / `channel sessionId` 的边界管理
- 基于 SQLite JSON state 的 checkpoint 与恢复
- 对 team workflow 的决策保留，以及 FEAT-014 前的显式 single-agent 回退

因此，理解这个模块时应把它看成 **“已实现的路由与状态边界层”**，而不是 “依赖 LangGraph 的未来构想图”。
