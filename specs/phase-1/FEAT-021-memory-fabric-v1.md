---
id: FEAT-021
title: Memory Fabric v1（三层记忆与 FTS5）
status: done
phase: phase-1
owner: whiteParachute
created: 2026-04-25
updated: 2026-04-25
related:
  - ../phase-0/FEAT-007-memory-fabric-independent.md
  - ../phase-0/FEAT-011-manual-eat-shit.md
  - ../evolution-metabolism.md
  - ../design-principles.md
  - ../../docs/modules/memory-fabric.md
  - ../../docs/data-directory.md
  - ../../roadmap/phases.md#phase-1-intelligence--场景理解与动态编排
---

# Memory Fabric v1（三层记忆与 FTS5）

## 1. Context / 背景

Phase 0 的 Memory Fabric 已交付独立文件级记忆能力：Haro 可以读写 `index.md` / `knowledge/`，并兼容 aria-memory 目录格式。这解决了“记忆可用”和“用户可迁移”的问题，但还不足以支撑 Phase 1 的多 Agent 编排和 Dashboard：

- 记忆没有稳定的全文检索 read model，查询依赖文件扫描和索引文本。
- Session、长期事实、skill 使用模式混在文件语义中，无法可靠按生命周期和用途治理。
- 多 Agent 共享记忆需要 scope、来源、置信度、冲突状态，否则容易把未经验证的结论注入下游。
- FEAT-018 KnowledgePage 需要 Memory API，而不是直接读文件。

本 spec 借鉴 Hermes 已验证的 Session / Persistent / Skill memory 分层和 SQLite FTS5 搜索，但保留 Haro 的核心差异：信息维度拆分、raw source refs、对抗性验证和 aria-memory 兼容。

## 2. Goals / 目标

- G1: 将 Memory Fabric 从 Phase 0 文件级能力升级为可 import 的 v1 模块和 API。
- G2: 定义 Session / Persistent / Skill 三层记忆，并明确生命周期、写入者和查询优先级。
- G3: 增加 SQLite FTS5 read model，支持按 scope、agent、layer、关键词、验证状态检索。
- G4: 保持 Markdown / aria-memory 目录兼容，不要求用户迁移现有知识文件。
- G5: 引入来源、置信度、冲突状态和 assetRef，避免未经验证的记忆被静默当作事实。
- G6: 为 FEAT-018 KnowledgePage、FEAT-022 Asset Registry 和 Phase 2 Pattern Miner 提供稳定接口。

## 3. Non-Goals / 不做的事

- 不引入向量数据库、embedding 或 sqlite-vec；Phase 1 只做 FTS5。
- 不实现 OpenClaw 风格 Dreaming / consolidation 自动晋升；这属于 Phase 2。
- 不让 Dashboard 直接写文件系统；所有读写必须走 Memory Fabric API。
- 不改变 FEAT-005 AgentRunner 的 provider 调用语义。
- 不把 unverified memory 自动写入 system prompt 且不带来源提示。
- 不在本 spec 内实现 Evolution Asset Registry；只预留 `assetRef` 字段。

## 4. Requirements / 需求项

- R1: Memory Fabric v1 必须提供可 import API，至少包含 `writeEntry()`、`queryEntries()`、`contextFor()`、`markVerification()`、`archiveEntry()`、`stats()`。
- R2: 每条记忆必须属于一个 layer：`session`、`persistent`、`skill`。
- R3: 每条记忆必须属于一个 scope：`platform`、`shared`、`agent:{id}` 或 `project:{pathHash}`。
- R4: 每条记忆必须保存 `sourceRef`、`contentHash`、`verificationStatus`，可选保存 `confidence` 和 `assetRef`。
- R5: Persistent memory 必须继续写入或引用 Markdown canonical source，保持 aria-memory 兼容。
- R6: SQLite 必须维护 `memory_entries` 和 `memory_entries_fts` read model；查询不得只遍历 Markdown 文件。
- R7: `queryEntries()` 必须支持 keyword、scope、agentId、layer、verificationStatus、limit、since 等过滤条件。
- R8: `contextFor()` 注入给 Agent 的内容必须优先 verified 条目；unverified/conflicted 条目必须带来源和不确定性提示。
- R9: 同一 topic 出现内容冲突时，不得覆盖旧条目；必须保留双方并标记 `conflicted` 或创建 conflict event。
- R10: Skill memory 必须能绑定 skill id / assetRef / 使用结果，支持记录成功模式、失败样例和适用边界。
- R11: FEAT-018 的 Memory REST API 必须通过 Memory Fabric v1 调用，不得直接读写 `~/.haro/memory/**`。
- R12: migration/indexer 必须能从现有 aria-memory 目录重建 FTS5 read model，重复运行幂等。

