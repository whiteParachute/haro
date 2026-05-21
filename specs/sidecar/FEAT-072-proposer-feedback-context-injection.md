# FEAT-072 Proposer feedbackContext 注入

## 状态

- 状态：已实现
- 日期：2026-05-21
- 范围：Haro sidecar propose / validate / approval-request 描述
- 前置：FEAT-069 proposer feedback-aware dedupe

## 背景

FEAT-069 已经能挡住同 target 且内容等价的重复提案。它解决的是“同一个东西不要再推给审批人”。

但它没有解决另一个问题：如果下一轮内容确实变化了，Haro 仍可能没有明确承认上一次审批意见。审批人看不到“这次有没有回应我的修改方向”。

本 FEAT 做短期可控补强：不引入 LLM proposer，不重写提案正文，只把最近一次退回意见作为结构化上下文写进 proposal，并在 validate 阶段强制检查。

## 目标

1. proposal artifact 可显式记录最近一次 `request-changes` / `reject` 的审批意见。
2. propose 写盘前自动追加人工检查项，提醒审批人核对是否回应了上次意见。
3. validate 发现同 target 有退回意见但 proposal 未引用时，阻断 apply eligibility。
4. approval-request 描述首段展示上一次审批意见，避免审批人反复追问上下文。

## 非目标

- 不实现 LLM proposer。
- 不让 Haro 自动改写 whyChange / howChange 的业务文案。
- 不修改 approval-decisions / approval-conversations 的读写模型。
- 不改 Web UI、apply、rollback、AgentDock 或 aria-memory。
- 不处理现有真实 proposal / approval-request。

## Contract 变更

`EvolutionProposalSchema` 新增可选字段：

```ts
feedbackContext?: {
  priorDecisionId: string;
  priorProposalId: string;
  priorDirection: string;
  conversationSummary?: string;
  conversationRefs?: string[];
  incorporatedAt: string;
  incorporationNote?: string;
}
```

规则：

- 只有同 target 最近一次审批结论是 `request-changes` 或 `reject` 时才写入。
- `feedbackContext` 不参与 `changeSet[*].contentHash` 计算。
- `feedbackContext` 不改变 FEAT-069 的 semantic fingerprint 规则。
- 没有退回历史时，proposal 结构保持兼容。

## Propose 行为

流程顺序：

1. 生成 candidate。
2. 执行 mcp-audit-policy 评估。
3. 执行 active target dedupe。
4. 执行 FEAT-069 等价反馈挡板。
5. 若未被挡板阻断，再注入 `feedbackContext`。
6. 写 proposal artifact 和 proposal-content。

注入规则：

- 复用 `readLatestApprovalDecisionForProposalTarget`。
- 只读取同 target 最近一次 decision。
- 若 decision 是 `request-changes` / `reject`，写入 `feedbackContext`。
- 追加人工检查：确认本次是否回应上次审批意见；未回应时要求继续 `request-changes`。
- `propose --auto-dry-run --json` 新增 `proposalsWithFeedbackContext`。

如果 FEAT-069 命中，仍只写 `blocked-proposal-events`。不会写 proposal，也不会注入 feedbackContext。

## Validate 行为

validate 新增 blocker：`MISSING_FEEDBACK_CONTEXT`。

触发条件：

- 同 target 最近一次 decision 是 `request-changes` / `reject`；并且
- 当前 proposal 没有 `feedbackContext`；或
- `feedbackContext.priorDecisionId` 不是最新 decision id。

处理语义：

- 仍写 validation artifact。
- `blockingReasons` 增加 `MISSING_FEEDBACK_CONTEXT`。
- `applyEligible=false`。
- 不改 riskVerdict 计算逻辑，只通过既有 blockingReasons 路径影响结果。

选择这个语义的原因：保留审计链路，方便 supervisor 看到 proposal 为什么不能进入应用。直接拒写 validation 会让问题更难定位。

## Approval-request 展示

如果 proposal 有 `feedbackContext`，`whyChange` 段首展示：

- 上一次审批意见。
- 上一次意见内容，按短句拆分。
- 决策 ID。

所有新增中文文案继续受 FEAT-068 lint 约束。长 direction 会分段展示，完整原文仍保留在 `feedbackContext.priorDirection`。

## 验收标准

- 同 target 上一条为 `request-changes`，新 proposal 内容不同：写入 `feedbackContext`，并追加人工检查项。
- 同 target 上一条为 `request-changes`，新 proposal 缺 `feedbackContext`：validate 写出 blocked validation，`applyEligible=false`。
- `feedbackContext.priorDecisionId` 不是最新 decision：validate 同样 blocked。
- 上一条为 `approve`：不注入 feedbackContext，validate 行为不变。
- 没有任何 decision：不注入 feedbackContext，行为不变。
- FEAT-069 命中时：仍 blocked，不写 proposal。
- daily workflow summary 能看到 `proposalsWithFeedbackContext`。

## 回滚方式

- 回滚代码后，旧 proposal artifact 中的可选 `feedbackContext` 字段会被忽略或保留为未知扩展，不影响旧字段。
- 若需要撤回某条 proposal，仍走既有 reject / request-changes / cleanup 流程。
- 本 FEAT 不写生产数据，不需要数据迁移。

## 后续工作

FEAT-072 只做到“显式引用上次意见”。它不会真正理解并重写提案。

后续 FEAT-073 可独立实现 LLM proposer：把 `feedbackContext`、approval-conversation 摘要和当前观察输入给模型，让模型生成新的 whyChange / howChange / proposal-content 草案，再由现有 policy / lint / validate 继续把关。
