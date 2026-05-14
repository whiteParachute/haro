---
id: FEAT-047
title: Gated Apply L0/L1
status: draft
phase: sidecar
owner: whiteParachute
created: 2026-05-08
updated: 2026-05-14
related:
  - FEAT-043-agentdock-contract-skeleton.md
  - FEAT-044-read-only-mcp-sidecar.md
  - FEAT-046-sidecar-asset-registry-adapter.md
  - ../../docs/planning/agentdock-kernel-sidecar-architecture.md
---

# Gated Apply L0/L1

## 1. Context / 背景

Haro sidecar 第一阶段只读。后续要开放低风险自进化时，必须把 apply 限定在 L0/L1，并强制 proposal、validation、snapshot、rollback gate。

代码级 L2/L3 变更不得通过 MCP tool 直接落地，只能生成 patch branch 和验证报告。

## 2. Goals / 目标

- G1: 实现 `haro_apply`，只接受已验证 proposal id。
- G2: 实现 `haro_rollback`，只回滚有 rollback ref 的 L0/L1 application。
- G3: 对 L0/L1 写入目标做硬限制。
- G4: 所有 apply/rollback 事件写入 Evolution Store 和 Asset Registry。

## 3. Non-Goals / 不做的事

- 不支持自由文本 apply。
- 不支持 L2/L3 直接 apply。
- 不自动修改 AgentDock kernel 代码。
- 不绕过 AgentDock 既有配置/skill/profile 写入口。

## 4. Requirements / 需求项

- R1: `haro_apply` 输入只能是 `{ proposalId }`，不得接受自由文本 patch。
- R2: proposal status 必须为 `validated`，且 validation report 中 `applyEligible=true`。
- R3: validation report 必须包含 test plan、risk verdict、rollback readiness。
- R4: L0 可写范围：prompt 文案、skill 描述、配置默认值。
- R5: L1 可写范围：skill 文件、runner profile、schedule/routing config。
- R6: apply 前必须创建 snapshot，并写入 rollback ref。
- R7: apply 后必须写 application event、asset event、audit log。
- R8: `haro_rollback` 必须基于 rollback ref 恢复 apply 前状态，并写 rollback event。
- R9: L2/L3 proposal 调用 `haro_apply` 必须拒绝，并提示生成 patch branch。
- R10: Phase F 第一段 CLI gate preflight 不执行内容变更；gate 通过只写 `ApplicationRecord(status=ready, applied=false)`，供后续 executor 消费。

## 5. Design / 设计要点

Gate 顺序：

```text
haro_apply({ proposalId })
  -> load proposal
  -> load validation report
  -> check level in L0/L1
  -> check applyEligible
  -> check rollbackReady
  -> create snapshot
  -> apply change set
  -> write application event
  -> write asset event
```

拒绝条件：

| 条件 | 错误码 |
| --- | --- |
| proposal 不存在 | `PROPOSAL_NOT_FOUND` |
| 未验证 | `VALIDATION_REQUIRED` |
| validation 不允许 apply | `APPLY_NOT_ELIGIBLE` |
| 目标等级为 L2/L3 | `DIRECT_APPLY_FORBIDDEN` |
| snapshot 失败 | `SNAPSHOT_FAILED` |
| rollback ref 缺失 | `ROLLBACK_REF_REQUIRED` |

当前实现切片：

- `ApplicationRecordSchema` 已加入 `@haro/agentdock-contract`。
- `haro apply --proposal-id <id> --json` 已实现 gate preflight。
- Gate 已覆盖 proposal existence、L2/L3 direct apply forbidden、L0/L1 target allowlist、`proposal.status=validated`、validation report、`applyEligible=true`、`rollbackReady=true`、snapshot ref、rollback ref。
- Gate 通过后写 `~/.haro/evolution/applications/<application-id>.json` ready record，`applied=false`。
- 当前不创建真实 snapshot、不执行 changeSet、不写 `applied` asset event、不读写 memory。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定未验证 proposal，当调用 `haro_apply` / `haro apply --proposal-id` 时，应返回 `VALIDATION_REQUIRED`，且不产生 application 写入。（对应 R2）
- AC2: 给定 L2 proposal，当调用 `haro_apply` 时，应返回 `DIRECT_APPLY_FORBIDDEN`。（对应 R9）
- AC2.1: 给定 eligible L0 proposal 且 snapshot/rollback refs 齐全，当调用 `haro apply --proposal-id` 时，应写 `ApplicationRecord(status=ready, applied=false)`，不得修改目标资产、不得写 memory。（对应 R10）
- AC3: 给定 validated L0 proposal，当 apply 成功时，应写 snapshot、application event、asset event。（对应 R4/R6/R7）
- AC4: 给定 snapshot 失败，当 apply 时，应整体失败且不写目标文件。（对应 R6）
- AC5: 给定已 apply 的 L1 proposal，当调用 `haro_rollback` 时，应恢复 apply 前状态并写 rollback event。（对应 R8）

## 7. Test Plan / 测试计划

- 单元测试：gate 判定矩阵。
- 单元测试：错误码和 remediation。
- 集成测试：L0 apply + rollback。
- 集成测试：L1 skill/profile fixture apply + rollback。
- 手动验证：通过 AgentDock MCP 调用 `haro_apply({ proposalId })`。

第一段已覆盖的自动测试：

- contract schema：ready application record 合法性、ready record 不允许 blocking reasons。
- CLI gate：未验证 proposal 返回 `VALIDATION_REQUIRED` 且不写 application record。
- CLI gate：L2/L3 proposal 返回 `DIRECT_APPLY_FORBIDDEN`。
- CLI gate：eligible L0 proposal 写 ready application record，`applied=false`，不写 `applied` asset event，不创建 memory。

## 8. Open Questions / 待定问题

- Q1: L1 写入 AgentDock skill/profile/task config 的最小稳定入口是什么？
- Q2: apply 是否需要 AgentDock 侧审批 token，还是 Haro validation + 用户确认足够？
- Q3: rollback 是否允许跨 AgentDock 版本执行，还是必须校验 capability version 相同？

## 9. Changelog / 变更记录

- 2026-05-14: Haro — 完成 Phase F 第一段 gate preflight：新增 `ApplicationRecord` contract，`haro apply --proposal-id` 校验 proposal/validation/L0-L1/snapshot/rollback refs，gate 通过写 ready application record；暂不执行内容 apply、不写 memory。
- 2026-05-08: Haro — 初稿。
