---
id: FEAT-033
title: Cron 任务最小版（cron + once）
status: done
phase: phase-1.5
owner: whiteParachute
created: 2026-05-01
updated: 2026-05-02
related:
  - ../phase-1/FEAT-014-team-orchestrator.md
  - ../phase-1/FEAT-023-permission-token-budget-guard.md
  - ../phase-1.5/FEAT-032-mcp-tool-layer.md
  - ../phase-1.5/FEAT-038-web-api-decoupling.md
  - ../phase-1.5/FEAT-039-cli-feature-parity.md
  - ../../docs/architecture/overview.md
  - ../../docs/planning/archive/redesign-2026-05-01.md
---

# Cron 任务最小版（cron + once）

## 1. Context / 背景

Haro Phase 0 / Phase 1 没有"定时任务"概念：agent 完成任务即结束，无法 schedule 一个未来执行；用户也无法说"每天 9 点跑一遍 X"。这导致几类典型自用场景缺失：

- 周期性收集（每天聚合 PR 状态、每周清理过期 session）
- 延迟执行（"30 分钟后再问我一次"、"明天上午发提醒"）
- 监控触发（agent 检测到指标异常后定时复查）

调研对比：

- **happyclaw** 的 `schedule_task` 三模式（cron / interval / once）+ 两上下文（group / isolated）已经验证可用。
- **hermes-agent**（`NousResearch/hermes-agent`）的 `cron/scheduler.py` 用「`tick()` 纯函数 + 跨进程文件锁 + 多触发源（gateway 后台 thread / standalone daemon / 手工调用）」的设计，**不依赖第三方调度库**，由 store 自己维护 `next_run_at`。这种设计不绑定单一 host 进程，对"web-api 不部署不影响使用"的边界很友好。

Phase 1.5 取**最小子集**：只做 cron + once，复用现有 session 上下文（group 模式）；isolated / interval 模式延后到 Phase 2.0+ 视需要再做。架构上对齐 hermes 的 tick 模型而非 happyclaw 的常驻调度对象。

## 2. Goals / 目标

- G1: 新增 `CronManager`，支持 cron 表达式（标准 5/6 字段）和一次性 ISO timestamp 触发。
- G2: 任务上下文复用现有 session：到点后 spawn agent runtime 处理 task spec，session-id 等于注册任务时的 session。
- G3: CLI 命令族 `haro cron list/show/create/cancel/trigger/tick/daemon`（FEAT-039 CLI 等价补完同步落地）。
- G4: Dashboard 提供"任务"页：列表、详情、手动触发、取消（详情走 FEAT-039 实施时再补 UI 段）。
- G5: 暴露 `schedule_task` MCP 工具（FEAT-032 实现，工具名保留 happyclaw 兼容；内部走 cron service）。
- G6: 任务持久化：进程重启后未执行任务不丢失。
- G7: 配额与守门：单 session 同时有效任务数上限（默认 50），cron 频率下限（默认 ≥1 分钟一次）；超限走 FEAT-023 Permission Guard。
- G8: **触发不绑定单一 host 进程**：web-api 进程、`haro cron daemon`、`haro cron tick` 任一在跑即可触发；都不在跑时任务保持登记，下次任一启动后自动 pick up。

## 3. Non-Goals / 不做的事

- 不实现 interval 模式（fixed delay between runs）；可用 cron 模拟。
- 不实现 isolated 上下文（独立环境无 session 复用）；延后到 Phase 2.0+。
- 不实现任务依赖图 / 工作流编排；任务之间相互独立。
- 不引入分布式调度（单机内即可）；多实例协作属于已移除的 Phase 4 范围。
- 不实现 timezone 自动检测；所有 cron 默认按 system timezone 解析，cron expression 接受 `TZ=` 前缀显式指定。
- 不允许 cron 频率高于 1 分钟一次（防止 abuse），明确报错引导用户写脚本而非 schedule。
- 不强依赖 web-api 进程；web-api 不部署时 `haro cron daemon` / `haro cron tick` 仍能驱动调度。
- 不依赖第三方调度库做内存调度（不引入 node-schedule / APScheduler 等同类常驻对象）；只用 cron 解析库（如 `croner`）算 `next_run_at`。

