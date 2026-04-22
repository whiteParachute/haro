---
id: FEAT-013
title: Scenario Router（场景路由器）
status: in-progress
phase: phase-1
owner: whiteParachute
created: 2026-04-22
updated: 2026-04-22
related:
  - ../multi-agent-design-constraints.md
  - ../provider-protocol.md
  - ../provider-selection.md
  - ../team-orchestration-protocol.md
  - ../channel-protocol.md
  - ../phase-0/FEAT-005-single-agent-execution-loop.md
  - ../../roadmap/phases.md#phase-1-intelligence--场景理解与动态编排
  - ../../docs/modules/scenario-router.md
  - ../../docs/modules/agent-runtime.md
  - ../../docs/data-directory.md
---

# Scenario Router（场景路由器）

## 1. Context / 背景

Phase 0 已交付 `AgentRunner.run(task, agentId)` 单 Agent 同步执行路径：任务进入后由选择规则引擎决定 provider/model，随后创建 session、消费事件流、写入 SQLite，并维护 `~/.haro/agents/{id}/state.json`。这条链路满足了最小可用执行闭环，但仍缺少一个位于任务入口处的“场景理解层”：系统尚不能在任务到达时判断它应直接走单 Agent，还是应进入多 Agent 协作。

路线图将 Phase 1 的首个核心交付定义为 `Scenario Router（场景感知 + 有状态图 + Checkpointing）`。这意味着 Router 不只是一个分类器，而是 Phase 1 的编排入口：它必须先识别任务场景，再产出结构化路由决策，并把工作流状态持久化到可恢复的 checkpoint 中。

同时，Router 的设计受到三组现有约束：

1. **兼容 Phase 0 基线**：`AgentRunner` 仍是已交付的单 Agent 执行叶子，不应在本 spec 中被回改或重写。
2. **遵守多 Agent 强约束**：多 Agent 协作必须 fork-and-merge，禁止 chain handoff；并行价值来自搜索空间覆盖，而不是岗位分工。
3. **保持 provider/model 可插拔**：Router 可以给出路由提示，但不得硬编码 provider/model，也不得复制 `provider-selection.md` 的选择逻辑。

因此，FEAT-013 的目标是把 Scenario Router 定义为 **Phase 1 的 canonical ingress**：任务统一先进入 Router，由 Router 决定走 single-agent 还是 team workflow，并定义 workflow、leaf session、checkpoint、continuation 之间的边界；但本 spec 仍只起草协议和行为，不实现运行时代码。

## 2. Goals / 目标

- G1: 定义 Scenario Router 的入口定位、场景分类输出、路由决策输出与状态边界，使其成为 Phase 1 的 canonical ingress。
- G2: 定义 single-agent / parallel / debate / pipeline / hub-spoke 等工作流的可路由范围与禁止项，并把多 Agent 约束写成 workflow invariants。
- G3: 定义 workflowId、leaf sessionId、checkpoint、continuationRef 之间的映射与恢复优先级，使 workflow 中断后可从 checkpoint 恢复。
- G4: 保持与 FEAT-005、Channel session、Provider 选择规则的兼容边界，不要求回改 Phase 0 代码或 spec。

## 3. Non-Goals / 不做的事

- 不修改 `packages/` 下任何实现文件，不开始 Phase 1 编码实现。
- 不修改 `specs/phase-0/` 下任何既有 spec，尤其不回写 FEAT-005 的单 Agent 语义。
- 不定义 Team Orchestrator 的完整执行实现、并发调度细节或 Team YAML schema；Router 只定义如何选择其入口与模板。
- 不重写 provider/model 选择逻辑，不新增 provider-specific 分支或硬编码 model id。
- 不把 `channel sessionId` 升级为 `workflowId`，不修改 Phase 0 的 channel session mapping 语义。
- Phase 1 保持最小内建模板集合，并要求其与本 spec 的 routing matrix 一一对应；模板配置化覆盖（全局 `~/.haro/` / 项目级 `.haro/`）推迟到 Phase 2。
- Phase 1 不定义专门的 `code + team` 内建模板；复杂代码任务若未命中 analysis/design/review 等次级 scene，默认仍走 single-agent。
- `evolution-loop` 仅保留协议枚举 / 接口占位以对齐 `team-orchestration-protocol.md`；Phase 1 Router 不得产出该 mode，实现推迟到 Phase 2.

