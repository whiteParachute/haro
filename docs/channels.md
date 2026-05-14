# Channel 指南（sidecar-era）

> **2026-05-14 状态**：Haro 不再继续扩展自建 channel/workbench 主链路。AgentDock 负责日用 IM / Web / scheduler / runtime；Haro 作为 sidecar 通过 AgentDock MCP、AgentDock 定时任务和 AgentDock skills/agent 编排交互。

## 当前边界

保留的历史 channel adapter 只用于兼容、调试和迁移经验：

| Channel | 状态 | 说明 |
| --- | --- | --- |
| `cli` | 保留 | 本地 REPL / `haro run` 调试入口。 |
| `feishu` | 保留兼容 | 历史 IM adapter；新的审批主路径优先通过 AgentDock 已有 Feishu/IM 能力呈现。 |
| `telegram` | 保留兼容 | 历史 IM adapter；不是 sidecar 主路径。 |
| `web` | 已移除 | 旧 Dashboard Chat / Web Channel / WebSocket streaming 不再属于 Haro Web。Haro Web 只保留 proposal review 工作台。 |

## 推荐接入方式

新的 Haro sidecar 不应让用户直接进入 Haro channel，而是：

1. 在 AgentDock 注册 `haro mcp`。
2. 用 AgentDock scheduler 触发 `haro observe/propose/validate/approval-request`。
3. 由 AgentDock agent/skills/IM 把 approval request 汇报给用户。
4. 用户可在 AgentDock/飞书中审批，也可打开 Haro Web proposal review 工作台审批同一批 artifacts。

## CLI Channel（兼容入口）

```bash
haro                    # 启动本地 REPL
haro run "任务描述"      # 单次调试运行
```

CLI channel 仍可用于本地诊断，但不应被设计成新的常驻 workbench。

## 飞书 / Telegram Channel（历史兼容）

历史命令仍保留：

```bash
haro channel setup feishu
haro channel enable feishu
haro channel doctor feishu

haro channel setup telegram
haro channel enable telegram
haro channel doctor telegram
```

这些 adapter 的存在不改变 sidecar 新基线：日用消息入口由 AgentDock 负责，Haro 通过 AgentDock 暴露的稳定 contract 与 MCP 工具参与。

## 已删除：Web Channel

旧 Web Channel 曾提供：

- `/api/v1/channels/web/*`
- `/ws` subscription
- Dashboard Chat history / upload / stream
- `@haro/channel-web`

这批能力已下线。原因是它会把 Haro 重新推回自建 workbench/runtime 路线，与当前“AgentDock kernel + Haro sidecar”的边界冲突。

Haro Web 的现存职责见 [Haro Web Proposal Review Workbench](modules/web-dashboard.md)。
