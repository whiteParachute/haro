---
id: FEAT-014
title: Team Orchestrator（团队编排器）
status: done
phase: phase-1
owner: whiteParachute
created: 2026-04-22
updated: 2026-04-22
related:
  - ../multi-agent-design-constraints.md
  - ../team-orchestration-protocol.md
  - ../phase-1/FEAT-013-scenario-router.md
  - ../../docs/modules/team-orchestrator.md
  - ../../docs/modules/scenario-router.md
  - ../../roadmap/phases.md#phase-1-intelligence--场景理解与动态编排
---

# Team Orchestrator（团队编排器）

## 1. Context / 背景

FEAT-013 已把 `Scenario Router` 定义为 Phase 1 的 canonical ingress：任务先被分类，随后产出
`RoutingDecision` 与 `ScenarioWorkflow`，其中 team 路径已经保留
`executionMode = team`、`orchestrationMode = parallel / debate / pipeline / hub-spoke`、
`workflowId`、`nodes`、`leafSessionRefs` 与 `CheckpointStore` 边界。但当前运行时尚未实现真正的 Team
Orchestrator：CLI 只会记录 team 决策、写入 checkpoint，再 warning 后回退到 single-agent 执行。

这导致当前系统存在一个明显断层：**Router 已能决定“应该多 Agent 协作”，但运行时还不能把这个决策展开为可执行、可恢复、可合并的 team 图。**
FEAT-013 同时明确把 merge 节点的统一输出协议延后到 FEAT-014，因此 FEAT-014 的任务不是重做路由，
而是补齐 team workflow 的执行协议、merge 语义与 checkpoint 恢复边界。

本 spec 受到以下硬约束控制：

1. **Fork and Merge, Never Chain**：所有 team 推理图必须先分叉再回流到 merge，禁止成员之间串行交接链。
2. **Parallel Coverage, Not Role Division**：branch 的拆分按信息来源、搜索空间、假设维度，不能按 PM / 开发 / 测试等岗位分工。
3. **Validator is an Adversary**：validator / critic 只能输出否定意见、风险或问题清单，不能接棒修复。
4. **Pipeline only for deterministic toolchains**：涉及推理、判断、分析的 team 任务不能使用 pipeline。
5. **AgentRunner remains the only leaf executor**：Phase 1 仍只有 `AgentRunner` 负责叶子执行；Team
   Orchestrator 只负责组织多个 leaf run，而不是引入第二套 leaf runtime。

因此，FEAT-014 的目标是把 Team Orchestrator 定义为 **Router 之后的 team runtime control plane**：它消费
FEAT-013 的 workflow / checkpoint 合约，负责 fan-out、leaf 调度、merge、checkpoint 与恢复；但不重新分类、
不回改 FEAT-013 实现、不开始 Phase 1 其他编码组件。

## 2. Goals / 目标

- G1: 定义 Team Orchestrator 与 Scenario Router、AgentRunner、CheckpointStore 之间的调用边界。
- G2: 定义 `parallel`、`debate`、`pipeline` 三种主模式的执行协议、调度边界与 merge 语义。
- G3: 为 FEAT-013 已会产出的 `hub-spoke` 路径定义兼容边界，避免 Router 产出合法 mode 但 runtime 语义缺失。
- G4: 定义统一的 merge 节点输出 envelope，使下游节点与恢复逻辑可以一致消费分支结果。
- G5: 定义 team workflow 的 checkpoint 写入点、branch ledger 与中断恢复语义，保证 partial-merge 可幂等恢复。
- G6: 保持与 FEAT-013 已有 `workflowId`、`leafSessionRefs`、`provider fallback`、`channel sessionId` 边界兼容。

## 3. Non-Goals / 不做的事

- 不修改 `packages/` 下任何实现文件，不开始 FEAT-014 的运行时代码编写。
- 不修改 `specs/phase-1/FEAT-013-scenario-router.md`、`specs/team-orchestration-protocol.md` 或其他既有 spec。
- 不重做 `Scenario Router` 的 scene taxonomy、routing matrix 或 provider selection 逻辑。
- 不引入新的 leaf executor；team branch 的叶子执行仍视为 `AgentRunner` 调用。
- 不在本 spec 中拍板 actor、线程池、队列、锁、并发库等实现细节。
- 不把 Team YAML / team registry / template 配置化治理完整展开为本轮交付；Phase 1 仍以内建模板为前提。
- 不允许通过 branch-to-branch 直接通信、摘要传递或 validator 接棒来“简化”编排。
- 不把 `channel sessionId` 与 `workflowId` 混用，也不改变 FEAT-013 定义的恢复优先级。

