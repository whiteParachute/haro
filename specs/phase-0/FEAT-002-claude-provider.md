---
id: FEAT-002
title: Claude Provider（基于 claude-agent-sdk，防封号强绑定 lark-bridge）
status: draft
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-18
related:
  - ../provider-protocol.md
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

- Q1: SDK 的 `query()` 是否原生支持 tool filtering？需 RTFM。若不支持，需要在 ClaudeProvider 层做工具白名单筛选。
- Q2: `maxContextTokens` 是写死还是随 model 动态查询？（SDK 是否暴露）
- Q3: `permission_mode` 映射到 SDK 的哪个参数？lark-bridge 里怎么配的？需要对照
- Q4: session-id 与 SDK 的 `resume` 机制如何映射（Phase 0 可能不需要 resume，Phase 1 再考虑）

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
