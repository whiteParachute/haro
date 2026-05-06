---
id: FEAT-035
title: Memory Fabric v2 — Aria-Memory 文件存储对齐
status: draft
phase: phase-1.5
owner: whiteParachute
created: 2026-05-06
updated: 2026-05-06
related:
  - ../phase-0/FEAT-007-memory-fabric-independent.md
  - ../phase-1/FEAT-021-memory-fabric-v1.md
  - ../phase-1.5/FEAT-031-web-channel.md
  - ../phase-1.5/FEAT-032-mcp-tool-layer.md
  - ../../docs/modules/memory-fabric.md
  - ../../docs/data-directory.md
---

# Memory Fabric v2 — Aria-Memory 文件存储对齐

## 1. Context / 背景

FEAT-021 Memory Fabric v1 已交付（Phase 1，2026-04-25 done）：三层 layer（session / persistent / skill）+ scope（platform / shared / agent / project）+ SQLite `memory_entries` 与 `memory_entries_fts` read model + aria-memory 目录兼容写入。这套设计满足 Phase 1 多 Agent 编排和 Dashboard KnowledgePage 的需求，但实际使用中暴露两个问题：

1. **存储模型与 owner 日常使用的 aria-memory 不一致**。owner 在 Claude Code / Codex / OpenClaw 等多个 runtime 都使用 aria-memory 风格的"MEMORY.md 索引 + 散 Markdown 文件"模型。Haro 当前的 SQLite read model 是只读派生层，但 v1 的"以 SQLite 为查询入口"在 owner 心智里是"另一套记忆系统"，造成认知割裂。
2. **FEAT-031 Web Channel D4 需要"文件存储内的搜索"作为历史检索后端**。如果继续用 FTS5 read model，Web Channel 与 owner 直接维护的 aria-memory 目录之间就要再做一层映射；改为统一的 aria-memory 文件搜索可以一刀解决。

owner 决策（FEAT-031 spec D4）：Memory Fabric 整体逻辑照搬 aria-memory，相关的搜索也就变成了文件存储内的搜索。本 spec 承担该改造。

## 2. Goals / 目标

- G1: 把 Memory Fabric 持久化层切换为 aria-memory 风格的纯文件存储（MEMORY.md 索引 + 类型化散 Markdown 文件），删除 SQLite `memory_entries` / `memory_entries_fts` 作为权威读模型。
- G2: 保留 v1 公开 API 形态（`writeEntry / queryEntries / contextFor / markVerification / archiveEntry / stats`），调用方语义尽量不变；底层换实现。
- G3: 提供 aria-memory 一致的"类型化条目"：`user` / `feedback` / `project` / `reference`，落到 v1 既有的 layer/scope 维度上；保留 sourceRef / contentHash / verificationStatus / confidence / assetRef 字段。
- G4: 提供 `searchMemoryFiles(query, scope, opts)` 接口，支持 Web Channel（FEAT-031）和 MCP `memory_query` 工具（FEAT-032）调用。搜索语义对齐 aria-memory：先扫 MEMORY.md，再按命中条目读散文件，不引入额外索引引擎。
- G5: 提供从 v1（SQLite + 现有 aria-memory 目录混合）到 v2（纯文件存储）的迁移工具，幂等，可重跑。
- G6: 维护职责（wrapup / global_sleep / auto-maintain）与 `aria-memory:*` skill 体系对齐，复用既有触发条件和阈值，不在 Haro 内重起一套。

## 3. Non-Goals / 不做的事

- 不引入向量数据库、embedding、sqlite-vec、外部搜索引擎；搜索就是文件 grep + 索引文件解析。
- 不改变 v1 的 layer / scope 维度命名和语义（仅改底层存储）。
- 不为 Dashboard / Web API 端引入新的权威读路径；Dashboard 仍走 Memory Fabric API（不直接读文件，对齐 FEAT-021 R11）。
- 不实现 Phase 2 的 Dreaming / consolidation 自动晋升。
- 不在本 spec 内实现 FEAT-031 Web Channel 的历史搜索 UI；只提供 API 接口。
- 不退化 conflicted / verificationStatus 这套对抗性验证语义；这部分在文件 frontmatter 里继续承载。

