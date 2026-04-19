---
id: FEAT-007
title: Memory Fabric 独立能力（aria-memory 兼容 + 三层即时写 + 本 session 注入）
status: done
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-18
related:
  - ../../docs/modules/memory-fabric.md
  - ./FEAT-010-skills-subsystem.md
  - ./FEAT-005-single-agent-execution-loop.md
  - ../../roadmap/phases.md#p0-7memory-fabric-独立能力
---

# Memory Fabric 独立能力

## 1. Context / 背景

Haro 的记忆原型**基本照抄 aria-memory**：同样的三层目录（index.md / impressions / knowledge）、同样的多端写入合并机制（`.pending/`）、同样的 Obsidian wikilink 格式。

与 aria-memory 的**关键差异**：aria-memory 依赖 Claude Code 的 SessionStart hook 注入记忆到 system prompt，因此"本次 session 写入的内容下次 session 才可见"。Haro 自己 orchestrate 执行循环，可以做得更好——**写入即时可见**：同一 session 内前面 turn 写入的记忆，后面 turn 立刻能读到。

本 spec 交付 Phase 0 的 Memory Fabric 独立能力，作为 FEAT-005（Runner）、FEAT-010（Skills）、FEAT-011（eat/shit）的共同底座。

## 2. Goals / 目标

- G1: 原生读写 `~/.haro/memory/`（index.md / impressions/ / knowledge/），不依赖任何外部库
- G2: 目录格式与 aria-memory 完全兼容，用户可把已有 aria-memory 目录直接指给 Haro
- G3: 实现**三层即时写**（显式 / 事件驱动 / session 结束兜底），**本 session 内立即可见**
- G4: 多端写入合并沿用 aria-memory `.pending/` 幂等键机制
- G5: 提供 `MemoryFabric` 类供 FEAT-005 / FEAT-010 / FEAT-011 调用

## 3. Non-Goals / 不做的事

- 不做正式库抽取（`@haro/memory-fabric` 独立 npm 包推迟到 Phase 1）
- 不做 Phase 0 默认启用主备（主备作为可选配置存在但不强制测试）
- 不做 shared/ 共享记忆的跨 Agent 访问（Phase 1）
- 不做向量检索 / 语义检索（Phase 2，届时对标 OpenClaw 的 hybrid 模式）
- 不做 OpenClaw 式的 "Dreaming" 自动 consolidation（Phase 2+，在 memory-sleep 内增强）

## 4. Requirements / 需求项

### 查询（R1–R2）

- R1: 查询策略分三层级联（照抄 aria-memory）：
  1. 读 `index.md`（随身索引，~200 条上限）做关键词匹配
  2. `impressions/YYYY-MM-DD_*.md` Grep 正则
  3. `knowledge/*.md` Grep 正则
  4. 未命中时扩展到 `impressions/archived/`
- R2: 查询 API：`MemoryFabric.query({ scope, agentId?, query, limit? })`，返回匹配的知识 + 来源文件 + 日期；查询结果必须**立即包含本 session 刚写入的内容**（无缓存延迟）

### 写入（R3–R6）

- R3: 三层写入时机：
  - **T1 显式写（同步即时）**：`MemoryFabric.write()`，用户显式触发（`remember` skill）或 agent 主动沉淀；原子写 `knowledge/*.md` + 更新 `index.md` + 立即提交到内存索引
  - **T2 事件驱动写（异步即时）**：`MemoryFabric.deposit()`，agent 在 reasoning 中识别"值得记住的模式"；追加到 `.pending/<uuid>.md`（幂等键 `{source, wrapup_id, hash}`）+ 立即更新内存索引（但不立即合并到主文件）
  - **T3 session 结束兜底**：`MemoryFabric.wrapupSession()`，把完整 transcript 提炼为一个 impression 写到 `impressions/YYYY-MM-DD_<topic>.md`；无论 T1/T2 是否写过都执行，防止遗漏
- R4: **本 session 注入**：`MemoryFabric` 维护一个内存 `MemoryIndex`（索引 + 热数据），T1/T2 写入后立即更新它；Agent Runtime 每轮 query 前调用 `MemoryFabric.contextFor({ agentId, query })` 取 top-N 条近期相关记忆，作为 systemPrompt 前缀
- R5: **多端写入合并**：`.pending/` 下的幂等键 = `{source, wrapup_id, hash}`；`memory-sleep` 扫 `.pending` 时按 hash 去重、按 source 合并、冲突时保留多方（沿用 aria-memory 逻辑）
- R6: 写入使用**应用层 Promise-chain 串行化** + 临时文件 `rename()` 原子替换（无 OS file lock），保证单进程内并发写安全

### 维护（R7–R8）

