---
id: FEAT-007
title: Memory Fabric 独立能力（原生读写 + aria-memory 目录兼容）
status: draft
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-18
related:
  - ../../docs/modules/memory-fabric.md
  - ./FEAT-010-skills-subsystem.md
  - ../../roadmap/phases.md#p0-7memory-fabric-独立能力
---

# Memory Fabric 独立能力

## 1. Context / 背景

Haro 的记忆设计原则：**先具备独立记忆能力**，再兼容 aria-memory。Phase 0 采用文件级直接操作，不做正式的库抽取（留到 Phase 1）。本 spec 交付最小可用的记忆读写 + 目录结构 + 与 FEAT-010 的 skill 集成点（`memory-wrapup` 在 session 结束时触发写入）。主备配置作为兼容性选项但不是 Phase 0 默认。

## 2. Goals / 目标

- G1: 原生读写 `~/.haro/memory/` 下的 `index.md` + `knowledge/*.md`，不依赖任何外部库
- G2: 目录格式与 aria-memory 完全兼容，用户可把已有 aria-memory 目录直接指给 Haro 使用
- G3: 提供 `MemoryFabric` 类供 FEAT-005 / FEAT-010 调用

## 3. Non-Goals / 不做的事

- 不做正式库抽取（`@haro/memory-fabric` 独立 npm 包推迟到 Phase 1）
- 不做 Phase 0 默认启用主备（主备作为可选配置存在但不强制测试）
- 不做 shared/ 共享记忆的跨 Agent 访问（Phase 1）
- 不做记忆的全文检索（Phase 1，当前仅 index.md 入口查询）
- 不做向量索引（Phase 2+）

## 4. Requirements / 需求项

- R1: `MemoryFabric.write({ scope, agentId?, category, content })`，scope ∈ {`platform`,`agent`,`shared`}；自动维护 `index.md`
- R2: `MemoryFabric.read({ scope, agentId?, query })`，返回匹配的 knowledge 文件列表（按主题/标签，非全文）
- R3: `MemoryFabric.appendSession({ agentId, session })`，将 session 要点写入 `agents/{agentId}/knowledge/session-<yyyymm>.md`（按月归档）
- R4: 目录结构严格按 [memory-fabric.md](../../docs/modules/memory-fabric.md) 的布局创建：`platform/`、`agents/{id}/`、`shared/`
- R5: 兼容已有 aria-memory 目录 — `memory.path` 可配置为非默认路径；读写使用相同 index.md + knowledge 格式
- R6: 提供"主备"可选配置（schema 支持，但 Phase 0 默认单路径）；有备用路径时写主 + 异步写备
- R7: Memory Fabric 对外不暴露具体实现细节（文件系统层为内部）；上层（Runner / Skills）只通过 `MemoryFabric` 类调用
- R8: 预装记忆 skill（remember / memory / memory-wrapup / memory-sleep / memory-status / memory-auto-maintain，FEAT-010 交付）内部调用本 spec 的 API

## 5. Design / 设计要点

**API**

```typescript
interface MemoryFabric {
  write(req: WriteRequest): Promise<string /* 写入路径 */>
  read(req: ReadRequest): Promise<KnowledgeFile[]>
  appendSession(req: AppendSessionRequest): Promise<void>
  stats(): Promise<MemoryStats>   // 供 memory-status
  maintenance(): Promise<MaintenanceReport>   // 供 memory-sleep
}
```

**index.md 维护**

每次 write 后追加/更新 `index.md` 的相应段落，格式沿用 aria-memory：

```markdown
# <scope-name> Index

## Knowledge

- [session-202604.md](knowledge/session-202604.md) — <摘要>
- [common-bugs.md](knowledge/common-bugs.md) — <摘要>

Last maintained: 2026-04-18T10:00:00Z
```

**兼容 aria-memory**

- 不修改 aria-memory 目录内的其他文件（`impressions/` 等）
- 写入时遵守 aria-memory 的 frontmatter 约定（`title / tags / created / updated`）
- `memory-sleep` 的具体维护语义沿用 aria-memory（不另发明）

**主备（兼容选项）**

```yaml
memory:
  primary:
    path: ~/.haro/memory
    globalSleep: true
  backup:
    path: /mnt/nas/haro-memory-backup
    globalSleep: false
```

- 写入：主同步、备异步（fire-and-forget + 日志）
- 读取：先主后备（主失败才读备）
- 维护（`memory-sleep`）：仅主执行

## 6. Acceptance Criteria / 验收标准

- AC1: 调用 `memoryFabric.write({ scope: 'agent', agentId: 'x', category: 'knowledge', content })`，`~/.haro/memory/agents/x/knowledge/<file>.md` 被创建，`index.md` 新增对应条目（对应 R1、R4）
- AC2: `memoryFabric.read({ scope: 'agent', agentId: 'x', query: { tag: 'foo' } })` 返回带 `tag: foo` 的文件列表（对应 R2）
- AC3: 配置 `memory.path: /tmp/existing-aria` 指向已有 aria-memory 目录，Haro 读/写后原有文件未被破坏（对应 R5）
- AC4: 配置主备路径，写入一条记忆 → 主路径立刻可见；备路径在 1s 内也出现该文件（对应 R6）
- AC5: 运行 `grep -rE "fs\.(write|read)File.*\\.haro/memory" packages/{core,cli,providers} --include="*.ts"` 返回 0 行（除 Memory Fabric 自身实现），即所有上层必须走 API（对应 R7）
- AC6: 调用 `stats()` 返回记忆数量、分布、最后维护时间的结构化数据（对应 `memory-status` skill 的来源）
- AC7: FEAT-005 的 Runner 在 session 结束时调用 `memoryFabric.appendSession`，对应月份 knowledge 文件新增一行条目（对应 R3、R8）

## 7. Test Plan / 测试计划

- 单元测试：
  - `memory-fabric.write.test.ts` — 各 scope 的写入 + index.md 更新（AC1）
  - `memory-fabric.read.test.ts` — tag/topic 查询（AC2）
  - `append-session.test.ts` — 月份归档命名 + 内容（AC7）
  - `primary-backup.test.ts` — 主备写入时序（AC4）
- 集成测试：
  - `aria-compat.test.ts` — 用一个预置 aria-memory fixture 目录（AC3）
  - `api-boundary.test.ts` — 扫描源码确保上层不绕过 API（AC5）
- 手动验证：
  - AC4 主备（需要 NAS 环境，否则用两个本地目录替代）

## 8. Open Questions / 待定问题

- Q1: `query` 参数的语义（tag / topic / fuzzy）Phase 0 只支持 tag 精确匹配是否够用？
- Q2: `maintenance()` 与 aria-memory 的 `global_sleep` 如何对齐？是直接 shell out 调用，还是自己实现？建议 Phase 0 先简单合并重复条目 + 更新时间戳
- Q3: 跨进程并发写入 `index.md` 的冲突？文件锁？flock？
- Q4: `memory-wrapup` skill 的粒度：每 session 一次还是按 N 次 batch？

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
