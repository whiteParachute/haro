# Team Orchestrator 模块（historical / removed）

> **FEAT-081W / E-1 docs closure（2026-05-28）**
>
> 本文是历史 Haro-owned workbench/runtime 设计归档，不描述当前运行实现。
> 当前主线是 AgentDock runtime/workspace kernel + Haro self-evolution sidecar；Haro 不再拥有 TeamOrchestrator 生产执行面。

## 当前事实

- `packages/core/src/team-orchestrator.ts` 已由 **FEAT-081D** 物理删除。
- `packages/core/src/legacy/team-orchestrator.ts` legacy re-export 与 package export 已由 **FEAT-081D** 删除。
- 旧 CLI `legacy_team_orchestrator_removed` / removed-result 兼容 payload 已由 **FEAT-081S** 删除。
- `HARO_ENABLE_LEGACY_TEAM_ORCHESTRATOR=1` 不会恢复 TeamOrchestrator。
- team-mode 请求没有 skill `directOutput` 时，不再进入已删除 TeamOrchestrator 的专用 removed-result；当前行为走普通 single-agent / runner fallback 路径。

## 本文档保留目的

本文仅保留三类历史上下文：

1. 解释 FEAT-081D/081S 为什么只删除 TeamOrchestrator 窄面，而没有扩大到 ScenarioRouter、runtime 或 provider path。
2. 作为历史设计归档，帮助识别旧文档、测试、spec 中出现的 TeamOrchestrator 术语。
3. 明确未来不能根据本文恢复 Haro-owned multi-agent runtime；此类能力应由 AgentDock workspace / runner / skills 承接，或通过 Haro sidecar contract 暴露。

## 已删除内容边界

FEAT-081D 的 scoped removal 只覆盖：

- `packages/core/src/team-orchestrator.ts`
- `packages/core/src/legacy/team-orchestrator.ts`
- `packages/core/test/team-orchestrator.test.ts`
- `@haro/core/legacy/team-orchestrator` package export

FEAT-081S 的 scoped removal 只覆盖：

- `packages/cli/src/index.ts#legacy-team-orchestrator-removed-result`
- `legacy_team_orchestrator_removed` 专用 JSON payload
- 已删除 TeamOrchestrator 后遗留的 CLI removed-result 兼容入口

这些删除记录已在 `packages/cli/src/legacy-removal-guard.ts` 的 `agent-runtime-router.physicalRemovals[]` 中固化。

## 仍受保护的范围

以下范围没有因为 FEAT-081D、FEAT-081S 或 FEAT-081W 获得删除批准：

- `packages/core/src/scenario-router.ts`
- `packages/core/src/runtime/**`
- `packages/core/src/agent/**`
- `packages/cli/src/index.ts` 中普通 run/chat/LLM provider path
- `AgentRunner` 与 provider runtime
- MCP `send_message` / memory tools / schedule task production path
- provider、memory、skills、Web/Web API
- AgentDock host
- 真实 `~/.haro*`、`aria-memory-vault`

## 与 ScenarioRouter 的当前关系

当前 ScenarioRouter 仍是 blocked/protected 的路由与 checkpoint 边界。它可以产出 historical team execution mode 形状，但 TeamOrchestrator integration 已删除。

因此：

- 不应再把 TeamOrchestrator 描述为当前 active implementation。
- 不应再说 CLI 当前直接调用 TeamOrchestrator。
- 不应把 TeamOrchestrator 删除事实推导成 ScenarioRouter、runtime、run/chat 或 LLM provider path 可删。

## FEAT-081W 结论

FEAT-081W/E-1 只做 stale docs/schema closure：修正文档中把 TeamOrchestrator 描述为当前实现的表述。它不新增 `physicalRemovals`，不修改 guard stage，不删除 production code。

总清理目标仍未达成：`provider-codex`、`memory-fabric`、`agent-runtime-router` 仍 blocked，`skills-marketplace` 仍 deferred。后续是否继续删除需要新的产品/架构/数据 ownership 证据或单项用户授权。