## 4. Requirements / 需求项

- R1: 持久化目录采用 `~/.haro/memory/<scope>/` 文件结构，例如：
  - `~/.haro/memory/platform/MEMORY.md` + `~/.haro/memory/platform/<entry>.md`
  - `~/.haro/memory/agent/<agent-id>/MEMORY.md` + 散文件
  - `~/.haro/memory/project/<pathHash>/MEMORY.md` + 散文件
  - `~/.haro/memory/session/<session-id>/MEMORY.md` + 散文件
- R2: 每个散 Markdown 文件包含 frontmatter，必须字段：`id` / `name` / `description` / `type`（user/feedback/project/reference）/ `layer`（session/persistent/skill）/ `scope` / `sourceRef` / `contentHash` / `verificationStatus`，可选字段：`agentId` / `confidence` / `assetRef` / `topic`。
- R3: MEMORY.md 必须为人类可读的索引，每个条目格式：`- [Title](file.md) — one-line hook`，文件长度上限对齐 aria-memory 既有约束（200 行以内 hard limit；超出时由 sleep 机制重组）。
- R4: 公开 API 必须保留 v1 全部签名：`writeEntry / queryEntries / contextFor / markVerification / archiveEntry / stats`；底层从 SQLite 改为文件读写后，行为差异必须在 Changelog 中明确列出。
- R5: 新增 `searchMemoryFiles(query, scope, opts)`：先解析对应 scope 的 MEMORY.md 提取候选文件，再对候选文件做 case-insensitive grep + frontmatter 匹配；支持 `limit / since / type / verificationStatus` 过滤；返回结构化 `MemoryEntry[]`，不返回原始文件路径。
- R6: 写入流程必须保证 MEMORY.md 与散文件最终一致：先写散文件 → 再原子更新 MEMORY.md（tmp + rename）；中途崩溃时下次启动通过 `repair()` 扫描散文件重建 MEMORY.md。
- R7: `repair()` / `migrate()` 工具必须幂等：对已经是 v2 形态的目录无副作用；对 v1 SQLite + 部分 aria-memory 目录的混合形态可一键收敛到 v2。
- R8: 删除 v1 的 `memory_entries` / `memory_entries_fts` 表；`stats()` 内的"FTS 索引大小 / 重建时间"指标改为"散文件数 / MEMORY.md 行数 / 上次 sleep 时间"。
- R9: Memory Fabric API 调用方（FEAT-018 KnowledgePage、FEAT-022 Asset Registry、FEAT-024 Knowledge Dashboard、FEAT-031 Web Channel、FEAT-032 MCP `memory_query`）的契约不变，所有 SQLite 强相关代码（如直接 join FTS 表）必须重写为调用 `searchMemoryFiles` 或 `queryEntries`。
- R10: 维护任务对接 `aria-memory:*` skill 体系：`memory-wrapup` / `memory-sleep` / `memory-auto-maintain` 在 Haro 内由 Memory Fabric 暴露 `runWrapup() / runSleep()` 钩子，被 skill 调用；不在 Haro 内重写 sleep / wrapup 逻辑。
- R11: 性能基线：单 scope 散文件 ≤ 1000 个时，`searchMemoryFiles` 返回 P50 < 100ms / P99 < 300ms；超过时通过 sleep 机制压缩，不通过引入索引引擎来"扛"。
- R12: 必须支持只读模式：当 owner 用 `aria-memory` skill 在 Haro 外修改文件后，下次 Haro 启动 / `repair()` 时自动 reconcile 而不报错或丢条目。

## 5. Design / 设计要点

### 5.1 目录结构

```
~/.haro/memory/
├── platform/
│   ├── MEMORY.md
│   └── <slug>.md          # 平台级共享记忆
├── shared/
│   ├── MEMORY.md
│   └── <slug>.md          # 跨 agent 共享
├── agent/
│   └── <agent-id>/
│       ├── MEMORY.md
│       └── <slug>.md
├── project/
│   └── <pathHash>/
│       ├── MEMORY.md
│       └── <slug>.md
└── session/
    └── <session-id>/
        ├── MEMORY.md
        └── <slug>.md
```

