---
id: FEAT-003
title: Codex Provider（基于 @openai/codex-sdk）
status: done
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-19
related:
  - ../provider-protocol.md
  - ../../docs/architecture/provider-layer.md
  - ./FEAT-002-claude-provider.md
  - ./FEAT-005-single-agent-execution-loop.md
  - ./FEAT-007-memory-fabric-independent.md
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
- R4: `capabilities()` 返回：`{ streaming: false, toolLoop: false, contextCompaction: false, contextContinuation: true }`；`maxContextTokens` 字段**不硬编码**，通过 `listModels()` 实时查询 Codex API 得到（见 §5"模型列表实时获取"）
- R5: 认证读取 `process.env.OPENAI_API_KEY`；`~/.haro/config.yaml::providers.codex` 可选 `baseUrl`（企业端点覆盖）；YAML 里**不**做 `${ENV}` 插值（与 Claude Provider 禁 apiKey 的立场呼应：凭证不进配置文件）
- R6: `healthCheck()` 调用 SDK 的 models 列表接口验证 key 有效；5s 超时兜底（沿用 FEAT-002 的 race 模式）
- R7: 独立 npm 包 `@haro/provider-codex`，与 Claude Provider 完全无耦合
- R8: Provider 层**不**内置任何兜底模型（例如不硬编码 `codex-1-mini`）。模型清单全部走 `listModels()` 实时获取；上层（FEAT-005 Runner）需要兜底时从实时清单里挑选，不从代码常量里读

## 5. Design / 设计要点

**SDK 选型与对照**

参考本组织已落地项目（`lark-bridge` / `KeyClaw-fresh` / `happyclaw-yl-new`）均使用 `@openai/codex-sdk`；原生 `openai` SDK 在 KeyClaw-fresh 的 "GPT 大清洗" 中已被删除。Haro 直接采用 `@openai/codex-sdk`，**不**再引入原生 `openai` 包。与 FEAT-002 的差异：Codex 没有封号合规顾虑，因此**不设 ESLint 拦截**（与 FEAT-002 R6 对 `@anthropic-ai/sdk` 的全局封禁不同）。

**模型列表实时获取**

- `listModels(): Promise<readonly CodexModelInfo[]>` —— 调用 Codex API `/models` 接口获取当前可用模型及其上下文长度，进程内 TTL 缓存（默认 10 分钟）
- `capabilities()` 的 `maxContextTokens` 字段通过 `listModels()` 查到当前选中模型的窗口后填充；未选定模型时返回 `undefined`
- **没有代码内硬编码的兜底模型**。FEAT-005 Runner 需要 fallback 时，从 `listModels()` 结果里按策略挑（如"选 context 最大的非 deprecated 模型"）

**会话延续**

```
第 1 轮 query → Codex 返回 response_id=r1 → Haro 存为 session_events.response_id
第 2 轮 query(previousResponseId=r1) → Codex 返回 response_id=r2
...
```

Session 级 `response_id` 存储由 FEAT-005 的 Agent Runtime 负责，本 spec 只负责透传。

**上下文超长处理（分层）**

| 层 | 职责 |
|----|------|
| FEAT-003 Provider | 只翻译错误：发 `AgentErrorEvent { code: 'context_too_long', retryable: false, hint: 'save-and-clear' }` |
| FEAT-005 Runner | 看到 `hint === 'save-and-clear'` 时调 `MemoryFabric.wrapupSession()` 把当前上下文落成 impression，清空 `previousResponseId`，重新发起 query |
| Memory Fabric | 承接 session 收尾写入，保证"清空上下文但不丢失记忆" |

这样把"保存记忆并 clear"的策略沉淀到 Runner + Memory Fabric 协同，Provider 保持无状态。

**错误处理**

| 错误 | 处理 |
|------|------|
| 401 Unauthorized | `AgentErrorEvent { code: 'auth_error', retryable: false }` |
| 429 Rate Limit | `{ code: 'rate_limit', retryable: true }`，由 FEAT-005 决定是否 fallback |
| 408 Timeout | `{ code: 'timeout', retryable: true }` |
| 5xx | `{ code: 'upstream_error', retryable: true }` |
| 上下文超长 | `{ code: 'context_too_long', retryable: false, hint: 'save-and-clear' }`（参见上文分层处理） |

## 6. Acceptance Criteria / 验收标准

