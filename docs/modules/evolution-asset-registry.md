# Evolution Asset Registry 设计

> **2026-05-14 状态：sidecar registry adapter 第一段已落地。**
>
> Evolution Asset Registry 保留并迁移到 Haro sidecar 数据目录，服务 proposal / validation / gated apply 的资产事件。当前 sidecar adapter 的 canonical 存储是 `~/.haro/assets/manifests` + `~/.haro/assets/events` JSON files，`haro_asset_query` 读取 manifest read model 并解析 latest event；旧 core SQLite read model 仅作历史兼容参考。旧文中若出现 Haro 自建 workbench 语境，按 sidecar 语境重评估后再引用。


## 概述

Evolution Asset Registry 是 Haro Phase 1 的进化资产 read model 与审计日志。在 sidecar 基线中，它把 `eat` / `shit` / Skills 影响到的 prompt、skill、routing rule、MCP/tool config、archive manifest 注册为统一资产，但不取代原始文件。Memory 由 AgentDock 侧提供，Haro 只在 observation / proposal 中保留 memory source refs，不再注册 memory asset。

## 资产身份与内容版本

- `id` 是稳定生命周期身份，例如 `skill:lark-doc`、`archive:shit-2026-04-25T...`，不得随内容变化而变化。
- `contentHash` 表示当前内容版本，用于重复 proposal 去重、冲突检测和版本追踪。
- 内容变化通过 `recordEvent()` 追加 audit event，并更新 asset read model 的 `version/contentHash/contentRef`。
- 重复 `contentHash` 的 proposal 不创建第二个资产；Registry 会追加 `conflict` event。

## API

sidecar 第一段对外导出：

```ts
const registry = createSidecarAssetRegistry(root)

registry.recordEvent(assetEvent) // writes ~/.haro/assets/events + manifests
registry.query({ kind: 'frontier-source-ref', status: 'validated', query: 'openai' })
```

历史 core 对外导出：

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

- `eat`：不再直接写入 Haro-owned memory；只生成 observation preview 与 skill/prompt/routing-rule proposal，并注册为 `proposed` asset。
- `SkillsManager`：install/promote、enable、disable、uninstall、use 追加对应事件；skill 资产 id 使用 `skill:<skillId>`。
- `shit`：archive 创建 `archive:<archiveId>` asset；受影响对象追加 `archived` event；rollback 追加 `rollback` event，不删除历史事件。
- AgentDock memory：如 proposal 依赖记忆证据，只保存 AgentDock 暴露的 sourceRef / observationRef；不在 Haro registry 中创建 memory kind。
- Web Dashboard（FEAT-024，历史 workbench）：Skills REST 的 install/uninstall 必须返回 audit 结果；如果 Registry 能力缺失，返回显式 `unsupported`，不能静默跳过事件。

## Phase 1 边界

- prompt asset 以完整 Agent `systemPrompt` 为最小边界；不实现 `@model-dependent` 块级治理。
- routing-rule asset 只覆盖用户/项目级覆盖规则；内建 RoutingMatrix 仅可作为只读 baseline/sourceRef。
- GEP metadata 是可选字段，缺失时不影响现有 eat/shit/skills 流程。