## 4. Requirements / 需求项

- R1: 新建 `packages/core/src/cron/`，包含 `manager.ts`、`storage.ts`、`runner.ts`、`tick.ts`、`cron-parser.ts`。
- R2: 任务持久化复用主 DB（`~/.haro/haro.sqlite`），新增 `cron_jobs` 表（schema 见 §5.3），加进 `db/schema.ts` 的 `CORE_TABLES`；不引入额外 sqlite 文件。
- R3: 调度模型采用 hermes 风格 `tick()` 纯函数 + 跨进程 lease 锁；**不引入** `node-schedule` / APScheduler / `cron` 等常驻调度对象。Cron 表达式解析允许使用 `croner` 等纯解析器。
- R4: 任务 spec 至少包含 `{ id, sessionId, mode: 'cron'|'once', when, taskInput, agentId?, status, createdAt, lastRunAt?, nextRunAt? }`。
- R5: 任务执行时 spawn `AgentRunner.run({ task: taskInput, agentId, continueFromSessionId: sessionId })`，事件流并入原 session events，可在 SessionDetailPage 看到。
- R6: 任务失败按 `taskInput.retryPolicy`（默认 `{ max: 3, backoff: 'exponential' }`）重试；最终失败标 `failed`，写 `last_error` 字段。
- R7: cron 表达式校验：合法语法、最小间隔 ≥1 分钟；非法或过密直接拒绝并返回 remediation。
- R8: `once` 模式 `when` 必须是未来时间（带 5 秒宽限），过期直接拒绝。
- R9: CLI / web-api / MCP 三入口共享同一 `services.cron.*` 实现，行为一致；不允许某入口绕过另一入口的守门。
- R10: 取消运行中任务必须 graceful：到下一次 tick 时跳过已 cancelled 任务；正在 in-flight 的任务通过 AgentRunner abort signal 中止（最多等 30 秒），超时则强制 abort 并标 `cancelled-forced`。
- R11: `tick()` 必须是无状态纯函数：参数注入 `storage` / `runner` / `now()` / `logger`；不持有内存调度状态；同一时刻只允许一个 tick 在跑（跨进程 lease 锁，租约默认 60 秒可续）。
- R12: 三种触发源：
  - **web-api 进程内 ticker**：进程启动时 `setInterval(tick, 60_000)`，shutdown 时清理；web-api 不启动不影响 R8/R9 的 CRUD 与 daemon/tick 触发。
  - **`haro cron daemon`**：CLI 子命令，前台 while-loop 每 60 秒调 `tick`；`--detach` 写 `~/.haro/cron.pid`。
  - **`haro cron tick`**：CLI 单次 tick，供系统 cron / launchd / CI / debug 调用。

## 5. Design / 设计要点

### 5.1 模块边界

`CronManager` 是 core 内部模块；CLI / web-api / MCP 工具层都通过 `services.cron.*` 操作。

```
CronManager
  ├─ create(spec)         返回 task id
  ├─ cancel(id)
  ├─ trigger(id)          手动立即触发：把 next_run_at 设为 now，下次 tick pick up
  ├─ list({ session?, status? })
  ├─ get(id)
  └─ subscribe(callback)  事件订阅（用于 web-api WS 推送，可选）
```

### 5.2 tick 模型（hermes-agent 风格）

```
tick(deps):
  1. acquire cross-process lease lock（cron_lease 表，单行；lease_until > now 即锁住）
     - 拿不到 → 直接返回（说明另一进程在跑）
  2. due = storage.findDue(now)            -- enabled && next_run_at <= now
  3. for job in due:
       advance_next_run(job)               -- 先写 next_run_at（cron 取下一次；once 标 done-after-run）
                                          -- 崩溃时 at-most-once：宁可漏跑也不重跑
  4. 释放 lease（or 续约后进入执行阶段）
  5. for job in due（可并行，受 FEAT-023 budget 限）：
       runner.execute(job) → AgentRunner.run
       mark_run(job, success/error)
```

进程启动后**不需要**做"加载所有 pending 任务并 register cron handle"——下次 tick 自然 pick up，简化 recovery。

`tick()` 三种调用源（任一即可，可叠加运行；lease 锁防并发）：