- R7: `MemoryFabric.maintenance()` 手动触发，对应 `memory-sleep` skill；**照抄 aria-memory global_sleep 12 步**：备份 → 合并 pending → 压缩 index → 重建 index → 过期清理 → 拆分合并 knowledge → 更新 personality → 更新 meta → 更新 `.last-sleep-at` → 生成 daily → 追加 changelog
- R8: `MemoryFabric.stats()` 返回记忆数量、分布、最后维护时间（供 `memory-status` skill）

### 兼容与边界（R9–R12）

- R9: 配置 `memory.path` 支持指向已有 aria-memory 目录；读写时**不破坏** aria-memory 其他子目录（如 `impressions/archived/`、`personality.md`）
- R10: 主备配置（兼容选项）：写主同步 + 写备异步；读先主后备；维护仅主执行
- R11: Memory Fabric 对外仅暴露 API；上层（Runner / Skills）不得直接 `fs.readFile` 访问记忆目录
- R12: 预装记忆 skill（6 个，FEAT-010 交付）内部调用本 spec 的 API

## 5. Design / 设计要点

### 5.1 目录结构（照抄 aria-memory）

```
~/.haro/memory/
├── platform/
│   ├── index.md                    # 200 条 Obsidian wikilink 索引
│   ├── impressions/
│   │   ├── 2026-04-18_<topic>.md   # 按日期+主题
│   │   └── archived/               # > 6 个月移入
│   ├── knowledge/
│   │   ├── <domain>.md             # 按领域
│   │   └── .pending/               # 多端写入临时区
│   │       └── <uuid>.md           # 带幂等键 frontmatter
│   ├── personality.md              # 用户交互风格
│   ├── meta.json                   # lastGlobalSleepAt / indexVersion / 计数
│   ├── .last-sleep-at              # Git 跟踪的水位戳
│   └── changelog.md
├── agents/{id}/                    # 结构同 platform/
└── shared/                         # Phase 1
```

### 5.2 三层写入时序

```
T1 显式写（用户说"记住这个" / agent 学到关键事实）
  ↓ 同步
  原子写 knowledge/<file>.md
  → 更新 index.md（Promise-chain 串行化）
  → 更新 MemoryIndex（内存）
  → 返回给调用方

T2 事件驱动写（agent reasoning 中自动沉淀）
  ↓ 异步
  追加 .pending/<uuid>.md  { source, wrapup_id, hash, content }
  → 更新 MemoryIndex（内存）← 本 session 可见的关键一步
  → 不立即合并到 knowledge/ 主文件（留给 memory-sleep）

T3 session 结束兜底
  ↓
  提炼 transcript → impressions/YYYY-MM-DD_<topic>.md
  → 更新 index.md
  → 触发一次轻量 memory-sleep（仅合并本 session 产生的 .pending）
```

### 5.3 本 Session 注入机制

aria-memory 的注入在 Claude Code SessionStart hook 做，因此"本 session 写入 → 本 session 不可见"。Haro 因为自己 orchestrate 执行循环，**在 Agent Runtime 的每轮 query 前主动读 MemoryFabric**：

```typescript
// FEAT-005 Runner 每轮循环前
const ctx = await memoryFabric.contextFor({ agentId, query: task })
const augmentedSystemPrompt = [
  agent.systemPrompt,
  '\n\n<memory-context>\n',
  ctx.items.map(i => `- [${i.date}] ${i.summary} → ${i.source}`).join('\n'),
  '\n</memory-context>'
].join('')
```

`contextFor()` 直接查 `MemoryIndex`（内存结构），零 IO 延迟，**保证 T1/T2 刚写入的条目立刻可见**。

### 5.4 多端写入合并（从 aria-memory 照抄）

场景：同一用户从飞书和 Telegram 同时与 Haro 交互，两个 Channel 的 Agent 都要写记忆 → `.pending/` 并发写。

合并规则（`memory-sleep` 执行）：

1. 按 `hash` 去重（完全相同的内容只保留一份）
2. 按 `source` 标注（`sg-feishu` / `sg-telegram` / …）
3. 冲突时（同一 wrapup_id 但 hash 不同）→ 保留两条并在 `knowledge/<file>.md` 内以 `## Source: X` / `## Source: Y` 分段
4. 若主文件在两次 sleep 之间被人工编辑（mtime 晚于 last-sleep-at），不覆盖，merge 到末尾

### 5.5 Dreaming（OpenClaw 风格，Phase 2+ 增强）

Phase 0 的 `memory-sleep` 只做"去重 + 合并 + 整理"；Phase 2+ 在其内部增加 OpenClaw 风格的 **Dreaming** 短→长期晋升：

- 采集 `.pending/` 每条的使用证据（该内容被查询命中次数 / 被 agent 引用次数）
- 质量评分（content length / diversity / novelty）
- 高分条目晋升为长期 knowledge；低分归档或丢弃
- 这是 [Evolution Engine](../../docs/evolution/self-improvement.md) 的一部分，与 eat/shit 代谢机制协同

Phase 2+ 设计细节另立 spec。

## 6. Acceptance Criteria / 验收标准

### 查询与写入

