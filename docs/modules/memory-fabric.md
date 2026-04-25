# Memory Fabric 设计

## 概述

Memory Fabric 是 Haro 的记忆子系统。**核心设计目标是让 Haro 拥有独立的记忆能力**，不依赖任何外部系统就能完成记忆的写入、查询、索引、维护。

在具备独立能力的前提下，Memory Fabric 还兼容 [aria-memory](https://github.com/...) 的目录格式，用户可以把已有的 aria-memory 目录无缝挂载到 Haro 上继续使用。

## 设计原则

1. **独立能力优先**：Haro 单独运行时必须具备完整记忆功能
2. **格式兼容**：兼容 aria-memory 目录结构，降低迁移成本
3. **可配置外挂**：记忆目录、主备、后端实现均可通过配置切换（遵守 [可插拔原则](../architecture/overview.md#设计原则)）
4. **独立部署**：Memory Fabric 可以不启动完整 Haro 单独运行
5. **搜索优先**：Phase 1 查询路径必须有 SQLite FTS5 read model，不能只靠遍历 Markdown 文件
6. **分层和验证并重**：借鉴 Hermes 的 Session / Persistent / Skill memory，但所有写入都要带 Haro 自有的 scope、来源、置信度和验证状态

## Phase 1 v1 调整：三级记忆 + FTS5

Phase 0 的 Memory Fabric 已证明“本地文件 + aria-memory 兼容”可用。Phase 1 v1 的目标不是推翻该格式，而是在其上增加可查询、可审计、可验证的 read model。

| 层级 | 作用 | 生命周期 | 默认存储 | 典型写入者 |
|------|------|----------|----------|------------|
| Session memory | 当前对话/当前 workflow 的短期事实、约束、待办、checkpoint 旁路提示 | session/workflow 结束后可晋升或丢弃 | SQLite + session_events/raw refs | Agent Runtime / Channel / Router |
| Persistent memory | 跨会话事实、用户偏好、项目知识、平台决策 | 长期保留，可被 shit 归档 | Markdown canonical + SQLite FTS5 index | 用户 / Agent / eat / wrapup |
| Skill memory | 可复用解决模式、工具链经验、skill 使用结果和失败案例 | 跟随 skill/asset 版本演进 | `assets` 引用 + FTS5 index | eat / Skill subsystem / Pattern Miner |

Haro 在 Hermes 分层之上增加四类维度：

- **scope**：`platform` / `shared` / `agent:{id}` / `project:{path}`。
- **source**：用户输入、session event、eat proposal、skill run、workflow checkpoint、外部调研。
- **verificationStatus**：`unverified` / `verified` / `conflicted` / `rejected`。
- **assetRef**：可选地指向 Evolution Asset Registry 中的 skill、prompt、routing rule 或 eat/shit archive。

### FTS5 read model

Markdown 文件仍是兼容层和人工可读 canonical source；SQLite 是查询和统计 read model。

```sql
CREATE TABLE memory_entries (
  id TEXT PRIMARY KEY,
  layer TEXT NOT NULL,
  scope TEXT NOT NULL,
  agent_id TEXT,
  topic TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  content_path TEXT,
  content_hash TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  asset_ref TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  confidence REAL,
  tags TEXT NOT NULL DEFAULT '[]',
  verification_evidence_refs TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  archived_reason TEXT
);

CREATE VIRTUAL TABLE memory_entries_fts USING fts5(
  entry_id UNINDEXED,
  topic,
  summary,
  content,
  tokenize='unicode61'
);
```

实现说明：

- `MemoryFabric` 初始化时会确保 read model schema 存在；默认数据库为全局 `haro.db`（当 `root` 为 `.../memory`）或 memory root 下的 `.memory-fabric.sqlite`（测试/独立模式）。
- FTS5 表由 `memory_entries` 同步维护；中文查询会额外写入分词/bigram 搜索文本，避免 `unicode61` 对连续 CJK 文本召回不足。
- `content_hash + layer + scope` 幂等；同 `topic` 但不同 `content_hash` 的条目保留双方并标记为 `conflicted`。

查询路径：

1. 先按 scope 和 agentId 过滤候选。
2. FTS5 召回 topic / summary / content 命中项。
3. 按 layer、recency、confidence、usage、verificationStatus 排序。
4. 对 `conflicted` 或低置信度项降权；需要进入 system prompt 的内容必须有来源引用。

Phase 1 不引入向量数据库；sqlite-vec / LanceDB 留给 Phase 2+ 评估。

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

- `writeEntry(input)`：写入 `session | persistent | skill` 三层记忆。`persistent` 会保留 Markdown canonical source；`session` / `skill` 可以只存在于 SQLite read model。
- `queryEntries(query)`：必须走 SQLite/FTS5 read model，支持 keyword、scope(s)、agentId、layer、verificationStatus、assetRef、skillId、since、limit。
- `contextFor(query)`：用于 Agent prompt 注入，优先 verified；unverified/conflicted 条目带来源和不确定性提示；rejected/archived 默认不注入。
- `markVerification(id, status, evidenceRefs)`：记录 reviewer/owner evidence；platform/shared 条目标为 `verified` 时强制 D3 双门控（critic/reviewer evidence + user/owner confirmation）。
- `archiveEntry(id, reason)`：软归档，不删除 Markdown source。
- `stats()`：返回 Phase 0 文件统计 + v1 layer/scope/status 聚合。
- `rebuildIndex(options?)`：扫描现有 aria-memory 目录并幂等重建 `memory_entries` / FTS5。

以上能力均为 Haro 原生实现；"目录布局"层兼容 aria-memory，使用户已有目录可直接挂载。

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

`contextFor()` 优先查 SQLite/FTS5 read model，并按 `agent:{id}` / `shared` / `platform`、验证状态和相关度排序；旧 Phase 0 写入路径仍维护 `MemoryIndex` 作为同 session fallback，保证 T1/T2 刚写入的条目立刻出现在下一轮的上下文里。

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

**Phase 1 v1 当前实现**：核心包内已提供可 import 的 v1 API、FTS5 read model、三级记忆、scope/verification/assetRef 维度和 aria-memory rebuild；独立 npm 包抽取仍可作为后续发布形态，不是 FEAT-021 的 blocker。

## 与 eat / shit 代谢的关系

- **eat** 可以把外部内容沉淀为 Memory Fabric 中的知识文件
- **shit** 可以扫描 `~/.haro/memory/`，识别最近 N 天无人读取 / 过期标记的记忆并归档

详见 [Evolution 代谢机制规范](../../specs/evolution-metabolism.md)。

## 参考

- [Skills 子系统设计](./skills-system.md)
- [Evolution 代谢机制规范](../../specs/evolution-metabolism.md)
- [可插拔原则](../architecture/overview.md#设计原则)