## 4. Requirements / 需求项

> 编号后的需求是开发与测试对齐的锚点。PR / commit message / 测试用例都应引用编号（R1、R2…）。

- R1: Team Orchestrator 必须被定义为 Router 之后的 team workflow 执行层；其输入至少包含
  `RoutingDecision`、`ScenarioWorkflow`、原始输入引用与可恢复 checkpoint state。
- R2: Team Orchestrator 不得重新做 scene classification、reroute 或改写 `workflowId` 语义；Router 只负责到
  workflow 入口，Orchestrator 负责把该入口展开为执行图。
- R3: 当 `executionMode = team` 时，Team Orchestrator 必须把每个 leaf branch 的实际执行视为
  `AgentRunner` 调用；不得绕过 AgentRunner 直接调用 provider 或建立第二套 leaf session 语义。
- R4: Team Orchestrator 必须支持 `parallel`、`debate`、`pipeline` 三种主模式，并为 FEAT-013 已会产出的
  `hub-spoke` 定义明确行为：要么纳入 Phase 1 的正式兼容路径，要么给出显式 unsupported 语义；不得保持未定义状态。
- R5: 所有 team workflow 都必须遵守 fork-and-merge 拓扑：branch 只能从同一 orchestrator 节点 fan-out，
  再回流到 merge 节点；不得形成 proposer → worker → validator 之类的链式 handoff。
- R6: branch 拆分维度必须是信息来源、搜索空间、假设维度或工具步骤；不得按人类岗位、角色或职能拆分 team。
- R7: `parallel` 模式必须表达“多路并行覆盖同一全局任务”，每个 branch 都可读取同一份原始输入与完整 checkpoint
  state，但探索指令必须在信息来源 / 假设 / 搜索空间上有明确差异。
- R8: `debate` 模式必须至少包含 proposer 与 adversarial critic 两类 branch；critic 只能输出问题、风险、
  反例或否定意见，不得输出 fix、revised proposal、接棒实现计划或替代方案执行。
- R9: `pipeline` 模式只允许用于 deterministic-toolchain。若任一步包含分析、判断、开放式推理、策略生成或
  语义裁决，该 workflow 必须被视为不合规，不能伪装成 pipeline。
- R10: Team Orchestrator 必须定义 branch 生命周期的最小状态集合，至少包括：`pending`、`dispatched`、
  `running`、`completed`、`failed`、`cancelled`、`timed-out`、`merge-consumed`。
- R11: Team Orchestrator 必须区分“逻辑 team member”与“执行尝试”：逻辑 member / branch plan 可以复用，
  但每次 leaf 执行尝试都必须有独立 branch ledger 记录；是否复用底层 agent 实例对象属于实现期问题，不在本 spec 拍板。
- R12: Team Orchestrator 必须遵守 FEAT-013 的 leaf session 规则：同一 branch attempt 最多绑定一个 active
  `leafSessionRef`；显式 retry 才允许新增 leaf session；provider fallback 仍属于同一 leaf session 内部切换，
  不能被解释为新 branch 或新 team member。
- R13: Team Orchestrator 必须定义统一的 merge output envelope。该 envelope 至少包含：`workflowId`、
  `mergeNodeId`、`orchestrationMode`、`sourceBranches`、`status`、`evidenceRefs`、`consumedBranches` 与
  mode-specific body；其中 mode body 必须能够映射到 `candidates / findings / decision / evidenceRefs` 四类逻辑桶
  或等价结构。
- R14: merge output 不得退化为纯自然语言摘要。下游节点与恢复逻辑必须能读取结构化字段，并能追溯到原始输入、
  完整 branch 产物或其稳定引用。
- R15: `parallel`、`debate`、`pipeline`、`hub-spoke` 的 merge body 可以不同，但必须通过同一 envelope 暴露
  审计、恢复与下游消费所需的最小公共字段；不得强行把所有 mode 压成同一语义 body。
