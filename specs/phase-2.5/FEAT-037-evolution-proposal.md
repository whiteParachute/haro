---
id: FEAT-037
title: Evolution Proposal Generator + Dashboard 审批队列
status: draft
phase: phase-2.5
owner: whiteParachute
created: 2026-05-01
updated: 2026-05-01
related:
  - ../phase-1/FEAT-018-web-dashboard-orchestration-observability.md
  - ../phase-1/FEAT-022-evolution-asset-registry.md
  - ../phase-1/FEAT-023-permission-token-budget-guard.md
  - ../phase-1/FEAT-028-web-dashboard-product-maturity.md
  - ../phase-2.0/FEAT-036-industry-intel.md
  - ../phase-2.0/FEAT-040-self-monitor.md
  - ../phase-2.0/FEAT-041-auto-eat-shit-trigger.md
  - ../phase-2.5/FEAT-042-pattern-miner.md
  - ../evolution-engine-protocol.md
  - ../evolution-metabolism.md
  - ../../docs/architecture/overview.md
  - ../../docs/planning/archive/redesign-2026-05-01.md
---

# Evolution Proposal Generator + Dashboard 审批队列

## 1. Context / 背景

Haro 进化层四个驱动源中，"用户决策"是 Phase 2.5 的核心：平台产出**结构化进化提案**，owner 在 Dashboard 上 approve / reject / modify，决策本身又被 Self-Monitor 记录、反馈给 Pattern Miner 调整下一轮。这是 Haro 与"自动改代码"派系的关键差异——**任何 platform-state 改动都要过人审**。

本 spec 把 Phase 2.0 的 Auto Trigger 产物与 Phase 2.5 的 Pattern Miner 产物**统一收口为 Evolution Proposal**，提供：

1. 标准化提案数据模型
2. Dashboard 审批队列 UI
3. 决策反馈到下游执行（FEAT-011 eat / shit 实际写入；Phase 3.0 Auto-Refactorer 实际改动）
4. 决策日志反哺 Self-Monitor / Pattern Miner

## 2. Goals / 目标

- G1: 定义 `EvolutionProposal` 数据模型与生命周期：`pending → approved → executed | rejected | superseded | expired`。
- G2: 接收来自 FEAT-041 Auto Trigger 与 FEAT-042 Pattern Miner 的提案；预留 Phase 3.0 Auto-Refactorer 接入位。
- G3: Dashboard 新建 `/proposals` 页：列表 / 详情 / 决策按钮 / 历史决策回放。
- G4: 决策动作（approve / reject / modify）必须写 `proposal_decision_log`，并把决策反馈写回 Pattern Miner（FEAT-042 R8）。
- G5: approve 后必须执行对应动作链：eat / shit 实际写入、skill 配置切换、prompt 替换；执行失败必须自动 rollback。
- G6: 与 FEAT-023 Permission Guard 接合：approve 是 `write-platform`，必须二次确认；reject 是 `read-only` 决策。
- G7: CLI 命令族同步落地：`haro proposal list` / `proposal show <id>` / `proposal approve <id>` / `proposal reject <id>` / `proposal modify <id>`。

## 3. Non-Goals / 不做的事

- 不让 proposal 直接执行 L2 / L3 改动（写代码、改架构）；那属于 Phase 3.5 Agent-as-Developer。
- 不引入 voting / multi-approver 机制；自用单机 owner 单签即可。
- 不引入 proposal 之间的依赖图；并行 / 顺序由 owner 自己判断。
- 不允许 proposal 自动续期或 escalate；过期就 expired。
- 不向外推送通知（邮件 / Slack）；仅 Dashboard 内提醒。
- 不做 proposal 跨实例同步。

## 4. Requirements / 需求项

