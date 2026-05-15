# Channel Layer（historical compatibility）

> **2026-05-15 状态**：Haro 不再以自建 Channel Layer 作为主路径。AgentDock 负责日用 IM / workbench；Haro sidecar 通过 MCP、Haro Web 托管服务的每日 frontier scheduler 和 AgentDock skills/agent 编排接入。

## 当前保留范围

| Channel | 当前状态 | 用途 |
| --- | --- | --- |
| `cli` | 保留 | 本地 REPL / debug。 |
| `feishu` | 历史兼容 | 保留 adapter 经验；新审批呈现优先走 AgentDock 侧 IM。 |
| `telegram` | 历史兼容 | 保留 adapter 经验；不是 sidecar 主路径。 |
| `web` | 已移除 | 旧 Web Channel / Dashboard Chat / WebSocket streaming 已下线。 |

## 新边界

- Haro 不新增自有 IM channel 作为主产品面。
- Haro 不再把浏览器作为 chat channel。
- Haro Web 只做 proposal review 与每日 frontier scheduler 状态展示，不做消息收发、session history、文件上传或 streaming。
- sidecar 输出应通过 AgentDock 已有 channel 或 Haro Web approval request review 呈现。

## Agent 主动出站（历史兼容）

`@haro/mcp-tools` 的 `send_message` 仍通过 `ChannelRegistry.get(channelId).send(channelSessionId, OutboundMessage)` 调用已启用 channel。该能力是历史兼容层，不是 sidecar 新主线。

## 配置示例

```yaml
channels:
  cli:
    enabled: true
  feishu:
    enabled: false
    appId: "${FEISHU_APP_ID}"
    appSecret: "${FEISHU_APP_SECRET}"
    transport: websocket
    sessionScope: per-chat
  telegram:
    enabled: false
    botToken: "${TELEGRAM_BOT_TOKEN}"
    transport: long-polling
```

`channels.web` 已废弃；不要再依赖 `~/.haro/channels/web` 或 `/api/v1/channels/web/*`。

## 与 Haro Web 的关系

Haro Web 当前不是 Channel，而是 [Proposal Review Workbench](web-dashboard.md)：

- 读取 `~/.haro/evolution/approval-requests/*.json`
- 写入 `~/.haro/evolution/approval-decisions/*.json`
- 在 approve 时给 proposal 增加 `human-approval` ref

这与消息 channel、Agent runtime、session history 无关。
