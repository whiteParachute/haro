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
- R11: `haro snapshot --proposal-id` 可为 L0/L1 proposal 生成 schema-valid `AssetSnapshotRecord` 与 `RollbackRecord`；重复执行应基于 proposal / validation / snapshot source 生成确定性 id。
- R12: Phase F target-specific snapshot 第一段只允许读取 Haro sidecar-owned `~/.haro/assets/current/{prompt,mcp-tool-config}/` 当前内容，并复制到 `~/.haro/evolution/snapshot-content/<snapshot-id>/`；不得读取 AgentDock internals、`aria-memory-vault` 或任意 `file://` proposal path。
- R13: Phase F sidecar-local apply 第一段只允许从 `~/.haro/evolution/proposal-content/<proposal-id>/` 读取拟应用内容，并只写入 `~/.haro/assets/current/{prompt,mcp-tool-config}/`；必须写 `ApplicationRecord(status=applied)` 与 `applied` asset event，仍不得读写 memory。
- R14: apply 必须校验 snapshot / rollback artifact 归属当前 proposal、匹配 validation（若 artifact 带 validationId）、target kind、changeSet target 和 rollback.snapshotRef，不得接受其它 proposal 的 refs。

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
| 本地 executor 不支持 | `UNSUPPORTED_APPLY_EXECUTOR` |
| 变更操作不支持 | `UNSUPPORTED_CHANGE_OPERATION` |
| proposal content 缺失 | `APPLY_CONTENT_REQUIRED` |
| proposal content hash 不匹配 | `APPLY_CONTENT_HASH_MISMATCH` |
| apply 写入失败 | `APPLY_EXECUTION_FAILED` |

当前实现切片：

- `ApplicationRecordSchema` 已加入 `@haro/agentdock-contract`。
- `AssetSnapshotRecordSchema` / `RollbackRecordSchema` 已加入 `@haro/agentdock-contract`。
- `haro snapshot --proposal-id <id> --json` 已实现 snapshot/rollback artifact 生成，写入 `~/.haro/evolution/snapshots/*` 与 `~/.haro/evolution/rollbacks/*`。
- 对 `prompt` / `mcp-tool-config`，snapshot 会按 allowlist 从 sidecar-owned `~/.haro/assets/current/<kind>/<base64url(asset-id)>.{md,txt,json}` 读取当前内容，复制到 `~/.haro/evolution/snapshot-content/<snapshot-id>/`，并在 snapshot entry 中记录 `snapshotSource=target-content`、`sourceContentRef`、`contentRef`、`contentHash`；rollback entry 使用该 snapshot content 作为 restore ref/hash。
- 如果 sidecar-local 当前内容不存在，则回退到 sidecar asset ledger 中最近的 `applied` / `rolled-back` / `archived` baseline；仍不存在则记录 `snapshotSource=absent` 并生成 `delete-created-asset` rollback entry。
- `haro apply --proposal-id <id> --json` 已实现 gate preflight + sidecar-local L0 apply executor。
- Gate 已覆盖 proposal existence、L2/L3 direct apply forbidden、L0/L1 target allowlist、`proposal.status=validated`、validation report、`applyEligible=true`、`rollbackReady=true`、snapshot ref、rollback ref。
- Apply 会校验 snapshot/rollback artifact 绑定当前 proposal 与当前 validation（若 artifact 带 validationId），且 entries 覆盖当前 proposal changeSet；跨 proposal refs 会 fail closed。
- Gate 缺 snapshot/rollback refs 时会先生成 refs。
- 对 L0 `prompt` / `mcp-tool-config`，apply 会从 `~/.haro/evolution/proposal-content/<proposal-id>/<change-index>-<base64url(asset-id)>.{md,txt,json}` 读取拟应用内容，拒绝 symlink，校验可选 `contentHash`，写入 `~/.haro/assets/current/<kind>/<base64url(asset-id)>.<ext>`，并清理同 asset 的其它允许扩展名文件，避免 stale alternate current content。
- Apply 成功后写 `~/.haro/evolution/applications/<application-id>.json` applied record，`applied=true`，并写 `applied` asset event，event 带 snapshot/rollback metadata。
- 当前不支持 L1 executor、不支持 delete/archive op、不读写 memory。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定未验证 proposal，当调用 `haro_apply` / `haro apply --proposal-id` 时，应返回 `VALIDATION_REQUIRED`，且不产生 application 写入。（对应 R2）
- AC2: 给定 L2 proposal，当调用 `haro_apply` 时，应返回 `DIRECT_APPLY_FORBIDDEN`。（对应 R9）
- AC2.1: 给定 eligible L0 proposal、snapshot/rollback refs 齐全且 proposal content 存在，当调用 `haro apply --proposal-id` 时，应写 `ApplicationRecord(status=applied, applied=true)`、写 `applied` asset event，并只修改 sidecar-owned `assets/current`。（对应 R13）
- AC2.2: 给定 L0/L1 proposal，当调用 `haro snapshot --proposal-id` 时，应写 schema-valid snapshot/rollback metadata；重复执行应复用确定性 id，不产生重复 artifacts。（对应 R11）
- AC2.3: 给定 eligible L0 proposal 但 proposal rollback refs 为空，当调用 `haro apply --proposal-id` 时，应先生成 snapshot/rollback refs，再应用 sidecar-local proposal content，并写 applied application record。（对应 R11/R13）
- AC2.4: 给定 L0 `prompt` / `mcp-tool-config` proposal 且 sidecar-local 当前内容存在，当调用 `haro snapshot --proposal-id` 时，应复制当前内容到 `snapshot-content`，snapshot/rollback entry 应包含 restore ref/hash，且不得读取 memory 或 AgentDock internals。（对应 R12）
- AC2.5: 给定 eligible L0 proposal 但 proposal content 缺失或 hash 不匹配，当调用 `haro apply --proposal-id` 时，应返回 blocking gate code，不写 application record、不写 applied event、不修改 current content。（对应 R13）
- AC2.6: 给定 eligible L0 proposal 但 rollbackRefs 指向其它 proposal 的 snapshot/rollback artifact，当调用 `haro apply --proposal-id` 时，应返回 blocking gate code，不写 application record、不写 applied event、不修改 current content。（对应 R14）
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

