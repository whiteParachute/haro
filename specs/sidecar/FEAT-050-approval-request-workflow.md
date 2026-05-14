---
id: FEAT-050
title: Approval Request Workflow
status: implemented
phase: sidecar
owner: whiteParachute
created: 2026-05-14
updated: 2026-05-14
related:
  - FEAT-045-scheduled-sidecar-cli.md
  - FEAT-047-gated-apply-l0-l1.md
  - FEAT-049-patch-branch-l2-l3.md
  - ../../docs/planning/agentdock-kernel-sidecar-architecture.md
---

# Approval Request Workflow

## 1. Context / 背景

启动阶段不允许 Haro 把自动 proposal 直接推进 apply 或真实 patch branch。用户只应给出方向，例如“去 X 平台收集外部信息”；Haro/AgentDock 应自动完成情报整理、提案、验证，并把每个 proposal 转成可审批的清晰请求。

审批请求必须明确说明：

- 为什么改。
- 怎么改。
- 改了有什么收益。
- 风险、测试和回滚计划。
- 用户可以选择 approve / reject / request-changes。

## 2. Goals / 目标

- G1: 新增 `ApprovalRequestRecord` 与 `ApprovalDecisionRecord` contract。
- G2: 新增 `haro approval-request --pending`，把已有 validation 的 proposal 转成审批请求 artifact。
- G3: 审批请求写入 `~/.haro/evolution/approval-requests/`，供 AgentDock 飞书/Web 渲染。
- G4: 命令只生成审批请求，不 apply、不创建 branch、不写 memory。

## 3. Non-Goals / 不做的事

- 不在 Haro CLI 中承载最终用户审批 UI；人审 UI 由 Haro Web proposal review 或 AgentDock/飞书承接。
- `haro approval-request --pending` 不签发 `humanApprovalRef`，只生成待审请求；approve decision 可由 Haro Web/AgentDock 写入并被 apply gate 消费。
- 不直接联网抓取 X / YouTube / paper；外部采集编排由 AgentDock agent/skills 承接，Haro 接收结构化 evidence。

## 4. Requirements / 需求项

- R1: `ApprovalRequestRecord` 必须包含 proposalRef、validationRef、whyChange、howChange、expectedBenefits、requiredTests、manualChecks、regressionRisks、rollbackPlan。
- R2: 每个 approval request 必须包含 `decisionOptions=['approve','reject','request-changes']`。
- R3: `haro approval-request --pending` 只处理已有 validation report、尚未生成 approval request、且尚无 `humanApprovalRefs` 的 proposal。
- R4: 重复运行不得重复生成同一 proposal 的 approval request。
- R5: `haro status` / `haro doctor --component sidecar` 必须统计 approval request / approval decision artifacts 和 corrupt JSON。
- R6: `approve` decision 必须转换为 `human-approval` evidence，供 `haro apply` 的 human-review gate 消费。
- R7: `reject` decision 必须阻止 apply，并把 proposal 标记为 `rejected`。
- R8: `request-changes` decision 必须携带 direction、阻止当前 proposal apply，并把 proposal 标记为 `superseded`，由后续 proposal 重新按方向生成。

## 5. Current Implementation / 当前实现

- `ApprovalRequestRecordSchema` 与 `ApprovalDecisionRecordSchema` 已加入 `@haro/agentdock-contract`。
- `haro approval-request --pending --json` 已实现，输出 approval request ids、paths 和完整 request payload。
- approval request 中包含 deterministic why/how/benefit 文案、测试、人工检查、风险和 rollback plan。
- Haro Web proposal review 会写入 `approval-decisions/*.json`；CLI apply 会同步消费 approve / reject / request-changes decision。
- approve 会补齐 proposal `humanApprovalRefs`；reject 会阻止 apply；request-changes 会返回明确 reviewer direction 并要求生成修订 proposal。
- `haro status` / `doctor` 已纳入 `approvalRequests` 和 `approvalDecisions` 计数。
- 命令走 sidecar-only path，不创建 `$HARO_HOME/memory`。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定 validated proposal，当运行 `haro approval-request --pending --json` 时，应写 schema-valid approval request，且包含 why/how/benefit。（对应 R1）
- AC2: 重复运行同一 pending set，不应重复生成 approval request。（对应 R4）
- AC3: 给定缺少 validation 或已有 approval request 的 proposal，不应生成新的 approval request。（对应 R3）
- AC4: status/doctor 能统计 approval request / approval decision artifacts 和 corrupt count。（对应 R5）
- AC5: approve decision 后，`haro apply --proposal-id` 不再卡在 `HUMAN_REVIEW_REQUIRED`，而进入后续 content/snapshot/apply gate。（对应 R6）
- AC6: reject decision 后，`haro apply --proposal-id` 返回 `APPROVAL_REJECTED`。（对应 R7）
- AC7: request-changes decision 后，`haro apply --proposal-id` 返回 `CHANGES_REQUESTED` 并包含 reviewer direction。（对应 R8）

## 7. Next Step / 下一步

下一步是让 AgentDock 侧 skill/IM 把 `approval-requests` artifact 自动渲染成飞书审批消息，并把用户的 approve/reject/request-changes 回复写成同一份 `ApprovalDecisionRecord` contract；Haro 不直接接管 IM，只消费结构化 decision/evidence。

## 8. Changelog / 变更记录

- 2026-05-14: Haro — 新增 approval request contract 与 CLI，打通 validated proposal → human-review artifact 第一段。
- 2026-05-14: Haro — 新增 approval decision contract 与 apply gate 消费，打通 approve/reject/request-changes 对后续 apply 的影响。
