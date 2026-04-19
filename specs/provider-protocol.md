# Provider 接入协议规范

## 概述

本文档定义 Haro Provider Abstraction Layer 的核心接口协议。所有 Provider 实现必须遵守此协议。

当前仓库只保留 Codex Provider 的正式实现，但协议层继续保持多 Provider 抽象，便于未来按同一契约接入其他 Provider。

## 核心接口定义

### AgentProvider

```typescript
/**
 * 所有 Agent Provider 必须实现此接口
 */
interface AgentProvider {
  /** Provider 唯一标识符，如 'codex' */
  readonly id: string

  /**
   * 执行 Agent 查询，返回事件流
   * @param params 查询参数
   * @returns AsyncGenerator，产出 AgentEvent 序列
   */
  query(params: AgentQueryParams): AsyncGenerator<AgentEvent>

  /**
   * 返回此 Provider 的能力矩阵
   */
  capabilities(): AgentCapabilities

  /**
   * 检查 Provider 是否可用（认证有效、服务可达）
   */
  healthCheck(): Promise<boolean>
}
```

### AgentCapabilities

```typescript
/**
 * Provider 能力矩阵（超集设计，Provider 特有能力可暴露）
 *
 * 超集设计原则：接口允许 Provider 特有能力暴露，
 * 调用方通过 capabilities() 查询后决定是否使用特有能力。
 */
interface AgentCapabilities {
  /** 是否支持流式输出（mid-query push） */
  streaming: boolean

  /** 是否内置工具调用循环 */
  toolLoop: boolean

  /** 是否支持上下文压缩 */
  contextCompaction: boolean

  /** 是否支持通过 ID 延续上下文 */
  contextContinuation?: boolean

  /** 支持的权限模式（Provider 特有，可选） */
  permissionModes?: Array<'plan' | 'auto' | 'bypass'>

  /** 支持的最大上下文 token 数 */
  maxContextTokens?: number

  /** Provider 特有的额外能力（开放扩展） */
  extended?: Record<string, unknown>
}
```

### AgentQueryParams

```typescript
/**
 * Agent 查询参数
 */
interface AgentQueryParams {
  /** 用户输入 / 任务描述 */
  prompt: string

  /** Agent 系统提示词 */
  systemPrompt?: string

  /** 启用的工具名称列表 */
  tools?: string[]

  /** 会话上下文（用于跨轮次延续） */
  sessionContext?: {
    /** 会话 ID */
    sessionId: string
    /** 前一次响应 ID */
    previousResponseId?: string
  }

  /** Provider 特有参数（透传给底层 SDK） */
  providerOptions?: Record<string, unknown>

  /** 覆盖默认模型 */
  model?: string

  /** 权限模式（Provider 特有，可选） */
  permissionMode?: 'plan' | 'auto' | 'bypass'
}
```

### AgentEvent

```typescript
/**
 * Provider 产出的事件类型（事件流设计）
 */
type AgentEvent =
  | AgentTextEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentResultEvent
  | AgentErrorEvent

interface AgentTextEvent {
  type: 'text'
  /** 增量文本（流式）或完整文本（非流式） */
  content: string
  /** 是否为增量片段 */
  delta?: boolean
}

interface AgentToolCallEvent {
  type: 'tool_call'
  /** 工具调用 ID */
  callId: string
  /** 工具名称 */
  toolName: string
  /** 工具参数 */
  toolInput: Record<string, unknown>
}

interface AgentToolResultEvent {
  type: 'tool_result'
  /** 对应的工具调用 ID */
  callId: string
  /** 工具执行结果 */
  result: unknown
  /** 是否执行出错 */
  isError?: boolean
}

interface AgentResultEvent {
  type: 'result'
  /** 最终结果文本 */
  content: string
  /** 本轮的 response ID（用于上下文延续） */
  responseId?: string
  /** token 用量统计 */
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

interface AgentErrorEvent {
  type: 'error'
  /** 错误码 */
  code: string
  /** 错误信息 */
  message: string
  /** 是否可重试 */
  retryable: boolean
}
```

## 认证协议

### Codex Provider 认证

- **方式**：API Key（通过环境变量传递）
- **SDK**：`@openai/codex-sdk`
- Haro 不从 YAML 读取 `apiKey`；凭证统一经 `OPENAI_API_KEY` 环境变量注入

```yaml
# ~/.haro/config.yaml
providers:
  codex:
    # 凭证通过 OPENAI_API_KEY 环境变量传递
    baseUrl: "https://api.openai.com/v1"   # 可选企业端点覆盖
```

## 注册机制

```typescript
// Provider 注册表
class ProviderRegistry {
  private providers = new Map<string, AgentProvider>()

  register(provider: AgentProvider): void {
    this.providers.set(provider.id, provider)
  }

  get(id: string): AgentProvider {
    const provider = this.providers.get(id)
    if (!provider) throw new Error(`Provider '${id}' not registered`)
    return provider
  }

  list(): AgentProvider[] {
    return Array.from(this.providers.values())
  }
}
```
