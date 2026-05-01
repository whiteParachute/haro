---
id: FEAT-033
title: 定时任务最小版（cron + once）
status: draft
phase: phase-1.5
owner: whiteParachute
created: 2026-05-01
updated: 2026-05-01
related:
  - ../phase-1/FEAT-014-team-orchestrator.md
  - ../phase-1/FEAT-023-permission-token-budget-guard.md
  - ../phase-1.5/FEAT-032-mcp-tool-layer.md
  - ../phase-1.5/FEAT-038-web-api-decoupling.md
  - ../phase-1.5/FEAT-039-cli-feature-parity.md
  - ../../docs/architecture/overview.md
  - ../../docs/planning/redesign-2026-05-01.md
---

# 定时任务最小版（cron + once）

## 1. Context / 背景

Haro Phase 0 / Phase 1 没有"定时任务"概念：agent 完成任务即结束，无法 schedule 一个未来执行；用户也无法说"每天 9 点跑一遍 X"。这导致几类典型自用场景缺失：

- 周期性收集（每天聚合 PR 状态、每周清理过期 session）
- 延迟执行（"30 分钟后再问我一次"、"明天上午发提醒"）
- 监控触发（agent 检测到指标异常后定时复查）

happyclaw 的 schedule_task 三模式（cron / interval / once）+ 两上下文（group / isolated）已经验证可用。Phase 1.5 取**最小子集**：只做 cron + once，复用现有 session 上下文（group 模式）；isolated 模式与 interval 模式延后到 Phase 2.0+ 视需要再做。

## 2. Goals / 目标

- G1: 新增 `ScheduledTaskManager`，支持 cron 表达式（标准 5/6 字段）和一次性 ISO timestamp 触发。
- G2: 任务上下文复用现有 session：到点后 spawn agent runtime 处理 task spec，session-id 等于注册任务时的 session。
- G3: CLI 命令族 `haro schedule list/show/create/cancel`（FEAT-039 CLI 等价补完同步落地）。
- G4: Dashboard 提供"任务"页：列表、详情、手动触发、取消（详情走 FEAT-039 实施时再补 UI 段）。
- G5: 暴露 `schedule_task` MCP 工具（FEAT-032 实现）。
- G6: 任务持久化：进程重启后未执行任务不丢失。
- G7: 配额与守门：单 session 同时有效任务数上限（默认 50），cron 频率下限（默认 ≥1 分钟一次）；超限走 FEAT-023 Permission Guard。

## 3. Non-Goals / 不做的事

- 不实现 interval 模式（fixed delay between runs）；可用 cron 模拟。
- 不实现 isolated 上下文（独立环境无 session 复用）；延后到 Phase 2.0+。
- 不实现任务依赖图 / 工作流编排；任务之间相互独立。
- 不引入分布式调度（单进程内即可）；多实例协作属于已移除的 Phase 4 范围。
- 不实现 timezone 自动检测；所有 cron 默认按 system timezone 解析，cron expression 接受 `TZ=` 前缀显式指定。
- 不允许 cron 频率高于 1 分钟一次（防止 abuse），明确报错引导用户写脚本而非 schedule。

## 4. Requirements / 需求项

- R1: 新建 `packages/core/src/scheduled-tasks/`，包含 `manager.ts`、`storage.ts`、`runner.ts`、`cron-parser.ts`。
- R2: 任务持久化使用 `~/.haro/scheduled-tasks.sqlite`，schema 见 §5.3；进程启动时加载未来任务 + 重新调度。
- R3: 调度引擎使用 `node-schedule` 或等价库；不允许引入 cron daemon / systemd timer 等外部依赖。
- R4: 任务 spec 至少包含 `{ id, sessionId, mode: 'cron'|'once', when, taskInput, agentId?, status, createdAt, lastRunAt?, nextRunAt? }`。
- R5: 任务执行时 spawn `AgentRunner.run({ task: taskInput, sessionId, agentId })`，事件流并入原 session events，可在 SessionDetailPage 看到。
- R6: 任务失败按 `taskInput.retryPolicy`（默认 `{ max: 3, backoff: 'exponential' }`）重试；最终失败标 `failed`，写 `error` 字段。
- R7: cron 表达式校验：合法语法、最小间隔 ≥1 分钟；非法或过密直接拒绝并返回 remediation。
- R8: `once` 模式 `when` 必须是未来时间（带 5 秒宽限），过期直接拒绝。
- R9: CLI / API / MCP 任三入口共享同一 `ScheduledTaskManager` 实例，行为一致；不允许某入口绕过另一入口的守门。
- R10: 取消运行中任务必须 graceful：发送 abort 信号给 AgentRunner，最多等 30 秒；超时则强制 kill 并标 `cancelled-forced`。

## 5. Design / 设计要点

### 5.1 模块边界