| 源 | 触发节奏 | 用途 |
|---|---|---|
| `web-api` 进程内 `setInterval(tick, 60_000)` | 60s | Web 在线时的默认调度 |
| `haro cron daemon` | 60s while-loop | 不跑 web-api 时的兜底 |
| `haro cron tick` | 单次 | 系统 cron / CI / debug |

### 5.3 SQLite schema（合入主 DB CORE_TABLES）

```sql
CREATE TABLE cron_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  mode TEXT NOT NULL CHECK(mode IN ('cron','once')),
  when_expr TEXT NOT NULL,
  task_input TEXT NOT NULL,        -- JSON
  retry_policy TEXT,                -- JSON
  status TEXT NOT NULL,             -- pending / running / done / failed / cancelled / cancelled-forced / missed
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER,
  last_status TEXT,                 -- ok / error
  last_error TEXT,
  last_delivery_error TEXT,
  created_at INTEGER NOT NULL,
  cancelled_at INTEGER,
  metadata TEXT
);
CREATE INDEX idx_cron_jobs_session ON cron_jobs(session_id);
CREATE INDEX idx_cron_jobs_due ON cron_jobs(enabled, next_run_at);

CREATE TABLE cron_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- 单行
  holder TEXT NOT NULL,                    -- "<host>:<pid>"
  acquired_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL
);
```

`cron_lease` 单行哨兵；获取锁用 `UPDATE cron_lease SET holder=?, lease_until=? WHERE id=1 AND lease_until < ?`，affected_rows=1 即拿到。

### 5.4 与 FEAT-023 Permission Guard 的接合

`schedule_task` 写操作要求 `write-local` + `external-service`（cron 长期运行算外部服务）；超 50 任务 / 高频 cron 触发 `budget-increase` 审批。

### 5.5 CLI 命令面（详细在 FEAT-039）

```bash
haro cron list [--session <id>] [--status pending|done|failed]
haro cron show <id>
haro cron create --cron "0 9 * * *" --task "..." --session <id>
haro cron create --once 2026-05-15T09:00:00+08:00 --task "..." --session <id>
haro cron cancel <id>
haro cron trigger <id>         # 把 next_run_at 设为 now，等下次 tick 跑
haro cron tick                 # 立即跑一次 tick（CI / debug / 系统 cron）
haro cron daemon [--detach]    # 前台 / 后台 60s 循环 tick；写 ~/.haro/cron.pid
```

### 5.6 错误码

| code | 含义 |
|---|---|
| `CRON_FREQUENCY_TOO_HIGH` | cron 频率小于 1 分钟一次 |
| `CRON_QUOTA_EXCEEDED` | 单 session 任务数超 50 |
| `CRON_INVALID_EXPRESSION` | cron 语法错误 |
| `CRON_ONCE_IN_PAST` | once 时间已过期 |
| `CRON_JOB_NOT_FOUND` | 任务 id 不存在 |
| `CRON_LEASE_HELD` | tick 因 lease 被占而 skip（非用户错误，仅日志） |

## 6. Acceptance Criteria / 验收标准

- AC1: 注册一个 `cron: "*/5 * * * *"` 任务，连续 15 分钟内触发 3 次，session events 含 3 条对应记录（对应 R5）。
- AC2: 注册 `once: 2 分钟后` 任务，进程重启后到点正确触发（对应 R2、R8）。
- AC3: 注册 cron `"* * * * * *"`（每秒）被拒绝，错误码 `CRON_FREQUENCY_TOO_HIGH`，remediation 指向"≥ 1 分钟"（对应 R7）。
- AC4: 单 session 注册到 51 个任务时第 51 个被拒绝，错误码 `CRON_QUOTA_EXCEEDED`（对应 G7、R9）。
- AC5: 取消 running 任务时 AgentRunner 收到 abort，30 秒内 graceful 结束；30 秒超时则强 abort，task 标 `cancelled-forced`（对应 R10）。
- AC6: CLI `haro cron list` 与 web-api `/api/v1/cron/jobs` 与 MCP `schedule_task` 列出的任务集合一致（对应 R9）。
- AC7: web-api 进程未启动场景下，`haro cron daemon` 与 `haro cron tick` 单独都能正确触发任务（对应 G8、R12）。
- AC8: web-api 与 daemon 同时在跑时，`tick` 不会重复触发同一 due 任务（对应 R11 lease 锁）。

