# Skills 子系统设计

## 概述

Skills 子系统负责 Haro 的**能力扩展与代谢**：
- 支持第三方 skill 的**安装、卸载、查询、调用**
- **预装一组必要 skills**（Phase 0 即可用）
- 通过 [eat / shit 代谢机制](../../specs/evolution-metabolism.md) 实现能力的有控增减

Skills 不是 Haro 的核心模块，而是最典型的可插拔外挂（遵守 [可插拔原则](../architecture/overview.md#设计原则)）。

## 与 Codex / Claude Code Skill 的关系

Haro 的 Skills 格式**直接兼容 Codex 与 Claude Code 的 skill 格式**（`SKILL.md` + frontmatter）。

跨运行时发布使用同一份 canonical 预装 skill，避免 runtime 之间漂移：

```bash
haro skills sync-runtime --skill metabolism --runtime codex,claude
```

- 默认 `metabolism` 路径会成对同步 `eat / shit`，确保知识摄入和代谢清理能力同时进入 `$CODEX_HOME/skills` 与 `$CLAUDE_HOME/skills`。
- 目标 runtime 中已有内容不同的 skill 时默认 fail-fast；只有显式 `--overwrite` 才会在保留备份后覆盖。
- `shit` 的跨运行时文档是 FEAT-011 Haro `shit` 命令的安全包装层：先 dry-run、再显式确认，通过 Haro archive / rollback 路径变更状态，不直接执行文件清理。

## 预装 Skills（Phase 0）

共 15 个：

### 记忆类（6）

`remember / memory / memory-wrapup / memory-sleep / memory-status / memory-auto-maintain`

### 自查类（3）

`review / security-review / simplify`

### 自动化（1）

`loop`

### 消息渠道（3）

`lark-bridge / feishu-sessions / lark-setup`

### 进化代谢（2）

`eat / shit`

## Skills 目录结构

```
~/.haro/skills/
├── preinstalled/
├── user/
├── installed.json
├── preinstalled-manifest.json
└── usage.sqlite
```

## 安装机制

```bash
haro skills install <git-url>
haro skills install ./path/to/skill
haro skills list
haro skills info <skill-name>
haro skills uninstall <skill-name>
haro skills enable <skill-name>
haro skills disable <skill-name>
```

- 本地路径若为符号链接：允许 follow，但最终复制解析后的内容到 `user/`
- `installed.json` 记录来源；`preinstalled-manifest.json` 记录预装快照来源与 pinned commit

## Skill 调用

触发方式两种：

1. **用户显式调用**：`/skill-name args`
2. **Haro description 匹配触发**：在 Provider 调用前由 Haro 自己判定，Phase 0 每次输入最多自动触发一个 skill

调用流程：

```
触发 → 加载 SKILL.md（按需加载）
     → 执行 skill
     → 更新 usage.sqlite
     → 再决定是否继续交给 Provider
```

## 使用统计（配合 shit）

```sql
CREATE TABLE skill_usage (
  skill_id TEXT PRIMARY KEY,
  install_source TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  is_preinstalled INTEGER NOT NULL DEFAULT 0
);
```

## 与 eat proposal bundle 的关系

Phase 0 的 `eat` 不直接把新 skill 安装到 active 目录；它先生成：

```
~/.haro/archive/eat-proposals/<timestamp>/skills/<skill-id>/SKILL.md
```

用户确认后再通过 `haro skills install <path>` promote 到 `user/`。

## 防误删

以下情况 shit 不得淘汰：
- 15 个预装 skill
- Agent 配置显式引用的 skill
- `archive/eat-proposals/` 下尚未 promote 的提案包

## 路线

| Phase | Skills 子系统交付 |
|-------|-------------------|
| Phase 0 | 安装/卸载/查询 + 预装 15 skill + description 匹配 + eat/shit 手动触发 |
| Phase 1 | Skill marketplace 雏形 + Agent 级 skill 绑定 |
| Phase 2 | eat/shit 自动触发 |
| Phase 3 | Agent 自主编写新 skill |