## 5. Design / 设计要点

### 5.1 MemoryEntry

```typescript
type MemoryLayer = 'session' | 'persistent' | 'skill';
type MemoryScope = 'platform' | 'shared' | `agent:${string}` | `project:${string}`;
type VerificationStatus = 'unverified' | 'verified' | 'conflicted' | 'rejected';

interface MemoryEntry {
  id: string;
  layer: MemoryLayer;
  scope: MemoryScope;
  agentId?: string;
  topic: string;
  summary: string;
  content: string;
  contentPath?: string;
  contentHash: string;
  sourceRef: string;
  assetRef?: string;
  verificationStatus: VerificationStatus;
  confidence?: number;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}
```

### 5.2 Storage model

SQLite read model：

```sql
CREATE TABLE memory_entries (
  id TEXT PRIMARY KEY,
  layer TEXT NOT NULL,
  scope TEXT NOT NULL,
  agent_id TEXT,
  topic TEXT NOT NULL,
  summary TEXT NOT NULL,
  content_path TEXT,
  content_hash TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  asset_ref TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  confidence REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE VIRTUAL TABLE memory_entries_fts USING fts5(
  topic,
  summary,
  content,
  content='',
  tokenize='unicode61'
);
```

Markdown canonical source：

- `persistent` 默认继续写入 `~/.haro/memory/{platform|shared|agents/<id>}/knowledge/*.md`。
- `session` 可仅保存在 SQLite/session_events/raw refs 中，只有被晋升时才写 Markdown。
- `skill` Phase 1 先以 SQLite read model + `assetRef` 为准；`~/.haro/memory/skills/<skill-id>/knowledge/*.md` 作为可选 canonical mirror，不作为实现 blocker。

### 5.3 Query ranking

默认排序建议：

1. scope 精确匹配优先：当前 agent/project > shared > platform。
2. `verified` > `unverified` > `conflicted`；`rejected` 默认不返回。
3. FTS5 rank + recency + usage count + confidence 加权。
4. `skill` layer 仅在任务触发相关 skill 或 query 命中 tool/skill 标签时提升权重。

### 5.4 Conflict and adversarial validation

冲突处理：

- `contentHash` 相同：幂等更新 usage/updatedAt。
- topic 相同但内容冲突：创建新 entry，双方标记 `conflicted`，记录 evidenceRefs。
- platform/shared scope 的冲突条目不得自动进入 prompt 注入；需要 reviewer/critic 或用户确认后才能改为 `verified`。

### 5.5 API sketch

```typescript
interface MemoryFabric {
  writeEntry(input: WriteMemoryEntryInput): Promise<MemoryEntry>;
  queryEntries(query: MemoryQuery): Promise<MemorySearchResult[]>;
  contextFor(query: MemoryContextQuery): Promise<MemoryContext>;
  markVerification(id: string, status: VerificationStatus, evidenceRefs: string[]): Promise<void>;
  archiveEntry(id: string, reason: string): Promise<void>;
  stats(): Promise<MemoryStats>;
  rebuildIndex(options?: { scope?: string; dryRun?: boolean }): Promise<RebuildResult>;
}
```

### 5.6 Closed design decisions