- R16: Team Orchestrator 必须在至少三个关键阶段写入 checkpoint：fork / dispatch 完成后、leaf branch terminal
  完成后、merge 节点完成后；checkpoint 必须通过 FEAT-013 的 `CheckpointStore` 持久化。
- R17: team workflow 的 checkpoint state 必须额外包含 branch ledger，至少记录：branchId、nodeId、status、
  attempt、leafSessionRef、outputRef、consumedByMerge、startedAt、finishedAt、lastError。
- R18: Team Orchestrator 必须遵守 FEAT-013 的恢复优先级：`workflow checkpoint -> continuationRef ->
provider responseId -> node restart`；不得在仍存在 workflow state 时退化为重新分类或重新规划。
- R19: 对 partial-merge 恢复，Team Orchestrator 必须以前序 checkpoint 中的 `consumedBranches` / dedupe 标记
  为准；已完成且已消费的 branch 不得被重复执行或重复并入 merge。
- R20: `hub-spoke` 在 Phase 1 的行为必须被明确写死。若正式兼容，则其 branch 输出关系必须是“互补切片 +
  synthesis merge”，而非竞争候选；若暂不实现，则必须要求 runtime 返回显式 unsupported error，而不是静默 fallback。
- R21: debate / validator 的 negative-only contract 必须体现为结构化输出约束。至少要能表达：问题、风险、
  反例、未覆盖边界；不得出现 `fix`、`implementationPlan`、`revisedProposal` 等接棒字段。
- R22: pipeline 的合法性检查必须在 Phase 1 可执行边界内落地。由于本阶段仍以内建模板为主，合法性判定不得依赖
  未来 Team YAML 注册面作为唯一 enforcement 入口。
- R23: FEAT-014 本轮交付的 git diff 必须只新增 `specs/phase-1/FEAT-014-team-orchestrator.md`；不得修改
  `packages/` 或既有 specs。

## 5. Design / 设计要点

### 5.1 调用边界：Router 只到 workflow 入口，Orchestrator 负责展开执行图

Team workflow 的控制面分层如下：

```text
CLI / Channel / API ingress
  -> Scenario Router
  -> RoutingDecision + ScenarioWorkflow skeleton
  -> Team Orchestrator
       -> branch expansion / fan-out
       -> AgentRunner leaf execution(s)
       -> merge
       -> checkpoint / resume
```

边界要求：

- `Scenario Router` 决定是否进入 team workflow，以及使用哪种 `orchestrationMode` / `workflowTemplateId`。
- `Team Orchestrator` 消费 Router 产出的 skeleton workflow，把它展开为实际执行图与 branch plan。
- `AgentRunner` 仍是唯一 leaf executor；Team Orchestrator 只是组织多个 `AgentRunner` run。
- `CheckpointStore` 仍是 workflow 级恢复锚点；Team Orchestrator 不能自造平行的恢复主键。

因此，Router 负责“选哪条 team 路径”，Orchestrator 负责“这条 team 路径如何被执行、合并与恢复”。

### 5.2 Team 执行图与拓扑约束

Phase 1 中所有合法 team 图都必须满足统一拓扑不变量：

```text
                fork
                  |
      ┌-----------+-----------┐
      |           |           |
   branch A    branch B    branch C
      └-----------+-----------┘
                  |
                merge
```

约束说明：

- 所有 branch 必须直接由 orchestrator 或其等价 dispatch 节点 fan-out。
- branch 之间不得直接通信，不得互传摘要，不得形成链式 handoff。
- validator / critic 也只是某一种 branch；它可以读取原始输入与完整 checkpoint state，但输出仍需回到 merge。
- `hub-spoke` 在拓扑上仍然遵守相同约束，只是 merge 语义从“竞争候选裁决”变成“互补切片综合”。

### 5.3 Agent 生命周期：逻辑 member、branch attempt 与 leaf session 的分层

FEAT-014 不把“是否复用底层 agent 实例对象”写死为协议，但必须把运行时状态边界写清：

1. **逻辑 team member**：模板中声明的能力槽位或 branch 角色，例如 `local-code-source`、`doc-source`、
   `proposer`、`critic`、`tool-step-2`。
2. **branch plan**：一次 workflow 中该逻辑 member 对应的计划 branch，具有稳定 `branchId`。
3. **branch attempt**：某个 branch 的一次执行尝试，具有 `attempt` 计数。
4. **leaf session**：某次 branch attempt 通过 AgentRunner 产生的 leaf `sessionId` / continuation / provider
   response 绑定。

