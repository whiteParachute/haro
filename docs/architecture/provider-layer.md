# Provider Abstraction Layer (PAL) 设计

## 概述

Provider Abstraction Layer (PAL) 是 Haro 对「**谁在回答**」的抽象，负责统一管理多个 AI Agent Provider 的接入，屏蔽底层差异。与之并列的 [Channel Abstraction Layer](../modules/channel-layer.md) 抽象「**从哪里来**」。

PAL 是 [可插拔原则](./overview.md#设计原则) 的典型落地：每个 Provider 独立注册、独立装卸，核心模块对具体 Provider 零硬编码。

当前 Phase 0 仓库只保留 Codex Provider 的正式实现，但 PAL 继续保留多 Provider 抽象。

## 核心设计决策

### D1：执行模型 — SDK 直调（方案 A）

**决策**：Haro 直接调用 Provider SDK，自己实现 agent loop。

**理由**：
- SDK 直调对 token 流、工具调用、上下文管理的控制力远强于 CLI 子进程
- 支持自定义 context strategy、checkpoint、进化钩子

**不选 CLI 子进程（方案 B）**：Multica 的做法，但 Haro 作为平台级产品需要更多控制力。

### D2：Codex Provider — 使用 Codex SDK

**决策**：Codex Provider 调用 `@openai/codex-sdk`，参考社区已有的 CodexRunner 实现思路。

**Codex 特性**：
- 轮次制（无中途推送）
- 依赖 `previous_response_id` 进行上下文管理
- 需要外部 MCP 处理工具调用

### D3：接口设计 — 超集（暴露 Provider 特有能力）

**决策**：AgentProvider 接口采用超集设计，允许 Provider 特有能力暴露，而不仅限于最小公共集。

**理由**：不同 Provider 的能力面天然不对齐。调用方通过 `AgentCapabilities` 查询 Provider 特有能力后再决定是否使用。

### D4：每个 Provider 独立可插拔（对齐全局可插拔原则）

**决策**：PAL 严格遵守 [No-Intrusion Plugin Principle](./overview.md#设计原则)。

**具体要求**：
- **独立注册 / 装载 / 卸载**：每个 Provider 是独立 npm 包或独立目录，可单独安装
- **核心模块零硬编码**：Agent Runtime、Scenario Router、Evolution Engine 不得出现 `if providerId === 'codex'` 这类分支
- **差异化通过 capabilities 暴露**：调用方先查 `provider.capabilities()` 再决定用不用特有能力
- **新 Provider 接入不改核心代码**：只需实现 `AgentProvider` 接口 + 在 `~/.haro/config.yaml` 注册

## 当前 Provider 实现

### Codex Provider

```typescript
// 基于 @openai/codex-sdk
import { CodexClient } from '@openai/codex-sdk'

class CodexProvider implements AgentProvider {
  readonly id = 'codex'

  async query(params: AgentQueryParams): AsyncGenerator<AgentEvent> {
    const response = await this.client.complete({
      prompt: params.prompt,
      previous_response_id: params.sessionContext?.previousResponseId,
    })
    yield { type: 'result', content: response.text }
  }

  capabilities(): AgentCapabilities {
    return {
      streaming: false,
      toolLoop: false,
      contextCompaction: false,
      contextContinuation: true,
    }
  }
}
```

## 认证配置

| Provider | 认证方式 | 参考 |
|---------|---------|------|
| Codex | API Key（通过环境变量传递） | 社区实践 |

```yaml
# ~/.haro/config.yaml
providers:
  codex:
    baseUrl: "https://api.openai.com/v1"  # 可选企业端点覆盖
```

## Provider/Model 智能选择

Provider 选择不由 Agent 硬绑定，而是由规则引擎动态决定：

```
任务 → 匹配选择规则 → 选出最优 Provider + Model → 执行
                                                  ↓ 失败
                                            Fallback 到备选
```

详见：[specs/provider-selection.md](../../specs/provider-selection.md)

## 当前状态

- 当前仓库仅保留 Codex Provider 的正式实现
- PAL 仍保持多 Provider 抽象；未来新增 Provider 时沿用同一接口与注册机制