`ScheduledTaskManager` 是 core 内部模块；CLI / web-api / MCP 工具层都通过它的公共 API 操作。

```
ScheduledTaskManager
  ├─ create(spec)         返回 task id
  ├─ cancel(id)
  ├─ trigger(id)          手动立即触发（debug 用）
  ├─ list({ session?, status? })
  ├─ get(id)
  └─ subscribe(callback)  事件订阅（用于 web-api WS 推送）
```

### 5.2 调度循环

进程启动：
1. 加载 `scheduled-tasks.sqlite` 中 `status in (pending, running)` 的任务
2. 对每个 cron 任务用 `node-schedule.scheduleJob(cron, run)` 注册
3. 对每个 once 任务，若 `when > now` 则注册一次性 timer；若 `when <= now` 则按 grace 5 秒判定，超出标 `missed`

任务到时：
1. `runner.execute(task)` → AgentRunner spawn
2. 事件流写入 session_events 同时更新 task status
3. 完成后更新 `lastRunAt` / `nextRunAt`（cron 模式）

### 5.3 SQLite schema

```sql
CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  mode TEXT NOT NULL CHECK(mode IN ('cron','once')),
  when_expr TEXT NOT NULL,
  task_input TEXT NOT NULL,        -- JSON
  retry_policy TEXT,                -- JSON
  status TEXT NOT NULL,             -- pending / running / done / failed / cancelled / missed
  last_run_at INTEGER,
  next_run_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  cancelled_at INTEGER,
  metadata TEXT
);
CREATE INDEX idx_tasks_session ON scheduled_tasks(session_id);
CREATE INDEX idx_tasks_next_run ON scheduled_tasks(next_run_at) WHERE status = 'pending';
```

### 5.4 与 FEAT-023 Permission Guard 的接合

`schedule_task` 写操作要求 `write-local` + `external-service`（cron 长期运行算外部服务）；超 50 任务 / 高频 cron 触发 `budget-increase` 审批。

### 5.5 CLI 命令面（详细在 FEAT-039）

```bash
haro schedule list [--session <id>] [--status pending|done|failed]
haro schedule show <id>
haro schedule create --cron "0 9 * * *" --task "..." --session <id>
haro schedule create --once 2026-05-15T09:00:00+08:00 --task "..." --session <id>
haro schedule cancel <id>
haro schedule trigger <id>     # 手动立即跑（debug）
```

## 6. Acceptance Criteria / 验收标准

- AC1: 注册一个 `cron: "*/5 * * * *"` 任务，连续 15 分钟内触发 3 次，session events 含 3 条对应记录（对应 R5）。
- AC2: 注册 `once: 2 分钟后` 任务，进程重启后到点正确触发（对应 R2、R8）。
- AC3: 注册 cron `"* * * * * *"`（每秒）被拒绝，错误码 `CRON_FREQUENCY_TOO_HIGH`，remediation 指向"≥ 1 分钟"（对应 R7）。
- AC4: 单 session 注册到 51 个任务时第 51 个被拒绝，错误码 `SCHEDULE_QUOTA_EXCEEDED`（对应 G7、R9）。
- AC5: 取消 running 任务时 AgentRunner 收到 abort，30 秒内 graceful 结束；30 秒超时则强 kill，task 标 `cancelled-forced`（对应 R10）。
- AC6: CLI `haro schedule list` 与 web-api `/api/v1/schedule/tasks` 与 MCP `schedule_task` 列出的任务集合一致（对应 R9）。

## 7. Test Plan / 测试计划

- 单元测试：cron-parser 边界用例（5/6 字段、TZ 前缀、非法语法）；once 时间窗判定；retry policy 指数回退。
- 集成测试：进程重启 → 任务恢复；cron 触发 → AgentRunner 执行 → events 写入；cancel running 任务的 graceful + forced 路径。
- 性能：1000 个 cron 任务并存时调度引擎 CPU 占用 < 5%；触发抖动 < 5s。
- 安全：cron 注入（恶意表达式 / 命令拼接）；taskInput 大小限制（默认 64KB）。
- 回归：FEAT-014 Team Orchestrator session events、FEAT-023 Permission Guard 决策。

## 8. Open Questions / 待定问题

- Q1: 同时 due 的多个任务是否串行还是并行？倾向并行但受 FEAT-023 budget 控制；待 FEAT-040 Self-Monitor 看实际并发负载再调。
- Q2: 任务可以读写哪些目录？复用 session workspace 还是独立沙箱？倾向复用 session workspace（group 模式定义），isolated 模式留给后续。
- Q3: 错过的 cron 触发要补跑吗？倾向不补（最小复杂度）；进程长时间下线后只跑下一次。
- Q4: 任务输出（stdout / 错误）是否要单独存档？倾向并入 session events，减少新表。

## 9. Changelog / 变更记录

- 2026-05-01: whiteParachute — 初稿（Phase 1.5 自用底座补完批次 1）
