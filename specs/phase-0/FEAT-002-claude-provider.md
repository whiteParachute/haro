---
id: FEAT-002
title: Claude Provider（基于 claude-agent-sdk，防封号强绑定 lark-bridge）
status: done
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-18
related:
  - ../provider-protocol.md
  - ../provider-selection.md
  - ../../docs/architecture/provider-layer.md
  - ../../roadmap/phases.md#p0-2claude-provider
---

# Claude Provider

## 1. Context / 背景

Haro 需要的第一个 Provider。Anthropic 对非官方调用极度敏感，错误的调用方式会导致订阅账号被封禁。lark-bridge 项目已积累了合规的 Claude 接入方式（使用 `@anthropic-ai/claude-agent-sdk`），这是 Haro 技术栈中**唯一强绑定**的外部约束。

本 spec 实现 ClaudeProvider，为后续 FEAT-005（Agent 执行循环）提供对接点。

## 2. Goals / 目标

- G1: 通过 `@anthropic-ai/claude-agent-sdk` 对接 Claude，实现 `AgentProvider` 接口（见 [provider-protocol](../provider-protocol.md)）
- G2: 调用方式与 lark-bridge 对齐，完全走 SDK，不触碰任何被 Anthropic 视为违规的 API
- G3: Provider 可独立注册、独立装卸，符合 [可插拔原则](../../docs/architecture/overview.md#设计原则)

## 3. Non-Goals / 不做的事

- 不直接使用 `anthropic.messages.create()`、`@anthropic-ai/sdk` 或任何 Raw API 入口
- 不模拟 Claude.ai 浏览器行为、不做 OAuth token 窃取
- 不做多账号切换、不做订阅状态爬取（Phase 1+）
- 不实现 Provider 动态重评估（见 [provider-selection](../provider-selection.md) 的 Phase 2 部分）

## 4. Requirements / 需求项

- R1: 实现 `ClaudeProvider implements AgentProvider`，`id = 'claude'`
- R2: `query()` 方法使用 `@anthropic-ai/claude-agent-sdk` 的 `query()` 函数；将 Haro 的 `AgentQueryParams` 映射为 SDK 的 `ClaudeCodeOptions`
- R3: 将 SDK 产生的事件转换为 Haro 的 `AgentEvent` 流（text / tool_call / tool_result / result / error）
- R4: `capabilities()` 返回：`{ streaming: true, toolLoop: true, contextCompaction: true, permissionModes: ['plan','auto','bypass'], maxContextTokens: <model-specific> }`
- R5: `healthCheck()` 调用 SDK 的 light-weight ping，验证订阅认证有效；不暴露任何凭证细节
- R6: 合规审查门控 — 源码中 `grep -r 'anthropic.messages.create\|from "@anthropic-ai/sdk"' packages/providers/claude` 必须返回 0 行
- R7: 配置 schema（Zod）中**不允许**出现 `apiKey` 字段；若存在则启动时抛错并引用本 spec
- R8: 独立 npm 包 `@haro/provider-claude`，导出 `ClaudeProvider` 类与默认实例化函数

## 5. Design / 设计要点

**事件映射**

| SDK 事件 | Haro AgentEvent |
|---------|-----------------|
| `message_start` | 忽略（内部） |
| `content_block_delta` (text) | `AgentTextEvent { delta: true }` |
| `tool_use` | `AgentToolCallEvent` |
| `tool_result` | `AgentToolResultEvent` |
| `message_stop` | `AgentResultEvent` |
| error | `AgentErrorEvent { retryable: <由错误码决定> }` |

**认证**

- SDK 自动处理订阅认证；Haro 只读取 `~/.haro/config.yaml::providers.claude.defaultModel` 等非凭证字段
- 若 SDK 报认证错误，healthCheck 返回 false，Fallback 由上层选择引擎触发（见 FEAT-005）

**合规防护（R6、R7）**

- 一条专门的 ESLint 规则 `no-anthropic-raw-api`（Phase 0 用简单的 `no-restricted-imports` 实现）：
  - 禁止 import `@anthropic-ai/sdk`
  - 禁止在非 `@haro/provider-claude` 之外的包使用 `@anthropic-ai/claude-agent-sdk`
- Zod schema 中 `providers.claude` 使用 `.strict()` 模式，遇到 `apiKey` 抛错

**工具白名单（R2 细化）**

Haro Provider 层自己维护 allowlist，不信任 SDK 自动透传：

- 从 `AgentConfig.tools` 读取允许的工具名
- 把 allowlist 映射为 SDK 的 tool 配置（具体参数见 Q1 的结论）
- SDK 未识别的工具直接忽略并 warn
- 参考 OpenClaw 的 `tools.allow` / `tools.deny` 语义（见下节"对 Hermes / OpenClaw 的对照"）

**maxContextTokens（R4 细化）**

Phase 0 采用 **按 model 硬编码的静态表**：

```typescript
const CLAUDE_MAX_CONTEXT: Record<string, number> = {
  'claude-haiku-4-5': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-opus-4-7': 1_000_000,  // 1M context variant
  // ...
}
```

Phase 2 演进：对齐 Hermes 的**多源动态解析链**（详见 [provider-selection.md 的动态重评估](../provider-selection.md#动态重评估机制)）：
- config override → 自定义 provider 配置 → persistent cache → SDK/endpoint `/models` → registry 兜底
- 由 Provider 动态重评估机制触发刷新

**Permission mode 映射（R4 细化）**

SDK 本身接受 `plan / auto / bypass` 三值，与 Haro 的 `AgentQueryParams.permissionMode` 一一对应，**直接透传**无需转换。这是对照 OpenClaw 的验证性实现（OpenClaw 已在 Claude CLI backend 走通 `--permission-mode bypassPermissions`）。

**Session resume 占位（R4 细化）**

Phase 0：在 `sessions` 表记录 SDK 返回的 session id（`sessions.sdk_session_id` 字段），但**不主动 resume**；每次 run 为独立 session。

Phase 1：实现 `--resume <sdk_session_id>` 透传，参考 OpenClaw 的 Claude CLI backend 做法。这保证了 Phase 0 的数据不浪费。

## 5.1 对 Hermes / OpenClaw 的对照

两个项目是 Haro 的主要参考，但其 Claude 接入**底层调用方式不能抄**：

| 维度 | Hermes (NousResearch/hermes-agent) | OpenClaw | Haro 决策 |
|------|-----------------------------------|----------|----------|
| 底层 SDK | 直调 Anthropic API / OpenAI API / OpenRouter 等多 provider | 支持 Claude CLI backend 透传 + 也支持直调 API | **仅 `@anthropic-ai/claude-agent-sdk`**；禁止直调 |
| 封号风险 | 存在（直调 API） | 存在（直调 API 时） | **零**（强绑定 lark-bridge 模式） |
| 工具过滤 | 47 tools 集中注册，过滤机制未明示 | **allow/deny list + per-agent override** | **照抄 OpenClaw 语义**（allow/deny + per-agent） |
| maxContextTokens | 多源动态解析链 | 输出端硬上限 32k | **Phase 0 静态表，Phase 2 抄 Hermes 动态链** |
| permission mode | 未实现 | CLI backend 透传 | **直接透传 SDK 同名参数** |
| session resume | parent_session_id 链 + 压缩 split | `--resume <id>` 透传 | **Phase 0 只落字段，Phase 1 实现透传** |

**关键原则**：可以学它们的"上层设计"（allow/deny、resume、permission），但必须走 `claude-agent-sdk` 这唯一合规通道。两家的"直调 Anthropic API"路径在 Haro 代码库中永远禁止。

## 6. Acceptance Criteria / 验收标准

- AC1: 手动运行 `pnpm --filter @haro/provider-claude test:live`（需有订阅），完成一次 "Hello" 查询并收到 `AgentResultEvent`（对应 R1~R3）
- AC2: 修改源码故意加入 `import { Anthropic } from '@anthropic-ai/sdk'`，CI/lint 拒绝（对应 R6）
- AC3: 在 `~/.haro/config.yaml` 写入 `providers.claude.apiKey: "sk-xxx"`，启动时进程退出并提示 "Claude Provider 不应配置 apiKey（见 FEAT-002）"（对应 R7）
- AC4: `ClaudeProvider.capabilities()` 返回的字段结构与 provider-protocol 的 `AgentCapabilities` 类型定义严格一致（tsc 编译通过 + 运行时 Zod 校验通过）（对应 R4）
- AC5: 断网时 `healthCheck()` 在 5 秒内返回 false（对应 R5）
- AC6: 该 provider 包从 `package.json` 中移除时（未注册），核心模块启动仍成功（仅 log warn，不崩）（对应 R8 + 可插拔原则）

## 7. Test Plan / 测试计划

- 单元测试：
  - `claude-provider.capabilities.test.ts` — 能力矩阵静态校验（AC4）
  - `event-mapping.test.ts` — SDK 事件 → Haro 事件流（使用 mock SDK）（AC1 的内核部分）
- 集成测试（标记为 `@live`，本地可选跑）：
  - `smoke.live.test.ts` — 实际发一次 query（AC1）
- 手动验证：
  - AC5（断网场景）
  - 合规审查 lint 规则真实命中（AC2）

## 8. Open Questions / 待定问题

全部已关闭（见 Changelog 2026-04-18 决策条）。

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
- 2026-04-18: whiteParachute — 关闭 Open Questions + 新增 §5.1 对照小节 → approved
  - Q1 → Provider 层做 allowlist（照抄 OpenClaw 的 allow/deny 语义，不依赖 SDK 自动透传）
  - Q2 → Phase 0 按 model 硬编码静态表；Phase 2 由动态重评估机制实现多源解析链（对齐 Hermes）
  - Q3 → 直接透传 SDK 的同名 `plan/auto/bypass`（OpenClaw 已验证路径）
  - Q4 → Phase 0 只落 `sessions.sdk_session_id` 字段；Phase 1 实现 `--resume` 透传
- 2026-04-18: whiteParachute — 实现完成 → done
  - 新增 `@haro/provider-claude` 包（ClaudeProvider + 事件映射 + 静态 capabilities + healthCheck 5s 兜底）
  - `@haro/core` 新增 provider 子路径导出（AgentProvider/AgentEvent/AgentCapabilities/ProviderRegistry）
  - 根级 ESLint 双层拦截：全局禁 `@anthropic-ai/sdk`；除 `packages/provider-claude/**` 外禁 `@anthropic-ai/claude-agent-sdk`
  - Config schema 对 `providers.claude.apiKey` 硬拒绝并附 FEAT-002 指引
  - 构造函数额外校验 `ANTHROPIC_API_KEY` 环境变量（codex 评审关闭封号绕路）
  - 26 unit tests（含 AC1/AC2/AC4/AC5/AC6 覆盖）全绿