推荐最小状态机：

```typescript
interface BranchLedgerEntry {
  branchId: string;
  nodeId: string;
  memberKey: string;
  mode: 'parallel' | 'debate' | 'pipeline' | 'hub-spoke';
  status:
    | 'pending'
    | 'dispatched'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'timed-out'
    | 'merge-consumed';
  attempt: number;
  leafSessionRef?: {
    sessionId: string;
    continuationRef?: string;
    providerResponseId?: string;
  };
  outputRef?: string;
  consumedByMerge: boolean;
  startedAt?: string;
  finishedAt?: string;
  lastError?: string;
}
```

协议边界：

- 逻辑 member 是否复用同一个内存中的 agent 对象是实现问题；spec 只要求 branch ledger 可区分逻辑 member 与执行尝试。
- **Q1 结论（业界参考）**：Claude Code 明确推崇 fresh spawn（每次新建干净上下文），Codex CLI 默认 `codex exec` 为 one-shot 无状态调用，Hermes Agent 的子代理虽为 in-process clone 但各自保持独立会话状态。业界共识是"默认隔离、记忆外置、复用仅发生在连接/会话层"。因此 FEAT-014 **不强制复用底层 agent 实例，默认每次 branch attempt 新建或 fork 隔离上下文**；若实现选择复用，必须在 dispatch 前显式重置状态，确保 branch 间无上下文泄漏。
- branch retry 必须提升 `attempt`；若产生新的 leaf session，必须显式追加到 `leafSessionRefs`。
- provider fallback 不会创建新 branch，也不会重置 `attempt`。

### 5.4 Parallel 模式：多路覆盖、竞争候选、统一 merge

适用场景：同一全局任务需要从不同信息来源、搜索空间或假设维度并行探索。

执行协议：

1. Orchestrator 为每条 branch 保留同一份原始输入引用与完整 checkpoint state。
2. branch 指令只能在信息属性上区分，例如“本地代码”、“线上文档”、“历史记忆”、“CI 日志”；不能按岗位区分。
3. 各 branch 并行运行，互不通信。
4. merge 节点收集所有 branch 的完整产物后，形成候选集、发现项与决策。

推荐 merge body：

```typescript
interface ParallelMergeBody {
  kind: 'parallel';
  candidates: Array<{
    branchId: string;
    outputRef: string;
    confidence?: number;
    evidenceRefs: string[];
  }>;
  findings: Array<{
    id: string;
    summary: string;
    type: 'observation' | 'conflict' | 'gap';
    sourceBranchIds: string[];
    evidenceRefs: string[];
  }>;
  decision: {
    mode: 'select-one' | 'select-many' | 'union' | 'blocked';
    selectedBranchIds: string[];
    rationale: string;
    evidenceRefs: string[];
  };
}
```

负向约束：

- 不得在 branch 之间串行传递中间结果。
- 不得在只收到部分 branch 结果时提前返回“最终答案”。
- 不得把 branch 输出压缩成摘要后再给 merge；merge 必须读取完整产物或稳定引用。

### 5.5 Debate 模式：proposer + adversarial critic，决策在 merge 形成

适用场景：方案评审、决策验证、风险识别。

执行协议：

1. proposer branch 产出完整方案。
2. critic branch 读取原始输入、完整方案与完整 checkpoint state，输出问题、风险、反例、未覆盖边界。
3. proposer 与 critic 不直接往返，不允许形成多轮 chain。
4. merge 节点依据 proposer 产物与 critic findings 形成最终决策：通过、阻断、要求重新规划或保留多个候选。

推荐 merge body：

```typescript
interface DebateMergeBody {
  kind: 'debate';
  candidates: Array<{
    branchId: string;
    role: 'proposer';
    outputRef: string;
    evidenceRefs: string[];
  }>;
  findings: Array<{
    branchId: string;
    role: 'critic';
    summary: string;
    severity: 'low' | 'medium' | 'high';
    evidenceRefs: string[];
  }>;
  decision: {
    outcome: 'accepted' | 'accepted-with-risk' | 'blocked' | 'needs-replan';
    rationale: string;
    evidenceRefs: string[];
  };
}
```

