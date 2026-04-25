---
id: FEAT-022
title: Evolution Asset Registry（进化资产注册表）
status: in-progress
phase: phase-1
owner: whiteParachute
created: 2026-04-25
updated: 2026-04-25
related:
  - ../phase-0/FEAT-010-skills-subsystem.md
  - ../phase-0/FEAT-011-manual-eat-shit.md
  - ./FEAT-020-cross-runtime-shit-skill.md
  - ./FEAT-021-memory-fabric-v1.md
  - ../evolution-metabolism.md
  - ../design-principles.md
  - ../../docs/modules/skills-system.md
  - ../../docs/evolution/self-improvement.md
  - ../../docs/data-directory.md
---

# Evolution Asset Registry（进化资产注册表）

## 1. Context / 背景

Haro 当前的 `eat` / `shit` 已能完成手动代谢，但产物仍以文件和命令结果为主：

- `eat` 可以写 Memory 或生成 proposal bundle，但 proposal、promote、install 之间缺少统一资产身份。
- `shit` 可以 archive 和 rollback，但 archive 与原始 skill/prompt/rule 的版本关系不够显式。
- Skills、prompts、routing rules、memory 条目分散在不同目录，后续 Evolution Engine 难以判断“哪个版本来自哪个 signal、被谁使用、是否有效”。
- FEAT-020 已把 `shit` 提升为 Codex runtime skill，但还没有把代谢闭环变成可审计资产生命周期。

本 spec 借鉴 EvoMap 的协议化进化语法（signal → gene → prompt → event），但不在 Phase 1 引入完整 GEP runtime。Phase 1 只做资产封装、版本、审计和 GEP 兼容字段，为 Phase 2 Evolution Engine 预留稳定输入。

## 2. Goals / 目标

- G1: 给 skill、prompt、routing rule、memory、mcp、archive 建立统一资产身份。
- G2: 记录资产的版本、状态、来源、内容 hash 和审计事件。
- G3: 让 eat/shit、Skills 子系统、Memory Fabric 可以通过 asset id 串联生命周期。
- G4: 预留 EvoMap 风格 GEP 字段，支持 signal/gene/prompt/event 的来源追溯。
- G5: 提供查询和导出能力，供 Dashboard、shit、Evolution Engine 使用。
- G6: 保持现有文件目录为 source/canonical，不强行迁移所有内容进数据库。

## 3. Non-Goals / 不做的事

- 不实现完整 GEP 解释器或声明式进化 DSL。
- 不自动生成 prompt/rule/skill；自动生成属于 Phase 2+ Evolution Engine。
- 不改变 FEAT-011 的 dry-run-first 和人类确认边界。
- 不把 asset registry 作为唯一存储；文件仍是可读 source 或 runtime 加载面。
- 不做跨机器资产同步或团队市场；这些属于 Phase 4 ecosystem。

## 4. Requirements / 需求项

- R1: 系统必须提供 `EvolutionAsset` 与 `EvolutionAssetEvent` 数据模型，覆盖 skill、prompt、routing-rule、memory、mcp、archive。
- R2: 每个 asset 必须有稳定 `id`、`kind`、`name`、`version`、`status`、`sourceRef`、`contentRef`、`contentHash`。
- R3: asset 状态至少包含 `proposed`、`active`、`archived`、`rejected`、`superseded`。
- R4: 每次 proposal、promote、modify、use、archive、rollback、conflict 都必须写 audit event。
- R5: eat 生成 proposal bundle 时必须创建对应 asset；promote/install 时必须更新 asset 版本和状态。
- R6: shit 归档任何受管对象时必须更新 asset 状态，并把 archive id 与 rollback 信息写入 event。
- R7: SkillsManager 必须能把 installed skill 映射到 skill asset，记录 enable/disable/install/uninstall 事件。
- R8: Memory Fabric v1 必须能在 memory entry 中保存可选 `assetRef`，并通过 asset 查询相关 memory。
- R9: Routing rules 和 prompt 文本若进入可演化范围，必须作为 asset 注册；不得只散落在 YAML/Markdown 中。
- R10: GEP 兼容字段必须是可选 metadata，缺失时不得影响现有 eat/shit 流程。
- R11: Registry 必须支持 `listAssets()`、`getAsset()`、`recordEvent()`、`resolveByContentHash()`、`exportManifest()`。
- R12: Registry 写入必须 append/audit-friendly；不得静默覆盖历史事件。

## 5. Design / 设计要点

### 5.1 Asset model

```typescript
type EvolutionAssetKind = 'skill' | 'prompt' | 'routing-rule' | 'memory' | 'mcp' | 'archive';
type EvolutionAssetStatus = 'proposed' | 'active' | 'archived' | 'rejected' | 'superseded';

interface EvolutionAsset {
  id: string;
  kind: EvolutionAssetKind;
  name: string;
  version: number;
  status: EvolutionAssetStatus;
  sourceRef: string;
  contentRef: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  createdBy: 'user' | 'agent' | 'eat' | 'shit' | 'migration';
  gep?: {
    signalRef?: string;
    geneRef?: string;
    promptRef?: string;
    eventRef?: string;
  };
}
```

