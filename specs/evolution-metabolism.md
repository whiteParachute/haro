# Evolution 代谢机制规范（eat / shit）

## 概述

Haro 的自我进化不只是 OODA 线性改进，还包含**双向代谢**：

- **eat（摄入）**：把外部知识 / 经验 / 反馈沉淀为持久能力（rules / skills / Agent 配置 / Memory Fabric）
- **shit（排出）**：扫描现有外挂组件（rules / skills / MCP server / 记忆），评估必要性，淘汰冗余

两者合力确保平台**持续进化但不膨胀**，是 [自我改进机制](../docs/evolution/self-improvement.md) 的底层代谢层。

本规范定义 `eat` 和 `shit` 两个核心 skill 的行为契约。Haro 将 `eat` 作为预装 skill 引入（保留原作者署名与 `CC-BY-NC-SA-4.0` 许可），`shit` 为 Haro 自研。

## 设计原则

1. **留精华，不堆数量**：每次摄入必须通过质量门槛；每次排出必须有理由
2. **可回滚**：shit 不直接删除，先归档到 `archive/` 目录
3. **防误删**：核心组件（预装 skills、核心 rules、平台级记忆索引）不在 shit 的候选范围
4. **人类裁决**：eat 写入前预览确认，shit 淘汰前预览确认，均由用户点头
5. **遵守上下文成本约束**：沉淀前考虑"加载代价"——永远加载的 CLAUDE.md / rules 比按需加载的 skills 成本高

## eat — 摄入规范

### 输入

- HTTP(S) URL / GitHub 仓库 / 本地文件 / 纯文本

### 质量门槛（拒绝条件）

- 纯娱乐、一次性使用、质量低 / 不准确
- Claude / Haro 已具备的通用知识
- 一行能搞定的小规则（直接 append 到已有 rules）
- 与现有规则冲突（提示冲突，由用户决策）
- 已存在等价规则 / skill（提示重复，建议合并）
- Agent 能从代码库推导的内容（目录结构、tech stack、linter 覆盖的风格）

### 流程

```
Step 1: 获取内容（按输入类型选择 fetcher）
Step 2: 分析（提炼核心价值 + 影响扫描 + 四问验证）
Step 3: 决策（分桶到 CLAUDE.md / rules / skill / 拒绝）
Step 4: 预览 → 用户确认 → 写入 → 防膨胀检查
```

### 四问验证

每条候选规则逐条问：

- **Failure-backed?** 没有这条，Agent 会犯具体什么错？
- **Tool-enforceable?** 能用 linter / CI 强制执行吗？能 → 不写 rule
- **Decision-encoding?** 编码了一个非显而易见的决策吗？
- **Triggerable?** 有明确的触发场景吗？

四项全否 → 拒绝写入。

### 分桶决策

| 目标 | 特征 | 成本 | 限制 |
|------|------|------|------|
| CLAUDE.md | 跨任务的通用原则 / 哲学 | 高（每会话注入） | ≤ 200 行 |
| rules/ | 领域操作规范 / 防错规则 | 高（每会话注入） | 每文件 < 100 行 |
| skills/ | 可复用的多步骤工作流 | 低（按需加载） | SKILL.md < 500 行 |

eat skill 的完整实现参考 `/home/heyucong.bebop/SKILL.md`。

## shit — 排出规范

### 目标

定期或按需清理 Haro 外挂组件中不再必要的部分，保持系统轻量。Phase 2 Evolution Engine 自动触发，Phase 0 也可由用户手动触发。

### 作用范围（维度）

| 维度 | 扫描对象 | 必要性指标 |
|------|---------|-----------|
| `rules` | `~/.haro/rules/*.md` | 最近 N 天引用次数、与现有规则的重合度 |
| `skills` | `~/.haro/skills/*` | 最近 N 天触发次数、被 eat 新 skill 取代 |
| `mcp` | `~/.haro/mcp-servers/*` | 最近 N 天调用次数、健康检查失败率 |
| `memory` | `~/.haro/memory/**/*.md` | 最近 N 天读取次数、内容过期判定 |
| `all` | 以上全部 | — |

