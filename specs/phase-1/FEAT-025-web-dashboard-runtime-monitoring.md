---
id: FEAT-025
title: Web Dashboard — Runtime Logs & Provider Monitoring（运行时日志与 Provider 监控）
status: done
phase: phase-1
owner: whiteParachute
created: 2026-04-25
updated: 2026-04-26
related:
  - ./FEAT-018-web-dashboard-orchestration-observability.md
  - ./FEAT-023-permission-token-budget-guard.md
  - ../phase-0/FEAT-005-single-agent-execution-loop.md
  - ../provider-protocol.md
  - ../../docs/modules/agent-runtime.md
---

# Web Dashboard — Runtime Logs & Provider Monitoring（运行时日志与 Provider 监控）

## 1. Context / 背景

FEAT-018 拆分后，workflow 调试由 FEAT-018 承担，Knowledge/Skills 由 FEAT-024 承担。本 spec 承接原 FEAT-018 中剩余的运行时观测能力：Session events、Provider fallback log、Provider 调用统计、活跃 session 与系统运行状态。

这部分价值是帮助用户判断 Haro 是否健康运行、哪个 provider/model 失败率高、fallback 是否频繁、当前有哪些 session 活跃。它不负责 workflow checkpoint 级调试，也不负责 Memory/Skills 生命周期。

## 2. Goals / 目标

- G1: 实现 LogsPage，支持 Session events 和 provider_fallback_log 查询。
- G2: 实现 InvokeAgentPage，展示 provider 调用次数、成功率、平均延迟、fallback 次数。
- G3: 实现 MonitorPage，实时展示活跃 session 和系统状态。
- G4: 暴露 Providers / Logs / Monitor REST 或 WebSocket read model。
- G5: 读取 FEAT-023 的 token budget ledger，展示 provider/model token 使用趋势。

## 3. Non-Goals / 不做的事

- 不实现 workflow 图和 checkpoint debug drawer；属于 FEAT-018。
- 不实现 Knowledge/Skills 页面；属于 FEAT-024。
- 不修改 ProviderRegistry 或 AgentRunner 核心调用语义。
- 不提供 provider 配置编辑；系统配置属于 FEAT-017，Provider 深度管理另立 spec。
- 不接入真实计费账单；Phase 1 只展示 token 和估算成本。

## 4. Requirements / 需求项

- R1: REST API 覆盖 logs 领域：`GET /api/v1/logs/session-events`、`GET /api/v1/logs/provider-fallbacks`。
- R2: session events 查询必须支持 sessionId、agentId、eventType、时间范围、limit。
- R3: provider fallback 查询必须展示 sessionId、originalProvider、fallbackProvider、trigger、ruleId、createdAt。
- R4: REST API 覆盖 providers 统计：`GET /api/v1/providers/stats`，按 `24h`、`7d`、`all` 三个窗口返回 provider/model 调用次数、成功率、fallback 次数、平均延迟、token 使用量。
- R5: MonitorPage 必须订阅 WebSocket `system.status` 和 `session.update`，展示活跃 session 列表。
- R6: Provider stats 必须来自 session_events、provider_fallback_log 和 FEAT-023 budget ledger；不得用静态 mock 作为成功路径。
- R7: 页面必须能显示 provider unhealthy/fallback spike，但不得自动切换 provider 或修改 selection rules。
- R8: LogsPage 必须支持 JSON 事件格式化，避免只显示自由文本摘要。
- R9: Runtime provider 调用事件必须将可靠的 latency 字段落库记录，Provider stats 的 `avgLatencyMs` 必须基于落库字段聚合。

## 5. Design / 设计要点

### 5.1 新增后端文件

```
packages/cli/src/web/routes/
├── logs.ts
└── providers.ts
```

### 5.2 新增前端文件

```
packages/web/src/
├── pages/
│   ├── LogsPage.tsx
│   ├── InvokeAgentPage.tsx
│   └── MonitorPage.tsx
└── components/
    ├── logs/
    │   ├── EventFilterBar.tsx
    │   └── EventTable.tsx
    └── monitor/
        ├── LiveSessionMonitor.tsx
        └── ProviderStatsTable.tsx
```