### 5.2 Event model

```typescript
type EvolutionAssetEventType =
  | 'proposed'
  | 'promoted'
  | 'used'
  | 'modified'
  | 'enabled'
  | 'disabled'
  | 'archived'
  | 'rollback'
  | 'rejected'
  | 'superseded'
  | 'conflict';

interface EvolutionAssetEvent {
  id: string;
  assetId: string;
  type: EvolutionAssetEventType;
  actor: 'user' | 'agent' | 'system';
  evidenceRefs: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
}
```

### 5.3 SQLite schema

```sql
CREATE TABLE evolution_assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  content_ref TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  gep_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE evolution_asset_events (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(asset_id) REFERENCES evolution_assets(id)
);
```

### 5.4 Lifecycle

```text
eat proposal
  -> asset(status=proposed, version=1)
  -> promoted/install
  -> asset(status=active, version=2)
  -> used/modified events
  -> shit archive
  -> asset(status=archived)
  -> rollback
  -> asset(status=active, version++)
```

规则：

- `contentHash` 相同的重复 proposal 走 dedupe，不生成新 asset；只写 `conflict` 或 `used` event。
- archive 本身也是 asset，便于追踪一次 shit 操作影响了哪些资产。
- rollback 不删除 archive event，而是追加 rollback event 并更新目标 asset 状态。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定一次 eat skill proposal，当 proposal bundle 生成后，应存在对应 `skill` asset 和 `proposed` event。（对应 R1-R5）
- AC2: 给定一次 skill promote/install，当安装成功后，asset 状态应变为 `active`，版本递增，并写入 `promoted` event。（对应 R5、R7）
- AC3: 给定一次 shit archive，当归档成功后，受影响 asset 应变为 `archived`，archive asset 和 rollback metadata 均可查询。（对应 R6）
- AC4: 给定一次 rollback，当恢复成功后，应追加 `rollback` event，目标 asset 重新进入 `active` 或原状态，不删除历史事件。（对应 R6、R12）
- AC5: 给定同 contentHash 的重复 proposal，当记录时，不应创建重复 active asset。（对应 R2、R11）
- AC6: 给定 Memory Fabric entry 带 assetRef，当查询 asset 时，应能反查相关 memory 条目。（对应 R8）
- AC7: 给定 routing rule 或 prompt 变成可演化对象，当扫描 registry 时，应能看到对应 `routing-rule` 或 `prompt` asset。（对应 R9）
- AC8: 给定缺少 GEP metadata 的 asset，现有 eat/shit 流程仍应正常工作。（对应 R10）

## 7. Test Plan / 测试计划

- 单元测试：asset schema、event append、status transition、dedupe by contentHash。
- 集成测试：eat proposal -> promote -> shit archive -> rollback 全链路。
- Skills 回归：installed skill 与 asset id 映射，enable/disable 写 event。
- Memory 回归：memory entry 的 assetRef 可查询，不破坏 FTS5。
- 手动验证：导出 asset manifest，能看到 proposal、active、archive、rollback 的完整链路。

## 8. Open Questions / 待定问题

全部已关闭：

- ~~Q1: asset id 应使用内容 hash 派生，还是使用随机 id + contentHash 去重？~~ **决策：使用稳定随机/命名空间 id + contentHash 去重。** asset id 代表生命周期身份，编辑和版本递增不改变 id；`contentHash` 负责重复 proposal 去重、冲突检测和版本内容追踪。
- ~~Q2: prompt asset 的最小边界是整个 Agent systemPrompt，还是 `@model-dependent` 标注块？~~ **决策：Phase 1 以整个 Agent `systemPrompt` 作为 prompt asset 最小边界。** `@model-dependent` 块级治理留给 Phase 2+，避免本阶段过早拆分 prompt 版本语义。
- ~~Q3: routing rule asset 是否在 Phase 1 覆盖内建 RoutingMatrix，还是只覆盖用户/项目级覆盖规则？~~ **决策：Phase 1 只覆盖用户/项目级覆盖规则。** 内建 RoutingMatrix 可作为只读 baseline/sourceRef 注册或导出，但不进入可修改资产生命周期，防止 registry 初版影响核心路由稳定性。

## 9. Changelog / 变更记录

- 2026-04-25: Codex — 初稿，定义 Evolution Asset Registry、asset/event 数据模型、eat/shit 生命周期和 GEP 兼容字段。
- 2026-04-25: whiteParachute — 关闭 Open Questions 并批准进入实现：asset id 使用稳定生命周期 id，contentHash 用于去重；prompt asset 以整个 Agent `systemPrompt` 为 Phase 1 边界；routing-rule asset 只覆盖用户/项目级覆盖规则。
- 2026-04-25: Codex — 实现开始，状态改为 in-progress；完整验证、提交并推送前不标 done。
