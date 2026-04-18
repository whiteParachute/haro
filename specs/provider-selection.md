# Provider/Model 智能选择规则引擎

## 概述

Provider 和 Model 的选择不由 Agent 硬绑定，而是通过规则引擎动态决定最优组合，并在失败时自动 Fallback。

```
任务 → 匹配选择规则 → 选出最优 Provider + Model → 执行
                                                  ↓ 失败
                                            Fallback 到备选
```

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
