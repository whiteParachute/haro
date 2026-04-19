# Evolution 代谢机制规范（eat / shit）

## 概述

Haro 的自我进化不只是 OODA 线性改进，还包含**双向代谢**：

- **eat（摄入）**：把外部知识 / 经验 / 反馈沉淀为持久能力（Memory、可安装 skill 提案、规则提案）
- **shit（排出）**：扫描现有外挂组件（rules / skills / MCP server / 记忆），评估必要性，淘汰冗余

两者合力确保平台**持续进化但不膨胀**，是 [自我改进机制](../docs/evolution/self-improvement.md) 的底层代谢层。

> Phase 0 限定：由于 Instruction Substrate（`CLAUDE.md` / `rules/` 的主动加载链）尚未单独落地，`eat` 在 Phase 0 的**直接写入**只覆盖 Memory；对 `CLAUDE.md` / `rules/` / `skills` 的候选产物先生成**proposal bundle**，再由用户显式 promote/install。

本规范定义 `eat` 和 `shit` 两个核心 skill 的行为契约。Haro 将 `eat` 作为预装 skill 引入（保留原作者署名与 `CC-BY-NC-SA-4.0` 许可），`shit` 为 Haro 自研。

## 设计原则

1. **留精华，不堆数量**：每次摄入必须通过质量门槛；每次排出必须有理由
2. **可回滚**：shit 不直接删除，先归档到 `archive/` 目录
3. **防误删**：核心组件（预装 skills、核心 rules、平台级记忆索引）不在 shit 的候选范围
4. **人类裁决**：eat 写入前预览确认，shit 淘汰前预览确认，均由用户点头
5. **遵守上下文成本约束**：沉淀前考虑"加载代价"——永远加载的 `CLAUDE.md` / `rules` 比按需加载的 skills 成本高

## eat — 摄入规范

### 输入

- HTTP(S) URL / GitHub 仓库 / 本地文件 / 纯文本

### 质量门槛（拒绝条件）

- 纯娱乐、一次性使用、质量低 / 不准确
- Claude / Haro 已具备的通用知识
- 一行能搞定的小规则（直接并入现有条目或拒绝）
- 与现有规则冲突（提示冲突，由用户决策）
- 已存在等价规则 / skill（提示重复，建议合并）
- Agent 能从代码库推导的内容（目录结构、tech stack、linter 覆盖的风格）

### 流程

```
Step 1: 获取内容（按输入类型选择 fetcher）
Step 2: 分析（提炼核心价值 + 影响扫描 + 四问验证）
Step 3: 决策（分桶到 Memory / proposal bundle / 拒绝）
Step 4: 预览 → 用户确认 → 写入 / 生成提案 → 防膨胀检查
```

### 四问验证

每条候选规则逐条问：

- **Failure-backed?** 没有这条，Agent 会犯具体什么错？
- **Tool-enforceable?** 能用 linter / CI 强制执行吗？能 → 不写 rule
- **Decision-encoding?** 编码了一个非显而易见的决策吗？
- **Triggerable?** 有明确的触发场景吗？

四项全否 → 拒绝写入。

### 分桶决策

| 目标 | 特征 | Phase 0 行为 | 限制 |
|------|------|-------------|------|
| `memory/` | 应立即可查的事实 / 经验 | 直接写入 Memory Fabric | 遵守 FEAT-007 API 边界 |
| `CLAUDE.md` 提案 | 跨任务的通用原则 / 哲学 | 写入 `archive/eat-proposals/<ts>/claude/`，不自动生效 | 单文件 ≤ 200 行 |
| `rules/` 提案 | 领域操作规范 / 防错规则 | 写入 `archive/eat-proposals/<ts>/rules/`，不自动生效 | 每文件 < 100 行 |
| `skills/` 提案 | 可复用的多步骤工作流 | 写入 `archive/eat-proposals/<ts>/skills/<id>/SKILL.md`，由用户后续安装 | `SKILL.md` < 500 行 |

## shit — 排出规范

### 目标