critic 的结构化负约束：

```typescript
interface CriticOutput {
  issues: Array<{ summary: string; evidenceRefs: string[] }>;
  risks?: Array<{ summary: string; evidenceRefs: string[] }>;
  counterExamples?: Array<{ summary: string; evidenceRefs: string[] }>;
  uncoveredEdges?: Array<{ summary: string; evidenceRefs: string[] }>;
}
```

其中不得出现 `fix`、`patch`、`implementationPlan`、`revisedProposal`、`delegateTo` 等接棒字段。

### 5.6 Pipeline 模式：仅限 deterministic-toolchain

适用场景：纯工具链、格式转换、数据清洗、日志汇总等不依赖推理分支的步骤序列。

执行协议：

1. pipeline step 按顺序执行。
2. 每步输入必须是上一步的完整产物或其稳定引用，而不是对上一步的摘要。
3. 如果某一步需要分析、判断、创造性生成、方案裁决或开放式 LLM 推理，该 workflow 即不再合法，应改用
   parallel / debate / hub-spoke。
4. pipeline 的“串行”仅限 deterministic tool step 之间的数据依赖；不得把推理型 agent handoff 伪装成工具步骤。

推荐 merge / terminal body：

```typescript
interface PipelineMergeBody {
  kind: 'pipeline';
  candidates: Array<{
    stepId: string;
    outputRef: string;
    evidenceRefs: string[];
  }>;
  findings: Array<{
    stepId: string;
    summary: string;
    type: 'step-output' | 'warning' | 'failure';
    evidenceRefs: string[];
  }>;
  decision: {
    outcome: 'completed' | 'blocked' | 'partial';
    rationale: string;
    evidenceRefs: string[];
  };
}
```

说明：这里仍保留 `candidates / findings / decision` 三类逻辑桶，但 `candidates` 的语义是“step outputs”，不是竞争方案。

### 5.7 Hub-Spoke 兼容边界：互补切片而非竞争候选

虽然本 spec 的重点是 `parallel`、`debate`、`pipeline` 三种主模式，但 FEAT-013 已会对 analysis 场景产出
`hub-spoke-analysis`。因此 FEAT-014 不能忽略它。本 spec 对 Phase 1 的处理是：**把 hub-spoke 视为正式兼容路径**，
但其 merge 语义与 parallel 明确区分。

适用语义：

- 每个 spoke branch 负责互补的信息切片，而不是互相竞争的候选答案。
- merge 必须做 synthesis，并显式指出 coverage gaps。

推荐 merge body：

```typescript
interface HubSpokeMergeBody {
  kind: 'hub-spoke';
  candidates: Array<{
    branchId: string;
    outputRef: string;
    role: 'slice';
    evidenceRefs: string[];
  }>;
  findings: Array<{
    summary: string;
    type: 'synthesis' | 'gap' | 'conflict';
    sourceBranchIds: string[];
    evidenceRefs: string[];
  }>;
  decision: {
    outcome: 'synthesized' | 'blocked';
    rationale: string;
    evidenceRefs: string[];
  };
}
```

与 parallel 的区别：

- parallel：多个 branch 给出竞争或交叉验证的候选判断。
- hub-spoke：多个 branch 给出互补切片，最终结果依赖所有切片回流后再综合。

**Q5 结论**：`hub-spoke` 的 synthesis merge **复用现有 `HubSpokeMergeBody` 投影，不新增 coverage scoring 结构**。`findings.type = 'gap'` 已足够表达 coverage gap；Phase 1 不引入量化覆盖度评分，若未来需要可在不破坏 envelope 公共字段的前提下扩展 body。

### 5.8 Merge 节点统一 envelope：统一恢复与审计字段，保留 mode body 差异

FEAT-014 采用 **统一 envelope + mode-specific body**，而不是为所有 mode 强制同一语义 body。

```typescript
interface MergeEnvelope {
  workflowId: string;
  mergeNodeId: string;
  orchestrationMode: 'parallel' | 'debate' | 'pipeline' | 'hub-spoke';
  status: 'ready' | 'completed' | 'blocked';
  sourceBranches: Array<{
    branchId: string;
    nodeId: string;
    status: 'completed' | 'failed' | 'cancelled' | 'timed-out' | 'skipped';
    outputRef?: string;
  }>;
  consumedBranches: string[];
  checkpointRef: string;
  evidenceRefs: string[];
  body: ParallelMergeBody | DebateMergeBody | PipelineMergeBody | HubSpokeMergeBody;
}
```