### 5.2 散文件 frontmatter（示例）

```markdown
---
id: mem_2026-05-06_haro-feat031-d4
name: FEAT-031 Web Channel D4 决策
description: D4 历史搜索走 Memory Fabric aria-memory 风格文件搜索，不再 FTS5
type: project
layer: persistent
scope: project:haro
sourceRef:
  - specs/phase-1.5/FEAT-031-web-channel.md#8
contentHash: sha256:...
verificationStatus: verified
confidence: high
agentId: null
topic: web-channel-history-search
---

owner 在 FEAT-031 spec OQ 收敛阶段确认：Memory Fabric 整体照搬 aria-memory；
Web Channel 历史搜索 = 文件存储内搜索，不引 FTS5。
```

### 5.3 MEMORY.md 索引（示例）

```markdown
# Haro Project Memory Index

## Active Topics
- [FEAT-031 D4 历史搜索](feat031-d4.md) — 走 Memory Fabric aria-memory 风格搜索，不引 FTS5
- [FEAT-035 v2 切换](feat035-v2.md) — 删除 SQLite/FTS5，改纯文件存储

## User
- [Owner 偏好：保留多 channel 抽象](owner-keep-abstractions.md) — 自用单人但保留扩展点
```

### 5.4 搜索算法（伪代码）

```ts
async function searchMemoryFiles(query, scope, opts = {}) {
  const memoryMd = await readMemoryIndex(scope);
  const candidates = parseIndexEntries(memoryMd);  // → [{title, file, hook}]
  const matches = [];
  for (const c of candidates) {
    if (quickHookMatch(c.hook, query)) matches.push(c);
  }
  for (const c of candidates) {
    if (matches.includes(c)) continue;
    const entry = await readEntryFile(scope, c.file);
    if (frontmatterMatch(entry.frontmatter, query, opts) ||
        bodyGrep(entry.body, query)) {
      matches.push(c);
    }
  }
  return matches.slice(0, opts.limit ?? 50).map(toMemoryEntry);
}
```

### 5.5 v1 → v2 迁移

`haro memory migrate --from v1`：

1. 锁住 Memory Fabric 写路径（迁移期间 read-only）。
2. 从 v1 SQLite `memory_entries` 全量扫描，每条生成对应散文件（frontmatter + body）。
3. 按 scope 重建 MEMORY.md（每条目一行索引 + 一句 hook）。
4. 重命名 v1 SQLite 文件为 `memory_v1.sqlite.bak`（保留 30 天兜底）。
5. 解锁。
6. 完成后跑 `repair()` 校验。

### 5.6 与 Aria-Memory Skill 协作

- Haro 内 Memory Fabric 暴露 `runWrapup(sessionId)` 与 `runSleep(scope)`，但不实现具体压缩 / 拆分逻辑。
- `aria-memory:memory-wrapup` 与 `aria-memory:memory-sleep` skill 调用上述钩子。
- `aria-memory:memory-auto-maintain` 通过 `/loop` 周期触发；Haro 不自己排程。
- 这一段对应 FEAT-021 R6 的 SQLite read model 维护逻辑被整体替换。

## 6. Acceptance Criteria / 验收标准

- AC1: `~/.haro/memory/<scope>/MEMORY.md` 存在且与对应散文件目录最终一致；`repair()` 重跑无变更（对应 R6、R7）。
- AC2: `searchMemoryFiles("FEAT-031", "project:haro")` 命中 D4 决策记录，返回值包含 frontmatter 全部必须字段（对应 R5、R2）。
- AC3: v1 → v2 迁移工具对包含 N 条 SQLite 记忆 + 已存在 aria-memory 目录的混合环境，迁移后散文件数 = N，MEMORY.md 索引行数 = N，无丢条目；重跑迁移幂等（对应 R7、G5）。
- AC4: 删除 v1 SQLite 表后，FEAT-018 KnowledgePage / FEAT-022 / FEAT-024 / FEAT-031 / FEAT-032 调用 Memory Fabric API 全部通过既有契约返回数据（对应 R9）。
- AC5: 性能基线测试：1000 条散文件、单 query "session" 关键词，P99 < 300ms（对应 R11）。
- AC6: owner 用 `aria-memory:remember` skill 在 Haro 外写入新条目后，下次 `haro memory query` 能查到，且 MEMORY.md 经过一次 `repair()` 后包含该条目（对应 R12）。
- AC7: `aria-memory:memory-wrapup` 调用 Haro 暴露的 `runWrapup` 钩子，session 散文件被压缩进 persistent scope，不重复，且 verificationStatus 字段被保留（对应 R10）。