### 防误删白名单

以下组件**永远不进入候选淘汰清单**：

- Haro [预装 skills](../docs/modules/skills-system.md#预装-skills) 15 项
- `specs/` 下所有强制规范
- Memory Fabric 平台级索引（`memory/platform/index.md`）
- 核心 rules（带 `@core` 标注的规则文件）

### 流程

```
Step 1: 扫描
  - 按维度枚举候选项
  - 排除白名单
  - 采集必要性指标

Step 2: 评估
  - 使用频率（最近 N 天触发 / 读取次数）
  - 冗余度（与其他组件语义重合）
  - 被取代（新 eat 进来的组件是否覆盖了旧组件职责）
  - 冲突失活（与核心原则冲突的规则）
  - 过期（记忆中明确打了过期标记的内容）

Step 3: 预览
  - 输出淘汰候选清单 + 每项的淘汰理由
  - 标记风险等级（low / medium / high）

Step 4: 用户确认
  - 支持"全部淘汰 / 选择部分 / 跳过"
  - 高风险项默认不勾选，必须显式确认

Step 5: 执行
  - 移动到 ~/.haro/archive/shit-<timestamp>/ 目录
  - 写归档元数据（原路径、淘汰理由、回滚脚本）
  - 不直接 rm
```

### 归档结构

```
~/.haro/archive/shit-2026-04-18T10-30-00/
├── manifest.json            # 本次归档清单 + 回滚脚本
├── rules/
│   └── deprecated-xxx.md
├── skills/
│   └── unused-skill/
└── memory/
    └── stale-notes.md
```

`manifest.json` 结构：

```json
{
  "archivedAt": "2026-04-18T10:30:00Z",
  "triggeredBy": "manual | auto",
  "items": [
    {
      "originalPath": "~/.haro/rules/deprecated-xxx.md",
      "archivedPath": "rules/deprecated-xxx.md",
      "reason": "最近 90 天引用次数 0，被 rules/new-xxx.md 取代",
      "riskLevel": "low",
      "rollback": "mv {archivedPath} {originalPath}"
    }
  ]
}
```

### 回滚

```bash
haro shit rollback <archive-id>     # 整包回滚
haro shit rollback <archive-id> --item <path>  # 单项回滚
```

### 必要性指标采集

shit 的判断依赖使用统计。Haro 必须维护一张"组件引用计数表"：

```sql
-- ~/.haro/haro.db
CREATE TABLE component_usage (
  component_type TEXT NOT NULL,  -- 'rule' | 'skill' | 'mcp' | 'memory'
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
│                                               │
│   Observe → Orient → Decide → Act             │
│              ↑                 ↓              │
│              └──── eat / shit ←┘              │
│                                               │
│   eat：把 Observe 得到的外部信号/用户反馈     │
│        沉淀为 rules / skills / Memory        │
│                                               │
│   shit：在 Act 之后定期回收，避免组件膨胀    │
└──────────────────────────────────────────────┘
```

### 自动触发条件（Phase 2+）

- `eat`：新用户反馈 / 互联网调研产出 → 若通过四问验证则触发
- `shit`：每 `~/.haro/config.yaml::evolution.metabolism.shitInterval`（默认 30 天）触发一次全维度扫描

### 手动触发（Phase 0 起即可用）

```bash
# 摄入
haro eat https://example.com/some-article
haro eat ./local-doc.md

# 排出
haro shit --scope skills --days 90     # 扫描 90 天内未触发的 skill
haro shit --scope all --dry-run        # 全维度预览，不执行
haro shit rollback <archive-id>         # 回滚
```

## 与多 Agent 设计约束的关系

- **约束①（传原文者活）**：eat 在影响扫描时必须读取原始候选规则内容，不读压缩摘要
- **约束④（验证 Agent 是否定者）**：shit 的执行前由 Critic Agent 对抗性审查"这些真的可以删吗"，其职责只是找反对理由，不给替代方案

## Changelog

- 2026-04-18: 初稿。eat 沿用现有 `/home/heyucong.bebop/SKILL.md` 设计；shit 为 Haro 自研首版。