设计原则：

- envelope 统一的是审计、恢复、去重与下游消费所需的最低公共字段。
- body 保留各 mode 的真实语义，不为了“看起来统一”而抹平差异。
- 每一种 body 都必须能投影到四类逻辑桶：`candidates`、`findings`、`decision`、`evidenceRefs`。
- `evidenceRefs` 必须指向原始输入、完整 branch 产物或其稳定引用，不能只指向上游摘要。

### 5.9 Checkpoint 集成：fork、leaf terminal、merge 都写入持久化状态

Team Orchestrator 必须复用 FEAT-013 的 `CheckpointStore`，并在以下时机写入 workflow 级 checkpoint：

1. **fork / dispatch 后**：记录执行图展开结果、branch ledger 初始状态、rawContextRefs 与 routingDecision。
2. **任一 leaf branch terminal 后**：更新该 branch 的 ledger、leafSessionRefs、outputRef 与错误状态。
3. **merge 完成后**：落盘 `MergeEnvelope`、`consumedBranches`、最终 team status。

推荐 team checkpoint state 扩展：

```typescript
interface TeamBranchState {
  teamStatus:
    | 'planned'
    | 'running'
    | 'merge-ready'
    | 'merged'
    | 'failed'
    | 'cancelled'
    | 'timed-out';
  activeNodeId: string;
  branches: Record<string, BranchLedgerEntry>;
  merge?: {
    status: 'pending' | 'ready' | 'completed' | 'blocked';
    consumedBranches: string[];
    envelopeRef?: string;
  };
  workflowDeadline?: string; // ISO 8601，整体 workflow 超时截止时间
  fallbackExecutionMode?: 'single-agent' | null;
  teamOrchestratorPending?: boolean;
}
```

兼容要求：

- 当前 CLI fallback 写入的 `fallbackExecutionMode` / `teamOrchestratorPending` 应被视为 Phase 1 过渡状态的一部分，
  未来实现可在同一 branchState contract 上扩展，而不是另起字段体系。
- checkpoint 仍以 workflow 级 JSON 为唯一恢复主状态，不新增平行存储契约作为强制依赖。

**Q4 结论**：采用 **双层超时模型**。整体 timeout 控制用户等待体验（`workflowDeadline` 挂在 `TeamBranchState`），per-leaf timeout 防止单个 branch 异常挂起。两者同时生效，先到先触发。整体超时触发时，所有未完成 branch 标记为 `cancelled`（由 orchestrator 触发），而非 `timed-out`（保留给 per-leaf 专用）。

### 5.10 恢复与幂等：partial-merge 不得重复消费已完成分支

恢复流程必须继续遵守 FEAT-013：

1. 根据 `workflowId` 读取最新 checkpoint。
2. 优先按当前 node 对应 branch 的 `continuationRef` 恢复。
3. 若无 continuationRef，则尝试 provider response continuation。
4. 若以上都无，则从 node-level restart 恢复该 branch 或 merge。

幂等与去重规则：

- 已标记 `completed` 且 `consumedByMerge = true` 的 branch，不得重复执行。
- merge 已记录 `consumedBranches` 后，重复恢复不得再次消费这些 branch。
- 若 merge 前部分 branch 已完成，恢复只允许继续未完成 branch 或重放 merge，不得把整个 workflow 当成新任务。
- provider fallback 只影响单个 branch attempt 的 leaf continuation，不改变 merge 去重语义。

### 5.11 与当前 CLI fallback 的关系

当前 CLI 在 team mode 下的行为是：

1. Router 正常产出 team `RoutingDecision`。
2. workflow checkpoint 正常落盘。
3. 运行时 warning：FEAT-014 尚未实现。
4. fallback 到 single-agent 执行。

FEAT-014 要求未来 runtime 直接替换第 3-4 步，而不是改变第 1-2 步的路由与 checkpoint 语义。
因此，本 spec 关注的是“如何接住既有 team workflow skeleton”，而不是重新设计 ingress。

## 6. Acceptance Criteria / 验收标准

> 每条 AC 必须可测（人能明确判断通过/失败）。AC 与 R 对齐；一条 R 可能对应多条 AC。

