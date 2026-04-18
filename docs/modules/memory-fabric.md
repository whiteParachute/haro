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
| **写入** | 接收结构化知识并存储到对应类别（platform / agent / shared） |
| **查询** | 按主题、标签、Agent、时间范围检索 |
| **索引** | 维护 `index.md` 作为入口快查表 |
| **维护** | 周期性压缩、合并重复、清理过期（对应 `memory-sleep` skill） |
| **统计** | 返回记忆数量、增长速率、最近使用等（对应 `memory-status` skill） |

以上能力均为 Haro 原生实现，与 aria-memory 目录格式无关；只有"目录布局"层兼容 aria-memory。

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

## Session 结束时的记忆写入

每次 Agent 执行完成后，由 `memory-wrapup` skill 触发，将关键信息写入记忆：

```typescript
async function writeSessionMemory(
  session: Session,
  agentId: string
): Promise<void> {
  const memoryPath = `~/.haro/memory/agents/${agentId}`

  await appendToKnowledge(memoryPath, {
    sessionId: session.id,
    timestamp: session.endedAt,
    keyInsights: extractInsights(session.events),
  })
}
```

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
