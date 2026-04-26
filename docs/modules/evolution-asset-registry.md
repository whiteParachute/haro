# Evolution Asset Registry 设计

## 概述

Evolution Asset Registry 是 Haro Phase 1 的进化资产 read model 与审计日志。它把 `eat` / `shit` / Skills / Memory Fabric 影响到的对象注册为统一资产，但不取代原始文件：skill、prompt、routing rule、memory Markdown、archive manifest 仍然是可读 source 或 runtime 加载面。

## 资产身份与内容版本

- `id` 是稳定生命周期身份，例如 `skill:lark-doc`、`archive:shit-2026-04-25T...`，不得随内容变化而变化。
- `contentHash` 表示当前内容版本，用于重复 proposal 去重、冲突检测和版本追踪。
- 内容变化通过 `recordEvent()` 追加 audit event，并更新 asset read model 的 `version/contentHash/contentRef`。
- 重复 `contentHash` 的 proposal 不创建第二个资产；Registry 会追加 `conflict` event。

## API

core 对外导出：

```ts
const registry = createEvolutionAssetRegistry({ root })

registry.listAssets({ kind: 'skill', status: 'active' })
registry.getAsset('skill:review', { includeEvents: true })
registry.recordEvent({ type: 'used', assetId: 'skill:review' })
registry.resolveByContentHash(hash, { kind: 'skill' })
registry.exportManifest({ outputFile: '~/.haro/assets/manifest-exports/assets.json' })
```

## 生命周期事件

支持事件：`proposed / promoted / used / modified / enabled / disabled / archived / rollback / rejected / superseded / conflict`。

状态集合保持为：`proposed / active / archived / rejected / superseded`。`disabled` 是事件，不新增状态；禁用事实通过 event metadata 表达。

## 子系统接入

- `eat`：memory direct write 注册 memory asset，并把 `assetRef` 写入 Memory Fabric；skill/prompt/routing-rule proposal 注册为 `proposed` asset。
- `SkillsManager`：install/promote、enable、disable、uninstall、use 追加对应事件；skill 资产 id 使用 `skill:<skillId>`。
- `shit`：archive 创建 `archive:<archiveId>` asset；受影响对象追加 `archived` event；rollback 追加 `rollback` event，不删除历史事件。
- Memory Fabric：`memory_entries.asset_ref` 可通过 `queryEntries({ assetRef })` 反查相关 memory。
- Web Dashboard（FEAT-024）：Skills REST 的 install/uninstall 必须返回 audit 结果；如果 Registry 能力缺失，返回显式 `unsupported`，不能静默跳过事件。Memory REST 暴露 `assetRef` 字段用于 KnowledgePage 追溯来源。

## Phase 1 边界

- prompt asset 以完整 Agent `systemPrompt` 为最小边界；不实现 `@model-dependent` 块级治理。
- routing-rule asset 只覆盖用户/项目级覆盖规则；内建 RoutingMatrix 仅可作为只读 baseline/sourceRef。
- GEP metadata 是可选字段，缺失时不影响现有 eat/shit/skills/memory 流程。
