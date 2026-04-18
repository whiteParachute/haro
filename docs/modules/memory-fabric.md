# Memory Fabric 设计

## 概述

Memory Fabric 是 Haro 的记忆集成模块，设计为独立模块，可以：
1. **独立部署**：作为独立的记忆服务运行
2. **复用现有目录**：配置已有的 aria-memory 目录直接使用

## 设计原则

- **独立性**：Memory Fabric 是独立模块，可以在不启动完整 Haro 的情况下单独部署
- **兼容性**：兼容 aria-memory 目录格式，同时兼容自定义改动（如主备配置、global_sleep 逻辑）
- **可配置性**：通过配置文件指向不同的记忆目录

## 目录结构

```
~/.haro/memory/
├── platform/           # 平台级记忆
│   ├── index.md        # 记忆索引（aria-memory 格式）
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

## 与 aria-memory 的关系

Memory Fabric 完全兼容 aria-memory 的目录格式和改动设计：

```yaml
# ~/.haro/config.yaml
memory:
  primary:
    # 可以指向已有的 aria-memory 目录
    path: "/path/to/existing/aria-memory"
    # 或使用 Haro 默认目录
    # path: "~/.haro/memory"
  backup:
    path: "/path/to/backup-memory"
```

**兼容的 aria-memory 格式**：
- `index.md`（记忆索引文件）
- `knowledge/` 目录（知识文件）
- `impressions/` 目录（印象文件）

## 主备配置

Memory Fabric 支持主备配置，规则如下：

- **仅主（primary）执行 `global_sleep`** 等全局维护逻辑
- 备（backup）只做被动同步，不主动执行全局操作
- 读取操作：先从主读，主不可用时从备读
- 写入操作：写主，同步备（异步）

```yaml
# 主备配置示例
memory:
  primary:
    path: "~/.haro/memory"
    globalSleep: true   # 仅主执行 global_sleep
  backup:
    path: "/mnt/nas/haro-memory-backup"
    globalSleep: false  # 备不执行 global_sleep
```

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

## Session 结束时的记忆写入

每次 Agent 执行完成后，自动将关键信息写入记忆：

```typescript
async function writeSessionMemory(
  session: Session,
  agentId: string
): Promise<void> {
  const memoryPath = `~/.haro/memory/agents/${agentId}`
  
  // 写入本次 session 的关键知识
  await appendToKnowledge(memoryPath, {
    sessionId: session.id,
    timestamp: session.endedAt,
    keyInsights: extractInsights(session.events),
  })
}
```

## Phase 0 集成方式

Phase 0 采用**文件级直接操作**（最快实现）：

- Haro 直接读写记忆目录中的文件（index.md, knowledge/*.md）
- 不做正式的库抽取（推迟到 Phase 1）
- 兼容 aria-memory 当前作为 Claude Code extension 的使用方式

**Phase 1 升级路径**：将 aria-memory 核心逻辑抽取为可 import 的库。
