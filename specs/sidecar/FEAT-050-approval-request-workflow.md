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

- G1: 新增 `ApprovalRequestRecord` contract。
- G2: 新增 `haro approval-request --pending`，把已有 validation 的 proposal 转成审批请求 artifact。
- G3: 审批请求写入 `~/.haro/evolution/approval-requests/`，供 AgentDock 飞书/Web 渲染。
- G4: 命令只生成审批请求，不 apply、不创建 branch、不写 memory。

## 3. Non-Goals / 不做的事

- 不在 Haro CLI 中承载最终用户审批 UI。
- 不签发 `humanApprovalRef`。
- 不直接联网抓取 X / YouTube / paper；外部采集编排由 AgentDock agent/skills 承接，Haro 接收结构化 evidence。

## 4. Requirements / 需求项

- R1: `ApprovalRequestRecord` 必须包含 proposalRef、validationRef、whyChange、howChange、expectedBenefits、requiredTests、manualChecks、regressionRisks、rollbackPlan。
- R2: 每个 approval request 必须包含 `decisionOptions=['approve','reject','request-changes']`。
- R3: `haro approval-request --pending` 只处理已有 validation report、尚未生成 approval request、且尚无 `humanApprovalRefs` 的 proposal。
- R4: 重复运行不得重复生成同一 proposal 的 approval request。
- R5: `haro status` / `haro doctor --component sidecar` 必须统计 approval request artifacts 和 corrupt JSON。

## 5. Current Implementation / 当前实现

- `ApprovalRequestRecordSchema` 已加入 `@haro/agentdock-contract`。
- `haro approval-request --pending --json` 已实现，输出 approval request ids、paths 和完整 request payload。
- approval request 中包含 deterministic why/how/benefit 文案、测试、人工检查、风险和 rollback plan。
- `haro status` / `doctor` 已纳入 `approvalRequests` 计数。
- 命令走 sidecar-only path，不创建 `$HARO_HOME/memory`。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定 validated proposal，当运行 `haro approval-request --pending --json` 时，应写 schema-valid approval request，且包含 why/how/benefit。（对应 R1）
- AC2: 重复运行同一 pending set，不应重复生成 approval request。（对应 R4）
- AC3: 给定缺少 validation 或已有 approval request 的 proposal，不应生成新的 approval request。（对应 R3）
- AC4: status/doctor 能统计 approval request artifacts 和 corrupt count。（对应 R5）

## 7. Next Step / 下一步

AgentDock 需要把 `approval-requests` artifact 渲染为飞书/Web 审批消息。用户选择 approve/reject/request-changes 后，AgentDock 负责写入 decision/approval evidence；Haro 只接收结构化 `humanApprovalRef` 或修改方向，不直接接管 IM。

## 8. Changelog / 变更记录

- 2026-05-14: Haro — 新增 approval request contract 与 CLI，打通 validated proposal → human-review artifact 第一段。
