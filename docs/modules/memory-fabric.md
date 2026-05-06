# Memory Fabric 设计

## 概述

Memory Fabric 是 Haro 的记忆子系统。**核心设计目标是让 Haro 拥有独立的记忆能力**，不依赖任何外部系统就能完成记忆的写入、查询、索引、维护。

在具备独立能力的前提下，Memory Fabric 还兼容 [aria-memory](https://github.com/...) 的目录格式，用户可以把已有的 aria-memory 目录无缝挂载到 Haro 上继续使用。

## 设计原则

1. **独立能力优先**：Haro 单独运行时必须具备完整记忆功能
2. **格式兼容**：兼容 aria-memory 目录结构，降低迁移成本
3. **可配置外挂**：记忆目录、主备、后端实现均可通过配置切换（遵守 [可插拔原则](../architecture/overview.md#设计原则)）
4. **独立部署**：Memory Fabric 可以不启动完整 Haro 单独运行
5. **文件存储优先**：FEAT-035 v2 起统一为 aria-memory 风格的"MEMORY.md 索引 + 散文件"模型；不引入 FTS / 向量索引，搜索 = 文件存储内的 grep + 索引解析。
6. **分层和验证并重**：借鉴 Hermes 的 Session / Persistent / Skill memory，但所有写入都要带 Haro 自有的 scope、来源、置信度和验证状态

## Phase 1 v1 → Phase 1.5 v2 演进：去 SQLite 化

Phase 0 的 Memory Fabric 已证明"本地文件 + aria-memory 兼容"可用。Phase 1 v1（FEAT-021，2026-04-25 done）在文件之上叠加了 SQLite + FTS5 read model。Phase 1.5 v2（FEAT-035，2026-05-06）把这层移除，改为纯文件存储——理由：owner 在 Claude Code / Codex / OpenClaw 都用 aria-memory 风格，再维护一套独立的 read model 等于把同一份记忆系统拆成两套心智模型；FEAT-031 Web Channel D4 也直接依赖"文件存储内的搜索"作为历史检索后端。

| 层级 | 作用 | 生命周期 | v2 存储 | 典型写入者 |
|------|------|----------|---------|------------|
| Session memory | 当前对话/workflow 的短期事实、约束、待办、checkpoint 旁路提示 | session/workflow 结束后可晋升或丢弃 | `<scope>/knowledge/.pending/*.md` | Agent Runtime / Channel / Router |
| Persistent memory | 跨会话事实、用户偏好、项目知识、平台决策 | 长期保留，可被 shit 归档 | `<scope>/knowledge/<slug>-<hash>.md`（带 frontmatter） | 用户 / Agent / eat / wrapup |
| Skill memory | 可复用解决模式、工具链经验、skill 使用结果和失败案例 | 跟随 skill/asset 版本演进 | `<scope>/knowledge/*.md` + `assets` 引用 | eat / Skill subsystem / Pattern Miner |

Haro 在 Hermes 分层之上增加四类维度（v2 仍保留）：

- **scope**：`platform` / `shared` / `agent:{id}` / `project:{path}`。
- **source**：用户输入、session event、eat proposal、skill run、workflow checkpoint、外部调研。
- **verificationStatus**：`unverified` / `verified` / `conflicted` / `rejected`。
- **assetRef**：可选地指向 Evolution Asset Registry 中的 skill、prompt、routing rule 或 eat/shit archive。

### v2 文件存储（FEAT-035）

每个 scope 一棵子树：

```
~/.haro/memory/
├── platform/
│   ├── index.md                # MEMORY.md 索引（人类可读，工具维护）
│   ├── knowledge/<slug>-<hash>.md
│   ├── impressions/<date>_<slug>.md
│   └── impressions/archived/
├── shared/...
├── agents/<agent-id>/...
└── projects/<pathHash>/...
```

每个散文件 frontmatter 至少包含：`id` / `topic` / `summary` / `layer` / `scope` / `source_ref` / `content_hash` / `verification_status` / `tags` / `created_at` / `updated_at`。可选字段：`agent_id` / `asset_ref` / `confidence` / `verification_evidence_refs` / `archived_at` / `archived_reason`。

实现说明：

- `MemoryFileStore` 在内存中维护 `Map<entryId, MemoryEntry>`，按 scope 懒加载；启动后所有 CRUD 走内存 + 文件，**没有 SQLite**。
- 写入：先写散文件 → 内存 Map 上插入 → `syncFrontmatter()` 用 entry 的规范字段重写 frontmatter（保留 `wrapup_id` 等非规范字段不被覆盖）→ `rewriteIndex(scope)` 原子更新 MEMORY.md。
- `content_hash + layer + scope` 幂等；同 `topic` 但不同 `content_hash` 的条目保留双方并标记为 `conflicted`。
- `impressions/archived/` 下的文件即使 frontmatter 缺 `archived_at` 也按目录推断为已归档。

查询路径（无 FTS）：

1. 按 scope 提示决定要 hydrate 哪些子树（无提示时枚举全部 scope）。
2. 在内存 Map 上做关键词 grep + scope/layer/agentId/assetRef/skillId/tags/since 过滤。
3. 按 verificationStatus、layer、recency、confidence 加权排序。
4. 对 `conflicted` 项降权；需要进入 system prompt 的内容必须有来源引用。

性能基线：单 scope 散文件 ≤ 1000 时 P99 < 300ms；超过时由 `aria-memory:memory-sleep` 压缩，不引入索引引擎（FEAT-035 D4）。

### v1 → v2 迁移

`MemoryFabric.migrateFromV1({ dbFile })`：

1. 读旧 SQLite 的 `memory_entries` 行（已通过 scope 白名单 + 路径校验防越界写入）。
2. 为每行在对应 scope 的 `knowledge/` 下合成散文件，frontmatter 包含全部规范字段。
3. 把消费过的 `dbFile` 重命名为 `dbFile.bak.<ISO timestamp>`（保留 30 天兜底，详见 FEAT-035 D2）。
4. 对已经是 `.bak.<...>` 形态的源路径直接 no-op，不再连续追加 `.bak`。
5. 重跑幂等：已有同 id 的 v2 散文件就跳过该行。

### 对抗性验证

Memory Fabric v1 不能把“写得像事实”的内容直接当事实使用：

- platform/shared scope 写入必须有 `source_ref`，不能只存自然语言结论。
- 同一 topic 出现冲突时，新旧条目都保留，标记 `conflicted`，并进入 review/shit 候选。
- `Skill memory` 的成功模式必须绑定样本数、失败样例和适用边界，不能只记录“某做法有效”。
- 给 Agent 注入记忆时，优先注入 verified 条目；unverified 条目必须带来源和不确定性提示。

## 核心能力（独立模块必备）

| 能力 | 说明 |
|------|------|
| **写入** | 三层即时写：T1 显式同步写 / T2 事件驱动异步写 / T3 session 结束兜底（见下节） |
| **查询** | 三层级联：index.md → impressions → knowledge → archived（照抄 aria-memory） |
| **本 session 注入** | Agent Runtime 每轮 query 前主动读 MemoryFabric，保证"写入即可见" |
| **索引** | 维护 `index.md` 作为入口快查表（~200 条上限，Obsidian wikilink 格式） |
| **维护** | 完整照抄 aria-memory `global_sleep` 12 步流程（压缩 / 合并 / 清理 / 重排） |
| **多端合并** | `.pending/` 幂等键（source + wrapup_id + hash）合并多 Channel 并发写入 |
| **统计** | 返回记忆数量、增长速率、最近使用等 |

## v1 API 边界

上层（Runner、Skill、后续 REST route）只允许通过 Memory Fabric API 访问记忆，不直接读写 `~/.haro/memory/**`：

```typescript
const memory = createMemoryFabric({ root: paths.dirs.memory })

await memory.writeEntry({
  layer: 'persistent',
  scope: 'shared',
  topic: 'provider setup policy',
  content: 'Provider secrets must use secretRef or protected env files.',
  sourceRef: 'spec:FEAT-026',
  verificationStatus: 'verified',
})

const hits = memory.queryEntries({
  keyword: 'provider secrets',
  scopes: ['shared', 'platform'],
  verificationStatus: ['verified', 'unverified'],
  limit: 10,
})

const ctx = memory.contextFor({
  agentId: 'haro-assistant',
  query: 'How should provider setup store secrets?',
})
```

API：

- `writeEntry(input)`：写入 `session | persistent | skill` 三层记忆。每层都落到 scope 子树下的 Markdown 散文件；frontmatter 由 `syncFrontmatter()` 自动同步规范字段。
- `queryEntries(query)`：在内存 Map 上过滤（FEAT-035 v2 走文件存储），支持 keyword、scope(s)、agentId、layer、verificationStatus、assetRef、skillId、since、limit。
- `searchMemoryFiles(query, options?)`：FEAT-031 / FEAT-032 历史检索的统一入口；语义同 `queryEntries`，多了 `type` 过滤（`user/feedback/project/reference`）。
- `contextFor(query)`：用于 Agent prompt 注入，优先 verified；unverified/conflicted 条目带来源和不确定性提示；rejected/archived 默认不注入。
- `markVerification(id, status, evidenceRefs)`：记录 reviewer/owner evidence；platform/shared 条目标为 `verified` 时强制 D3 双门控（critic/reviewer evidence + user/owner confirmation）。
- `archiveEntry(id, reason)`：软归档，不删除 Markdown source。
- `stats()`：返回文件统计（散文件数 / impressions / pending / lastMaintenanceAt）+ layer/scope/status 聚合。
- `rebuildIndex(options?)`：扫描现有 aria-memory 目录并幂等重建内存索引（v2 不再写 SQLite）。
- `runWrapup(input)` / `runSleep(input)`：FEAT-035 R10 给 `aria-memory:memory-wrapup` / `memory-sleep` skill 用的钩子；Haro 暴露原子语义，具体策略归 skill。
- `repairScope(scope?)`：扫描散文件、重建内存索引并刷新 MEMORY.md；幂等。
- `migrateFromV1({ dbFile })`：把旧 SQLite memory_entries 行转写成 v2 散文件并重命名 .bak（详见前面"v1 → v2 迁移"）。

以上能力均为 Haro 原生实现；"目录布局"层兼容 aria-memory，使用户已有目录可直接挂载。

### Web Dashboard contract（FEAT-024）

Dashboard 只通过 Memory Fabric API 访问记忆，不直接读写 `~/.haro/memory/**`：

- `GET /api/v1/memory/query`：映射到 `queryEntries()`，支持 `scope/agentId/layer/verificationStatus/keyword/limit`。
- `POST /api/v1/memory/write`：映射到 `writeEntry()`，仅允许 `shared` 与当前 `agent:{id}`；`platform` scope 返回拒绝且不得落库。
- `GET /api/v1/memory/stats`：映射到 `stats()`，用于页面摘要与 smoke 断言。
- `POST /api/v1/memory/maintenance`：Phase 1 Web contract 返回 `202`、`taskId` 与 `async=true`；维护在后台运行，不把同步完成伪装成用户可等待的 UI 操作。

KnowledgePage 查询结果必须展示 `sourceRef` 和 `verificationStatus`，写入表单默认 `shared`，不提供 platform 写入入口。

## 目录结构

```
~/.haro/memory/
├── platform/           # 平台级记忆
│   ├── index.md        # 记忆索引
│   └── knowledge/      # 知识文件
│       └── *.md
├── agents/
│   ├── haro-assistant/ # Agent 私有记忆
│   │   ├── index.md
│   │   └── knowledge/
│   ├── code-reviewer/
│   │   ├── index.md
│   │   └── knowledge/
│   └── .../
└── shared/             # 团队共享记忆（Phase 1）
    ├── index.md
    └── knowledge/
~/.haro/assets/         # Phase 1：skill/prompt/rule/eat/shit 资产注册表
```

目录格式与 aria-memory 完全一致，用户可以直接把已有 aria-memory 目录指给 Haro 使用。

## 与 aria-memory 的兼容

Memory Fabric 兼容 aria-memory 的目录格式和改动设计。以下是**兼容性选项**，非必需：

### 兼容配置

```yaml
# ~/.haro/config.yaml
memory:
  path: ~/.haro/memory        # 默认使用 Haro 自有记忆目录
  # 或挂载已有的 aria-memory 目录：
  # path: /path/to/existing/aria-memory
```

### 兼容的格式项

- `index.md`（记忆索引文件）
- `knowledge/` 目录（知识文件）
- `impressions/` 目录（印象文件）

## 主备配置（兼容性选项）

主备能力是为了兼容 aria-memory 的多源写入模式，**不是 Memory Fabric 的核心功能**。默认单源足够使用。

启用主备的场景：
- 用户已有 aria-memory 主备架构，希望 Haro 继承
- 用户希望把 NAS / 云盘作为备份路径

```yaml
# 仅在需要时配置
memory:
  primary:
    path: ~/.haro/memory
    globalSleep: true       # 仅主执行全局维护逻辑
  backup:
    path: /mnt/nas/haro-memory-backup
    globalSleep: false      # 备不主动维护
```

规则：
- **仅主执行 `memory-sleep`** 等全局维护
- 备只做被动同步，不主动触发全局操作
- 读：先主后备；写：写主 + 异步同步备

## Per-Agent 私有记忆

每个 Agent 在 `~/.haro/memory/agents/{name}/` 下拥有独立的私有记忆空间：

```
~/.haro/memory/agents/code-reviewer/
├── index.md          # 此 Agent 的记忆索引
└── knowledge/
    ├── common-bugs.md      # 常见 Bug 知识
    └── review-patterns.md  # 审查模式知识
```

**隔离原则**：
- Agent 私有记忆默认不对其他 Agent 可见
- 团队共享记忆（`shared/`）在 Phase 1 实现，所有 Agent 可读
- 平台级记忆（`platform/`）由 Haro 系统维护

## 三层即时写入

Haro 的记忆写入时机比 aria-memory 更激进 — **全部即时写，同 session 内立即可见**。aria-memory 的 wrapup 是 deferred 到下一 session start 才 flush，Haro 自己 orchestrate 执行循环，不需要依赖外部 hook，因此可以做到"写完立即能查到"。

### T1 显式写（同步即时）

**触发**：用户 `remember` skill / Agent 主动沉淀关键事实

**流程**：
```
MemoryFabric.write({ scope, agentId, content })
  ↓ 同步
  原子写 knowledge/<file>.md （tmp + rename）
  → 更新 index.md（Promise-chain 串行化）
  → 更新 MemoryIndex（内存）
  → 返回
```

下一次 `query()` 立即命中。

### T2 事件驱动写（异步即时）

**触发**：Agent 在 reasoning 中识别"值得记住的模式"（通过 SDK 事件流捕获）

**流程**：
```
MemoryFabric.deposit({ source, content })
  ↓ 异步
  追加 .pending/<uuid>.md  frontmatter: { source, wrapup_id, hash }
  → 立即更新 MemoryIndex（本 session 可见的关键一步）
  → 不立即合并到 knowledge/ 主文件（留给 memory-sleep）
```

内存索引立即包含该条，但磁盘主文件推迟。这在性能（不阻塞主流程）和可见性（本 session 读得到）之间取得平衡。

### T3 Session 结束兜底

**触发**：Haro Channel session end

**流程**：
```
MemoryFabric.wrapupSession({ transcript })
  ↓
  提炼 → impressions/YYYY-MM-DD_<topic>.md
  → 触发一次轻量 memory-sleep（仅合并本 session 的 .pending）
  → 更新 index.md
```

作为保底，防止 T1/T2 遗漏关键信息。

## 本 Session 注入机制

aria-memory 依赖 Claude Code 的 SessionStart hook 注入 index.md 到 system prompt，因此本 session 新写入的条目**当前不可见**。Haro 自己 orchestrate 执行循环，**不依赖任何外部 hook**：

```typescript
// Agent Runtime（FEAT-005）每轮 query 前
const memCtx = await memoryFabric.contextFor({
  agentId,
  query: task,
  limit: 10,
})

const augmentedSystemPrompt = [
  agent.systemPrompt,
  '\n<memory-context>',
  ...memCtx.items.map(i => `- [${i.date}] ${i.summary} → ${i.source}`),
  '</memory-context>',
].join('\n')

await provider.query({ systemPrompt: augmentedSystemPrompt, ... })
```

`contextFor()` 走 v2 文件存储（FEAT-035），按 `agent:{id}` / `shared` / `platform`、验证状态和相关度排序；旧 Phase 0 写入路径仍维护 `MemoryIndex` 作为同 session fallback，保证 T1/T2 刚写入的条目立刻出现在下一轮的上下文里。

## 多端写入合并（`.pending/`）

**场景**：用户同时从飞书和 Telegram 与 Haro 对话，两个 Channel 的 Agent 并发调用 `deposit()` → `.pending/` 并发写。

**合并规则**（`memory-sleep` 执行）：

1. **去重**：按 `hash` 相同则只保留一份
2. **来源标注**：不同 `source` 的条目在合并后的 knowledge 文件里以 `## Source: X` 分段保留
3. **冲突保留**：同 `wrapup_id` 但 `hash` 不同 → 两份都保留，手工核对
4. **人工编辑保护**：若主文件 mtime > `.last-sleep-at`，不覆盖，merge 到末尾

这一机制完全照抄 aria-memory，确保 Haro 与 aria-memory 目录双向兼容。

## Dreaming（OpenClaw 风格，Phase 2+ 增强）

Phase 0 的 `memory-sleep` 只做"去重 + 合并 + 整理"。Phase 2+ 在其内部增加 **OpenClaw 风格的 Dreaming**：

```
每次 memory-sleep 内新增步骤：
  ↓
  采集 .pending/ 每条的使用证据
    （被查询命中次数 / 被 Agent 引用次数 / 被 eat 引用次数）
  ↓
  质量评分（content length / diversity / novelty / usage 权重）
  ↓
  高分晋升：.pending → knowledge/（长期记忆）
  低分归档：knowledge → archived/
  极低分：shit 候选
```

这是 [Evolution Engine](../evolution/self-improvement.md) 的底层代谢机制，与 eat/shit 和 Evolution Asset Registry 协同运作——防止记忆和资产无限膨胀。

设计细节待 Phase 2 独立 spec 展开。

## Phase 0 集成方式

Phase 0 采用**文件级直接操作**（最快实现）：

- Haro 直接读写记忆目录中的文件（`index.md`, `knowledge/*.md`）
- 通过预装的记忆类 skill（`remember` / `memory` / `memory-wrapup` / `memory-sleep` / `memory-status` / `memory-auto-maintain`）暴露给 Agent 调用
- 不做正式的库抽取（推迟到 Phase 1）

**Phase 1.5 v2 当前实现**（FEAT-035，2026-05-06）：核心包内已提供可 import 的 API、aria-memory 风格文件存储（散文件 + MEMORY.md 索引）、三级记忆、scope/verification/assetRef 维度、`searchMemoryFiles` 公开搜索、`runWrapup` / `runSleep` skill 钩子、`migrateFromV1` 迁移工具；SQLite memory_entries / memory_entries_fts 已下线。独立 npm 包抽取仍可作为后续发布形态，不是 FEAT-035 的 blocker。

## 与 eat / shit 代谢的关系

- **eat** 可以把外部内容沉淀为 Memory Fabric 中的知识文件
- **shit** 可以扫描 `~/.haro/memory/`，识别最近 N 天无人读取 / 过期标记的记忆并归档

详见 [Evolution 代谢机制规范](../../specs/evolution-metabolism.md)。

## 参考

- [Skills 子系统设计](./skills-system.md)
- [Evolution 代谢机制规范](../../specs/evolution-metabolism.md)
- [可插拔原则](../architecture/overview.md#设计原则)
