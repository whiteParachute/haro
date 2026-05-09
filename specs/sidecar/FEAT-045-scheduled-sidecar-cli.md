---
id: FEAT-045
title: Scheduled Sidecar CLI
status: draft
phase: sidecar
owner: whiteParachute
created: 2026-05-08
updated: 2026-05-08
related:
  - FEAT-043-agentdock-contract-skeleton.md
  - FEAT-044-read-only-mcp-sidecar.md
  - ../../docs/planning/agentdock-kernel-sidecar-architecture.md
  - ../phase-1.5/FEAT-033-scheduled-tasks.md
---

# Scheduled Sidecar CLI

## 1. Context / 背景

Haro 的后台 observe/propose/validate 不应依赖普通聊天上下文。AgentDock 已支持 scheduler 和 script task，因此 Haro 应提供无交互 CLI，让 AgentDock 定时任务周期触发。

该能力是 Haro sidecar 的后台驱动面。FEAT-045 的第一步先把 FEAT-044 `haro_observe` 从纯 fake fixture 升级为可读真实 AgentDock HTTP API 的 observation source；后续 CLI 的 `haro observe --since last` 复用同一 source，而不是读取 AgentDock 内部源码或维护第二套 memory。

## 2. Goals / 目标

- G1: 提供 `haro connect agent-dock` 保存 AgentDock 连接配置。
- G2: 提供 `haro observe --since last` 增量采集 AgentDock 状态。
- G3: 提供 `haro propose --auto-dry-run` 从 observations 生成 proposal。
- G4: 提供 `haro validate --pending` 批量验证 pending proposals。
- G5: 所有后台命令可被 AgentDock script task 安全执行。

## 3. Non-Goals / 不做的事

- 不实现 daemon 常驻进程作为第一版要求。
- 不修改 AgentDock scheduler。
- 不通过聊天消息触发后台维护。
- 不开放 apply。

## 4. Requirements / 需求项

- R1: `haro connect agent-dock --base-url <url> [--auth-ref <ref>] [--id <id>]` 写入 `~/.haro/agentdock-connections.json`。
- R2: `haro observe --since last` 根据 connection cursor 采集增量 observation，并写入 `~/.haro/evolution/observations/`。
- R3: `haro propose --auto-dry-run` 读取未消费 observations，生成 dry-run proposal，写入 `~/.haro/evolution/proposals/`。
- R4: `haro validate --pending` 读取 pending proposals，生成 validation report，写入 `~/.haro/evolution/validations/`。
- R5: `haro status` 输出 connection、cursor、observation/proposal/validation 计数。
- R6: `haro doctor` 检查 HARO_HOME、connection、AgentDock reachability、write permission、schema compatibility。
- R7: 所有命令支持 `--json`，stdout 输出结构化结果；错误写 stderr，退出码非 0。
- R8: 所有命令幂等。重复运行不得重复消费同一 observation。

## 5. Design / 设计要点

AgentDock script task 示例：

```bash
haro observe --since last && haro propose --auto-dry-run && haro validate --pending
```

数据流：

```text
AgentDock scheduler
  -> script task
  -> Haro CLI
  -> AgentDock HTTP observation source read-only
  -> ~/.haro/evolution/*
  -> cursor update
```

第一步已落地到 MCP source：

```text
AgentDock agent
  -> registered haro mcp
  -> haro_observe
  -> HARO_AGENTDOCK_BASE_URL HTTP API
  -> ObservationBatch(source=agentdock-http)
```

读取范围保持最小闭环：`/api/health`、`/api/status`、`/api/sessions`、`/api/sessions/:id/messages`、`/api/sessions/:id/turns`、`/api/tasks`。messages 映射为 `TurnObservation`，failed/error/timeout runtime turns 映射为 `RunnerErrorObservation`，有 `last_run` 的 tasks 映射为 `ScheduledTaskRunObservation`。`limit` 在返回层全局限制各 observation arrays；`window.cursor` 使用最新观察事件时间，不用采集时间 `until` 冒充事件高水位。

cursor 存储建议：

```text
~/.haro/evolution/cursors/<base64url(connection-id)>.json
```

## 6. Acceptance Criteria / 验收标准

- AC1: 给定有效 baseUrl，当执行 `haro connect agent-dock` 时，应写入 connection 配置并通过 schema 校验。（对应 R1）
- AC2: 给定 fake AgentDock source 和空 cursor，当执行 `haro observe --since last` 时，应写入 observation 文件并更新 cursor。（对应 R2/R8）
- AC2.1: 给定 `HARO_AGENTDOCK_BASE_URL`，当通过 `haro mcp` 调用 `haro_observe` 时，应采集真实 AgentDock HTTP API 并返回 `source=agentdock-http` 的 schema-valid `ObservationBatch`，不创建 `$HARO_HOME/memory`。（对应 R2/R5/R8）
- AC3: 给定同一 cursor 重复执行 observe，不应生成重复 observation；跨 connection 的相同 observation id 不应互相去重。（对应 R8）
- AC3.1: 给定 `prod:us` 与 `prod-us` 等可归一成同一路径的 connection id，cursor/lock 文件名应使用可逆编码隔离，不发生路径碰撞。
- AC4: 给定未消费 observation，当执行 propose 时，应生成 dry-run proposal。（对应 R3）
- AC5: 给定 pending proposal，当执行 validate 时，应生成 validation report。（对应 R4）
- AC6: 给定 `--json`，stdout 应为可解析 JSON，stderr 不应混入进度文本。（对应 R7）

## 7. Test Plan / 测试计划

- 单元测试：connection/cursor 读写、跨 connection 去重隔离、cursor 文件名碰撞、锁目录并发保护、损坏配置友好报错。
- 单元测试：HTTP observation source 的 sessions/messages/turns/tasks 映射、since 过滤、全局 limit、cursor、错误分类、baseUrl 凭据拒绝、excerpt 截断和 schema 校验。
- 集成测试：fake source observe → propose → validate。
- CLI 测试：`--json` 输出、退出码、stderr。
- 手动验证：在 AgentDock 中创建 script task 周期执行 Haro CLI。
- Live smoke：把 `haro mcp` 注册为 AgentDock 外部 MCP server，配置 `HARO_AGENTDOCK_BASE_URL=http://127.0.0.1:3000`，从 AgentDock runner 调用 `mcp__haro-sidecar__haro_observe` 并确认返回真实 AgentDock sessions/messages。

## 8. Open Questions / 待定问题

- Q1: 第一版 scheduler 推荐 cron 频率是多少？
- Q2: AgentDock reachability 检查走 HTTP health API，还是 capability probe？
- Q3: 第一版已采用 observation timestamp cursor + connection-scoped 已落盘 observation id 去重；若 AgentDock 后续暴露稳定 event id，再升级为 event-id cursor。

## 9. Changelog / 变更记录

- 2026-05-08: Haro — 初稿。
- 2026-05-08: Codex — 先落地真实 AgentDock HTTP observation source 最小闭环，作为后续 `haro observe --since last` CLI 的共享读取层。
- 2026-05-08: Codex — 实现 `haro connect agent-dock` 与 `haro observe --since last` 第一段：连接写入 `~/.haro/agentdock-connections.json`，observations 写入 `~/.haro/evolution/observations/`，cursor 写入 `~/.haro/evolution/cursors/<base64url(connection-id)>.json`，重复 observe 通过 connection-scoped 已落盘 observation id 去重，使用 per-connection lock 避免同连接并发重复写入，且不创建 `$HARO_HOME/memory`。
