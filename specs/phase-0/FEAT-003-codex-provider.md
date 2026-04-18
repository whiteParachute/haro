---
id: FEAT-003
title: Codex Provider（基于 @openai/codex-sdk）
status: draft
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-18
related:
  - ../provider-protocol.md
  - ../../docs/architecture/provider-layer.md
  - ./FEAT-002-claude-provider.md
  - ../../roadmap/phases.md#p0-3codex-provider
---

# Codex Provider

## 1. Context / 背景

Codex 是 Phase 0 的第二个 Provider，用于代码类任务（默认选择规则 `code-generation` 会把代码类任务优先路由给 Codex）。Codex 与 Claude 的接入模型差异较大：轮次制（无中途推送）、通过 `previous_response_id` 管理上下文、工具调用需要外部 MCP 处理。本 spec 覆盖 Codex 的最小可用接入。

## 2. Goals / 目标

- G1: 通过 `@openai/codex-sdk` 对接 Codex，实现 `AgentProvider` 接口
- G2: 支持跨轮次上下文延续（`previous_response_id`）
- G3: Provider 独立可插拔，与 Claude Provider 无耦合

## 3. Non-Goals / 不做的事

- 不做 Codex 的工具调用（MCP 外部处理，推迟到 Phase 1）
- 不做流式推送（Codex 协议不支持；`capabilities().streaming = false`）
- 不做多账号 / 配额管理（Phase 1+）

## 4. Requirements / 需求项

- R1: 实现 `CodexProvider implements AgentProvider`，`id = 'codex'`
- R2: `query()` 调用 `@openai/codex-sdk` 的轮次接口；接收 `AgentQueryParams.sessionContext.previousResponseId` 并透传
- R3: 将 Codex 的单次响应转换为 Haro `AgentResultEvent`，把返回的 `response_id` 填入 `responseId` 字段（供下一轮延续）
- R4: `capabilities()` 返回：`{ streaming: false, toolLoop: false, contextCompaction: false, contextContinuation: true }`
- R5: 认证通过 `~/.haro/config.yaml::providers.codex.apiKey`（支持 `${OPENAI_API_KEY}` 环境变量插值）
- R6: `healthCheck()` 调用 SDK 的 models 列表或一个轻量 ping 验证 key 有效
- R7: 独立 npm 包 `@haro/provider-codex`，与 Claude Provider 完全无耦合
- R8: 无流式的单次响应延迟应在合理阈值内（软目标：p95 < 30s，记日志用于 FEAT-005 的 fallback 决策）

## 5. Design / 设计要点

**会话延续**

```
第 1 轮 query → Codex 返回 response_id=r1 → Haro 存为 session_events.response_id
第 2 轮 query(previousResponseId=r1) → Codex 返回 response_id=r2
...
```

Session 级 `response_id` 存储由 FEAT-005 的 Agent Runtime 负责，本 spec 只负责透传。

**错误处理**

| 错误 | 处理 |
|------|------|
| 401 Unauthorized | `AgentErrorEvent { code: 'auth_error', retryable: false }` |
| 429 Rate Limit | `{ code: 'rate_limit', retryable: true }`，由 FEAT-005 决定是否 fallback |
| 408 Timeout | `{ code: 'timeout', retryable: true }` |
| 5xx | `{ code: 'upstream_error', retryable: true }` |
| 上下文超长 | `{ code: 'context_too_long', retryable: false }`（上层清空 previous_response_id 后重试） |

## 6. Acceptance Criteria / 验收标准

- AC1: 手动运行 `pnpm --filter @haro/provider-codex test:live`（需有 key），完成一次 "Write hello world in Python" 查询并收到代码（对应 R1~R3）
- AC2: 连续两次 query，第二次传入第一次的 `responseId`，Codex 响应显示记住上下文（对应 R2、R3）
- AC3: 故意传非法 key，`healthCheck()` 在 5 秒内返回 false；`query()` 产生 `auth_error` 且 `retryable: false`（对应 R6）
- AC4: `CodexProvider.capabilities()` 严格符合 AgentCapabilities 类型定义（对应 R4）
- AC5: 移除 `@haro/provider-codex` 包，核心模块启动仍成功，仅 warn（对应 R7 + 可插拔原则）
- AC6: p95 响应延迟日志字段 `latency_ms` 在 `session_events` 表中可查（对应 R8）

## 7. Test Plan / 测试计划

- 单元测试：
  - `codex-provider.capabilities.test.ts`（AC4）
  - `error-mapping.test.ts` — 各 HTTP 状态码 → AgentErrorEvent（错误 code/retryable 覆盖）
  - `context-continuation.test.ts` — 透传 previousResponseId（mock SDK）
- 集成测试（`@live`）：
  - `smoke.live.test.ts` — 真实 query + 上下文延续（AC1、AC2）
  - `auth-failure.live.test.ts` — 伪造非法 key（AC3）
- 手动验证：
  - AC5 卸包场景
  - AC6 延迟日志观察

## 8. Open Questions / 待定问题

- Q1: `@openai/codex-sdk` 是否已公开发布？若未发布，使用 `openai` SDK 的 `responses.create()` 是否等价？
- Q2: Codex 的"工具调用"在 Phase 0 彻底不支持是否可以接受？（默认选择规则会把代码生成路由给 Codex，但代码生成多数不需要工具）
- Q3: 上下文超长时的自动降级：Phase 0 抛错，还是自动清空 previous_response_id 重试？建议先抛错，让 FEAT-005 决策
- Q4: 是否保留 `codex-1-mini` 的 fallback 作为 Phase 0 默认？

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