- AC1: 手动运行 `pnpm --filter @haro/provider-codex test:live`（需有 key），完成一次 "Write hello world in Python" 查询并收到代码（对应 R1~R3）
- AC2: 连续两次 query，第二次传入第一次的 `responseId`，Codex 响应显示记住上下文（对应 R2、R3）
- AC3: 故意传非法 key，`healthCheck()` 在 5 秒内返回 false；`query()` 产生 `auth_error` 且 `retryable: false`（对应 R6）
- AC4: `CodexProvider.capabilities()` 严格符合 AgentCapabilities 类型定义；`maxContextTokens` 来源于 `listModels()` 实时结果而非代码常量（对应 R4、R8）
- AC5: 移除 `@haro/provider-codex` 包，核心模块启动仍成功，仅 warn（对应 R7 + 可插拔原则）
- AC6: `listModels()` 返回的模型列表在 TTL 缓存过期后会重新拉取；`grep -rE "codex-[0-9][^ '\"]*" packages/provider-codex/src` 不得命中代码中硬编码的具体模型 id（对应 R8）
- AC7: 模拟 Codex 返回"上下文超长"错误，Provider 产出的 `AgentErrorEvent` 必须同时携带 `code='context_too_long'` 和 `hint='save-and-clear'`（对应 §5 分层处理；FEAT-005 的 Runner 侧覆盖由 FEAT-005 自己的 AC 验证）

## 7. Test Plan / 测试计划

- 单元测试：
  - `codex-provider.capabilities.test.ts` — capabilities 形状 + 通过 mock `listModels` 注入 maxContextTokens（AC4）
  - `list-models.test.ts` — TTL 缓存命中/失效；AC6 的 grep 约束
  - `error-mapping.test.ts` — 各 HTTP 状态码 → AgentErrorEvent（覆盖 AC3、AC7 的 `context_too_long + hint`）
  - `context-continuation.test.ts` — 透传 previousResponseId（mock SDK）
- 集成测试（`@live`）：
  - `smoke.live.test.ts` — 真实 query + 上下文延续（AC1、AC2）
  - `auth-failure.live.test.ts` — 伪造非法 key（AC3）
- 手动验证：
  - AC5 卸包场景
  - AC6 硬编码模型 grep 过一遍

## 8. Open Questions / 待定问题

全部已关闭（见 Changelog 2026-04-18 决策条）。

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
- 2026-04-18: whiteParachute — 关闭 Open Questions → approved
  - Q1 → 采用 `@openai/codex-sdk`（对齐 lark-bridge / KeyClaw-fresh / happyclaw-yl-new 本组织已验证路径）；不引入原生 `openai` 包；**不**设 ESLint 拦截（Codex 无封号合规顾虑）
  - Q2 → Phase 0 工具调用彻底不支持；MCP 外部处理推迟 Phase 1
  - Q3 → Provider 只翻译错误事件（`context_too_long` + `hint: save-and-clear`）；"保存记忆并 clear"的策略沉淀到 FEAT-005 Runner + FEAT-007 MemoryFabric 协同，Provider 保持无状态
  - Q4 → **不保留** `codex-1-mini` 或任何硬编码兜底模型；模型清单通过 `listModels()` 实时获取（TTL 缓存）；上层需要 fallback 时从实时清单里挑选
  - R5 认证 → 不做 YAML `${ENV}` 插值；Provider 构造时直接读 `process.env.OPENAI_API_KEY`；`providers.codex` 配置只收 `baseUrl` 等非凭证字段
  - 原 AC6（latency_ms 落库）撤回 → 延迟观测由 FEAT-005 Runner 通过 pino 结构化日志统一处理；本 spec 不再要求 `session_events` 加列
  - 新 AC6 → 硬编码模型 id 的 grep 反检查；新 AC7 → `context_too_long` 必须携带 `hint: save-and-clear`
- 2026-04-19: whiteParachute — 实现合入 → done
  - `@haro/provider-codex` 落地 `CodexProvider` + `listModels()` TTL 缓存 + 错误翻译；29 单测（`capabilities.test.ts` / `context-continuation.test.ts` / `error-mapping.test.ts` / `health-check.test.ts` / `list-models.test.ts` / `schema.test.ts`）全绿
  - AC6 的硬编码模型 id grep 作为测试内置（`list-models.test.ts`）；AC7 的 `context_too_long + hint='save-and-clear'` 在 `error-mapping.test.ts` / `context-continuation.test.ts` 双重断言
  - `healthCheck()` 的 5s 超时竞态补齐了计时器 cleanup，避免每次调用留一个 pending timer
  - AC1/AC2/AC3 live 路径新增 `smoke.live.test.ts` / `auth-failure.live.test.ts`（`test:live` 显式触发；默认 test run 排除）