## 7. Test Plan / 测试计划

- 单元测试：cron-parser 边界用例（5/6 字段、TZ 前缀、非法语法）；once 时间窗判定；retry policy 指数回退；lease 锁获取/续约/过期。
- 集成测试：进程重启 → 任务恢复（无需 register，下次 tick pick up）；cron 触发 → AgentRunner 执行 → events 写入；cancel running 任务的 graceful + forced 路径；两个 tick caller 并发不重复触发。
- 性能：1000 个 cron 任务并存时单次 tick CPU < 5%、耗时 < 2s；触发抖动 < 60s（默认 ticker 周期）。
- 安全：cron 注入（恶意表达式 / 命令拼接）；taskInput 大小限制（默认 64KB）。
- 回归：FEAT-014 Team Orchestrator session events、FEAT-023 Permission Guard 决策。

## 8. Open Questions / 待定问题

- Q1: 同时 due 的多个任务串行还是并行？倾向并行但受 FEAT-023 budget 控制；待 FEAT-040 Self-Monitor 看实际并发负载再调。
- Q2: 任务可以读写哪些目录？复用 session workspace 还是独立沙箱？倾向复用 session workspace（group 模式定义），isolated 模式留给后续。
- Q3: 错过的 cron 触发要补跑吗？倾向不补（最小复杂度，hermes 也是如此）；进程长时间下线后只跑下一次。
- Q4: 任务输出（stdout / 错误）是否要单独存档？倾向并入 session events，减少新表。
- Q5: tick 默认周期 60s 是否够用？FEAT-040 数据可能要求降到 30s；先 60s。

## 9. Changelog / 变更记录

- 2026-05-01: whiteParachute — 初稿（Phase 1.5 自用底座补完批次 1）
- 2026-05-02: whiteParachute — v0.2 实现前修订：
  - 命名 scheduled-task → cron（包路径 / 表名 / CLI / 路由统一）
  - 存储改为复用主 DB `cron_jobs` 表（去除独立 `scheduled-tasks.sqlite`）
  - 调度模型改为 hermes-agent 风格 `tick()` 纯函数 + cross-process lease lock；放弃 node-schedule
  - 新增 G8 + R11/R12：三触发源（web-api ticker / `haro cron daemon` / `haro cron tick`），不强依赖 web-api
  - 新增 §5.6 错误码表 + AC7/AC8
- 2026-05-02: whiteParachute — Step 1–6 实现交付（轮 1 codex review 修复）。
  - **Step 1**：`packages/core/src/cron/` 骨架（`types` / `cron-parser` / `storage` / `manager`）+ `cron_jobs` / `cron_lease` 表 + 6 错误码 + `cron-parser ^5.5.0` 依赖
  - **Step 2**：`AgentRunner.run` 加 `signal?: AbortSignal` cooperative cancel；`CronRunner` 实现 advance → run → mark 链 + 三种 backoff retry
  - **Step 3**：`tick()` 纯函数 + 跨进程 SQLite advisory lease lock（`cron_lease` 单行哨兵）+ `createCronTickHost()` 长循环包装
  - **Step 4**：`@haro/core/services/cron`（`listJobs` / `getJob` / `createJob` / `cancelJob` / `triggerJob`）
  - **Step 5**：`haro cron list/show/create/cancel/trigger/tick/daemon` 命令族；`--cron`/`--once` 互斥；`--retry-max`/`--retry-backoff`；daemon 跑 `setInterval(tick, 60s)` 循环 + SIGINT/SIGTERM graceful 停止
  - **Step 6**：`/api/v1/cron/{jobs,jobs/:id,jobs/:id/trigger}` Hono 路由；HaroError → HTTP 400/404/409 映射
  - 测试：core 33/220、cli 17/150、web-api 11/65；全 monorepo 9 包 / 93 文件 / 470+ 测试全绿
  - Codex adversarial review fix-ups（轮 1）：配额按 `enabled=1 AND next_run_at IS NOT NULL` 计算（避免 recurring done 状态绕过配额）；once 严格 ISO-8601（必须 Z 或 ±HH:MM offset）；retryPolicy 在 create 时 normalize + 校验