- R1: 新建 `packages/core/src/evolution-proposal/`，含 `model.ts` / `repository.ts` / `executor.ts` / `decision-log.ts`。
- R2: `EvolutionProposal` 至少含字段：`id, kind, source, title, summary, evidence, suggestedChanges, impactScope, risks, rollbackPlan, decision, decidedBy?, decidedAt?, executedAt?, expireAt, status, createdAt, updatedAt`。
- R3: `kind` 至少枚举：`metabolism-eat` / `metabolism-shit` / `pattern-driven` / `auto-refactor-l0` / `auto-refactor-l1`（后两类是 Phase 3.0 占位，本 spec 不实现 executor）。
- R4: 提案默认 `expireAt = createdAt + 30 days`；过期未决议自动标 `expired`。
- R5: Dashboard `/proposals` 页：列表（按 status / kind / 创建时间过滤）+ 详情（完整 evidence + suggestedChanges + risks）+ 决策按钮（approve / reject / modify）+ 历史回放。
- R6: 决策动作走 web-api `POST /api/v1/proposals/:id/decision`，body `{ decision: 'approve'|'reject'|'modify', modifiedChanges?, reason }`；返回更新后的 proposal。
- R7: approve 触发 `executor.run(proposal)`：按 kind 调用对应执行器（eat 真正写 Memory Fabric / shit 真正归档 / pattern-driven 写 routing-rule update）。
- R8: 执行失败必须 rollback：恢复执行前快照，proposal 状态标 `execution-failed`，错误细节写 decision log，触发 Self-Monitor 告警事件。
- R9: 决策日志 `proposal_decision_log` 记录：proposal_id, decision, decided_by, decided_at, reason, before_snapshot_ref, after_snapshot_ref, execution_status。
- R10: 决策反馈 Pattern Miner：**仅当** `proposal.source.kind === 'pattern-miner'` 时调用 `patternMiner.recordFeedback(source.detectorId, decision)`（FEAT-042 R8 接口）；其他来源（auto-trigger / auto-refactorer / manual）的决策不调用该接口，避免污染 detector 反馈表。所有决策（无论来源）一律写 `proposal_decision_log`（R9）作为通用审计。
- R11: CLI `haro proposal *` 命令族行为与 web-api 等价（FEAT-039 R13 共享 service layer 约束）。
- R12: 只有 `role >= admin`（FEAT-028 RBAC）可决策；viewer 只读。

## 5. Design / 设计要点

### 5.1 数据模型

```ts
type ProposalSource =
  | { kind: 'auto-trigger'; sourceId: string; policyId: string }
  | { kind: 'pattern-miner'; sourceId: string; detectorId: string; patternId: string }
  | { kind: 'auto-refactorer'; sourceId: string; refactorerId: string; level: 'L0' | 'L1' }
  | { kind: 'manual'; sourceId: string; createdBy: string };

interface EvolutionProposal {
  id: string;
  kind: 'metabolism-eat' | 'metabolism-shit' | 'pattern-driven' | 'auto-refactor-l0' | 'auto-refactor-l1';
  source: ProposalSource;
  title: string;
  summary: string;
  evidence: ProposalEvidence;
  suggestedChanges: ChangeSpec[];        // 结构化变更描述
  impactScope: { modules: string[]; agents: string[]; channels: string[] };
  risks: { level: 'low' | 'medium' | 'high'; description: string }[];
  rollbackPlan: { kind: 'snapshot' | 'inverse-action' | 'manual'; details: string };
  decision: 'pending' | 'approve' | 'reject' | 'modify';
  decidedBy?: string;
  decidedAt?: number;
  executedAt?: number;
  expireAt: number;
  status: 'pending' | 'approved' | 'executed' | 'execution-failed' | 'rejected' | 'expired' | 'superseded';
  createdAt: number;
  updatedAt: number;
}
```

### 5.2 执行器

```ts
interface ProposalExecutor {
  kinds: ProposalKind[];
  execute(p: EvolutionProposal): Promise<{ snapshotRef: string; afterRef: string }>;
  rollback(p: EvolutionProposal, snapshotRef: string): Promise<void>;
}
```

执行器注册：

```
metabolism-eat       → EatExecutor (FEAT-011 复用)
metabolism-shit      → ShitExecutor (FEAT-011 复用)
pattern-driven       → 视 suggestedChanges 子类型分派 (skill toggle / routing rule update / etc.)
auto-refactor-l0/l1  → 暂未实现（Phase 3.0）
```

### 5.3 Dashboard `/proposals` 页结构

- 顶部 filter bar：status / kind / source / 时间范围
- 列表：Title + Confidence + Source + Risk Level + Status badge + 决策按钮
- 详情侧栏 / 抽屉：
  - Summary
  - Evidence 链（树状展开）
  - Suggested Changes（diff 视图）
  - Impact Scope
  - Risks（颜色标记）
  - Rollback Plan
  - 决策按钮组（approve / reject / modify with diff editor）
  - 历史决策回放（如已决策）

### 5.4 决策反馈环