- AC1: 给定一个已被 Router 路由为 `executionMode = team` 的 workflow，Team Orchestrator 应直接消费该
  `RoutingDecision + ScenarioWorkflow`，不得重新分类或改写 `workflowId`。（对应 R1-R2）
- AC2: 给定任一 team workflow，所有 leaf branch 的执行都必须映射到 `AgentRunner` 调用；spec 中不得出现
  直接绕过 AgentRunner 调 provider 的合法路径。（对应 R3）
- AC3: `parallel` 模式下，多个 branch 必须共享同一份原始输入引用，但探索方向在信息来源 / 搜索空间 / 假设维度上
  必须不同；不得以 PM / 开发 / 测试等岗位拆分 branch。（对应 R5-R7）
- AC4: `debate` 模式下，critic 的输出结构只能包含问题、风险、反例、未覆盖边界；如果输出含 `fix`、
  `implementationPlan`、`revisedProposal` 或等价字段，则该 branch 判定为违规。（对应 R8、R21）
- AC5: `pipeline` 模式只适用于 deterministic-toolchain；若任一步包含推理、判断、分析或开放式生成，则该
  workflow 必须被判定为不合规，不能作为合法 pipeline 样例。（对应 R9、R22）
- AC6: 任一 team workflow 的拓扑都必须是 fork 后 merge；spec 中不得存在 branch-to-branch 直接通信或串行交接的
  合法示例。（对应 R5）
- AC7: spec 中必须定义 branch 生命周期最小状态集合，并明确 provider fallback 仍留在同一 leaf session 内，
  不得被解释为新 branch 或新 team member。（对应 R10-R12）
- AC8: merge 节点输出必须包含统一 envelope 的公共字段，以及可映射到 `candidates / findings / decision /
evidenceRefs` 的 mode body；不得仅输出自由文本摘要。（对应 R13-R15）
- AC9: Team Orchestrator 必须在 fork / dispatch 后、leaf terminal 后、merge 完成后三类关键时机写入 checkpoint，
  且写入目标为 FEAT-013 的 `CheckpointStore`。（对应 R16-R17）
- AC10: 模拟 partial-merge 中断后，恢复流程必须重用已完成 branch 的 checkpoint 结果；已在 `consumedBranches`
  中出现的 branch 不得被重复 merge。（对应 R18-R19）
- AC11: `hub-spoke` 在 spec 中必须有明确 Phase 1 语义：要么正式兼容且定义“互补切片 + synthesis merge”，要么
  显式 unsupported；不得保持未定义。（对应 R4、R20）
- AC12: 本轮 FEAT-014 spec 起草的 git diff 只新增 `specs/phase-1/FEAT-014-team-orchestrator.md`，不修改
  `packages/` 与既有 specs。（对应 R23）

## 7. Test Plan / 测试计划

- **Schema tests**
  - 校验 `MergeEnvelope` 的公共字段完整性与 mode body 判别联合合法性。
  - 校验 `CriticOutput` 不允许出现 fix / revisedProposal / implementationPlan 等接棒字段。
  - 校验 `TeamBranchState` / `BranchLedgerEntry` 字段完整性与状态枚举。
- **Mode conformance tests**
  - `parallel`：验证 branch 拆分按信息维度，且 merge 读取完整 branch 输出。
  - `debate`：验证 proposer / critic 不直接往返，critic 为负向输出，最终决策在 merge 节点形成。
  - `pipeline`：验证合法样例只包含 deterministic tool step；出现 reasoning step 时 fail-fast。
  - `hub-spoke`：验证其输出关系是互补切片综合，而不是竞争候选投票。
- **Lifecycle tests**
  - 覆盖 `pending -> dispatched -> running -> completed / failed / cancelled / timed-out -> merge-consumed`
    的状态迁移。
  - 覆盖 branch retry 增加 `attempt`，以及 provider fallback 不新增 branch。
- **Checkpoint / resume tests**
  - fork 后中断：恢复时不重新分类，重用 workflow checkpoint。
  - branch 完成、merge 前中断：恢复时只继续未完成 branch 或重放 merge，不重复执行已完成 branch。
  - merge 完成后重复恢复：不得重复消费 `consumedBranches`。
  - continuationRef 缺失但 providerResponseId 存在时，仍遵循 FEAT-013 恢复优先级。
