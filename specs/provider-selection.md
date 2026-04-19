# Provider/Model 智能选择规则引擎

## 概述

Provider 和 Model 的选择不由 Agent 硬绑定。Haro 通过**规则引擎**做静态匹配，通过**动态重评估机制**让这些规则随时间演进，最终目标是 Haro 能**自主为每个任务选出最合适的 Provider + Model**，并在 Provider / Model 版本更新时谨慎地重新评估它们。

> Phase 0 约束：**规则可以约束 Provider，也可以给出 model 选择提示，但不得把具体 model id 硬编码成实现前提。** 具体 model 由 `provider.listModels()` 的实时结果在运行时解析，除非用户/Agent 配置显式指定了 `defaultModel`。

```
任务 → 匹配选择规则 → 选出最优 Provider + modelSelectionHint → 运行时解析具体 Model → 执行
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
| Provider 新增模型 | 检测到 Provider 上架新 Model（通过 `provider.listModels()` 或 `provider.capabilities().extended.models`） | 涉及此 Provider 的所有规则 |
| Provider 模型弃用 | 原 Model 被标记为 deprecated | 涉及此 Model 的所有规则 |
| 价格变化 | Provider 价格表发生变化（超出 ±10% 阈值） | 涉及成本权衡的规则 |
| 命中率异常 | 某规则的 Fallback 率持续 > 20%（7 天窗口） | 该规则 |
| 用户差评 | 用户对某次 session 反馈 ≤ 2 分（1–5 分制） | 该 session 使用的规则 |
| 周期体检 | 默认每 30 天全量重评估 | 所有规则 |
| 上下文窗口变更 | `maxContextTokens` 刷新（见下节多源解析链） | 涉及大上下文任务的规则 |

### maxContextTokens 多源解析链（Phase 2 落地）

Phase 0 采用 Provider 自带的 `listModels()` + 进程内缓存。Phase 2 对齐多源动态解析链：

```
解析顺序（fail-through）：
  1. config override              (~/.haro/config.yaml::providers.<id>.models.<model>.maxContextTokens)
  2. Provider 自定义配置          (provider.capabilities().extended.models[model].maxContextTokens)
  3. 本地持久缓存                 (~/.haro/cache/provider-meta/<id>-<model>.json)
  4. Provider SDK/endpoint /models
  5. Registry（如 models.dev / OpenRouter 等）
  6. 兜底：128k（安全下限）
