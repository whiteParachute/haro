# Provider Abstraction Layer (PAL) 设计

> **已停止发展**：本文描述的是历史 Haro-owned workbench/runtime 方向。
> 当前主线：`docs/planning/haro-sidecar-subtraction-and-feedback-loop.md`。
> 不要据此新增 provider/channel/memory/runtime/team/dashboard/skills marketplace 能力。
> 相关能力应由 AgentDock 承接，或通过 Haro sidecar contract 暴露。


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
| Codex | API Key（通过环境变量传递）或 ChatGPT subscription auth（`codex login` 写入 `~/.codex/auth.json`） | FEAT-003 / FEAT-029 |

```yaml
# ~/.haro/config.yaml
providers:
  codex:
    authMode: "auto"  # env | chatgpt | auto；默认 auto
    baseUrl: "https://api.openai.com/v1"  # 可选企业端点覆盖
```

### Phase 1 ChatGPT subscription auth（FEAT-029）

Codex Provider 支持 `providers.codex.authMode`：

| authMode | 行为 |
| --- | --- |
| `env` | 只接受当前进程 `OPENAI_API_KEY`；缺失时报错。 |
| `chatgpt` | 不向 `@openai/codex-sdk` 传 `apiKey`，也不切 `baseUrl`；SDK 子进程复用官方 `codex` binary，并由 binary 读取 `~/.codex/auth.json`。 |
| `auto`（默认） | `OPENAI_API_KEY` 显式存在时优先走 env；否则如果本机 `~/.codex/auth.json` 有 `tokens.access_token`，走 ChatGPT subscription auth；否则报错并提示配置 `OPENAI_API_KEY` 或先运行外部 `codex login`。 |

`resolveAuth()` 优先级固定为：

1. 显式 `OPENAI_API_KEY`（developer / org accounts）；
2. `authMode === 'chatgpt'`；
3. `authMode === 'auto' && readLocalCodexAuth().hasAuth`；
4. 报错，提示配置 `OPENAI_API_KEY` 或先运行外部 `codex login`。

ChatGPT 模式数据流（文字图）：

```
codex login --device-auth   # 或用户自行运行 codex login
  -> codex CLI 完成 OAuth 并写 ~/.codex/auth.json
  -> Haro provider runtime 只读校验 tokens.access_token
  -> Haro 不再通过 provider setup 写 providers.codex.authMode
  -> CodexProvider 调 SDK 时不传 apiKey/baseUrl
  -> SDK/codex binary 直接读取 ~/.codex/auth.json 并自行 refresh
```

ChatGPT 登录由外部 codex CLI 完成。devbox、SSH 远端和 headless 环境建议直接运行 `codex login --device-auth`；本机带浏览器也可以运行 `codex login`。`HARO_CODEX_LOGIN_MODE` 只属于历史 Haro setup 向导，FEAT-081N 后不再由 Haro 使用。

`listModels()` 在 chatgpt 模式下读 codex CLI 自己维护的 `~/.codex/models_cache.json`（无硬编码 slug，仍保持 FEAT-003 AC6）；`authMode=env` 但 `OPENAI_API_KEY` 缺失时 throws，由 `/api/v1/providers` 折叠为 `liveModelsFailed: true`，避免 Dashboard 显示模型但运行必失败。

安全边界：Haro 不复制 `access_token` / `refresh_token` / `id_token`，不把 `tokens.*` 写入 YAML；schema 显式拒绝 `providers.codex.tokens`。

### Provider CLI 边界（FEAT-026 / FEAT-081N）

FEAT-026 曾提供 Haro-owned provider onboarding。FEAT-081N 后，根据产品定位，Haro 新产品不再初始化 provider config；`haro provider setup ...` 已退役并 fail-closed。保留范围：

- 保留 `haro provider doctor/models/select/env`，把 provider 健康检查、模型发现、默认模型切换和 env 模板集中到一个命令族。
- 保留 provider runtime、`createCodexProvider`、`readLocalCodexAuth`、run/chat/LLM provider path。
- 配置文件只保存 `baseUrl`、`defaultModel`、`enabled`、`secretRef` 等非敏感字段。
- Secret 默认来自环境变量或外部 codex CLI auth；Haro provider setup 不再写 env file。
- CLI 前台运行与 systemd/web 服务运行时必须能解释各自读取到的 provider 配置来源。

后续不得把 081N 解读为 provider runtime/package 删除批准；若继续减法，必须另做 provider runtime 影响面评审。

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