定期或按需清理 Haro 外挂组件中不再必要的部分，保持系统轻量。Phase 2 Evolution Engine 自动触发，Phase 0 也可由用户手动触发。

### 作用范围（维度）

| 维度 | 扫描对象 | 必要性指标 |
|------|---------|-----------|
| `rules` | `~/.haro/rules/*.md`（若目录不存在则跳过） | 最近 N 天引用次数、与现有规则的重合度 |
| `skills` | `~/.haro/skills/*` | 最近 N 天触发次数、是否被新提案取代 |
| `mcp` | `~/.haro/mcp-servers/*` | 最近 N 天调用次数、健康检查失败率 |
| `memory` | `~/.haro/memory/**/*.md` | 最近 N 天读取次数、内容过期判定 |
| `all` | 以上全部 | — |

### 防误删白名单

以下组件**永远不进入候选淘汰清单**：

- Haro [预装 skills](../docs/modules/skills-system.md#预装-skillsphase-0) 15 项
- `specs/` 下所有强制规范
- Memory Fabric 平台级索引（`memory/platform/index.md`）
- 核心 rules（带 `@core` 标注的规则文件）
- `archive/eat-proposals/` 下未 promote 的提案包

### 流程

```
Step 1: 扫描
  - 按维度枚举候选项
  - 排除白名单
  - 采集必要性指标

Step 2: 评估
  - 使用频率
  - 冗余度
  - 被取代
  - 冲突失活
  - 过期

Step 3: 预览
  - 输出淘汰候选清单 + 每项淘汰理由
  - 标记风险等级（low / medium / high）

Step 4: 用户确认
  - 支持全部淘汰 / 选择部分 / 跳过
  - high 风险默认不勾选

Step 5: 执行
  - 移动到 ~/.haro/archive/shit-<timestamp>/
  - 写归档元数据（原路径、淘汰理由、回滚步骤）
  - 不直接 rm
```

### 归档结构

```
~/.haro/archive/
├── eat-proposals/<timestamp>/
│   ├── manifest.json
│   ├── claude/
│   ├── rules/
│   └── skills/
└── shit-<timestamp>/
    ├── manifest.json
    ├── rules/
    ├── skills/
    └── memory/
```

### 回滚

```bash
haro shit rollback <archive-id>
haro shit rollback <archive-id> --item <path>
```

### 必要性指标采集

```sql
CREATE TABLE component_usage (
  component_type TEXT NOT NULL,
  component_id TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (component_type, component_id)
);
```

每次 skill 触发、rule 被加载、memory 文件被读取、mcp 被调用时，Haro 增量更新此表。

## 代谢循环与 Evolution Engine 的关系

```
┌──────────────────────────────────────────────┐
│           Evolution Engine (OODA)             │
│   Observe → Orient → Decide → Act             │
│              ↑                 ↓              │
│              └──── eat / shit ←┘              │
└──────────────────────────────────────────────┘
```

### 自动触发条件（Phase 2+）

- `eat`：新用户反馈 / 互联网调研产出 → 若通过四问验证则触发
- `shit`：每 `~/.haro/config.yaml::evolution.metabolism.shitInterval`（默认 30 天）触发一次全维度扫描

### 手动触发（Phase 0 起即可用）

```bash
haro eat https://example.com/some-article
haro eat ./local-doc.md
haro shit --scope skills --days 90
haro shit --scope all --dry-run
haro shit rollback <archive-id>
```

## 与多 Agent 设计约束的关系

- **约束①（传原文者活）**：eat 在影响扫描时必须读取原始候选内容，不读压缩摘要
- **约束④（验证 Agent 是否定者）**：shit 的执行前由 Critic Agent 对抗性审查"这些真的可以删吗"；职责只是找反对理由，不给替代方案

## Changelog

- 2026-04-18: 初稿。eat 沿用现有 `/home/heyucong.bebop/SKILL.md` 设计；shit 为 Haro 自研首版。
- 2026-04-19: 补充 Phase 0 落地边界：直接写入仅覆盖 Memory；`CLAUDE.md` / `rules` / `skills` 统一先落 proposal bundle，再由用户显式 promote/install。
