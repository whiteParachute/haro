# Provider/Model 智能选择规则引擎

## 概述

Provider 和 Model 的选择不由 Agent 硬绑定。Haro 通过**规则引擎**做静态匹配，通过**动态重评估机制**让这些规则随时间演进，最终目标是 Haro 能**自主为每个任务选出最合适的 Provider + Model**，并在 Provider / Model 版本更新时谨慎地重新评估它们。

```
任务 → 匹配选择规则 → 选出最优 Provider + Model → 执行
                                                  ↓ 失败
                                            Fallback 到备选

规则本身 ← 动态重评估（Agent 自评估 + 用户反馈） ← Provider/Model 更新事件
```

## 两层能力

1. **静态层**：规则匹配 + Fallback（本文档下半部分）
2. **动态层**：评判标准 + 重评估触发 + 自评估机制（本文档上半部分）

## 动态重评估机制

Provider / Model 在生态里持续迭代（新版本、新定价、能力变化）。Haro 不能一次配置终身不变，必须主动评估。

### 触发重评估的事件

| 触发源 | 说明 | 重评估粒度 |
|--------|------|----------|
| Provider 新增模型 | 检测到 Provider 上架新 Model（通过 `provider.capabilities().extended.models`） | 涉及此 Provider 的所有规则 |
| Provider 模型弃用 | 原 Model 被标记为 deprecated | 涉及此 Model 的所有规则 |
| 价格变化 | Provider 价格表发生变化（超出 ±10% 阈值） | 涉及成本权衡的规则 |
| 命中率异常 | 某规则的 Fallback 率持续 > 20%（7 天窗口） | 该规则 |
| 用户差评 | 用户对某次 session 反馈 ≤ 2 分（1–5 分制） | 该 session 使用的规则 |
| 周期体检 | 默认每 30 天全量重评估 | 所有规则 |
| 上下文窗口变更 | `maxContextTokens` 刷新（见下节多源解析链） | 涉及大上下文任务的规则 |

### maxContextTokens 多源解析链（Phase 2 落地）