### 5.3 Provider stats

推荐统计字段：

```typescript
interface ProviderStats {
  provider: string;
  model: string;
  callCount: number;
  successCount: number;
  failureCount: number;
  fallbackCount: number;
  avgLatencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
}
```

聚合窗口必须覆盖 `24h`、`7d`、`all` 三种固定窗口。API 可以返回 `{ windows: { "24h": ProviderStats[], "7d": ProviderStats[], all: ProviderStats[] } }` 或等价结构，但前端必须能同时展示三种窗口的统计结果。

### 5.4 Latency recording

Provider 调用事件必须记录可靠的 latency 字段并落库。若现有 runtime 事件缺少稳定字段，FEAT-025 实现应在不改变 ProviderRegistry / AgentRunner 核心调用语义的前提下补充 provider 调用耗时记录，使 `avgLatencyMs` 不再是空占位字段。

### 5.5 MonitorPage

- 活跃 session：sessionId、agentId、provider/model、status、startedAt、duration。
- 系统状态：WebSocket 连接状态、DB 状态、gateway/channel 摘要链接。
- 预算状态：读取 budget summary，只展示，不审批。

## 6. Acceptance Criteria / 验收标准

- AC1: LogsPage 可按 sessionId、eventType、时间范围筛选 session events，并展示格式化 JSON。（对应 R1-R2、R8）
- AC2: Provider fallback log 可展示 original/fallback provider、trigger、ruleId 和时间。（对应 R3）
- AC3: InvokeAgentPage 可按 `24h`、`7d`、`all` 三个窗口展示 provider/model 调用次数、成功率、fallback 次数、平均延迟和 token 使用趋势。（对应 R4、R6、R9）
- AC4: MonitorPage 可通过 WebSocket 展示活跃 session，断开后重连并恢复订阅。（对应 R5）
- AC5: 页面发现 provider unhealthy 或 fallback spike 时只展示告警，不自动修改 provider selection。（对应 R7）

## 7. Test Plan / 测试计划

- 后端 API 测试：session events filter、provider fallback query、provider stats aggregation。
- 后端聚合测试：provider stats 覆盖 `24h`、`7d`、`all` 三个窗口，并验证 `avgLatencyMs` 来自落库 latency 字段。
- 前端测试：EventFilterBar、EventTable、ProviderStatsTable、LiveSessionMonitor。
- WebSocket 测试：system.status/session.update 订阅、断线重订阅。
- 回归测试：ProviderRegistry 和 AgentRunner 核心调用不因监控页面改变。

## 8. Open Questions / 待定问题

全部已关闭。2026-04-26 owner 决策：

- Q1: latency 字段需要落库记录，`avgLatencyMs` 必须基于落库 latency 聚合，不作为 Phase 1 空占位。
- Q2: provider stats 按 `24h`、`7d`、`all` 三个固定窗口聚合，不只做单一 `since` 查询参数。

## 9. Changelog / 变更记录

- 2026-04-25: Codex — 从 FEAT-018 拆分 LogsPage、InvokeAgentPage、MonitorPage，形成独立 FEAT-025。
- 2026-04-26: owner approval — 关闭 Open Questions：确认 latency 字段落库记录，provider stats 按 `24h`、`7d`、`all` 三窗口聚合；status: draft → approved。

- 2026-04-26: implementation done — Runtime Logs & Provider Monitoring 已交付。
  - 核心交付：新增 `/api/v1/logs/session-events`、`/api/v1/logs/provider-fallbacks`、`/api/v1/providers/stats`；Runner terminal events 补充 provider/model/latencyMs 并落库 `session_events.latency_ms`；前端新增 Logs、Invoke/Provider Monitoring、Monitor 页面和日志/监控组件；WebSocket client 断线后恢复 system/sessions/session 订阅。
  - 验证命令：`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm smoke`、Playwright browser smoke（截图 `/tmp/haro-feat-025-web-smoke.png`）。
  - Commit: 2d59328。
