# Skills 子系统设计

## 概述

Skills 子系统负责 Haro 的**能力扩展与代谢**：
- 支持第三方 skill 的**安装、卸载、查询、调用**
- **预装一组必要 skills**（Phase 0 即可用）
- 通过 [eat / shit 代谢机制](../../specs/evolution-metabolism.md) 实现能力的有控增减

Skills 不是 Haro 的核心模块，而是最典型的可插拔外挂（遵守 [可插拔原则](../architecture/overview.md#设计原则)）。

## 与 Claude Code Skill 的关系

Haro 的 Skills 格式**直接兼容 Claude Code 的 skill 格式**（`SKILL.md` + frontmatter），理由：

- 生态已成熟，用户的现有 skills 可直接复用
- 无需重新发明标准（前期考虑过 agentskills.io，Phase 0 暂不对接）
- 未来若需要 Haro 特有扩展字段，使用 frontmatter 的 `extended:` 命名空间

## 预装 Skills（Phase 0）

共 15 个，按职责分组：

### 记忆类（6）— 对应 Memory Fabric

| Skill | 来源 | 作用 |
|-------|------|------|
| `remember` | aria-memory | 向 Memory Fabric 写入知识 |
| `memory` | aria-memory | 查询 Memory Fabric |
| `memory-wrapup` | aria-memory | Session 结束时沉淀记忆（配合 P0-7） |
| `memory-sleep` | aria-memory | 全局记忆维护（索引压缩、清理） |
| `memory-status` | aria-memory | 查看记忆系统状态 |
| `memory-auto-maintain` | aria-memory | 周期性自动维护 |

### 自查类（3）— 支撑"Agent 通过 review 自发现 bug"

| Skill | 来源 | 作用 |
|-------|------|------|
| `review` | Claude Code 内置 | PR / diff 审查 |
| `security-review` | Claude Code 内置 | 安全审查 |
| `simplify` | Claude Code 内置 | 改动代码质量检查 |

### 自动化（1）

| Skill | 来源 | 作用 |
|-------|------|------|
| `loop` | Claude Code 内置 | 定时 / 循环执行，支撑 OODA 与自查触发 |

### 消息渠道（3）— 配合 Channel Layer

| Skill | 来源 | 作用 |
|-------|------|------|
| `lark-bridge` | lark-bridge 插件 | 飞书 Channel daemon 管理 |
| `feishu-sessions` | lark-bridge 插件 | 查看飞书活跃会话 |
| `lark-setup` | lark-bridge 插件 | 飞书接入向导 |

### 进化代谢（2）— Evolution 核心

| Skill | 来源 | 作用 |
|-------|------|------|
| `eat` | 复用用户既有 `SKILL.md` | 摄入外部知识 → 沉淀为 rules / skills / Memory |
| `shit` | Haro 自研 | 扫描并淘汰不再必要的外挂组件 |

详见 [Evolution 代谢机制规范](../../specs/evolution-metabolism.md)。

## Skills 目录结构

```
~/.haro/skills/
├── preinstalled/              # 预装 skills（受 shit 白名单保护）
│   ├── remember/
│   ├── memory/
│   ├── review/
│   ├── eat/
│   └── ...
├── user/                      # 用户手动安装
│   └── <skill-name>/
├── installed.json             # 已装 skill 清单（来源、版本、安装时间）
└── usage.sqlite               # 使用统计（供 shit 使用）
```

## 安装机制

```bash
# 从 Git 仓库安装
haro skills install <git-url>

# 从本地路径安装（开发调试）
haro skills install ./path/to/skill

# 从 marketplace 安装（Phase 1+）
haro skills install <marketplace>:<skill-name>

# 列表 / 详情
haro skills list
haro skills info <skill-name>

# 卸载 / 启用 / 禁用
haro skills uninstall <skill-name>
haro skills enable <skill-name>
haro skills disable <skill-name>

# 为指定 Agent 启用 skill
haro skills enable <skill-name> --agent <agent-id>
```

## Skill 调用

Skill 由 Agent 按需触发，触发方式两种：

1. **用户显式调用**：`/skill-name args`
2. **Agent 自动匹配触发词**：SKILL.md 的 `description` 字段列出的触发条件匹配时自动调用

调用流程：

```
触发 → 加载 SKILL.md（按需加载，不进默认上下文）
     → Agent 按 skill 指令执行
     → 记录 usage.sqlite 使用计数（供 shit 评估）
     → 结果返回
```

## 使用统计（配合 shit）

```sql
-- ~/.haro/skills/usage.sqlite
CREATE TABLE skill_usage (
  skill_id TEXT PRIMARY KEY,
  install_source TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  is_preinstalled INTEGER NOT NULL DEFAULT 0  -- 1 表示受 shit 保护
);
```

每次 skill 触发、加载时增量更新。shit 扫描时读取此表判定"最近 N 天未使用"。

## 防误删

以下情况 shit 不得淘汰：

- `is_preinstalled = 1` 的 15 个预装 skill
- Agent 配置文件中通过 `tools:` 显式引用的 skill
- 最近被 eat 新创建且 `< 30 天` 的 skill（观察期）

## 与可插拔原则的对照

| 原则要求 | Skills 子系统的实现 |
|---------|---------------------|
| 独立装载 / 卸载 | `haro skills install / uninstall` |
| 核心零硬编码 | 核心模块不知道具体 skill 名字，按触发词匹配 |
| 能力经 `capabilities()` 暴露 | SKILL.md frontmatter 的 `description / metadata` |
| 可卸载 | 卸载后核心功能不受影响 |

## 路线

| Phase | Skills 子系统交付 |
|-------|-------------------|
| Phase 0 | 安装/卸载/查询 + 预装 15 skill + eat 可用 + shit 手动触发 |
| Phase 1 | Skill marketplace 雏形 + Agent 级 skill 绑定 |
| Phase 2 | eat / shit 自动触发（由 Evolution Engine 调度） |
| Phase 3 | Agent 自主编写新 skill（Agent-as-Maintainer 的一部分） |

## 参考

- [Evolution 代谢机制规范](../../specs/evolution-metabolism.md)
- [Channel Layer 设计](./channel-layer.md)
- [Memory Fabric 设计](./memory-fabric.md)