Phase 0 采用 per-model 硬编码表（见 [FEAT-002](./phase-0/FEAT-002-claude-provider.md#maxcontexttokens-r4-细化)）。Phase 2 对齐 **Hermes (NousResearch/hermes-agent) 的多源动态解析链**：

```
解析顺序（fail-through）：
  1. config override              (~/.haro/config.yaml::providers.<id>.models.<model>.maxContextTokens)
  2. Provider 自定义配置          (provider.capabilities().extended.models[model].maxContextTokens)
  3. 本地持久缓存                 (~/.haro/cache/provider-meta/<id>-<model>.json, TTL 由事件触发刷新)
  4. Provider SDK/endpoint /models
  5. Registry（Anthropic /v1/models、OpenRouter、models.dev 等）
  6. 兜底：128k（安全下限）
```

实现要点：
- 每次"Provider 新增模型" / "Provider 模型弃用" 事件触发第 3 步缓存刷新
- 解析失败不阻塞请求，降级使用下一层的值
- 所有解析路径的证据（时间、来源、解析结果）写入 `evolution-context/orient/provider-meta.jsonl`，供 Pattern Miner 分析

### 评判标准（Agent 自评估 + 用户反馈）

Haro 不盲目相信官方 benchmark。重评估时综合以下两类信号：

**1. Agent 自评估（机器可测）**

每条 SelectionRule 在实际运行中累积以下指标：

```typescript
interface RulePerformanceMetrics {
  ruleId: string
  windowDays: number              // 观察窗口（默认 30 天）
  sampleCount: number             // 样本数（阈值达标才可用）

  // 成功/失败
  successRate: number             // 任务成功率
  fallbackRate: number            // Fallback 触发率
  avgRetryCount: number           // 平均重试次数

  // 效率
  avgLatencyMs: number            // 平均延迟
  avgInputTokens: number
  avgOutputTokens: number

  // 成本
  avgCostUSD: number              // 平均每次调用成本

  // 质量（通过自评 Agent 二次打分）
  selfEvaluatedScoreAvg: number   // 1–5 分，由 critic agent 对输出质量打分
}
```

自评分策略：
- 每 N 次调用随机抽样 1 次，由 Critic Agent（对抗性评估，遵守约束④）对输出质量打分
- 打分维度：任务完成度、准确性、可读性、是否偏题
- **Critic 只打分不改方案**

**2. 用户反馈（人类信号）**

- 用户对 session 的显式评分（1–5）
- 用户显式修正（"这次换 xxx 模型试试"被记录为反向信号）
- 用户长期未干预（视为隐式认可）

### 重评估输出

重评估不直接改规则，而是产出**建议**，进入 OODA 的 Decide 阶段：

```jsonc
{
  "event": "rule_reevaluation",
  "ruleId": "complex-reasoning",
  "currentSelect": { "provider": "claude", "model": "claude-opus-4-5" },
  "candidate": { "provider": "claude", "model": "claude-opus-4-7" },
  "rationale": {
    "selfEval": "新模型自评分高 0.4（4.2 → 4.6）",
    "userFeedback": "过去 7 天 3 次用户显式选择新模型",
    "cost": "成本持平",
    "latency": "降低 12%"
  },
  "confidence": 0.78,
  "action": "propose",     // propose | apply | reject
  "requiresUserApproval": true
}
```

### 谨慎原则

- **默认不自动 apply**：即使置信度高，默认只 propose 给用户确认
- **灰度观察**：apply 后前 N 次调用仍保留旧模型作 shadow run（非阻塞），对比输出
- **可回滚**：规则变更写入 git，支持 `haro provider rollback <rule-id>`
- **封号类变更不自动化**：凡是涉及认证方式、SDK 切换的变更，必须人类手动执行（见 [PAL 的 D2 约束](../docs/architecture/provider-layer.md#d2claude-provider--必须使用-agent-sdk不得直调-anthropic-api)）

### 与 Evolution 代谢的关系

- 被新 Model 取代的旧规则 → `shit` 的候选淘汰项
- 通过重评估学到的新规律 → `eat` 沉淀为新的默认规则

## 核心接口

### SelectionRule

```typescript
/**
 * Provider/Model 选择规则
 */
interface SelectionRule {
  /** 规则 ID，全局唯一 */
  id: string

  /** 规则描述（人类可读） */
  description?: string

  /** 优先级，数字越小优先级越高 */
  priority: number

  /** 匹配条件 */
  match: {
    /** 任务标签（如 'code', 'analysis', 'quick'） */
    tags?: string[]
    /** 任务关键词（正则） */
    promptPattern?: string
    /** 估算 token 数阈值 */
    estimatedTokens?: {
      min?: number
      max?: number
    }
    /** Agent ID（限定特定 Agent 使用此规则） */
    agentId?: string
  }

  /** 选择结果 */
  select: {
    /** 首选 Provider ID */
    provider: string
    /** 首选 Model（不填则使用 Provider 默认） */
    model?: string
  }

  /** Fallback 列表（按顺序尝试） */
  fallback?: Array<{
    provider: string
    model?: string
  }>
}
```

## 默认规则

以下 4 条默认规则内置于 Haro，优先级从高到低：

```typescript
const DEFAULT_SELECTION_RULES: SelectionRule[] = [
  {
    id: 'code-generation',
    description: '代码生成任务优先使用 Codex',
    priority: 10,
    match: {
      tags: ['code', 'coding', 'programming', 'debug', 'refactor'],
      promptPattern: '(写|生成|实现|重构|修复).*(代码|函数|类|模块|脚本)',
    },
    select: {
      provider: 'codex',
      model: 'codex-1',
    },
    fallback: [
      { provider: 'claude', model: 'claude-sonnet-4-5' },
    ],
  },
  {
    id: 'complex-reasoning',
    description: '复杂推理任务使用 Claude',
    priority: 20,
    match: {
      tags: ['reasoning', 'analysis', 'design', 'architecture'],
      estimatedTokens: { min: 10000 },
    },
    select: {
      provider: 'claude',
      model: 'claude-opus-4-5',
    },
    fallback: [
      { provider: 'claude', model: 'claude-sonnet-4-5' },
      { provider: 'codex', model: 'codex-1' },
    ],
  },
  {
    id: 'quick-task',
    description: '快速简单任务使用轻量模型',
    priority: 30,
    match: {
      tags: ['quick', 'simple', 'lookup'],
      estimatedTokens: { max: 2000 },
    },
    select: {
      provider: 'claude',
      model: 'claude-haiku-4-5',
    },
    fallback: [
      { provider: 'codex', model: 'codex-1-mini' },
    ],
  },
  {
    id: 'default',
    description: '默认规则：使用 Claude Sonnet',
    priority: 9999,
    match: {},
    select: {
      provider: 'claude',
      model: 'claude-sonnet-4-5',
    },
    fallback: [
      { provider: 'codex', model: 'codex-1' },
    ],
  },
]
```

## 规则覆盖

### 项目级覆盖

在项目目录的 `.haro/selection-rules.yaml` 中配置，会覆盖全局规则：

```yaml
# .haro/selection-rules.yaml
rules:
  - id: project-default
    description: 本项目默认使用 Codex
    priority: 1
    match: {}
    select:
      provider: codex
      model: codex-1
    fallback:
      - provider: claude
        model: claude-sonnet-4-5

  - id: design-docs
    description: 设计文档使用 Claude Opus
    priority: 5
    match:
      tags: [design, architecture, spec]
    select:
      provider: claude
      model: claude-opus-4-5
```

### 全局规则文件

`~/.haro/selection-rules.yaml` 定义全局默认规则，格式与项目级相同。

**优先级顺序**：Agent 硬绑定（`defaultProvider`/`defaultModel`） > 项目级规则 > 全局规则 > 内置默认规则

## Fallback 触发条件

以下情况触发 Fallback，按顺序尝试 `fallback` 列表：

| 触发条件 | 说明 |
|---------|------|
| `provider_unavailable` | Provider 健康检查失败 |
| `rate_limit` | 触发速率限制（429） |
| `timeout` | 请求超时 |
| `auth_error` | 认证失败（非封号，如 token 过期） |
| `model_not_found` | 指定 model 不存在 |
| `context_too_long` | 输入超过模型上下文限制 |

**不触发 Fallback 的情况**：
- `ban_risk`：检测到可能导致封号的行为，直接报错，不 Fallback
- `tool_error`：工具执行错误，属于业务逻辑，不切换 Provider

## Fallback 日志规范

```jsonc
{
  "level": "warn",
  "event": "provider_fallback",
  "originalProvider": "codex",
  "originalModel": "codex-1",
  "fallbackProvider": "claude",
  "fallbackModel": "claude-sonnet-4-5",
  "trigger": "rate_limit",
  "ruleId": "code-generation",
  "sessionId": "sess_xxx",
  "timestamp": "2026-04-18T08:00:00Z"
}
```