## 4. Requirements / 需求项

- R1: Scenario Router 必须被定义为 **Phase 1 的 canonical ingress**；所有来自 CLI/Channel/上层调用方的任务，在进入执行前都先经过 Router 的 scene classification 与 routing decision。
- R2: Router 必须输出结构化 `SceneDescriptor`，最小包含：`taskType`、`complexity`、`collaborationNeed`、`timeSensitivity`，并允许附带 `validationNeed` 等扩展标签；该描述必须可持久化与回放。
- R3: Router 必须输出结构化 `RoutingDecision`，最小包含：`executionMode`（`single-agent` / `team`）、`orchestrationMode`（仅当 `team` 时出现；协议层枚举与 `team-orchestration-protocol.md` 对齐，包含 `parallel` / `debate` / `pipeline` / `hub-spoke` / `evolution-loop`，但 Phase 1 Router 不得产出 `evolution-loop`）、`workflowTemplateId`、`providerSelectionHints`；Router 不得输出固定 provider/model。
- R4: 当 `executionMode = single-agent` 时，Router 必须把 `AgentRunner` 定义为 internal leaf executor，而不是并列的对外入口；FEAT-013 不要求修改 FEAT-005 API，只定义 Router → Runner 的调用层级。
- R5: Router 必须定义 scene taxonomy 到 routing result 的最小内建矩阵，并规定匹配优先级为 **具体规则优先于通配 fallback**；`任意` / `fallback` 行只能作为最后兜底，不能覆盖更具体的 scene 规则。Phase 1 只使用本 spec 内建模板，配置化覆盖推迟到 Phase 2。
- R6: 对于 reasoning 场景（例如 analysis / research / design / review），Router 只能路由到满足 fork-and-merge 的 team workflow；**不得**路由到 `pipeline`，也不得生成 `serial-chain` 拓扑。
- R7: `validator` / `critic` 节点必须是对抗性否定者：可以读取原始输入与完整 checkpoint state，但输出只能是问题清单、风险或否定意见；不得直接接棒修复、改写方案或形成 proposer → validator → proposer 的链式 handoff。
- R8: Router 必须定义 workflow identity 映射：`1 ingress -> 1 workflowId`；single-agent workflow 的基线是 `1 workflowId -> 1 leaf sessionId`；只有 **显式 retry / 新 leaf node / 新执行轮次** 才允许扩展为 `1 workflowId -> N leaf sessionId`。
- R9: Router 必须明确：FEAT-005 的 provider fallback 仍属于同一个 leaf session 内的候选切换，写入 `provider_fallback_log` 即可；**provider fallback 不得被解释为创建新 session**。
- R10: Router 必须把 checkpoint 定义为 workflow 级状态快照，至少包含：`workflowId`、`nodeId`、`sceneDescriptor`、`routingDecision`、`rawContextRefs`、`branchState`、`leafSessionRefs`、`createdAt`；checkpoint 存于现有 SQLite `workflow_checkpoints`，内容必须是完整结构化 JSON，而非摘要。`rawContextRefs` 以 immutable raw refs 为主载体，payload 内联仅作为未来优化方向，不是 Phase 1 必需项。
- R11: Router 必须定义恢复优先级：`workflow checkpoint -> referenced leaf session continuationRef -> provider responseId -> node-level restart`；恢复不得退化为“重新分类 + 重新规划”，除非不存在任何 workflow state。对于 partial-merge 恢复，contract 层必须以前序 checkpoint 中的 completed-branch 去重标记为准，避免重复消费已完成分支；更细的 ledger / 存储结构留待编码期细化。
- R12: Router 必须保证 fork 分支、merge 节点与 validator 节点都可访问原始输入引用与完整 checkpoint state，遵守“Pass the Source, Not the Summary”；不得只传递上游摘要。
- R13: Router 必须声明 `channel sessionId` 与 `workflowId` 的边界：前者继续表示 transport / conversation continuity，后者是 Router 在 ingress 后生成的内部编排主键；FEAT-013 不修改 `specs/channel-protocol.md` 的 session 语义。
- R14: Router 必须遵守 `provider-protocol.md` 与 `provider-selection.md` 的可插拔原则：Router 只能输出抽象 routing / selection hints；provider 查询、能力判定与 model 解析仍由现有 ProviderRegistry 与选择规则引擎处理。
- R15: FEAT-013 本轮修订必须把边界写死为“只修改 `specs/phase-1/FEAT-013-scenario-router.md`，不修改 `packages/` 与 `specs/phase-0/`”。