```
owner 在 Dashboard 决策
   ↓
POST /api/v1/proposals/:id/decision
   ↓
proposal_decision_log INSERT     // 通用审计（所有来源）
   ↓
if proposal.source.kind === 'pattern-miner':
    patternMiner.recordFeedback(proposal.source.detectorId, decision)   // FEAT-042
   ↓
selfMonitor.recordEvent({ kind: 'evolution_decision', payload: ... })
   ↓
（如果 approve）executor.run(proposal)
   ↓
（如果失败）executor.rollback + status='execution-failed'
```

**为什么按 source 门控**：feedback 的语义是"这个 detector 找出的模式有没有用"，仅对 `pattern-miner` 来源有意义。auto-trigger / auto-refactorer / manual 来源没有 detector，调用 `recordFeedback(undefined, ...)` 会污染 FEAT-042 反馈表、误导下一轮 confidence 调整。决策审计本身仍由 `proposal_decision_log` 兜底。

### 5.5 modify 路径

owner 选择 modify 时，Dashboard 提供 diff editor 编辑 `suggestedChanges`。提交时：
- 新建 child proposal `kind` 不变，`source.kind: 'manual'`，`source.sourceId: <parent-id>`
- 父 proposal 标 `superseded`
- 子 proposal `decision: approve`（用户已确认）+ 立即进入 executor

## 6. Acceptance Criteria / 验收标准

- AC1: FEAT-041 Auto Trigger 命中政策后，proposal 自动出现在 `/proposals` 页 `pending` 列表（对应 R6、R7）。
- AC2: FEAT-042 高置信度 pattern 自动转 proposal，evidence 含 detector 标识与跨源数据（对应 R3、R10）。
- AC3: owner approve 一个 metabolism-eat proposal，对应条目实际写入 Memory Fabric，FEAT-022 Asset Registry 记录新 asset（对应 R7）。
- AC4: executor 故意失败（mock）后 proposal 状态变 `execution-failed`，原数据未被破坏（对应 R8）。
- AC5: 30 天未决议的 pending proposal 自动标 `expired`，不再显示在主列表（对应 R4）。
- AC6: viewer 角色用户访问决策按钮被拒，admin 可决策（对应 R12）。
- AC7: `haro proposal list / show / approve / reject / modify` 与 web-api 等价（对应 R11）。
- AC8: approve / reject 一个 `source.kind === 'pattern-miner'` 的 proposal 后，patternMiner.feedback 表对应 detectorId 计数 +1；approve / reject 一个 `source.kind === 'auto-trigger'` 或 `manual` 的 proposal 后，patternMiner.feedback 表无新记录（对应 R10）。
- AC9: `proposal_decision_log` 完整记录每次决策与执行结果（对应 R9）。
- AC10: modify 路径产生 child proposal 并自动 approve，parent 标 superseded（对应 §5.5）。

## 7. Test Plan / 测试计划

- 单元测试：proposal 状态机迁移；executor / rollback；decision log 写入；Pattern Miner feedback 调用桩。
- 集成测试：FEAT-041 → proposal → approve → executor → Memory Fabric 实际写入；端到端 happy path + rollback path 各一条。
- 安全测试：跨用户决策（admin1 创建 / admin2 修改）；过期 proposal 决策被拒；execution-failed 后再次 approve 行为。
- E2E：Playwright 跑 Dashboard `/proposals` 完整流程（list → detail → approve → 状态更新 → 历史回放）。
- 性能：100 个 pending proposal 列表渲染 P95 < 300ms。
- 回归：FEAT-011 / 022 / 028 / 040 / 041 / 042 既有用例。

## 8. Open Questions / 待定问题

- Q1: Diff editor 是否需要 syntax-aware（YAML / JSON / Markdown）？倾向首版用 plain Monaco editor + JSON / YAML schema 校验。
- Q2: 历史决策回放是否要支持"undo"（撤销 approve）？倾向不做，rollback 是执行失败的自动行为，已 executed 提案需要 owner 创建反向 proposal。
- Q3: Risk level 怎么自动评？倾向首版由产生方（Auto Trigger / Pattern Miner）按规则填，owner 可手动调整；自动 risk model 留给 Phase 3.0+。
- Q4: 是否需要 proposal 评论 / 讨论区？倾向不做，自用单人不需要。
- Q5: 决策反馈到 patternMiner 是同步还是异步？倾向异步（fire-and-forget），避免决策接口因 patternMiner 服务下线被阻塞。

## 9. Changelog / 变更记录

- 2026-05-01: whiteParachute — 初稿（Phase 2.5 进化提案层批次 3）