- 2026-05-06: whiteParachute — Step 7 收尾（codex review 轮 2/3 全部修复 + web-api 自动化），spec status: done。
  - **轮 2 high #1**：`CronRunner.execute` 的 `runInput` 漏传 `continueFromSessionId: record.sessionId`，违反 R5/G2 session 复用语义。已修。
  - **轮 2 high #2**：`CronManager.cancel` 之前只 flip DB，无 in-flight abort、无 30s graceful、无 `cancelled-forced` 超时路径，违反 AC5/R10。新增 `packages/core/src/cron/inflight.ts` 进程级 `Map<jobId, {controller, done}>` registry；`tick()` 跑每个 job 前 `trackInflight`、finally 里 `clearInflight`；`cancel()` 改 async，立即 flip 'cancelled' + abort + `Promise.race(done, cancelTimeoutMs=30s)`，超时则 force-flip `cancelled-forced`（不带 `requireNotCancelled` guard，escalation 必须成功）。
  - **轮 2 high #3**：`tick()` 拿 60s lease 后从不续约，长任务可被其他进程重新 acquire 触发重复，违反 AC8。后台 `setInterval(renewLease, ttl/2)`；renewal 失败 / 抛出 → `renewalLost=true`，dispatch 循环 break；`finally` 里 `clearInterval` + `releaseLease`（SQL `WHERE holder = ?` 保证 lease 被别人拿走时无副作用）。
  - **轮 2 high #4**：`countActiveForSession` + `insert` 之间无事务，并发可绕过配额。新增 `storage.insertIfBelowQuota(input, quota)` 用 `db.transaction(...).immediate()` 包 count + insert（BEGIN IMMEDIATE 上写锁），manager.create 全量切换。
  - **轮 2 medium #5**：web-api 进程没启动 ticker host，违反 R12 第一条。`createWebApp` 在 runtime 同时有 `dbFile` + `runner|createRunner` 时自动建 `CronTickHost` 存到 `cronTickers` WeakMap；`startWebServer` 在 `ready` 后启动（守 `!stopped`），`stop` 时先 drain HTTP 再停 host + close storage。
  - **轮 2 low #6**：retry backoff 无上限，`max=16` 时 sleep 达 32768s 阻塞 tick。加 `MAX_RETRY_DELAY_MS = 5*60_000`，`Math.min(delay, cap)` 同时覆盖 fixed/linear/exponential 三种。
  - **轮 3 race fix-up**：之前 `cancel()` 对 `running` 行只设 enabled=0、保留 status='running'，runner 后续 markSuccess 用 `requireNotCancelled` guard 检查 `status NOT IN ('cancelled','cancelled-forced')` —— 'running' 不在内，guard 通过，runner 写 status='pending' 覆盖 cancel 意图。改为 cancel() 总是立即 flip 'cancelled'；runner 入口 re-read fresh 早退；runner 全部 `setStatus` / `advanceNextRun` 加 `requireNotCancelled`；tick.ts 派发前再 re-read fresh 跳过 cancelled。
  - **轮 3 medium**：`tick.ts` renewer 的 `setInterval` 回调里 `renewLease` 抛出会炸进程（出 try/finally 范围）。改为 try/catch，异常视为 lease 丢失。`server.stop` 顺序改为先 `server.close` drain HTTP 再 `host.stop` + `storage.close`，避免新请求落进 quiescing 中的 host。
  - **轮 3 已知限制**（accepted）：跨进程 cancel 不能 force-abort 另一进程的 in-flight；DB cancel 让对端下次 tick 跳过即可，spec §3 / §8 Q2 已含范畴说明；`inflight.ts` 顶部注释也指明这点。
  - 测试新增 8 个：continueFromSessionId 透传、backoff cap、quota TOCTOU 5-cap 墙、cancel forced-timeout、cancel graceful-ack、runner 写不能复活 cancelled 行、runner.execute 入口对 cancelled 行短路、tick lease renewal 长任务不丢锁；加 `resetInflightForTest()` beforeEach/afterEach 防跨测试污染。
  - 全 monorepo 9 包 / 100 文件 / 570 测试全绿；lint clean；build clean。
