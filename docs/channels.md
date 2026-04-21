# Channel 指南

## Channel 概念

Channel 是 Haro 的消息渠道抽象层，负责对接外部消息入口，将外部消息统一转成 `InboundMessage` 投递给 Agent Runner，并把 Agent 的执行结果反向回写。

**Channel 与 Provider 的区分**：

- **Provider** 抽象"谁在回答"（Codex / Claude / …）
- **Channel** 抽象"从哪里来"（CLI / 飞书 / Telegram / …）

两层均受 [可插拔原则](architecture/overview.md#设计原则) 约束，对 Haro 核心模块零侵入。

Phase 0 已实现的 Channel：

| Channel | 类型 | 连接方式 | 流式支持 | 备注 |
|---------|------|---------|---------|------|
| `cli` | 内置 | 本地 stdin/stdout | 原生支持 | 默认启用，不可移除 |
| `feishu` | 外部 | websocket | 否（终态发送） | 需 App ID / Secret |
| `telegram` | 外部 | long-polling | 私聊支持 | 需 Bot Token |

## CLI Channel（内置）

`cli` Channel 是 Haro 的默认入口，无需额外配置。当你运行 `haro`（不带子命令）时，即进入 CLI REPL。

```bash
haro                    # 启动 REPL
haro run "任务描述"      # 单次任务模式
```

CLI Channel 的状态保存在 `~/.haro/channels/cli/state.json`，主要记录默认 Agent、Provider、Model 选择。

## 飞书 Channel

### 启用与配置

```bash
# 交互式配置（推荐）
haro channel setup feishu

# 手动启用（如果已配置过）
haro channel enable feishu
```

`setup` 会引导你输入：

- `Feishu App ID`
- `Feishu App Secret`
- `Session scope`（`per-chat` 或 `per-user`）

你也可以预先在 `~/.haro/config.yaml` 中写好配置，再执行 setup：

```yaml
channels:
  feishu:
    enabled: false
    appId: "${FEISHU_APP_ID}"
    appSecret: "${FEISHU_APP_SECRET}"
    transport: websocket
    sessionScope: per-chat
```

配置中的 `${FEISHU_APP_ID}` 和 `${FEISHU_APP_SECRET}` 会在运行时被替换为对应的环境变量值。

### 诊断

```bash
haro channel doctor feishu
```

诊断项包括：

- `appId` / `appSecret` 是否已配置
- 凭据是否可通过飞书接口验证
- websocket 连接是否可用

如果报告 `missing_credentials`，请检查：

1. 环境变量 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 是否已导出
2. `config.yaml` 中的引用语法是否为 `${VAR}` 格式

### 会话模式

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| `per-chat` | 每个群聊/私聊对应一个 Haro session | 群机器人 |
| `per-user` | 每个用户对应一个 Haro session（跨群共享） | 个人助手 |

## Telegram Channel

### 启用与配置

```bash
# 交互式配置（推荐）
haro channel setup telegram

# 手动启用
haro channel enable telegram
```

`setup` 会引导你输入：

- `Telegram Bot Token`
- `Session scope`（`per-chat` 或 `per-user`）

预配置文件示例：

```yaml
channels:
  telegram:
    enabled: false
    botToken: "${TELEGRAM_BOT_TOKEN}"
    transport: long-polling
    sessionScope: per-chat
```

### 诊断

```bash
haro channel doctor telegram
```

诊断项包括：

- `botToken` 是否已配置
- Token 是否可通过 Telegram Bot API 验证
- long-polling 连接是否可用

### 流式输出行为

Telegram Channel 的流式支持有平台限制：

- **私聊**：支持流式输出，使用 `@grammyjs/stream` 推送 delta
- **群聊**：自动降级为终态一次性发送，避免群聊中消息刷屏

## Gateway 控制

Gateway 统一启动所有 enabled 的外部 Channel（飞书、Telegram），使 Haro 成为持续运行的助手。

### 启动

```bash
# 前台运行（阻塞终端，Ctrl+C 停止）
haro gateway start

# 后台运行（写入 PID 文件，重定向日志）
haro gateway start --daemon
```

前台模式适合调试和观察日志；后台模式适合长期运行。

### 停止

```bash
haro gateway stop
```

`stop` 会读取 `~/.haro/gateway.pid`，向对应进程发送 `SIGTERM`， graceful shutdown 超时后 fallback 到 `SIGKILL`。

### 查看状态

```bash
haro gateway status
```

输出示例：

```
Gateway: running (PID 12345)
Data directory: /home/user/.haro
Log file: /home/user/.haro/logs/haro.log
Channel data: /home/user/.haro/channels
Channels:
  feishu: healthy
  telegram: healthy
```

### Gateway 诊断

```bash
haro gateway doctor
```

诊断范围：

- gateway 进程是否在运行
- 所有 enabled Channel 的健康状态
- 数据目录、日志文件、PID 文件的可访问性

## 常用 Channel 命令速查

```bash
# 查看所有 Channel
haro channel list

# 启用 / 禁用 / 移除
haro channel enable feishu
haro channel disable telegram
haro channel remove telegram

# 单个 Channel 诊断
haro channel doctor feishu
haro channel doctor telegram

# Gateway 控制
haro gateway start
haro gateway start --daemon
haro gateway stop
haro gateway status
haro gateway doctor
```

## 数据路径

| 文件/目录 | 路径 | 说明 |
|----------|------|------|
| PID 文件 | `~/.haro/gateway.pid` | 记录当前 gateway 进程号 |
| Gateway 日志 | `~/.haro/logs/gateway.log` | 后台模式的 stdout/stderr |
| Channel 状态 | `~/.haro/channels/<id>/state.json` | 非敏感运行态 |
| Channel 会话 | `~/.haro/channels/<id>/sessions.sqlite` | 外部会话 → Haro session 映射 |

> 约束：`state.json` 不得写入 access token、app secret、bot token 等敏感凭证。凭证只来自环境变量 / 配置中的 `${...}` 引用。

## 移除与回滚

移除 Channel 不会删除历史数据，session 映射会归档到 `~/.haro/archive/channels/<id>-<timestamp>/`，需要时可通过文件系统手动恢复：

```bash
haro channel remove feishu
```

如需彻底清理 Channel 数据：

```bash
rm -rf ~/.haro/channels/feishu
```

更多 Channel 协议细节见 [specs/channel-protocol.md](../specs/channel-protocol.md) 和 [docs/modules/channel-layer.md](modules/channel-layer.md)。
