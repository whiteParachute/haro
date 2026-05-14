---
id: FEAT-049
title: Patch Branch L2/L3
status: implemented
phase: sidecar
owner: whiteParachute
created: 2026-05-14
updated: 2026-05-14
related:
  - FEAT-043-agentdock-contract-skeleton.md
  - FEAT-047-gated-apply-l0-l1.md
  - ../../docs/planning/agentdock-kernel-sidecar-architecture.md
---

# Patch Branch L2/L3

## 1. Context / 背景

Phase F 已允许 L0/L1 在 proposal、validation、snapshot、rollback gate 后写入 Haro sidecar-owned `assets/current`。但 L2/L3 涉及 Haro sidecar 代码、AgentDock kernel 或跨项目 contract，不能通过 MCP apply 直接落地。

Phase G 的第一段目标不是自动改代码，而是把 L2/L3 proposal 转成可审查的 patch branch plan：明确推荐分支名、验证命令、人工 review 要求、rollback plan 和证据 refs。

## 2. Goals / 目标

- G1: 增加 `PatchBranchPlanRecord` contract，持久化 L2/L3 patch branch 计划。
- G2: 增加 `haro patch-branch --proposal-id <id>`，只为已验证 L2/L3 proposal 生成 plan artifact。
- G3: L0/L1 proposal 调用 patch-branch 必须拒绝，引导继续走 gated apply。
- G4: patch branch plan 不创建真实 git branch、不修改代码、不写 AgentDock 内部资产、不读写 memory。

## 3. Non-Goals / 不做的事

- 不自动创建 git branch。
- 不自动生成 patch diff。
- 不自动修改 Haro 或 AgentDock 代码。
- 不绕过 L2/L3 人工 review / merge 决策。

## 4. Requirements / 需求项

- R1: `haro patch-branch` 输入只能是 `{ proposalId }` 加可选 `baseBranch` label。
- R2: proposal 必须存在，且 `level` 必须为 `L2` 或 `L3`。
- R3: proposal 必须已有 validation report；validation 可以是 `blocked`，因为 L2/L3 blocked 通常表示 direct apply forbidden，而不是禁止生成 patch branch。
- R4: 生成的 `PatchBranchPlanRecord` 必须包含 proposalRef、validationRef、changeRefs、requiredTests、manualChecks、regressionRisks、rollbackPlan、humanReviewRequired=true。
- R5: plan id 必须确定性生成；重复执行同一 proposal/baseBranch 不产生重复 artifacts。
- R6: plan 写入 `~/.haro/evolution/patch-branches/`，status/doctor 应统计 corrupt plan artifacts。
- R7: 该命令必须作为 sidecar-only 命令，不创建 `$HARO_HOME/memory`。

## 5. Design / 设计要点

第一段执行链：

```text
haro patch-branch --proposal-id <id>
  -> load proposal
  -> require level=L2/L3
  -> load latest validation report
  -> derive deterministic branchName: haro/evolution/<proposal-id>
  -> write PatchBranchPlanRecord
  -> report plan path and evidence refs
```

拒绝条件：

| 条件 | 错误码 |
| --- | --- |
| proposal 不存在 | `PROPOSAL_NOT_FOUND` |
| proposal 为 L0/L1 | `PATCH_BRANCH_NOT_REQUIRED` |
| validation 缺失 | `VALIDATION_REQUIRED` |

当前实现切片：

- `PatchBranchPlanRecordSchema` 已加入 `@haro/agentdock-contract`，并强制只允许 L2/L3。
- `haro patch-branch --proposal-id <id> --json` 已写入 `~/.haro/evolution/patch-branches/<plan-id>.json`。
- `--base-branch <name>` 只作为 plan label 写入 artifact，不 checkout、不创建真实 branch。
- `haro status` / `haro doctor --component sidecar` 已纳入 patch-branches 计数与 corrupt artifact 检查。
- 命令作为 sidecar-only 路径运行，不创建 `$HARO_HOME/memory`。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定已验证 L2 proposal，当运行 `haro patch-branch --proposal-id <id> --json` 时，应写 schema-valid `PatchBranchPlanRecord`，且不写 application record、不创建 memory。（对应 R2/R3/R4/R7）
- AC2: 重复执行同一 proposal/baseBranch，应返回同一 plan id，`patch-branches` 目录只有一个 artifact。（对应 R5）
- AC3: 给定 L0/L1 proposal，当运行 `haro patch-branch --proposal-id <id>` 时，应返回 `PATCH_BRANCH_NOT_REQUIRED`，不写 plan artifact。（对应 R2）
- AC4: `haro status --json` 应包含 `patchBranches` 计数；`doctor --component sidecar` 应把 corrupt patch plan 纳入 corrupt artifacts。（对应 R6）

## 7. Test Plan / 测试计划

- contract schema：接受 L2/L3 patch branch plan，拒绝 L0/L1 plan。
- CLI：L2 proposal + validation 生成 deterministic plan，不创建 memory、不写 application。
- CLI：L0 proposal 返回 `PATCH_BRANCH_NOT_REQUIRED`，不写 plan。
- CLI status/doctor：patchBranches 计数和 corrupt artifact 计入 sidecar health。

## 8. Open Questions / 待定问题

- Q1: 下一段是否由 Haro CLI 创建真实 git worktree/branch，还是交给 AgentDock/Codex 执行器？
- Q2: L3 AgentDock kernel patch plan 是否需要额外记录目标 repo / remote / ownership metadata？
- Q3: patch plan 是否需要绑定审批 token 后才能转成真实 branch？

## 9. Changelog / 变更记录

- 2026-05-14: Haro — 完成 Phase G 第一段 patch branch plan：新增 contract、CLI plan artifact、status/doctor 计数；不创建真实 branch、不改代码、不写 memory。
