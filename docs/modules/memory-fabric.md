# Memory Fabric 设计

## 概述

Memory Fabric 是 Haro 的记忆子系统。**核心设计目标是让 Haro 拥有独立的记忆能力**，不依赖任何外部系统就能完成记忆的写入、查询、索引、维护。

在具备独立能力的前提下，Memory Fabric 还兼容 [aria-memory](https://github.com/...) 的目录格式，用户可以把已有的 aria-memory 目录无缝挂载到 Haro 上继续使用。

## 设计原则

1. **独立能力优先**：Haro 单独运行时必须具备完整记忆功能
2. **格式兼容**：兼容 aria-memory 目录结构，降低迁移成本
3. **可配置外挂**：记忆目录、主备、后端实现均可通过配置切换（遵守 [可插拔原则](../architecture/overview.md#设计原则)）
4. **独立部署**：Memory Fabric 可以不启动完整 Haro 单独运行

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

`contextFor()` 直接查内存 `MemoryIndex`（零 IO 延迟），保证 T1/T2 刚写入的条目立刻出现在下一轮的上下文里。

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

这是 [Evolution Engine](../evolution/self-improvement.md) 的底层代谢机制，与 eat/shit 协同运作——防止记忆无限膨胀。

设计细节待 Phase 2 独立 spec 展开。

## Phase 0 集成方式

Phase 0 采用**文件级直接操作**（最快实现）：

- Haro 直接读写记忆目录中的文件（`index.md`, `knowledge/*.md`）
- 通过预装的记忆类 skill（`remember` / `memory` / `memory-wrapup` / `memory-sleep` / `memory-status` / `memory-auto-maintain`）暴露给 Agent 调用
- 不做正式的库抽取（推迟到 Phase 1）

**Phase 1 升级路径**：将 Memory Fabric 抽取为独立 npm 包（`@haro/memory-fabric`），供 Haro 和其他项目共用，同时保持对 aria-memory 目录格式的兼容。

## 与 eat / shit 代谢的关系

- **eat** 可以把外部内容沉淀为 Memory Fabric 中的知识文件
- **shit** 可以扫描 `~/.haro/memory/`，识别最近 N 天无人读取 / 过期标记的记忆并归档

详见 [Evolution 代谢机制规范](../../specs/evolution-metabolism.md)。

## 参考

- [Skills 子系统设计](./skills-system.md)
- [Evolution 代谢机制规范](../../specs/evolution-metabolism.md)
- [可插拔原则](../architecture/overview.md#设计原则)