```

实现要点：
- 每次"Provider 新增模型" / "Provider 模型弃用"事件触发缓存刷新
- 解析失败不阻塞请求，降级使用下一层的值
- 所有解析路径的证据（时间、来源、解析结果）写入 `evolution-context/orient/provider-meta.jsonl`

### 评判标准（Agent 自评估 + 用户反馈）

Haro 不盲目相信官方 benchmark。重评估时综合以下两类信号：

**1. Agent 自评估（机器可测）**

```typescript
interface RulePerformanceMetrics {
  ruleId: string
  windowDays: number
  sampleCount: number
  successRate: number
  fallbackRate: number
  avgRetryCount: number
  avgLatencyMs: number
  avgInputTokens: number
  avgOutputTokens: number
  avgCostUSD: number
  selfEvaluatedScoreAvg: number
}
```

自评分策略：
- 每 N 次调用随机抽样 1 次，由 Critic Agent（对抗性评估，遵守约束④）对输出质量打分
- 打分维度：任务完成度、准确性、可读性、是否偏题
- Critic 只打分不改方案

**2. 用户反馈（人类信号）**

- 用户对 session 的显式评分（1–5）
- 用户显式修正（"这次换 xxx 模型试试" 被记录为反向信号）
- 用户长期未干预（视为隐式认可）

### 重评估输出

重评估不直接改规则，而是产出**建议**，进入 OODA 的 Decide 阶段：

```jsonc
{
  "event": "rule_reevaluation",
  "ruleId": "complex-reasoning",
  "currentSelect": { "provider": "codex", "modelSelection": "quality-priority", "resolvedModel": "<runtime-model-a>" },
  "candidate": { "provider": "codex", "modelSelection": "provider-default", "resolvedModel": "<runtime-model-b>" },
  "rationale": {
    "selfEval": "新候选自评分高 0.4",
    "userFeedback": "过去 7 天 3 次用户显式选择新模型",
    "cost": "成本持平",
    "latency": "降低 12%"
  },
  "confidence": 0.78,
  "action": "propose",
  "requiresUserApproval": true
}
```

### 谨慎原则

- **默认不自动 apply**：即使置信度高，默认只 propose 给用户确认
- **灰度观察**：apply 后前 N 次调用仍保留旧模型作 shadow run（非阻塞）
- **可回滚**：规则变更写入 git，支持 `haro provider rollback <rule-id>`
- **认证方式变更不自动化**：凡是涉及认证方式、SDK 切换的变更，必须人类手动执行

### 与 Evolution 代谢的关系

- 被新 model 解析策略取代的旧规则 → `shit` 的候选淘汰项
- 通过重评估学到的新规律 → `eat` 沉淀为新的默认规则

## 核心接口

### SelectionRule

```typescript
interface SelectionRule {
  id: string
  description?: string
  priority: number
  match: {
    tags?: string[]
    promptPattern?: string
    estimatedTokens?: {
      min?: number
      max?: number
    }
    agentId?: string
  }
  select: {
    provider: string
    model?: string
    modelSelection?: 'provider-default' | 'quality-priority' | 'cost-priority' | 'largest-context'
  }
  fallback?: Array<{
    provider: string
    model?: string
    modelSelection?: 'provider-default' | 'quality-priority' | 'cost-priority' | 'largest-context'
  }>
}
```

规则解释：
- `model`：只有在**显式 pin 某个 model** 时才填写（例如用户手工指定、项目硬要求）
- `modelSelection`：更推荐的常态写法，由运行时结合 `listModels()` 实时解析出具体 model id
- 若两者都不填，等价于 `provider-default`

## 默认规则

以下 4 条默认规则内置于 Haro，优先级从高到低：

```typescript
const DEFAULT_SELECTION_RULES: SelectionRule[] = [
  {
    id: 'code-generation',
    description: '代码生成任务优先使用 Codex 的默认代码模型',
    priority: 10,
    match: {
      tags: ['code', 'coding', 'programming', 'debug', 'refactor'],
      promptPattern: '(写|生成|实现|重构|修复).*(代码|函数|类|模块|脚本)',
    },
    select: {
      provider: 'codex',
      modelSelection: 'provider-default',
    },
    fallback: [
      { provider: 'codex', modelSelection: 'largest-context' },
    ],
  },
  {
    id: 'complex-reasoning',
    description: '复杂分析/设计任务优先使用高质量默认模型',
    priority: 20,
    match: {
      tags: ['reasoning', 'analysis', 'design', 'architecture'],
      estimatedTokens: { min: 10000 },
    },
    select: {
      provider: 'codex',
      modelSelection: 'quality-priority',
    },
    fallback: [
      { provider: 'codex', modelSelection: 'largest-context' },
      { provider: 'codex', modelSelection: 'provider-default' },
    ],
  },
  {
    id: 'quick-task',
    description: '快速简单任务优先使用低成本 live 模型',
    priority: 30,
    match: {
      tags: ['quick', 'simple', 'lookup'],
      estimatedTokens: { max: 2000 },
    },
    select: {
      provider: 'codex',
      modelSelection: 'cost-priority',
    },
    fallback: [
      { provider: 'codex', modelSelection: 'provider-default' },
    ],
  },
  {
    id: 'default',
    description: '默认规则：使用 Provider 默认 live 模型',
    priority: 9999,
    match: {},
    select: {
      provider: 'codex',
      modelSelection: 'provider-default',
    },
    fallback: [
      { provider: 'codex', modelSelection: 'largest-context' },
    ],
  },
]
```

## 规则覆盖

### 项目级覆盖

在项目目录的 `.haro/selection-rules.yaml` 中配置，会覆盖全局规则：

```yaml
rules:
  - id: project-default
    description: 本项目默认使用 Codex live 默认模型
    priority: 1
    match: {}
    select:
      provider: codex
      modelSelection: provider-default
    fallback:
      - provider: codex
        modelSelection: largest-context

  - id: design-docs
    description: 设计文档优先使用质量导向解析策略
    priority: 5
    match:
      tags: [design, architecture, spec]
    select:
      provider: codex
      modelSelection: quality-priority
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
| `model_not_found` | 运行时解析出的 model 已失效 |
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
  "originalModel": "<runtime-model-a>",
  "fallbackProvider": "codex",
  "fallbackModel": "<runtime-model-b>",
  "trigger": "rate_limit",
  "ruleId": "code-generation",
  "sessionId": "sess_xxx",
  "timestamp": "2026-04-19T08:00:00Z"
}
```
