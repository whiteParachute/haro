# Channel 指南

## Channel 概念

Channel 是 Haro 的消息渠道抽象层，负责对接外部消息入口，将外部消息统一转成 `InboundMessage` 投递给 Agent Runner，并把 Agent 的执行结果反向回写。

**Channel 与 Provider 的区分**：

- **Provider** 抽象"谁在回答"（Codex / Claude / …）
- **Channel** 抽象"从哪里来"（CLI / 飞书 / Telegram / …）

两层均受 [可插拔原则](architecture/overview.md#设计原则) 约束，对 Haro 核心模块零侵入。

已实现的 Channel：

| Channel | 类型 | 连接方式 | 流式支持 | 阶段 | 备注 |
|---------|------|---------|---------|------|------|
| `cli` | 内置 | 本地 stdin/stdout | 原生支持 | Phase 0 | 默认启用，不可移除 |
| `feishu` | 外部 | websocket | 否（终态发送） | Phase 0 | 需 App ID / Secret |
| `telegram` | 外部 | long-polling | 私聊支持 | Phase 0 | 需 Bot Token |
| `web` | 内置 | HTTP + WebSocket（Web API） | delta 通过 `channels.web.event` 推送 | Phase 1.5 (FEAT-031) | 默认启用；Dashboard 走 `/api/v1/channels/web/*`；禁用后 Dashboard 进入只读 |

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

## Web Channel（Phase 1.5 / FEAT-031）

### 概述

Web Channel 让浏览器对话与飞书 / Telegram 同等公民——Dashboard Chat 页所有 send / receive / upload / history 操作都走 `/api/v1/channels/web/*`，不绕开 Channel 抽象层。

| 维度 | 行为 |
|------|------|
| 注册形式 | builtin（不可 `remove`，可 `disable`） |
| 默认状态 | 启用（首次部署即可使用 Dashboard 聊天） |
| 鉴权 | 复用 FEAT-028 RBAC + Web Session cookie；session 仅自己可见，admin / owner / legacy api-key 可见全部 |
| 启动 | `haro web` 自动通过 `startEnabledBackgroundChannels()` 起 Web Channel；`haro gateway start` 也会带它 |
| 关闭 | `haro channel disable web` → Dashboard Chat 退化为只读（看历史，不能发送） |

### REST 路由

```
POST   /api/v1/channels/web/sessions               # 新建 session（owner = 当前 web 用户）
GET    /api/v1/channels/web/sessions               # 列出（普通角色仅自己；admin+ 全部）
GET    /api/v1/channels/web/sessions/:id           # 详情
DELETE /api/v1/channels/web/sessions/:id           # 删除（含消息 + 文件）
GET    /api/v1/channels/web/sessions/:id/messages  # 历史（cursor 分页：?before=<ms>&beforeId=<id>&limit=<n>）
POST   /api/v1/channels/web/sessions/:id/messages  # 发送（content + 可选 metadata.agentId/providerId/modelId）
POST   /api/v1/channels/web/upload                 # multipart：sessionId + file
GET    /api/v1/channels/web/files/:id              # 下载（含 RBAC + 0600 文件）
```

### 实时事件

Web Channel 不开新 WebSocket 端点，复用现有 `/ws`：客户端通过 `subscribe { channel: 'channels:web' }` 或带 sessionId 的 sessions 订阅，服务端推 `channels.web.event` 消息，载荷 kind 包括 `message`（用户消息已持久化）/ `agent`（agent 输出 delta）/ `session.update`。

### 上传守门

- 图片单文件 ≤ 10 MB / 文档 ≤ 30 MB / 单 session 累计 ≤ 50 MB（默认值，可在 `channels.web.upload.*` 覆盖）
- 文件名经 `sanitizeFilename` 清洗：拒绝路径分隔符 / `..` / `.` / 系统目录（`.ssh`/`.gnupg`/`.aws`/`.kube`/`.docker`/...）/ URL 编码绕过（`%2e%2e%2f` 等）/ null byte / 凭据扩展名（`.env`/`.pem`/`.key`/...）
- mime 白名单：`image/*` 子集 + `text/*` + 显式 application 列表（pdf/docx/xlsx/pptx/json/zip 等）；不接受 `application/*` 通配
- 实际存储：`~/.haro/channels/web/files/<sessionId>/<fileId>-<safeFilename>`，文件 0600，目录 0700

### 错误状态码

| 状态 | 场景 | 客户端处理 |
|------|------|-----------|
| 400 `forbidden_path_segment` / `invalid_filename` | 路径穿越 / 非法文件名 | 给用户提示，重新选文件 |
| 403 | 当前用户无权访问该 session 或该文件 | 不渲染该资源 |
| 404 | session / file 不存在 | 列表刷新 |
| 410 `FILE_MISSING` | DB 仍有记录但磁盘已被外部删除 | 列表刷新；提示用户文件不可用 |
| 413 `too_large` / `quota_exceeded` | 单文件或 session 配额溢出 | 提示用户压缩或清理 |
| 415 `unsupported_mime` / `forbidden_extension` | 不在白名单 | 提示允许的类型 |
| 503 `WEB_CHANNEL_DISABLED` | channel 被 disable | Dashboard 切只读 |

### 启用 / 禁用

```bash
# 默认就是启用——这条命令一般用来"关闭后重新启用"
haro channel enable web

# 关闭：Dashboard 立即变只读，写路由 503，读路由仍工作
haro channel disable web

# 健康自检（确认 sessions.sqlite 可读）
haro channel doctor web
```

> 注意：Web Channel 不可 `remove`（builtin 标记 `removable: false`）。若希望彻底重置，先 `disable web`，再手动清理 `~/.haro/channels/web/`。

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
Log file: /home/user/.haro/logs/gateway.log
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
| Channel 会话 | `~/.haro/channels/<id>/sessions.sqlite` | 外部会话 → Haro session 映射；Web Channel 还含 `web_messages` / `web_files` 表 |
| Web Channel 文件 | `~/.haro/channels/web/files/<sessionId>/<fileId>-<filename>` | 上传附件，0600/0700 |

> 约束：`state.json` 不得写入 access token、app secret、bot token 等敏感凭证。凭证只来自环境变量 / 配置中的 `${...}` 引用。

## 移除与回滚

`haro channel remove` 会**永久删除** `~/.haro/channels/<id>/` 目录，包括 `state.json` 和 `sessions.sqlite`。如需保留会话映射或历史数据，请在移除前手动备份：

```bash
# 备份（可选）
cp -r ~/.haro/channels/feishu ~/.haro/archive/channels/feishu-$(date +%Y%m%d-%H%M%S)

# 移除
haro channel remove feishu
```

如需仅禁用而不删除数据，使用 `haro channel disable feishu`。

如需手动彻底清理已移除 Channel 的残留数据：

```bash
rm -rf ~/.haro/channels/feishu
```

更多 Channel 协议细节见 [specs/channel-protocol.md](../specs/channel-protocol.md) 和 [docs/modules/channel-layer.md](modules/channel-layer.md)。
