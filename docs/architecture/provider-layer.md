# Provider Abstraction Layer (PAL) 设计

## 概述

Provider Abstraction Layer (PAL) 是 Haro 对「**谁在回答**」的抽象，负责统一管理多个 AI Agent Provider 的接入，屏蔽底层差异。与之并列的 [Channel Abstraction Layer](../modules/channel-layer.md) 抽象「**从哪里来**」。

PAL 是 [可插拔原则](./overview.md#设计原则) 的典型落地 —— 每个 Provider 独立注册、独立装卸，核心模块对具体 Provider 零硬编码。

## 核心设计决策

### D1：执行模型 — SDK 直调（方案 A）

**决策**：Haro 直接调用各 Provider SDK，自己实现 agent loop。

**理由**：
- SDK 直调对 token 流、工具调用、上下文管理的控制力远强于 CLI 子进程
- 支持自定义 context strategy、checkpoint、进化钩子

**不选 CLI 子进程（方案 B）**：Multica 的做法，但 Haro 作为平台级产品需要更多控制力。

### D2：Claude Provider — 必须使用 Agent SDK，不得直调 Anthropic API

**决策**：Claude Provider 调用 `@anthropic-ai/claude-agent-sdk` 的 `query()` 方法，**调用方式必须与 lark-bridge 保持一致**。

**⚠️ 封号风险警告**（这是 Haro 技术栈中唯一的强绑定约束）：
- **禁止**直接调用 `anthropic.messages.create()` (Anthropic Messages API)
- **禁止**模拟 Claude.ai 的浏览器行为
- **必须**通过 `@anthropic-ai/claude-agent-sdk` 的官方方式接入
- 违反上述规则将导致 Claude 订阅账号被封禁

**参考实现**：lark-bridge 的 Claude 接入方式（订阅自动认证）

### D3：Codex Provider — 使用 Codex SDK

**决策**：Codex Provider 调用 `@openai/codex-sdk`，参考社区已有的 CodexRunner 实现思路。

**Codex 特性**：
- 轮次制（无中途推送）
- 依赖 `previous_response_id` 进行上下文管理
- 需要外部 MCP 处理工具调用

### D4：接口设计 — 超集（暴露 Provider 特有能力）

**决策**：AgentProvider 接口采用超集设计，允许 Provider 特有能力暴露，而不仅限于最小公共集。

**理由**：Claude 有封号顾虑，接口设计必须能区分和隔离不同 Provider 的行为差异。调用方通过 `AgentCapabilities` 查询 Provider 特有能力后再决定是否使用。

### D5：每个 Provider 独立可插拔（对齐全局可插拔原则）

**决策**：PAL 严格遵守 [No-Intrusion Plugin Principle](./overview.md#设计原则)。

**具体要求**：
- **独立注册 / 装载 / 卸载**：每个 Provider 是独立 npm 包或独立目录，可单独安装
- **核心模块零硬编码**：Agent Runtime、Scenario Router、Evolution Engine 不得出现 `if providerId === 'claude'` 这类分支
- **差异化通过 capabilities 暴露**：调用方先查 `provider.capabilities()` 再决定用不用特有能力
- **新 Provider 接入不改核心代码**：只需实现 `AgentProvider` 接口 + 在 `~/.haro/config.yaml` 注册

违规将被 lint 规则和 PR 评审拒绝。

## 两个 Provider 的具体实现

### Claude Provider

```typescript
// 基于 @anthropic-ai/claude-agent-sdk
import { query, ClaudeCodeOptions } from '@anthropic-ai/claude-agent-sdk'

class ClaudeProvider implements AgentProvider {
  readonly id = 'claude'
  
  async query(params: AgentQueryParams): AsyncGenerator<AgentEvent> {
    const options: ClaudeCodeOptions = {
      prompt: params.prompt,
      systemPrompt: params.systemPrompt,
      tools: params.tools,
      // ... 其他参数映射
    }
    // 使用 Agent SDK query()，不得使用 anthropic.messages.create()
    yield* query(options)
  }
  
  capabilities(): AgentCapabilities {
    return {
      streaming: true,          // 支持 mid-query push
      toolLoop: true,           // SDK 内置 tool loop
      contextCompaction: true,  // 支持 compaction
      permissionModes: ['plan', 'auto', 'bypass'],
    }
  }
}
```

### Codex Provider

```typescript
// 基于 @openai/codex-sdk
import { CodexClient } from '@openai/codex-sdk'

class CodexProvider implements AgentProvider {
  readonly id = 'codex'
  
  async query(params: AgentQueryParams): AsyncGenerator<AgentEvent> {
    // 轮次制，通过 previous_response_id 管理上下文
    const response = await this.client.complete({
      prompt: params.prompt,
      previous_response_id: params.sessionContext?.previousResponseId,
    })
    yield { type: 'result', content: response.text }
  }
  
  capabilities(): AgentCapabilities {
    return {
      streaming: false,         // 轮次制，无中途推送
      toolLoop: false,          // 需要外部 MCP
      contextCompaction: false,
      contextContinuation: true, // 支持 previous_response_id
    }
  }
}
```

## 认证配置

| Provider | 认证方式 | 参考 |
|---------|---------|------|
| Claude | 订阅自动认证（无需 API Key） | lark-bridge 的认证模式（强绑定） |
| Codex | API Key（通过 `~/.haro/config.yaml` 配置） | 社区实践 |

**Claude 认证说明**：
- 使用 `@anthropic-ai/claude-agent-sdk` 时，SDK 自动处理认证
- 认证凭证由 SDK 管理，Haro 不直接接触
- 不需要也不应该存储 Anthropic API Key（这会绕过 Agent SDK，有封号风险）

**Codex 认证配置**：
```yaml
# ~/.haro/config.yaml
providers:
  codex:
    apiKey: "${OPENAI_API_KEY}"  # 或直接写入（不推荐）
```

## Provider/Model 智能选择

Provider 选择不由 Agent 硬绑定，而是由规则引擎动态决定：

```
任务 → 匹配选择规则 → 选出最优 Provider + Model → 执行
                                                  ↓ 失败
                                            Fallback 到备选
```

详见：[specs/provider-selection.md](../../specs/provider-selection.md)

## 封号风险汇总

| 风险行为 | 状态 |
|---------|------|
| 直调 `anthropic.messages.create()` | ❌ 禁止 |
| 模拟浏览器登录 Claude.ai | ❌ 禁止 |
| 使用 Hermes 的 OAuth token 窃取方式 | ❌ 禁止（Hermes 存在此风险） |
| 通过 `@anthropic-ai/claude-agent-sdk` 的 `query()` | ✅ 合规 |
| lark-bridge 的订阅认证模式 | ✅ 合规 |