## 5. Design / 设计要点

### 5.1 Canonical ingress 与执行分层

Phase 1 之后，Router 在协议层位于输入层与执行层之间：

```text
CLI / Channel / API ingress
  -> Scenario Router
  -> RoutingDecision
    -> single-agent workflow -> AgentRunner (leaf executor)
    -> team workflow -> Team Orchestrator (future Phase 1 implementation)
```

关键边界：

- Router 是 **入口控制面**。
- `AgentRunner` 是 **single-agent workflow 的 leaf executor**。
- Team Orchestrator 是 **team workflow 的 leaf runtime**，但本 spec 不展开其内部实现。
- FEAT-013 不回改 FEAT-005，只重新定义“谁是上层入口”。

### 5.2 SceneDescriptor

Router 对每个任务先生成 `SceneDescriptor`：

```typescript
interface SceneDescriptor {
  taskType:
    | 'quick'
    | 'code'
    | 'analysis'
    | 'research'
    | 'design'
    | 'review'
    | 'deterministic-toolchain';
  complexity: 'simple' | 'moderate' | 'complex';
  collaborationNeed: 'single-agent' | 'team';
  timeSensitivity: 'realtime' | 'batch';
  validationNeed?: 'none' | 'standard' | 'adversarial';
  tags?: string[];
}
```

说明：

- `review` 与 `deterministic-toolchain` 在本 spec 中被显式列为合法 taskType，避免 `docs/modules/scenario-router.md` 中“表格未定义但选择逻辑使用”的漂移。
- `validationNeed` 是可选扩展维度，用于表示是否需要 validator pattern，但不直接创造新 orchestration mode。
- SceneDescriptor 是 workflow 持久化的一部分，后续恢复直接读取，不重新推断。

### 5.3 RoutingDecision

```typescript
interface RoutingDecision {
  executionMode: 'single-agent' | 'team';
  orchestrationMode?: 'parallel' | 'debate' | 'pipeline' | 'hub-spoke' | 'evolution-loop';
  workflowTemplateId: string;
  providerSelectionHints?: {
    preferredTags?: string[];
    estimatedComplexity?: 'simple' | 'moderate' | 'complex';
    requiresLargeContext?: boolean;
  };
}
```

设计原则：

- `executionMode` 只区分 single-agent 与 team。
- `orchestrationMode` 只使用既有协议枚举。
- `workflowTemplateId` 表示模板实例，如：`single-fast`、`single-code-default`、`hub-spoke-analysis`、`parallel-research`、`debate-design-review`。
- Phase 1 仅允许产出本 spec routing matrix 中列出的内建模板；模板配置化覆盖推迟到 Phase 2。
- `parallel-coverage`、`adversarial-validation` 只能是模板语义或节点 pattern，**不是**新的 mode。
- `evolution-loop` 仅保留为协议枚举占位；Phase 1 Router 不得将其作为实际路由结果输出。

### 5.4 Routing matrix（最小内建集合）

Phase 1 先固定最小内建模板集合，并要求 `workflowTemplateId` 与下表逐项对齐；模板配置化能力（全局 `~/.haro/` / 项目级 `.haro/`）推迟到 Phase 2。矩阵匹配遵循“**更具体 > 更通用**”；最后一行 fallback 才能使用通配规则。

| Scene 条件                                 | executionMode  | orchestrationMode | workflowTemplateId             | 备注                          |
| ------------------------------------------ | -------------- | ----------------- | ------------------------------ | ----------------------------- |
| `quick + simple + single-agent`            | `single-agent` | —                 | `single-fast`                  | 快速查询/轻量任务             |
| `code + (simple\|moderate) + single-agent` | `single-agent` | —                 | `single-code-default`          | 默认代码生成/修复仍走单 Agent |
| `analysis + moderate/complex + team`       | `team`         | `hub-spoke`       | `hub-spoke-analysis`           | 按信息维度拆分子任务          |
| `research + moderate/complex + team`       | `team`         | `parallel`        | `parallel-research`            | 多路覆盖搜索空间              |
| `design + moderate/complex + team`         | `team`         | `debate`          | `debate-design-review`         | 方案生成 + 对抗性批评         |
| `review + moderate/complex + team`         | `team`         | `debate`          | `debate-review`                | 适用于决策/评审/批判式验证    |
| `deterministic-toolchain + batch + team`   | `team`         | `pipeline`        | `pipeline-deterministic-tools` | 仅机械步骤                    |
| `任意未命中场景`                           | `single-agent` | —                 | `single-default-fallback`      | 最终兜底                      |