- AC1: 调用 `memoryFabric.write({ scope: 'agent', agentId: 'x', content })` 后，同一进程内**下一次 query** 立刻返回该条（对应 R2、R3 T1、R4）
- AC2: 调用 `memoryFabric.deposit({ ... })` 后，`.pending/` 下出现对应 uuid 文件；**同一进程内 query 立即命中**（通过 MemoryIndex 查到，即使主文件未合并）（对应 R3 T2、R4）
- AC3: `memoryFabric.query({ query: 'foo' })` 按"index → impressions → knowledge → archived"层级返回，每条带来源文件和日期（对应 R1）

### 本 Session 注入

- AC4: FEAT-005 Runner 在同一 session 内跑两次 run：第一次写入"用户偏爱简洁回答"→ 第二次 run 的 systemPrompt 包含该条（对应 R4）

### 多端合并

- AC5: 同时从两个 Channel（模拟飞书 + Telegram） deposit 不同内容但相同 wrapup_id；`memory-sleep` 后 knowledge 文件内既保留两份内容又按 source 分段（对应 R5）
- AC6: deposit 两条完全相同的内容（同 hash），`memory-sleep` 后只保留一份（对应 R5）

### 维护

- AC7: `maintenance()` 执行 12 步完整流程，幂等（连跑两次第二次无变化）（对应 R7）
- AC8: `.last-sleep-at` 在维护后更新；`meta.json` 的 `lastGlobalSleepAt` 同步（对应 R7）

### 兼容与边界

- AC9: 配置 `memory.path: /tmp/existing-aria` 指向预置 aria-memory fixture；Haro 读写后原有 `personality.md`、`changelog.md` 等未被破坏（对应 R9）
- AC10: 主备配置下，T1 写入后备路径在 1s 内同步出现该文件（对应 R10）
- AC11: 运行 `grep -rE "fs\\.(write|read)File.*\\.haro/memory" packages/{core,cli,providers} --include='*.ts'` 返回 0 行（除 Memory Fabric 自身）（对应 R11）

## 7. Test Plan / 测试计划

- 单元测试：
  - `memory-fabric.write.test.ts` — T1 即时写 + MemoryIndex 更新（AC1）
  - `memory-fabric.deposit.test.ts` — T2 pending + 内存索引（AC2）
  - `memory-fabric.query.test.ts` — 层级级联查询（AC3）
  - `context-for.test.ts` — 本 session 注入（AC4）
  - `merge-pending.test.ts` — 多端合并 + 幂等（AC5、AC6）
  - `maintenance.test.ts` — 12 步流程 + 幂等（AC7、AC8）
  - `primary-backup.test.ts` — 主备同步（AC10）
- 集成测试：
  - `aria-compat.test.ts` — 预置 aria-memory fixture（AC9）
  - `api-boundary.test.ts` — 源码扫描（AC11）
  - `same-session-visibility.e2e.test.ts` — 端到端验证"写入后同 session 可见"（AC4）
- 手动验证：
  - AC10 主备（用两个本地目录替代 NAS）

## 8. Open Questions / 待定问题

全部已关闭（见 Changelog 2026-04-18 决策条）。

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
- 2026-04-18: whiteParachute — 大幅重写 → approved
  - Q1 查询语义 → 照抄 aria-memory 三层级联（index → impressions → knowledge → archived）；FTS5 作为加速层留到 Phase 1，向量留到 Phase 2（对标 OpenClaw hybrid）
  - Q2 维护 → 完整照抄 aria-memory global_sleep 12 步；Phase 2+ 增强 OpenClaw 风格 Dreaming（短→长期晋升 + 质量评分 + 适配多端写入合并）
  - Q3 并发 → Promise-chain 串行化 + 原子 rename（单进程场景无需 OS file lock；与 OpenClaw 一致）
  - Q4 写入时机 → **重新设计**为三层即时写（T1 显式同步 + T2 事件异步 + T3 session 兜底）+ 本 session 立即可见（通过 Agent Runtime 每轮 query 前主动读 MemoryFabric，不依赖外部 hook）
- 2026-04-18: whiteParachute — 实现完成 → done
  - `@haro/core` 新增 memory/ 模块：MemoryFabric + MemoryIndex + SerialWriter + 原子 rename
  - 三层即时写全部通过 MemoryIndex 保持本 session 可见；pending 文件带 `topic_slug` frontmatter 供 merge 精确分组（codex 评审修复 prefix 别名）
  - maintenance() 按序执行 aria-memory 12 步并写出 `.last-sleep-at`/`meta.json`；幂等
  - 主备镜像从 SerialWriter 临界区抽离，提供 `drainBackups()` 供测试/shutdown 精确等待（codex 评审修复同步阻塞）
  - deterministicUuid 改为 sha256 完整摘要（codex 评审修复 16 字节前缀碰撞）
  - 11 单测 + 1 边界扫描测试覆盖 AC1..AC11 全绿
