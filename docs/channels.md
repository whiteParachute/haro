# Channel 指南（sidecar-era）

> **已停止发展**：本文描述的是历史 Haro-owned workbench/runtime 方向。
> 当前主线：`docs/planning/haro-sidecar-subtraction-and-feedback-loop.md`。
> 不要据此新增 provider/channel/memory/runtime/team/dashboard/skills marketplace 能力。
> 相关能力应由 AgentDock 承接，或通过 Haro sidecar contract 暴露。


> **2026-05-15 状态**：Haro 不再继续扩展自建 channel/workbench 主链路。AgentDock 负责日用 IM / workspace / runtime；Haro 作为 sidecar 通过已注册的 `haro mcp` 与 AgentDock workspace/agent 编排交互。

## 当前边界

Haro-owned channel adapter 已退役；真实 IM / workspace 消息由 AgentDock 承接：

| Channel | 状态 | 说明 |
| --- | --- | --- |
| `cli` | 保留 | 本地 REPL / `haro run` 调试入口。 |
| `feishu` | 已退役 | 历史 Haro-owned adapter 已删除；由 AgentDock host / IM manager 承接。 |
| `telegram` | 已退役 | 历史 Haro-owned adapter 已删除；由 AgentDock host / IM manager 承接。 |
| `web` | 已移除 | 旧 Dashboard Chat / Web Channel / WebSocket streaming 不再属于 Haro Web。Haro Web 只保留 proposal review 工作台。 |

## 推荐接入方式

新的 Haro sidecar 不应让用户直接进入 Haro channel，而是：

1. 在 AgentDock 注册 `haro mcp`。
2. 由 AgentDock agent 根据使用情况复用已有工作区，或新建/选择合适工作区后调用 Haro MCP tools。
3. 由 AgentDock agent/skills/IM 把 approval request 汇报给用户。
4. 用户可在 AgentDock/飞书中审批，也可打开 Haro Web proposal review 工作台审批同一批 artifacts。

## CLI Channel（兼容入口）

```bash
haro                    # 启动本地 REPL
haro run "任务描述"      # 单次调试运行
```

CLI channel 仍可用于本地诊断，但不应被设计成新的常驻 workbench。

## 飞书 / Telegram Channel（已由 AgentDock 接管）

FEAT-081L 后 Haro-owned `packages/channel`、`packages/channel-feishu`、`packages/channel-telegram` 与 `haro channel list/doctor/setup/onboarding/enable/disable/remove` 均已退役或删除。

当前边界：

- 真实 Feishu / Telegram / IM 投递链路由 AgentDock host / IM manager 负责。
- Haro 保留 MCP `send_message` 工具；该工具写入 AgentDock IPC messages contract。
- 不要恢复 Haro-owned channel registry、adapter setup/onboarding 或 channel doctor。

## 已删除：Web Channel

旧 Web Channel 曾提供：

- `/api/v1/channels/web/*`
- `/ws` subscription
- Dashboard Chat history / upload / stream
- `@haro/channel-web`

这批能力已下线。原因是它会把 Haro 重新推回自建 workbench/runtime 路线，与当前“AgentDock kernel + Haro sidecar”的边界冲突。

Haro Web 的现存职责见 [Haro Web Proposal Review Workbench](modules/web-dashboard.md)。
