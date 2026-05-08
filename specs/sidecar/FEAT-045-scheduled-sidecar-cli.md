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

该能力是 Haro sidecar 的后台驱动面。

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
  -> AgentDock observation source read-only
  -> ~/.haro/evolution/*
  -> cursor update
```

cursor 存储建议：

```text
~/.haro/evolution/cursors/<connection-id>.json
```

## 6. Acceptance Criteria / 验收标准

- AC1: 给定有效 baseUrl，当执行 `haro connect agent-dock` 时，应写入 connection 配置并通过 schema 校验。（对应 R1）
- AC2: 给定 fake AgentDock source 和空 cursor，当执行 `haro observe --since last` 时，应写入 observation 文件并更新 cursor。（对应 R2/R8）
- AC3: 给定同一 cursor 重复执行 observe，不应生成重复 observation。（对应 R8）
- AC4: 给定未消费 observation，当执行 propose 时，应生成 dry-run proposal。（对应 R3）
- AC5: 给定 pending proposal，当执行 validate 时，应生成 validation report。（对应 R4）
- AC6: 给定 `--json`，stdout 应为可解析 JSON，stderr 不应混入进度文本。（对应 R7）

## 7. Test Plan / 测试计划

- 单元测试：connection/cursor 读写。
- 集成测试：fake source observe → propose → validate。
- CLI 测试：`--json` 输出、退出码、stderr。
- 手动验证：在 AgentDock 中创建 script task 周期执行 Haro CLI。

## 8. Open Questions / 待定问题

- Q1: 第一版 scheduler 推荐 cron 频率是多少？
- Q2: AgentDock reachability 检查走 HTTP health API，还是 capability probe？
- Q3: observation cursor 用 AgentDock event id、timestamp，还是文件 offset？

## 9. Changelog / 变更记录

- 2026-05-08: Haro — 初稿。
