---
id: FEAT-046
title: Sidecar Asset Registry Adapter
status: draft
phase: sidecar
owner: whiteParachute
created: 2026-05-08
updated: 2026-05-14
related:
  - FEAT-043-agentdock-contract-skeleton.md
  - FEAT-048-frontier-intelligence-intake.md
  - ../../docs/modules/evolution-asset-registry.md
  - ../phase-1/FEAT-022-evolution-asset-registry.md
---

# Sidecar Asset Registry Adapter

## 1. Context / 背景

Evolution Asset Registry 是 Haro 旧路线中仍然有价值的资产。新基线下，它不再服务 Haro 自建 workbench，而是服务 AgentDock sidecar 的进化资产管理。

需要把资产登记从旧 runtime 语境迁移到 sidecar 数据目录，统一管理 prompt、skill、rule、tool config、runner profile、schedule config 等变更，并把外部 frontier signal 的 source refs 作为 proposal evidence 纳入资产事件链。Memory 由 AgentDock 侧提供，Haro 只保存 memory observation refs，不注册 memory asset。

## 2. Goals / 目标

- G1: 将 Evolution Asset Registry 迁移为 sidecar 数据目录下的独立资产库。
- G2: 让 proposal、validation、application 都能引用 asset id 和 asset event。
- G3: 为 L0/L1 gated apply 提供 snapshot 和 rollback metadata。
- G4: 保留 eat/shit 代谢思想，避免资产只增不减。
- G5: 让外部 frontier signal 的来源、摘要、采信/拒绝状态可追溯。

## 3. Non-Goals / 不做的事

- 不迁移旧 Haro runtime 所有历史数据。
- 不直接修改 AgentDock DB。
- 不实现 apply 执行。
- 不引入向量数据库。

## 4. Requirements / 需求项

- R1: Sidecar asset registry 存储在 `~/.haro/assets/`，不得写 AgentDock DB。
- R2: 每个 asset 必须包含 stable id、kind、version、source ref、content ref、content hash、status。
- R3: 每个 asset event 必须包含 event id、asset id、event type、actor、timestamp、proposal ref?、validation ref?、rollback ref?。
- R4: 支持 asset kinds：`skill`、`prompt`、`runner-profile`、`routing-rule`、`mcp-tool-config`、`schedule-config`、`frontier-source-ref`、`archive`。
- R5: 支持 statuses：`proposed`、`validated`、`applied`、`rolled-back`、`archived`、`rejected`、`superseded`。
- R6: `haro_asset_query` 必须读取 sidecar registry，并支持 kind/status/query/limit 过滤。
- R7: apply 前必须能为目标 asset 生成 snapshot ref。
- R8: rollback metadata 必须足以恢复 L0/L1 apply 前状态。

## 5. Design / 设计要点

建议目录：

```text
~/.haro/assets/
  manifests/
    <encoded-asset-id>.json
  events/
    <timestamp>-<encoded-asset-id>-<encoded-event-id>.json
  snapshots/
    <asset-id>/<timestamp>.json
  archives/
```

第一段实现采用 JSON manifest + event files，避免在 sidecar registry 第一版里再引入新的 SQLite schema。`registry.sqlite` 可在事件量变大后作为 read model 优化项补回，但不是当前 canonical 存储。

事件写入链：

```text
proposal generated
  -> asset event: proposed
validation passed
  -> asset event: validated
apply executed
  -> snapshot + asset event: applied
rollback executed
  -> asset event: rolled-back
```

## 6. Acceptance Criteria / 验收标准

- AC1: 给定 proposal 中的新 skill asset，当登记资产时，应写入 manifest 和 `proposed` event。（对应 R2/R3/R4）
- AC2: 给定 validation 通过，当更新资产状态时，应写入 `validated` event。（对应 R5）
- AC3: 给定 asset query kind/status/query/limit 过滤条件，应只返回匹配资产的 latest AssetEvent summary。（对应 R6）
- AC4: 给定准备 apply 的 L1 asset，应生成 snapshot ref，且 rollback metadata 非空。（对应 R7/R8）
- AC5: 给定 content 相同的 asset 重复登记，应复用或标记 superseded，不应生成无意义重复资产。（对应 G4）

## 7. Test Plan / 测试计划

- 单元测试：manifest schema、event schema、hash 计算。
- 单元测试：query filters。
- 集成测试：proposal → validation → snapshot event 链。
- 回归风险：旧 Evolution Asset Registry 数据结构与 sidecar manifest 不兼容；需提供轻量 adapter 而非原地修改。

## 8. Open Questions / 待定问题

- Q1: 第一版 registry 继续用 SQLite，还是先用 manifest JSON files？已决：第一段采用 manifest JSON + event JSON files；SQLite 只作为未来 read model 优化。
- Q2: 旧 Evolution Asset Registry 是否需要迁移工具，还是只做新 sidecar 数据？
- Q3: asset content ref 对 AgentDock skill/profile 文件应保存绝对路径、相对路径，还是 logical id？
- Q4: `frontier-source-ref` 是否作为独立 asset kind，还是只作为 proposal evidence ref？

## 9. Changelog / 变更记录

- 2026-05-14: Haro — 完成 file-backed sidecar asset registry 第一段：`SidecarAssetRegistry.recordEvent` 写 manifest/event，`haro_asset_query` 读取 sidecar registry manifests/events 并支持 kind/status/query/limit；不读旧 core EvolutionAssetRegistry，不触碰 memory。
- 2026-05-14: Haro — 将 scheduled propose/validate 接入 registry lifecycle：proposal changeSet 自动登记 `proposed` event，validation report 自动登记 `validated` event，manifest latest status 随之更新。
- 2026-05-14: Haro — Phase F gate preflight 已能在 snapshot/rollback refs 齐全时写 `ApplicationRecord(status=ready, applied=false)`；真实 `applied` asset event 仍待 apply executor 落地。
- 2026-05-13: Haro — contract 层 `AssetKindSchema` 已补 `frontier-source-ref`，与 FEAT-048 第一段 signal intake 对齐；完整 registry adapter 仍待实现。
- 2026-05-09: Haro — 补充 frontier-source-ref 与 FEAT-048 的关系。
- 2026-05-08: Haro — 初稿。