补充约束：

- `analysis/research/design/review` 若要求 team，**禁止**落到 `pipeline`。
- Phase 1 不定义专门的 `code + team` 标准模板；若某代码任务同时表现为 analysis/review/design，则按更具体 scene 规则处理，否则回退到 `single-code-default`。
- `validator pattern` 可出现在 `parallel` / `debate` / `hub-spoke` 模板内部，但不改变 orchestrationMode。

### 5.5 Workflow identity 与状态映射

```text
1 ingress
  -> 1 workflowId
     -> 1..N checkpoints
     -> 1..N nodes
        -> each leaf node may reference 0..1 leaf sessionId at a time
```

边界说明：

- `workflowId`：Router 生成的内部编排主键，是恢复入口主键。
- `leaf sessionId`：当某节点落到 `AgentRunner` 或未来 Team leaf runtime 时，对应写入 `sessions.id` 的执行标识。
- `channel sessionId`：外部 transport / conversation continuity 标识，不等同于 workflowId。
- single-agent workflow 的基线是 `1 workflowId -> 1 leaf sessionId`。
- FEAT-005 provider fallback 仅发生在同一 leaf session 内，不改变 workflow/session 映射。
- 若显式 retry、进入新 leaf node，或开启新执行轮次，workflow 才可新增 leaf session 引用。

### 5.6 Checkpoint 结构与持久化

checkpoint 存于现有 `workflow_checkpoints` 表，状态使用 JSON 序列化。推荐最小结构：

```typescript
interface WorkflowCheckpointState {
  workflowId: string;
  nodeId: string;
  nodeType: 'router' | 'agent' | 'team' | 'validator' | 'merge' | 'tool';
  sceneDescriptor: SceneDescriptor;
  routingDecision: RoutingDecision;
  rawContextRefs: Array<{ kind: 'input' | 'artifact' | 'session-event'; ref: string }>;
  branchState: Record<string, unknown>;
  leafSessionRefs: Array<{
    nodeId: string;
    sessionId: string;
    continuationRef?: string;
    providerResponseId?: string;
  }>;
  createdAt: string;
}
```

这里的 `rawContextRefs` 强调“传原文引用而非摘要”；Phase 1 决议为**优先保存 immutable raw refs + 完整结构化 state**，以满足 Pass the Source, Not the Summary。若未来需要为性能或离线恢复增加 payload 内联，应作为后续优化单独评估，而不是当前协议前提。

### 5.7 Recovery / Resume flow

恢复时的优先级：

1. 读取 `workflowId` 对应的最新 checkpoint。
2. 若 checkpoint 引用了 leaf session continuationRef，则优先恢复该 leaf executor 的 continuation。
3. 若 continuationRef 缺失但存在 provider responseId，则按 provider continuation 恢复。
4. 若以上都不可用，则从当前 node 执行级别重启。
5. 只有当 workflow 不存在任何 checkpoint / state 时，才允许把请求视为全新 ingress 并重新分类。

幂等原则：

- 对同一 checkpoint 的重复恢复必须视为“重入同一 workflow state”，而不是创建新的 workflow。
- merge 之后的下游节点不得因重复恢复而重复消费已经标记为 completed 的分支结果。
- partial-merge 恢复必须基于 `completed-branch` 去重标记判断哪些分支结果已被消费；contract 层先锁定这一幂等语义，具体数据结构留待编码期决定。
- 如果 leaf session 已完成但 merge 未完成，恢复应重用已完成分支的 checkpoint 结果，而不是重新执行所有分支。

### 5.8 多 Agent invariants

FEAT-013 将 `multi-agent-design-constraints.md` 转换为 Router 级硬约束：

- **Pass the Source, Not the Summary**：分支共享原始输入引用和完整 checkpoint state。
- **Fork and Merge, Never Chain**：team reasoning workflow 只能 fork 后 merge，禁止 proposer → worker → validator 串行交接。
- **Parallel Coverage, Not Role Division**：`hub-spoke-analysis`、`parallel-research` 等模板按信息来源/搜索空间拆分，不按 PM/开发/测试等岗位拆分。
- **Validator is an Adversary**：validator 只能找问题，不能直接写修复。
- **Pipeline only for deterministic toolchains**：有推理/判断的 team workflow 禁用 pipeline。