## 7. Test Plan / 测试计划

- 单元测试：MEMORY.md 解析 / 写入原子性 / frontmatter 校验 / 散文件 grep / 迁移幂等。
- 集成测试：FEAT-018 / FEAT-022 / FEAT-024 / FEAT-031 / FEAT-032 各自调用 Memory Fabric API 的回归套件全部通过。
- 性能测试：构造 100 / 500 / 1000 / 5000 散文件四档，跑 P50 / P99 搜索延迟。
- 端到端：与 `aria-memory:remember` / `memory-wrapup` / `memory-sleep` skill 协同测试，覆盖 wrapup / sleep / repair 三个 lifecycle。
- 回滚测试：v1 → v2 迁移后保留 30 天 .bak，`haro memory rollback --to v1` 可恢复（对应 R7 兜底）。

## 8. Resolved Decisions / 已决议

- D1（搜索后端）：不引入向量 / FTS / 外部搜索；纯文件 grep + MEMORY.md 索引。
- D2（v1 兼容）：API 形态保留，SQLite 后端整体删除（保留 30 天 .bak），不做长期双写。
- D3（aria-memory skill 协作）：Haro 暴露 hook，skill 体系负责具体维护逻辑，避免在 Haro 内重写。
- D4（性能上限）：单 scope 散文件 ≤ 1000；超过时由 sleep 机制压缩，不引入索引引擎。
- D5（原 Q1，索引行字段）：MEMORY.md 索引行只保留极简 `- [Title](file.md) — one-line hook`。`assetRef` / `confidence` / `verificationStatus` 等元数据**只**写散文件 frontmatter，索引行不冗余携带；让 MEMORY.md 保持高密度可扫的全人类视图。
- D6（原 Q2，低层批量读 API）：**不开放**直接读散文件 / 列目录的低层 API。Phase 2.0 Self-Monitor / Pattern Miner 等下游消费方一律走 `queryEntries / searchMemoryFiles`；防止回退到"绕过 Memory Fabric API 直接 fs 读"的反模式。
- D7（原 Q3，session → persistent wrapup）：是，由 `aria-memory:memory-wrapup` 自动接管。"先暂存 session/、wrapup 后合并到 persistent/" 的两阶段细节**对齐 aria-memory 当前做法**，不在 Haro 内重新设计；Haro 只暴露 `runWrapup(sessionId)` 钩子和"读散文件 → 合并 → 写新散文件 → 删旧散文件"的原子语义，具体策略归 skill。

## 9. Changelog / 变更记录

- 2026-05-06: whiteParachute — 初稿；从 FEAT-031 D4 决策衍生，定位为 Memory Fabric v2，承担 SQLite/FTS5 → aria-memory 文件存储的整体切换。
- 2026-05-06: whiteParachute — 收敛 Open Questions Q1–Q3 为 D5–D7（owner 决策：MEMORY.md 索引保持极简 / 不开低层批量读 API / wrapup 对齐 aria-memory 既有两阶段做法）。
- 2026-05-06: whiteParachute — 实现交付 + Codex 对抗性评审修复批次 1：`MemoryFileStore` + `searchMemoryFiles` + `runWrapup` / `runSleep` + `migrateFromV1`（scope 白名单 + 忽略 v1 `content_path` + .bak 幂等）+ `syncFrontmatter` 保留非规范字段（wrapup_id/hash/topic_slug）+ maintenance 冷启动 `loadScope` + `impressions/archived/` 目录默认过滤 + 同路径冲突检测仅淘汰 sparse hydration。状态：status 仍 `draft`，待落地后续调用方对接（FEAT-031 / FEAT-032 集成）后改 `done`。
