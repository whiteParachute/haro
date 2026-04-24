# Team Orchestrator 模块

## 概述

`packages/core/src/team-orchestrator.ts` 现在承接 FEAT-014：它消费 FEAT-013 的
`RoutingDecision + ScenarioWorkflow + CheckpointStore`，把 team workflow 展开为可执行、可恢复、可合并的 fork-and-merge 运行时。

当前实现边界：

- 只支持 Phase 1 的四种 mode：`parallel`、`debate`、`pipeline`、`hub-spoke`
- leaf 执行统一通过 `AgentRunner.run()`，不直接碰 provider
- checkpoint 继续落在 FEAT-013 的 `workflow_checkpoints`
- merge 输出统一为 `MergeEnvelope`，但 body 仍按 mode 分化
- `evolution-loop` 仍未进入 Phase 1 runtime

## 核心导出

```ts
import {
  TeamOrchestrator,
  BRANCH_STATUS_VALUES,
  type BranchLedgerEntry,
  type TeamBranchState,
  type MergeEnvelope,
  type ParallelMergeBody,
  type DebateMergeBody,
  type PipelineMergeBody,
  type HubSpokeMergeBody,
  type CriticOutput,
} from '@haro/core'
```

### Branch Ledger

`BranchLedgerEntry` 是 Team runtime 的最小 ledger 单元，核心字段包括：

- `branchId / nodeId / memberKey / workflowId`
- `status`: `pending -> dispatched -> running -> completed|failed|cancelled|timed-out -> merge-consumed`
- `attempt`: 显式 retry 才递增
- `leafSessionRef`: 与 FEAT-013 的 leaf session 映射兼容
- `outputRef / output / consumedByMerge / lastError`

`BRANCH_STATUS_VALUES` 暴露了运行时允许的状态全集，便于 schema/test 对齐。

### TeamBranchState

`TeamBranchState` 是 checkpoint 中 `branchState` 的 team 扩展，包含：

- `teamStatus`
- `activeNodeId`
- `branches`
- `merge.status / consumedBranches / envelopeRef`
- `workflowDeadline`（整体 workflow 超时）
- `leafTimeoutMs`（per-leaf 超时）
- `fallbackExecutionMode / teamOrchestratorPending`（当前 CLI release team 路径为 `null / false`；仅用于识别早期
  checkpoint 或未来显式降级边界）

这对应 FEAT-014 的双层超时模型：整体 deadline 会裁剪 branch 的可运行时长；若先触发 workflow deadline，
branch 记为 `cancelled` 且 teamStatus 记为 `timed-out`；否则保留 `timed-out` 给 per-leaf timeout。

## 四种编排模式

### 1. parallel

- 模板：`parallel-research`
- 拆分维度：信息来源（本地代码 / 文档 / 历史记忆）
- merge body：`ParallelMergeBody`
- 语义：竞争/交叉验证候选，最终做 structured union/select

### 2. debate

- 模板：`debate-design-review`、`debate-review`
- 分支：`proposer` + `critic`
- proposer 先执行；critic 由 orchestrator 注入 `reviewTargetOutputRef`，针对 proposer 输出做负向审查
- `critic` 输出必须满足 `CriticOutput`
- 禁止字段：`fix`、`patch`、`implementationPlan`、`revisedProposal`、`delegateTo`
- merge body：`DebateMergeBody`

### 3. pipeline

- 模板：`pipeline-deterministic-tools`
- 只允许 deterministic toolchain
- 两层 enforcement：
  1. 模板 metadata 静态声明 `deterministicToolStep: true`、`reasoningAllowed: false`
  2. runtime guard 要求 `sceneDescriptor.taskType === 'deterministic-toolchain'`
- 默认 strict fail-fast
- merge body：`PipelineMergeBody`

### 4. hub-spoke

- 模板：`hub-spoke-analysis`
- 拆分维度：互补信息切片（代码 / 文档 / CI 日志）
- merge body：`HubSpokeMergeBody`
- 语义：不是候选投票，而是 complementary slice synthesis

## 执行流程

`TeamOrchestrator.executeWorkflow()` 的主流程：

1. 校验 team decision / mode / template
2. `expandBranches()` 展开 branch plan
3. `writeCheckpoint('fork-dispatch')`
4. `dispatchBranch()` 通过 `AgentRunner` 执行 leaf
5. 每个 leaf terminal 后 `writeCheckpoint('leaf-terminal')`
6. `runMerge()` 生成统一 `MergeEnvelope`，先把 merge-ready envelope 持久化到 checkpoint
7. commit merge consumption，写入最终 `writeCheckpoint('merge')`

其中 `runMerge()` 采用 **hybrid** 路径：

- envelope 公共字段由规则组装
- mode body 通过 synthesizer 生成（默认 deterministic synthesizer，可注入自定义实现）
- 即便使用自定义 synthesizer，返回的 envelope body 仍会经过 runtime schema guard

## 恢复语义

`resumeWorkflow(workflowId)` 复用 FEAT-013 的恢复优先级：

1. `workflow checkpoint`
2. `continuationRef`
3. `providerResponseId`
4. `node restart`

并额外满足：

- 已 `merge-consumed` 的 branch 不会被重复执行
- `merge.consumedBranches` 用作 partial-merge 去重来源
- merge-ready checkpoint 若已持久化 envelope，resume 会直接 commit，不重跑 merge synthesizer
- merge 已完成时，resume 不会再次消费相同 branch
- `leafSessionRefs` 保留同一 node 的 retry 历史，最新 sessionRef 排在最前
- branch retry 不会设置 `continueLatestSession: true`，因此不会按 `agent_id + provider` 隐式续接全局 latest
  session；如果存在当前 branch 的上一轮 `leafSessionRef.sessionId`，只作为精确 `retryOfSessionId` 传给 Runner
  做审计关联，实际 attempt 默认隔离运行

## 与 CLI / Router 的关系

- `ScenarioRouter` 仍只负责“路由到哪条 workflow”
- `TeamOrchestrator` 负责“这条 team workflow 怎么 fan-out / checkpoint / merge / resume”
- `AgentRunner` 仍是唯一 leaf executor
- CLI release 路径在 `executionMode = team` 且 workflow 合法时直接调用 `executeWorkflow()`，不再 warning 后回退到
  single-agent；fallback 字段只作为旧 checkpoint 兼容或未来显式 unsupported 边界的状态槽位

## 测试覆盖

`packages/core/test/team-orchestrator.test.ts` 当前覆盖：

- schema：MergeEnvelope、CriticOutput、BranchStatus
- mode conformance：parallel / debate / pipeline / hub-spoke（含 proposer→critic 引用传递）
- lifecycle：状态迁移、retry attempt、provider fallback 不新增 branch、workflow deadline 抢占 leaf timeout
- retry isolation：branch retry 不续接其他 branch 或普通 CLI latest session
- checkpoint / resume：fork 恢复、partial-merge 去重、merge-ready envelope commit、continuationRef 优先级、leafSessionRefs 历史保留