### 5.9 与 Provider / Channel / AgentRunner 的边界

- **Provider 边界**：Router 不直接选择具体 provider/model，只给出抽象 hints；最终 provider/model 仍由 FEAT-005 的选择引擎和 ProviderRegistry 处理。
- **AgentRunner 边界**：Router 可引用 FEAT-005 continuation 语义，但不改动其 session 主循环或 fallback 定义。
- **Channel 边界**：Router 可消费 channel sessionId 作为 ingress context，但不得把 channel session mapping 改写成 workflow persistence 方案。

### 5.10 Deferred protocol boundary

- Phase 1 不在 FEAT-013 中定义 merge 节点统一输出结构协议。诸如 `candidates / findings / decision / evidenceRefs` 这类 merge payload schema，延后到后续 **FEAT-014 Team Orchestrator spec** 统一收敛。
- FEAT-013 当前只要求 merge 节点在协议上能读取 `rawContextRefs` + 完整 checkpoint state（或等价 raw refs），并遵守 fork-merge / validator invariants；不在本 spec 中展开 template-specific merge payload。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定一个 `quick + simple + single-agent` 任务，Router 应输出 `executionMode = single-agent`、`workflowTemplateId = single-fast`，并明确委派到 FEAT-005 Runner。（对应 R1-R4）
- AC2: 给定一个 `analysis + complex + team` 任务，Router 应输出 `executionMode = team`、`orchestrationMode = hub-spoke` 或其他满足 fork-and-merge 的 **Phase 1 合法 mode**，且不得选 `pipeline` 或 `evolution-loop`。（对应 R3、R5-R6）
- AC3: 给定一个 `design/review + team` 任务，Router 产生的 workflow template 中 validator/critic 节点必须只能输出问题清单或否定意见，不得含修复接棒语义。（对应 R6-R7）
- AC4: single-agent workflow 的基线映射必须为 `1 workflowId -> 1 leaf sessionId`；同一 workflow 内 provider fallback 只写 `provider_fallback_log`，不得创建新 sessionId。（对应 R8-R9）
- AC5: 任一 workflow node 完成后，SQLite `workflow_checkpoints` 中应存在对应 checkpoint，且 JSON 至少含 `workflowId`、`nodeId`、`sceneDescriptor`、`routingDecision`、`rawContextRefs`、`branchState`、`leafSessionRefs`；其中 `rawContextRefs` 以 raw refs 为主载体，不得退化为摘要。（对应 R10）
- AC6: fork 分支、merge 节点与 validator/critic 节点在协议上必须能访问 `rawContextRefs` + 完整 checkpoint state（或等价 raw refs），不得只接收上游摘要。（对应 R7、R10-R12）
- AC7: 模拟 workflow 中断后，恢复流程必须优先从 `workflowId` 对应的 checkpoint 继续；若 checkpoint 已存在，不得退化为重新分类同一任务。对 partial-merge 恢复，已标记 completed 的分支结果不得被重复消费。（对应 R11）
- AC8: 任一 team reasoning workflow 的设计中，不得出现 `pipeline` 或 `serial-chain` 拓扑；相关禁止项需在 spec 中有显式负向描述。（对应 R6、R12）
- AC9: spec 中必须明确 `channel sessionId` 与 `workflowId` 的不同职责，并写明 FEAT-013 不修改 `channel-protocol.md` 的 session mapping 语义。（对应 R13）
- AC10: spec 中不得出现固定 provider id / model id；所有 provider/model 决策均通过 `provider-protocol.md`、`provider-selection.md` 引用抽象能力与选择规则。（对应 R14）
- AC11: 本轮修订的 git diff 仅修改 `specs/phase-1/FEAT-013-scenario-router.md`，不得修改 `packages/` 或 `specs/phase-0/`。（对应 R15）

## 7. Test Plan / 测试计划