- D1: `session` layer 在 Phase 1 不引入独立 TTL 配置；默认随 workflow/session 生命周期清理或晋升，后续 Dreaming/consolidation 再引入策略化 TTL。
- D2: `skill` layer Phase 1 不强制写 Markdown canonical path；必须写入 SQLite read model，并通过 `assetRef` / skill id 可查。Markdown mirror 留给 FEAT-022/Phase 2 资产治理增强。
- D3: platform/shared scope 的 `verified` 状态采用双门控：critic/reviewer agent 给出验证 evidence，用户或 owner 确认后才可标记 verified；agent/project 私有 scope 可先保留更轻量的 reviewer evidence。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定一条 persistent memory 写入，当调用 `writeEntry()` 时，应写入 Markdown canonical source，并在 `memory_entries` 与 FTS5 中可查询。（对应 R1、R5-R6）
- AC2: 给定 keyword + scope 查询，当调用 `queryEntries()` 时，应只返回匹配 scope/layer/verificationStatus 的结果，并按 FTS5/ranking 排序。（对应 R7）
- AC3: 给定当前 agent 的任务，当调用 `contextFor()` 时，应优先返回该 agent scope 和 shared verified 条目，unverified 条目必须带来源提示。（对应 R8）
- AC4: 给定同一 topic 的冲突内容，当写入第二条时，不得覆盖第一条；两条应可被识别为冲突。（对应 R9）
- AC5: 给定 skill 运行结果，当写入 skill memory 时，应能通过 skill id 或 assetRef 查询到成功/失败模式。（对应 R10）
- AC6: 给定现有 aria-memory 目录，当运行 rebuild index 两次时，FTS5 结果应幂等且不重复。（对应 R12）
- AC7: 给定 FEAT-018 Memory REST 调用，当追踪实现时，不应出现直接读写 memory 文件的 route 逻辑。（对应 R11）

## 7. Test Plan / 测试计划

- 单元测试：MemoryEntry schema、scope/layer validation、conflict detection、ranking。
- 集成测试：Markdown write + FTS5 query + rebuild index 幂等。
- API 测试：FEAT-018 memory route 通过 Memory Fabric v1 查询/写入。
- 回归测试：Phase 0 memory-wrapup / memory-sleep 不被破坏；aria-memory 目录仍可挂载。
- 手动验证：写入一条 shared memory，在 CLI 下一轮 `contextFor()` 中可见；Dashboard 搜索可命中。

## 8. Open Questions / 待定问题

全部已关闭：

- ~~Q1: `session` layer 是否需要单独 TTL 配置，还是只随 workflow/session 结束统一清理？~~ **决策：Phase 1 不做独立 TTL。** session memory 随 workflow/session 生命周期清理或晋升；策略化 TTL 留给 Phase 2 Dreaming/consolidation。
- ~~Q2: `skill` layer 的 Markdown canonical path 是否必须落 `~/.haro/memory/skills/<skill-id>/`，还是只通过 assetRef + SQLite 保存即可？~~ **决策：Phase 1 只要求 SQLite + assetRef/skill id 可查询。** Markdown canonical mirror 可选，不阻塞本 spec。
- ~~Q3: platform/shared scope 的 `verified` 状态由用户确认、critic agent 还是双门控决定？~~ **决策：双门控。** critic/reviewer agent 提供 evidence，用户或 owner 确认后才能把 platform/shared 条目标为 verified。

## 9. Changelog / 变更记录

- 2026-04-25: Codex — 初稿，定义 Memory Fabric v1 三层记忆、FTS5 read model、验证状态与 Dashboard/API 边界。
- 2026-04-25: whiteParachute — 关闭 Open Questions 并批准进入实现：session 不设独立 TTL；skill memory Phase 1 以 SQLite + assetRef 为准；platform/shared verified 采用双门控。
- 2026-04-25: Codex — 实现开始，状态改为 in-progress；PR 合入前不标 done。
- 2026-04-25: Codex — 实现完成并标记 done：落地 `MemoryFabric` v1 API、SQLite FTS5 read model、scope/layer/verification/assetRef、aria-memory rebuild、Runner 来源/不确定性注入和文档同步。验证通过：`pnpm -F @haro/core build`、`pnpm -F @haro/core test`、`pnpm -F @haro/cli test`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm smoke`。
