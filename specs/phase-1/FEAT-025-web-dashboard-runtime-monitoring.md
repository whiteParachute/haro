---
id: FEAT-025
title: Web Dashboard — Runtime Logs & Provider Monitoring（运行时日志与 Provider 监控）
status: draft
phase: phase-1
owner: whiteParachute
created: 2026-04-25
updated: 2026-04-25
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
- R4: REST API 覆盖 providers 统计：`GET /api/v1/providers/stats`，返回 provider/model 调用次数、成功率、fallback 次数、平均延迟、token 使用量。
- R5: MonitorPage 必须订阅 WebSocket `system.status` 和 `session.update`，展示活跃 session 列表。
- R6: Provider stats 必须来自 session_events、provider_fallback_log 和 FEAT-023 budget ledger；不得用静态 mock 作为成功路径。
- R7: 页面必须能显示 provider unhealthy/fallback spike，但不得自动切换 provider 或修改 selection rules。
- R8: LogsPage 必须支持 JSON 事件格式化，避免只显示自由文本摘要。

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

### 5.4 MonitorPage

- 活跃 session：sessionId、agentId、provider/model、status、startedAt、duration。
- 系统状态：WebSocket 连接状态、DB 状态、gateway/channel 摘要链接。
- 预算状态：读取 budget summary，只展示，不审批。

## 6. Acceptance Criteria / 验收标准

- AC1: LogsPage 可按 sessionId、eventType、时间范围筛选 session events，并展示格式化 JSON。（对应 R1-R2、R8）
- AC2: Provider fallback log 可展示 original/fallback provider、trigger、ruleId 和时间。（对应 R3）
- AC3: InvokeAgentPage 可展示 provider/model 调用次数、成功率、fallback 次数和 token 使用趋势。（对应 R4、R6）
- AC4: MonitorPage 可通过 WebSocket 展示活跃 session，断开后重连并恢复订阅。（对应 R5）
- AC5: 页面发现 provider unhealthy 或 fallback spike 时只展示告警，不自动修改 provider selection。（对应 R7）

## 7. Test Plan / 测试计划

- 后端 API 测试：session events filter、provider fallback query、provider stats aggregation。
- 前端测试：EventFilterBar、EventTable、ProviderStatsTable、LiveSessionMonitor。
- WebSocket 测试：system.status/session.update 订阅、断线重订阅。
- 回归测试：ProviderRegistry 和 AgentRunner 核心调用不因监控页面改变。

## 8. Open Questions / 待定问题

- Q1: avgLatencyMs 是否已有可靠事件字段，还是 Phase 1 先留空并只展示 token/call/fallback？
- Q2: provider stats 是否按 24h/7d/全部三个窗口聚合，还是先支持 query 参数 `since`？

## 9. Changelog / 变更记录

- 2026-04-25: Codex — 从 FEAT-018 拆分 LogsPage、InvokeAgentPage、MonitorPage，形成独立 FEAT-025。