- 单元测试（未来实现阶段）：
  - scene classification：覆盖 `quick / code / analysis / research / design / review / deterministic-toolchain` 的最小判定分支。
  - routing matrix：覆盖“具体规则优先于 fallback”的优先级、reasoning 场景禁用 `pipeline`，以及 Phase 1 不产出 `evolution-loop`。
  - checkpoint serializer：覆盖 `WorkflowCheckpointState` 字段完整性、`rawContextRefs` 作为 primary carrier 的约束，以及 JSON 序列化。
  - recovery selector：覆盖 `checkpoint -> continuationRef -> responseId -> node restart` 的恢复优先级，以及 partial-merge 场景下 `completed-branch` 去重。
- 集成测试（未来实现阶段）：
  - single-agent workflow：验证 Router -> AgentRunner 的委派路径、workflowId 与 leaf sessionId 映射、provider fallback 不新建 session。
  - team workflow：验证 parallel / debate / hub-spoke 模式的 fork-merge 拓扑、validator 负向约束，以及 fork/merge/validator 均能读取 `rawContextRefs` + 完整 checkpoint state。
  - interruption / resume：验证 workflow 在 checkpoint 后中断并从同一 workflowId 恢复；若 merge 已消费部分分支，恢复不得重复消费已完成分支。
- 手动验证（本次 spec 起草阶段）：
  - 检查 frontmatter 已更新为 `status: approved`、`updated: 2026-04-22`，且 Open Questions 已关闭并从正文移除。
  - 检查 routing matrix、Non-Goals、Requirements、Acceptance Criteria 三处对 Phase 1 边界保持一致：仅最小内建模板、`code + team` 继续经次级 scene 处理、`evolution-loop` 仅保留占位且不产出。
  - 检查 spec 是否显式引用 FEAT-005、multi-agent constraints、provider 协议与 channel 边界，并把 merge 输出结构协议延后到 FEAT-014。
  - 运行 `pnpm lint` 作为仓库既有 lint 步骤，并在验证记录中注明该命令仅覆盖 `packages/*/src/**/*.ts` 与 `scripts/**/*.ts`，**不覆盖 markdown**。
- 回归风险点：
  - 把 `workflowId` 与 `channel sessionId` 混为一谈，导致 Phase 0 channel 语义被回改。
  - 把 `parallel-coverage`、`adversarial-validation` 误写成新的 orchestration mode。
  - 把 provider fallback 错误建模成新 session，破坏 FEAT-005 语义。

## 8. Changelog / 变更记录

- 2026-04-22: whiteParachute — 初稿
  - 将 Scenario Router 定义为 Phase 1 canonical ingress，明确 Router / AgentRunner / Team Orchestrator 的入口分层。
  - 收敛 workflowId、leaf sessionId、checkpoint、continuationRef 的边界与恢复优先级。
  - 把 fork-merge、validator 否定者、pipeline 禁用 reasoning 等多 Agent 约束写成 Requirements 与 Acceptance Criteria。
  - 明确本次交付只新增 `specs/phase-1/FEAT-013-scenario-router.md`，不修改 `packages/` 与 `specs/phase-0/`。
- 2026-04-22: whiteParachute — 关闭 Open Questions，spec approved
  - Q1 → `rawContextRefs` 采用引用优先；payload 内联保留为未来优化，不作为 Phase 1 前提。
  - Q2 → Phase 1 保持内建模板，并要求与 routing matrix 一致；配置化覆盖延后到 Phase 2。
  - Q3 → partial-merge 恢复采用 `completed-branch` 去重语义；contract 层禁止重复消费已完成分支，细节留待编码期。
  - Q4 → Phase 1 不新增 `code + team` 专门模板，继续通过 analysis / review / design 次级 scene 重分类。
  - Q5 → merge 输出结构协议延后到 FEAT-014 Team Orchestrator spec；FEAT-013 只锁定 Router 侧边界。
  - 补充 AC：fork / merge / validator 必须拿到 `rawContextRefs` + 完整 checkpoint state（或等价 raw refs），不能只传摘要。
- 2026-04-22: whiteParachute — 实现 FEAT-013 Scenario Router 核心逻辑与 CLI 接入
  - `packages/core/src/scenario-router.ts`：SceneClassifier、RoutingMatrix、ScenarioRouter、CheckpointStore 实现
  - `packages/cli/src/index.ts`：Router 接入为 canonical ingress，single-agent 委派到 AgentRunner，team 模式暂回退
  - 测试覆盖：core 层单元测试 + CLI 集成测试，全部通过
  - status 从 approved 切到 in-progress（实现已落地）
