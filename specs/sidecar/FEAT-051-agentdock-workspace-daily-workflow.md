---
id: FEAT-051
title: AgentDock Workspace Daily Workflow
status: implemented
phase: sidecar
owner: whiteParachute
created: 2026-05-15
updated: 2026-05-15
related:
  - FEAT-045-scheduled-sidecar-cli.md
  - FEAT-048-frontier-intelligence-intake.md
  - FEAT-050-approval-request-workflow.md
  - ../../docs/architecture/sidecar-operating-model.md
---

# AgentDock Workspace Daily Workflow

## 1. Context / 背景

Haro Web 只能是 proposal review 看板，不能承载 daily scheduler、消息流或 workspace runtime。每日自动收集外部情报、观察 AgentDock、生成 proposal 和审批请求，应该由 AgentDock workspace/agent 通过已注册的 `haro mcp` 驱动。

这条 workflow 的目标是：AgentDock 每天自动复用或新建合适工作区，调用 Haro sidecar MCP tool；Haro 只写 sidecar-owned artifacts，所有 proposal 默认需要人审，用户通过 AgentDock/飞书或 Haro Web review board 审批。

## 2. Goals / 目标

- G1: 在 `haro mcp` 中提供一个 AgentDock 可直接调用的 daily workflow tool。
- G2: workflow 串联 observe → optional frontier intake → propose → validate → approval-request。
- G3: workflow 只写 `~/.haro/evolution/*` 和 `~/.haro/assets/*` sidecar artifacts，不写 AgentDock DB、不写 memory、不 apply。
- G4: 返回机器可读 summary 和 nextActions，方便 AgentDock agent 在 IM/workspace 中向用户汇报。
- G5: Haro Web 只读取同一批 approval request artifacts，不参与调度或执行。

## 3. Non-Goals / 不做的事

- 不修改 AgentDock 代码。
- 不让 Haro Web 托管 scheduler、cron 状态或消息入口。
- 不绕过 human review；生成 proposal / approval request 后必须等待 approve / reject / request-changes。
- 不在 MCP tool 中直接执行 `haro apply` 或创建真实 patch branch。

## 4. Requirements / 需求项

- R1: 新增 MCP tool `haro_run_daily_workflow`，由 AgentDock workspace/agent 调用。
- R2: 输入支持 connection/source/since/limit，以及可选 `frontierSourceConfigPath`。
- R3: 输出必须包含 step counters、approvalRequestIds、是否写入 sidecar artifacts、以及给 AgentDock agent 的 nextActions。
- R4: tool 必须只调用 Haro sidecar workflow，不直接写 AgentDock runtime、workspace、IM 或 memory。
- R5: 与 existing CLI 幂等规则一致：重复 observation/proposal/validation/approval-request 不重复生成。
- R6: `haro mcp --enable-gated-write` 仍只额外开启 apply/rollback；daily workflow 本身不等同 gated write。

## 5. Current Implementation / 当前实现

- `@haro/mcp-tools` 新增 `haro_run_daily_workflow` schema 和 tool wrapper。
- `haro mcp` 启动时注入 workflow handler，委托 CLI sidecar workflow：
  - `observe --since last`
  - optional `intake frontier --source-config <file>`
  - `propose --auto-dry-run --include-frontier`
  - `validate --pending`
  - `approval-request --pending`
- `runAgentDockDailyWorkflow` 返回 concise structured summary，不把完整 observation batch 暴露为主要结果。
- 每个自动 proposal 仍带 `humanReviewRequired=true`；没有 approval decision 时 apply gate fail closed。

## 6. Acceptance Criteria / 验收标准

- AC1: `haro mcp` tools/list 应包含 `haro_run_daily_workflow`，但不包含 `haro_apply` / `haro_rollback`，除非显式 `--enable-gated-write`。
- AC2: 调用 `haro_run_daily_workflow({ source: 'fake' })` 应写入 observation/proposal/validation/approval-request artifacts，并返回 approvalRequestIds。
- AC3: 重复调用同一 workflow 不应重复消费已处理 observation batch。
- AC4: workflow 输出必须包含 `sidecarOnly=true` 和 nextActions，提示 AgentDock 汇报给用户并等待审批。
- AC5: Haro Web service 重启后不出现 daily scheduler 日志或 `HARO_DAILY_FRONTIER_*` 依赖。

## 7. Changelog / 变更记录

- 2026-05-15: Haro — 新增 `haro_run_daily_workflow` MCP tool 和 CLI handler，正式把 daily 自动提案主路径迁到 AgentDock workspace/agent + Haro MCP。
