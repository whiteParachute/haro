---
id: FEAT-040
title: Self-Monitor（被动观测埋点）
status: draft
phase: phase-2.0
owner: whiteParachute
created: 2026-05-01
updated: 2026-05-01
related:
  - ../phase-1/FEAT-014-team-orchestrator.md
  - ../phase-1/FEAT-021-memory-fabric-v1.md
  - ../phase-1/FEAT-023-permission-token-budget-guard.md
  - ../phase-1/FEAT-025-web-dashboard-runtime-monitoring.md
  - ../phase-1.5/FEAT-031-web-channel.md
  - ../phase-1.5/FEAT-032-mcp-tool-layer.md
  - ../phase-1.5/FEAT-033-scheduled-tasks.md
  - ../phase-2.0/FEAT-036-industry-intel.md
  - ../phase-2.0/FEAT-041-auto-eat-shit-trigger.md
  - ../phase-2.5/FEAT-042-pattern-miner.md
  - ../evolution-engine-protocol.md
  - ../../docs/architecture/overview.md
  - ../../docs/planning/archive/redesign-2026-05-01.md
---

# Self-Monitor（被动观测埋点）

## 1. Context / 背景

进化层的第一个驱动源是"使用记忆"——Haro 自己的运行轨迹（[overview § 四个进化驱动源](../../docs/architecture/overview.md#四个进化驱动源)）。但 Phase 1 的运行时只把数据散落在 session_events / channel logs / token_budget_ledger / tool_invocation_log 等多张表，没有统一的"自我观测"汇聚点。这导致：

- Pattern Miner（FEAT-042）找不到一致的特征视图
- Auto eat/shit Trigger（FEAT-041）阈值无法定义
- Evolution Proposal（FEAT-037）证据链得现挖现拼

Self-Monitor 是 **被动观测层**：不增加新的强制行为，只把已经在发生的事件结构化、归一化、汇聚到 `self_monitor` 系列表，并定义稳定的查询视图给 Phase 2.0+ 模块消费。

**关键约束**：Self-Monitor 的"被动埋点"理念要求 Phase 1.5 各 spec（FEAT-031 / 032 / 033 / 038 / 039）在实现时**预先埋好钩子**，不是 Phase 2.0 反过来改它们。本 spec 既是 Phase 2.0 的消费规范，也是 Phase 1.5 的埋点约定。

## 2. Goals / 目标

- G1: 新增 `SelfMonitor` 服务，统一收集 session / tool / channel / scheduled-task / industry-intel / memory / budget 七大子系统事件。
- G2: 定义稳定的特征视图（feature views）：失败模式、token 浪费、skill 命中率、工具耗时分布、channel 活跃度、记忆访问热度。
- G3: 数据保留策略：原始事件 30 天，5 分钟级聚合 90 天，1 小时级聚合 1 年；超期自动归档（配合 FEAT-011 shit）。
- G4: 暴露 query API：`SelfMonitor.featureView(name, range)` 返回结构化特征；不允许下游模块直接 SQL 查原始表。
- G5: Phase 1.5 实现钩子约定：在 FEAT-031 / 032 / 033 / 038 / 039 实现时预埋 `recordEvent(...)` 调用，事件 schema 由本 spec 定义。
- G6: Dashboard `/monitor` 页（FEAT-025 已存在）扩展进化指标视图，显示 Self-Monitor 特征趋势（详细 UI 段为 follow-up）。

## 3. Non-Goals / 不做的事

- 不引入 OpenTelemetry / Prometheus / Jaeger；自用单机 SQLite + 自维护视图就够。
- 不发外部 telemetry；所有数据本地保留，不脱出本机。
- 不做实时告警（"token 突增推送"）；告警留给 Phase 3.0+ 视情况。
- 不收集用户内容（消息原文、记忆原文）；只收集元数据（长度、token、状态、耗时、错误码）。
- 不替代 FEAT-025 Runtime Monitoring 的运维监控；Self-Monitor 是给进化层用的特征层，运维监控继续走原路径，两者数据可重叠但 schema 不强一致。
- 不做跨实例数据合并；单实例自闭。

## 4. Requirements / 需求项

- R1: 新建 `packages/core/src/self-monitor/`，含 `service.ts` / `events.ts` / `aggregations.ts` / `feature-views.ts` / `retention.ts`。
- R2: 事件 schema 至少覆盖以下 kind：`session_started` / `session_completed` / `session_errored` / `message_sent` / `message_received` / `tool_invoked` / `tool_failed` / `tool_retried` / `skill_invoked` / `memory_query` / `memory_write` / `channel_event` / `scheduled_task_triggered` / `scheduled_task_failed` / `budget_check` / `budget_denied` / `intel_fetched`。
- R3: 每条事件必须含 `{ kind, occurredAt, sessionId?, agentId?, channelId?, providerId?, payload?, latencyMs?, status?, errorCode? }`；`payload` 限制 1KB JSON，超出截断。
- R4: 5 分钟聚合任务：每 5 分钟扫描 raw events 表，写聚合表 `self_monitor_5m`；1 小时聚合同理写 `self_monitor_1h`。
- R5: 特征视图列表：`failure_pattern_by_tool` / `token_waste_by_session` / `skill_hit_rate_by_agent` / `tool_latency_p50_p95_p99` / `channel_activity_by_hour` / `memory_query_topk_keywords` / `scheduled_task_success_ratio` / `budget_violation_frequency`。
- R6: 每个特征视图必须有稳定 schema（不变更字段名 / 类型）；新增视图走新 view name，不在已有视图加字段。
- R7: 数据保留：raw events 30 天滚动删除；5m 聚合 90 天；1h 聚合 1 年；超期数据走 FEAT-011 shit 归档。
- R8: 钩子约定：Phase 1.5 各模块在以下点位调用 `selfMonitor.recordEvent(...)`：
    - `agent-runtime`: session start / done / error / each tool invoke / each retry
    - `web-api`: WS connect / disconnect / per-route latency（不含 payload）
    - `mcp-tools`: per tool call decision / latency / error
    - `channel-*`: send / receive / fail
    - `scheduled-tasks`: trigger / done / fail
    - `industry-intel`: fetch / dedup / passed / failed
    - `memory-fabric`: query / write
    - `permission-budget`: decision / denied / approved / exceeded
- R9: `recordEvent` 必须 fire-and-forget（async batch flush），不阻塞调用方主路径，P99 < 1ms。
- R10: 提供 CLI: `haro monitor stats` / `haro monitor view <feature> --range 24h` / `haro monitor export --range 7d --output <dir>`。

## 5. Design / 设计要点

### 5.1 数据库 schema

```sql
CREATE TABLE self_monitor_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  session_id TEXT,
  agent_id TEXT,
  channel_id TEXT,
  provider_id TEXT,
  status TEXT,
  error_code TEXT,
  latency_ms INTEGER,
  payload TEXT
);
CREATE INDEX idx_self_monitor_events_time ON self_monitor_events(occurred_at);
CREATE INDEX idx_self_monitor_events_kind ON self_monitor_events(kind, occurred_at);

CREATE TABLE self_monitor_5m (
  bucket_start INTEGER NOT NULL,
  kind TEXT NOT NULL,
  agent_id TEXT,
  channel_id TEXT,
  provider_id TEXT,
  count INTEGER NOT NULL,
  total_latency_ms INTEGER,
  error_count INTEGER,
  PRIMARY KEY (bucket_start, kind, agent_id, channel_id, provider_id)
);
-- self_monitor_1h schema 同 5m，bucket 改为 hour
```

### 5.2 写入 pipeline

```
caller.recordEvent(event)
  └─ async batch buffer (max 1000 / 1s flush)
       └─ batch INSERT INTO self_monitor_events
```

聚合任务由 FEAT-033 Scheduled Tasks 注册 cron `*/5 * * * *` 与 `0 * * * *` 触发，调用 `aggregations.runFiveMinute()` / `runHourly()`。

### 5.3 特征视图举例

```ts
// failure_pattern_by_tool
interface FailurePatternByToolRow {
  tool: string;
  errorCode: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  topAgents: { agentId: string; count: number }[];
}
selfMonitor.featureView('failure_pattern_by_tool', { range: '24h' })
  → FailurePatternByToolRow[]
```

### 5.4 retention / 归档

retention 任务每天跑一次：
1. 删除 raw events `occurred_at < now - 30d`
2. 删除 5m 聚合 `bucket_start < now - 90d`
3. 删除 1h 聚合 `bucket_start < now - 365d`
4. 删除前调用 FEAT-011 shit，把超期数据归档到 `~/.haro/archive/self-monitor-<ts>/`

### 5.5 与 FEAT-041 / FEAT-042 的接口

- FEAT-041 Auto eat/shit Trigger 通过 `featureView` 决定是否触发 eat（外部新条目超阈值）或 shit（低命中率 skill）
- FEAT-042 Pattern Miner 把多个 featureView 串成"模式"（"工具 X 失败率上升 + 同期 Industry Intel 提到 X 升级" → proposal）

## 6. Acceptance Criteria / 验收标准

- AC1: 跑 24 小时正常使用后，`self_monitor_events` 表至少有 7 类事件（对应 R2、R8）。
- AC2: 5 分钟聚合 cron 执行后，`self_monitor_5m` 行数 = 唯一 (bucket, kind, dims) 数（对应 R4）。
- AC3: `selfMonitor.featureView('tool_latency_p50_p95_p99', { range: '1h' })` 返回每个 tool 的 P50/P95/P99（对应 R5）。
- AC4: 31 天前的 raw events 被 retention 任务删除，且归档目录存在 manifest.json（对应 R7）。
- AC5: `recordEvent` P99 < 1ms（synthetic load 1000 evt/s, 1 分钟）（对应 R9）。
- AC6: `haro monitor view tool_latency_p50_p95_p99 --range 24h` CLI 输出与 web-api `/api/v1/monitor/views/...` 一致（对应 R10）。
- AC7: 新增视图不变更已有视图 schema；CI 校验所有视图 type 文件 hash 在已有视图上不变（对应 R6）。

## 7. Test Plan / 测试计划

- 单元测试：每种事件 schema 校验；聚合函数边界（空桶 / 跨桶 / 时区）；retention 删除范围。
- 集成测试：起完整服务 + 模拟负载 → 5m / 1h 聚合 → featureView 输出对账。
- 性能：1 万事件 / 秒峰值下批量 flush 不丢事件。
- 隐私：抽样 10000 事件 payload 字段确认无消息内容 / 记忆原文 / 凭据。
- 回归：FEAT-025 Runtime Monitoring 既有页面无 schema 影响。

## 8. Open Questions / 待定问题

- Q1: 是否要把 Self-Monitor 数据库与主 SQLite 物理分离？倾向同库不同表，简化备份；如果体积失控再分。
- Q2: Phase 1.5 各 spec 的钩子调用如果漏埋怎么办？倾向 CI 加 lint 规则：每个 spec 实现 commit 必须含 `recordEvent` 调用（按目录粒度检查）。
- Q3: 是否需要为视图加 SQL view（持久化视图）？倾向不加，特征视图是 TypeScript 函数，避免 schema migration 痛点。
- Q4: 收集是否要默认启用？倾向是默认启用，提供 `~/.haro/config.yaml` 中 `selfMonitor.enabled: false` 显式关闭，关闭时 `recordEvent` 变 no-op。

## 9. Changelog / 变更记录

- 2026-05-01: whiteParachute — 初稿（Phase 2.0 进化感知层批次 2）