- **CLI compatibility tests**
  - 当前 fallback branchState（`fallbackExecutionMode`、`teamOrchestratorPending`）与未来 team branchState
    contract 兼容。
  - analysis 场景下 Router 已产出的 `hub-spoke-analysis` 能被 FEAT-014 明确接住，而不是继续依赖隐式 fallback。
- **Manual review checklist**
  - 检查 spec 是否明确写出 Router / Orchestrator / AgentRunner / CheckpointStore 边界。
  - 检查 spec 是否显式写出 chain 禁止项、validator 负向约束、pipeline 使用限制。
  - 检查 spec 是否把 Open Questions 留在开放状态，而不是在正文中暗中拍板。

## 8. Open Questions / 待定问题

> 所有 Open Question 必须在 status 切到 `approved` 之前关闭，否则实现阶段会返工。

- ~~Q1: Team branch 的底层 agent 实例是否应该"每次 workflow 新建"，还是可以复用预定义的 team member agent 对象？~~
  **已关闭**：默认每次 branch attempt 新建或 fork 隔离上下文；复用需显式保证状态隔离。详见 Design 5.3。
- ~~Q2: merge 的实际执行机制应由 LLM 做语义合并、由结构化规则做确定性合并，还是采用 hybrid 方案？~~
  **已关闭**：采用 Hybrid 方案。结构化规则组装 envelope 公共字段，LLM 负责 mode body 语义综合，输出需 schema 校验。详见 Design 5.8。
- ~~Q3: `pipeline` 的失败语义应是严格 fail-fast、允许 step-level partial 容错，还是按模板单独声明？~~
  **已关闭**：默认 strict fail-fast；模板 metadata 可显式声明降级策略，但 runtime 必须校验确为 deterministic tool step。详见 Design 5.6。
- ~~Q4: Team workflow 的超时策略应使用整体 workflow timeout、per-leaf timeout，还是双层超时模型？~~
  **已关闭**：采用双层超时模型（整体 `workflowDeadline` + per-leaf timeout）。详见 Design 5.9。
- ~~Q5: `hub-spoke` 的 synthesis merge 是否需要单独的 coverage scoring 结构，还是复用与 parallel 相同的 envelope body 投影即可？~~
  **已关闭**：复用现有 `HubSpokeMergeBody`，不新增 coverage scoring。详见 Design 5.7。
- ~~Q6: 在 Phase 1 以内建模板为主的前提下，`pipeline` 合法性、merge strategy 元数据与未来 Team YAML 审核之间的
  enforcement 边界应落在哪一层？~~
  **已关闭**：两者兼顾——template metadata 静态声明 + runtime guard 兜底校验。详见 Design 5.6。

## 9. Changelog / 变更记录

- 2026-04-22: whiteParachute — 初稿
  - 新增 FEAT-014 Team Orchestrator spec，定义 Router 之后的 team runtime 边界。
  - 定义 parallel / debate / pipeline 三种主模式，以及 hub-spoke 的 Phase 1 兼容语义。
  - 新增统一 merge envelope、branch ledger、checkpoint / resume 合约与开放问题列表。
- 2026-04-22: whiteParachute — 审阅关闭 Open Questions
  - Q1: 确认默认新建 agent 实例，复用需显式状态隔离（参考 Claude Code fresh spawn、Codex one-shot、Hermes clone+isolate）。
  - Q2: 确认 merge 采用 Hybrid（结构化规则 + LLM 语义综合）。
  - Q3: 确认 pipeline 默认 fail-fast，模板可声明降级策略。
  - Q4: 确认双层超时模型（整体 + per-leaf）。
  - Q5: 确认 hub-spoke 复用现有 envelope body，不新增 coverage scoring。
  - Q6: 确认 template metadata + runtime guard 两层 enforcement。
  - status: draft → approved。
- 2026-04-22: implementation synced
  - 新增 `packages/core/src/team-orchestrator.ts`，实现 branch ledger、四种 merge body、checkpoint/resume 与 TeamOrchestrator 主入口。
  - 新增 `packages/core/test/team-orchestrator.test.ts`，覆盖 schema、mode conformance、lifecycle、checkpoint/resume。
  - 同步 `docs/modules/team-orchestrator.md`，状态更新为 done。