- contract schema：ready / applied application record 合法性、ready record 不允许 blocking reasons、`status=applied` 必须 `applied=true`。
- contract schema：snapshot/rollback metadata record 合法性。
- CLI gate：未验证 proposal 返回 `VALIDATION_REQUIRED` 且不写 application record。
- CLI gate：L2/L3 proposal 返回 `DIRECT_APPLY_FORBIDDEN`。
- CLI apply：eligible L0 proposal 写 applied application record、`applied` asset event，并只修改 sidecar-local `assets/current`；不创建 memory。
- CLI snapshot：`haro snapshot --proposal-id` 写确定性 snapshot/rollback metadata，重复执行不重复新增 artifact。
- CLI snapshot：存在 sidecar-local L0 当前内容时，复制到 `snapshot-content`，并在 snapshot/rollback entry 中记录 restore ref/hash。
- CLI apply：eligible L0 proposal 缺 refs 时自动生成 snapshot/rollback，再写 applied application record。
- CLI apply：proposal content 缺失时返回 `APPLY_CONTENT_REQUIRED`，不写 application record 或 `applied` event。
- CLI apply：跨 proposal 的 snapshot/rollback refs 返回 blocking gate code，不写 application record 或 `applied` event。

## 8. Open Questions / 待定问题

- Q1: L1 写入 AgentDock skill/profile/task config 的最小稳定入口是什么？
- Q2: apply 是否需要 AgentDock 侧审批 token，还是 Haro validation + 用户确认足够？
- Q3: rollback 是否允许跨 AgentDock 版本执行，还是必须校验 capability version 相同？

## 9. Changelog / 变更记录

- 2026-05-14: Haro — 完成 Phase F 第一段 gate preflight：新增 `ApplicationRecord` contract，`haro apply --proposal-id` 校验 proposal/validation/L0-L1/snapshot/rollback refs，gate 通过写 ready application record；暂不执行内容 apply、不写 memory。
- 2026-05-14: Haro — 完成 Phase F 第二段 metadata snapshot：新增 `AssetSnapshotRecord` / `RollbackRecord` contract 与 `haro snapshot --proposal-id`；`haro apply --proposal-id` 缺 refs 时生成 metadata-only snapshot/rollback refs；status/doctor 纳入 snapshots/rollbacks。
- 2026-05-14: Haro — 完成 Phase F 第三段 target-specific content snapshot 第一段：对 `prompt` / `mcp-tool-config` 只读取 sidecar-owned `~/.haro/assets/current/<kind>/`，复制当前内容到 `snapshot-content` 并写入 restore ref/hash；仍不执行 apply、不读写 memory。
- 2026-05-14: Haro — 完成 Phase F 第四段 sidecar-local apply executor 第一段：对 L0 `prompt` / `mcp-tool-config` 只读取 sidecar-owned `proposal-content`，写回 `assets/current`，记录 applied application/asset event；仍不读写 memory，不支持 L1/delete/archive。
- 2026-05-14: Haro — review 后补强 apply evidence ref 绑定校验：snapshot/rollback 必须归属当前 proposal 并匹配 validation/target/changeSet，防止复用其它 proposal 的 rollback refs。
- 2026-05-08: Haro — 初稿。
