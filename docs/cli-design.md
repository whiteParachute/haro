# CLI 设计文档

## 概述

Haro CLI 是 Haro 平台的**第一类入口**，与 Web Dashboard 平级，不是 Web UI 的子集。任何配置、使用、查询、管理动作都必须有等价的 CLI 命令——CLI 是"功能等价 Web UI 减去图形化体验"的完整入口。

**为什么 CLI-first**（参见 [架构总览 § 三层解耦](architecture/overview.md#三层解耦cli--web-api--web-前端)）：
- 单人自用、远程 SSH / devbox / headless 场景下 Web UI 不一定方便
- 借鉴 hermes-agent 设计：脱离 Web UI 也能完成全部使用与配置
- CLI 是 Phase 2.0+ 进化层 Self-Monitor 最稳定的命令信号源

技术栈：

- **commander.js**：命令路由与子命令注册
- **readline/promises**：持续 REPL 输入循环
- **@clack/prompts**：欢迎横幅、确认、选择器等一次性交互

> 如果你是第一次使用 Haro，建议先阅读 [Getting Started](./getting-started.md)。

## 设计原则

1. **与 Web Dashboard 命令面等价**：Web Dashboard 上能做的核心动作（聊天、查 session、管理 agent/skill/channel/provider、查 logs/memory、看 workflow、改预算、管用户），CLI 一定有对应命令族。完整对照见本文末 [Web UI 等价对照表](#web-ui-等价对照表)。
2. **结构化输出可机读**：所有"列出 / 查询 / 状态"类命令都必须支持 `--json` 输出，便于脚本化和自动化。
3. **REPL 与一次性命令对偶**：`haro` 进入 REPL；`haro <subcommand>` 单次执行。REPL 内的 slash 命令是 CLI 命令的子集。
4. **slash 命令不跨 Channel**：REPL `/xxx` 命令只在 CLI 本地消费，不透传到飞书 / Telegram / Web channel。
5. **可插拔命令族**：Provider / Channel 命令族通过 catalog/schema 驱动，不允许在命令层散落 `providerId === 'codex'` 或 `channelId === 'feishu'` 特判。
6. **服务层共用**（FEAT-039 R5/R13）：所有 CLI 命令的业务实现必须放在 `@haro/core/services/`，与 `@haro/web-api` 路由共用同一组 service。错误码走 `@haro/core/errors`（`HaroError` + remediation），`--json` 输出形状走 `@haro/core/types/cli-output`，命令端只做参数解析、确认提示、表格渲染。CLI 包内禁止重复实现业务逻辑或直接读写 SQLite。

---

## 开发态入口

在源码仓库中可直接使用顶层 pnpm 脚本调用 CLI，无需记忆深路径：

```bash
pnpm haro                  # 等同于 node packages/cli/bin/haro.js
pnpm haro setup            # 首次引导
pnpm haro doctor           # 诊断
pnpm haro run "..."        # 单次任务
```

> 注：`pnpm setup` 与 pnpm 内置命令冲突，等价路径为 `pnpm run setup` 或 `pnpm haro setup`。

---

## 命令一览

下表按主题分组列出全部命令族，并标注当前实现状态。**已实现**指 Phase 0 / Phase 1 已交付；**Phase 1.5 规划**指 FEAT-039（CLI 功能等价补完）尚未实现的命令族。

| 主题 | 命令族 | 状态 | 说明 |
|------|--------|------|------|
| Bootstrap | `setup` / `onboard` | 已实现 | 首次引导（FEAT-027 staged setup） |
| Bootstrap | `doctor` | 已实现 | 系统诊断（FEAT-027 结构化 issue + remediation） |
| Bootstrap | `config` | 已实现 | 查看合并后配置；`config get/set/unset` 已在批次 2 落地（secret 路径黑名单守门） |
| Bootstrap | `status` | 已实现 | 当前运行状态摘要 |
| Bootstrap | `update` | 已实现 | 检查 npm registry 上的新版本 |
| Provider | `provider` | 已实现（FEAT-026 / FEAT-029） | provider 配置、诊断、模型发现、ChatGPT 订阅认证 |
| Provider | `model` | 已实现 | 快速查看 / 切换默认 Provider+Model |
| Channel | `channel` | 已实现 | channel 启用 / 禁用 / 配置 / 诊断 |
| Channel | `gateway` | 已实现 | 启动 / 停止 / 监控所有 enabled channels |
| Skills | `skills` | 已实现 | install / list / info / enable |
| Skills | `skill` (单数详细控制) | 已实现（批次 2） | run / disable / uninstall / show events / validate |
| Run | `run` | 已实现 | 单次任务执行 |
| Run | `chat` | 已实现（批次 1） | 聊天会话视图（含历史浏览，--session 显式 pin 续接） |
| Session | `session` | 已实现（批次 1） | list / show / resume / export / delete |
| Agent | `agent` | 已实现（批次 1） | list / show / create / edit / delete / validate / test |
| Memory | `memory` | 已实现（批次 2） | query / remember / list / show / export |
| Logs | `logs` | 已实现（批次 2） | tail / show / export（tail 用 (createdAt, id) 复合游标） |
| Workflow | `workflow` | 已实现（批次 2） | list / show / replay (read-only) / checkpoints |
| Budget | `budget` | 已实现（批次 2） | show / audit；`set --agent` 仍未实现（无 per-agent budget 表，留 follow-up）|
| User | `user` | 已实现（批次 2） | list / show / create / role / disable / reset-token（FEAT-028 多用户）|
| Web | `web` | 已实现 | 启动 Web Dashboard 服务（FEAT-038 已退化为 `@haro/web-api` 的薄启动器；`pnpm -F @haro/web-api start` 可独立启动） |
| Evolution | `eat` / `shit` | 已实现 | 手动代谢 |

详细说明按主题分章节展开。

---

## 当前已实现命令

### `haro`

启动交互式 REPL（不带任何子命令时）。

```bash
haro
```

进入 REPL 后显示：

```
Haro v0.1.0 — 自进化多 Agent 平台
当前 Provider: codex (<resolved-live-model>)
输入 /help 查看可用命令

>
```

REPL 内可用的 slash 命令见 [REPL Slash 命令](#repl-slash-命令) 章节。

### `haro setup` / `haro onboard`

首次引导命令。`onboard` 是 `setup` 的别名。详见 [Getting Started](./getting-started.md)。

```bash
haro setup
haro onboard
```

**FEAT-027 staged setup**：
- 按 `prerequisites`、`global-command`、`data-directory`、`configuration`、`provider`、`database`、`web-service`、`channels`、`smoke-test` 分阶段检查
- 支持 `--profile dev|global|systemd`：`dev` 面向源码 `pnpm haro`，`global` 要求 `haro` 在 PATH，`systemd` 额外检查 user-level web service
- 支持 `--check` 只检查、`--repair` 执行安全修复、`--json` 输出机器可读 report
- setup 只写非敏感默认配置；不会写入 provider secret、修改 shell profile、安装 Node/pnpm、创建系统级 systemd unit 或调整防火墙
- provider 缺失时，provider/smoke stage 会提示 `haro provider setup codex`，并用 offline dry-run 证明 CLI/config/database 基础链路可用

### `haro doctor`

系统诊断，与 staged setup 共享同一套实时探测结果。排查指南见 [Troubleshooting](./troubleshooting.md)。

```bash
haro doctor
haro doctor --json
haro doctor --component provider|web|database|channel|config|cli|systemd
haro doctor --fix
```

**FEAT-027 结构化诊断**：
- 输出结构化 issue：`code`、`severity`、`component`、`evidence`、`remediation`、`fixable`
- `--component` 可缩小到 provider、web/systemd、database、channel、config 或 cli
- `--fix` 只执行安全修复：创建 Haro 目录、写非敏感默认配置、初始化 SQLite、收紧用户拥有目录权限、创建/更新 user-level systemd unit
- web/systemd 检查覆盖监听地址、端口占用、user service active/enabled 状态、env file 可读性和 `HARO_WEB_API_KEY` 模式
- setup/doctor 每次实时探测，不创建也不依赖 `~/.haro/setup-state.json`

### `haro config`

查看当前合并后的配置与来源。详见 [Configuration](./configuration.md)。

```bash
haro config
```

**配置层级**（高优先级先生效）：
1. 命令行参数
2. 项目级 `.haro/config.yaml`
3. 全局 `~/.haro/config.yaml`
4. 内置默认值

> 批次 2 起 `haro config get/set/unset` 已落地（见下文 [`haro config get/set/unset`](#haro-config-getsetunset已实现批次-2) 段落，secret 路径黑名单递归校验）；交互式编辑也仍然支持直接修改 `.haro/config.yaml`。

### `haro status`

查看当前运行状态（活跃 session、队列、最近执行情况）。

```bash
haro status                # 当前默认即输出 JSON
haro status --json         # _(Phase 1.5 规划)_ 显式标记，便于与 --human 等输出格式开关组合
haro status --human        # _(Phase 1.5 规划)_ 人读友好渲染（表格 / 颜色）
```

> 当前实现：`haro status` 默认 JSON，未注册 `--json` / `--human`。Phase 1.5 FEAT-039 会补完输出格式开关，让 status 与其他列出 / 查询命令的 `--json|--human` 风格统一。

### `haro update`

检查 npm registry 上是否有更新的 Haro CLI 版本，并提示升级命令。

```bash
haro update         # 检查更新并提示升级命令
haro update --check # 仅预览，不输出安装提示
```

**行为**：
- 向 `https://registry.npmjs.org/@haro/cli/latest` 查询最新版本
- 若当前版本 < 最新版本：输出版本差异与升级命令（`npm install -g @haro/cli@latest`）
- 若当前版本 == 最新版本：提示已是最新
- 若 registry 不可达（如尚未发布）：输出友好错误，不中断其他命令

### `haro run`

单次任务执行，不进入 REPL。

```bash
haro run "列出当前目录下的 TypeScript 文件"
haro run "帮我审查 src/provider.ts" --agent code-reviewer
haro run "..." --provider codex --model <live-model-id>
haro run "..." --no-memory
```

**选项**：
- `--agent <id>`：指定使用的 Agent
- `--provider <id>`：覆盖 Provider 选择规则
- `--model <name>`：显式 pin model
- `--no-memory`：本次执行不读写记忆，也不触发 `memory-wrapup`

### `haro model`

查看当前路由，或直接设置 CLI 默认 Provider / Model。

```bash
haro model
haro model codex
haro model codex <live-model-id>
```

> 当前仅支持位置参数直接写入默认 Provider / Model；交互式 `--select` 选择器在 Phase 1.5 规划。

### `haro provider`（FEAT-026 / FEAT-029）

Provider 配置与诊断命令族。`haro model` 保留为快速查看 / 切换默认模型；复杂 provider 首配、secretRef、model discovery 和 remediation 统一归入 `haro provider`。

```bash
haro provider list
haro provider setup codex
haro provider setup codex --auth-mode chatgpt --non-interactive
haro provider setup codex --auth-mode env --secret-ref env:OPENAI_API_KEY --non-interactive
haro provider setup codex --scope global --model <live-model-id>
haro provider setup codex --scope project --base-url https://api.example/v1 --non-interactive
haro provider doctor codex
haro provider models codex
haro provider select codex <live-model-id>
haro provider env codex
```

**设计边界**：
- YAML 只保存 `enabled`、`baseUrl`、`defaultModel`、`secretRef` 等非敏感配置，不保存真实 API key
- 默认通过环境变量读取 secret；只有显式 `--write-env-file` 才会把当前进程 secret 写入受保护 env file（0600，输出脱敏）
- `haro provider doctor` 输出 `PROVIDER_SECRET_MISSING`、`PROVIDER_HEALTHCHECK_FAILED`、`PROVIDER_MODEL_LIST_FAILED` 等 issue code 和下一条可执行修复命令
- provider 配置元数据来自 provider catalog/schema，避免命令层散落 `providerId === 'codex'` 分支

> Phase 1.5 后续将接入 `xiaomi-token-plan` / `kimi-token-plan` 等 provider；`haro provider setup <new-id>` 自动通过 catalog 驱动，无需新增 CLI 分支。

#### Codex ChatGPT subscription auth（FEAT-029）

TTY 下运行 `haro provider setup codex` 会先选择认证方式：

```
? Choose authentication method for Codex
  ▸ Sign in with ChatGPT (recommended for Plus / Pro / Team)
    Use OPENAI_API_KEY (developer / org accounts)
```

选择 ChatGPT 后，Haro 默认会在当前终端执行官方 `codex login --device-auth`；用户可在任意有浏览器的设备打开 URL 并输入用户码完成授权。成功后只写入非敏感配置：

```yaml
providers:
  codex:
    enabled: true
    secretRef: env:OPENAI_API_KEY
    authMode: chatgpt
```

示例输出（account_id 已脱敏）：

```
Launching `codex login --device-auth` — open the URL printed below in any browser, enter the code, then return here.

Open this URL in any browser:
https://auth.openai.com/device
Enter code: ABCD-EFGH

✓ ChatGPT login detected (account: user_2…XaxL, refreshed 2026-04-27T11:30:00Z)
Provider setup: codex
Auth mode: chatgpt
ChatGPT auth.json: /home/user/.codex/auth.json (present)
Codex binary: /home/user/.local/bin/codex
```

本机有浏览器且希望使用 localhost callback 时，可显式回退：

```bash
HARO_CODEX_LOGIN_MODE=browser haro provider setup codex
```

非交互 ChatGPT 模式不会 spawn 登录流程，只校验本机已经完成 `codex login --device-auth`（或浏览器回退模式的 `codex login`）：

```bash
haro provider setup codex --auth-mode chatgpt --non-interactive
```

`haro provider env codex` 在 ChatGPT 模式下输出：

```
Provider env: codex (Codex)

ChatGPT subscription auth via ~/.codex/auth.json
- authMode: chatgpt
- account_id: user_2…XaxL

No OPENAI_API_KEY export is required for this provider mode.
```

`haro provider doctor codex` 在 ChatGPT 模式下额外显示 `auth.json` 路径、`authMode`、脱敏 `account_id`、`last_refresh` 与 `codex` binary 是否在 PATH。任何 `access_token` / `refresh_token` / `id_token` 都不会出现在 stdout、日志或 YAML 中。

### `haro channel`

消息渠道管理。详见 [Channel Layer 设计](./modules/channel-layer.md) 与 [Channels 用户指南](./channels.md)。

```bash
haro channel list
haro channel enable <id>
haro channel disable <id>
haro channel remove <id>
haro channel doctor <id>
haro channel setup feishu
haro channel setup telegram
```

> Phase 1.5 将新增 `haro channel setup web` 用于配置 Web Channel（FEAT-031）。

### `haro gateway`

Gateway / daemon 控制，统一启动所有 enabled 的外部消息渠道（Feishu / Telegram / 未来的 Web Channel），使 Haro 成为持续运行的助手。详见 [Channels 用户指南](./channels.md#gateway-控制)。

```bash
haro gateway start          # 前台运行，统一启动所有 enabled channels
haro gateway start --daemon # 后台运行（写入 PID 文件，重定向日志）
haro gateway stop           # 停止正在运行的 gateway 进程
haro gateway status         # 查看 gateway 运行状态与各 channel 健康
haro gateway doctor         # 诊断 gateway 进程与所有 enabled channels
```

**运行模式**：
- 前台模式：直接阻塞终端，Ctrl+C 优雅停止所有 channels
- 后台模式：通过 `spawn` 启动 detached 子进程，PID 写入 `~/.haro/gateway.pid`，日志写入 `~/.haro/logs/gateway.log`

**数据路径**：
- PID 文件：`~/.haro/gateway.pid`
- Gateway 日志：`~/.haro/logs/gateway.log`
- Channel 私有状态：`~/.haro/channels/<id>/state.json` + `sessions.sqlite`
- 凭据：只来自环境变量 / config，不落盘到 state 文件

### `haro skills`

技能管理（**兼容 Claude Code skill 格式**）。

```bash
haro skills list
haro skills install <git-url-or-path>
haro skills info <skill-name>
haro skills enable <skill-name>
```

> Phase 1.5 将新增 `haro skill <name> run` / `disable` / `uninstall` / `show events` 等单数详细控制（FEAT-039）。

### `haro web`

启动 Web Dashboard 服务。

```bash
haro web                              # 默认 127.0.0.1:3456
haro web --port 3000 --host 0.0.0.0
haro web --api-key <token>            # _(Phase 1.5 规划)_ CLI 端注入 API key，避免依赖 HARO_WEB_API_KEY 环境变量
```

> 当前实现：`haro web` 仅支持 `--port` / `--host`；API key 通过 `HARO_WEB_API_KEY` 环境变量注入。FEAT-038 已把 Web Server 剥离到独立 `@haro/web-api` 包，`haro web` 现在是薄启动器（动态 `import('@haro/web-api')` + 注入 CLI 的 runtime 上下文，含 `runDiagnostics` 回调）；`pnpm -F @haro/web-api start [-- --port <n>] [--host <addr>]` 也可独立启动 web-api，但这条路径不带 CLI runtime 上下文，doctor 路由会返回 `WEB_DIAGNOSTICS_RUNNER_NOT_CONFIGURED` fallback。`--api-key` 等 CLI 端额外参数随 FEAT-039 补完。

### `haro eat` / `haro shit`

进化代谢。详见 [Evolution 代谢机制规范](../specs/evolution-metabolism.md)。

```bash
haro eat https://example.com/article
haro eat ./local-doc.md
haro eat "一段直接粘贴的文本"

haro shit --scope skills --days 90
haro shit --scope all --dry-run
haro shit rollback <archive-id>
```

> Phase 2.0 将新增自动 eat/shit 触发（FEAT-041）；当前命令仍由用户手动调用。

---

## Phase 1.5 命令（FEAT-039）

FEAT-039 批次 1（chat / session / agent）+ 批次 2（memory / logs / workflow / budget / user / skill 单数 / config get-set-unset）已落地。批次 3（REPL slash + 全命令 `--json/--human` 统一 + E2E + 类型守门 CI）仍在规划中。详细 spec 见 [`specs/phase-1.5/FEAT-039-cli-feature-parity.md`](../specs/phase-1.5/FEAT-039-cli-feature-parity.md)。所有命令通过 `@haro/core/services` 与 Web API 共用业务逻辑（R5/R13）。

### `haro chat`（已实现，批次 1）

聊天主入口，CLI 端的"对话视图"。与 `haro run` 区别：`run` 是单次任务、立即返回；`chat` 是持续对话，可看历史、切换 agent、附带文件。

```bash
haro chat                         # 进入聊天 REPL，新建 session
haro chat --session <id>          # 接续指定 session（pin 到该 session 的 previousResponseId）
haro chat --agent <id>            # 用指定 agent 开聊
haro chat --send "<msg>"          # 单轮发送，不进入 REPL（脚本化）
haro chat --history               # 列出最近 N 个 session 后让用户选
```

`--session` 校验：进入 REPL 前先确认 session 存在、属于当前 agent；不匹配会拒绝并给出建议命令（避免误把别的 agent 的会话续接到当前 agent）。`--session` 通过 runner 的 `continueFromSessionId` 路径精确取该 session 的 `previousResponseId`，不再退回到"latest completed for agent+provider"启发式。

### `haro session`（已实现，批次 1）

Session 管理。

```bash
haro session list                 # 列出活跃和最近 session
haro session list --json
haro session show <id>            # 查看完整事件流
haro session show <id> --tail
haro session resume <id>          # 真正进入 chat REPL，pin 到该 session
haro session export <id> [--format md|json]   # 分页拉满所有事件，输出 exportedCount
haro session delete <id> [--yes]  # CLI 端 audit event_type='cli.session.delete'
```

`session resume` 与 `chat --session <id>` 走同一条 REPL 入口；首轮 turn 强制从指定 session 续接，第二轮起回到"latest for agent+provider"（此时 latest 就是新生成的 session）。`session export` 持续分页直到拉空 session_events 表，避免 500 条静默截断。`session delete` 写入 `cli.session.delete` 审计事件，与 Web Dashboard 的 `web.session.delete` 区分来源。

### `haro agent`（已实现，批次 1）

Agent 管理。等价于 Web Dashboard 的 `/agent` 页。

```bash
haro agent list
haro agent show <id>
haro agent create <id> --from-template default   # 目前只支持 default 模板
haro agent edit <id>              # 打开 $EDITOR 修改 ~/.haro/agents/<id>.yaml，保存后再校验
haro agent delete <id>            # 默认 agent 受保护，需要先改 defaultAgent
haro agent validate <id>          # Zod schema 校验
haro agent test <id> --task "..."  # sandbox：noMemory + continueLatestSession=false
```

`agent test` 是真正的 sandbox：显式关掉 memory 写入与"latest session 续接"，确保不会读到历史对话上下文，也不会污染下一轮真实会话。

### `haro memory`（已实现，批次 2）

记忆查询与写入，等价于 Web Dashboard `/knowledge`。所有读写经 `services.memory`。

```bash
haro memory query "<query>"                       # FTS5 搜索
haro memory query "<q>" --scope agent --agent <id>
haro memory remember "<text>" --scope shared      # platform 写入被拒
haro memory list --scope shared
haro memory show <memory-id>
haro memory export --scope shared -o entries.json
```

### `haro logs`（已实现，批次 2）

运行日志与 session 事件，等价于 Web Dashboard `/logs`。`tail` 用 `(createdAt, id)` 复合游标 + 单 tick 内连续翻页，避免同时间戳爆发事件被丢。

```bash
haro logs tail                      # 跟随主流，Ctrl+C 退出
haro logs tail --session <id>
haro logs show --since <iso> --component provider
haro logs export --since <iso> -o haro-logs.jsonl
```

### `haro workflow`（已实现，批次 2）

工作流 checkpoint 查询。`replay` 当前是 read-only 检查器（live replay 待 follow-up）。

```bash
haro workflow list
haro workflow show <id>
haro workflow checkpoints <id>
haro workflow replay <id>            # read-only：只打印 checkpoint chain
```

### `haro budget`（已实现，批次 2，set 留 follow-up）

Token / 权限预算（FEAT-023）的 CLI 视图。当前没有 per-agent budget 表，所以 `set --agent` 直接拒绝并给出说明。

```bash
haro budget show                              # 列出最近 N 个 workflow 的预算
haro budget show --workflow <id>
haro budget audit --since <iso> --outcome denied --type budget
haro budget set --agent <id> --tokens 100000  # 留 follow-up：无 per-agent 表
```

### `haro user`（已实现，批次 2）

本地多用户管理（FEAT-028）。CLI 默认以 owner 身份运行；所有写动作的审计行 `actor_kind='system'` + `metadata.actorSource='cli'`，便于事后区分 CLI 与 bootstrap 来源。

```bash
haro user list
haro user show <username>
haro user create <username> --role admin --password <p>
haro user role <username> admin
haro user disable <username>
haro user reset-token <username> --password <new>   # 撤销该用户所有活跃 session
```

### `haro skill <id>`（已实现，批次 2，单数详细控制）

补充 `haro skills` 复数命令族。`haro skills` 偏管理（list / install / info / enable）；`haro skill <id>` 偏单技能详细控制。

```bash
haro skill <id> run [--input "..."]
haro skill <id> disable
haro skill <id> uninstall [--yes]   # preinstalled 受保护
haro skill <id> show events         # 资产 audit 事件流
haro skill <id> show detail
haro skill <id> validate            # 复跑 metadata 校验
```

### `haro config get/set/unset`（已实现，批次 2）

补完 `haro config`（早先只读）。secret 路径黑名单（`providers.*.apiKey`/`channels.*.appSecret` 等）会**递归校验**写入对象的全部子字段，拒绝把任何 secret 落盘到 YAML——`set channels.feishu '{"appSecret":"..."}'` 这种 parent-object 注入也会被拦下。

```bash
haro config get providers.codex.defaultModel
haro config set providers.codex.defaultModel <model-id> --scope global
haro config unset providers.codex.defaultModel --scope project
```

> 写入受 `secretRef` 与权限分级守门；任何 secret 字段（包括嵌套字段）拒绝直接写明文 YAML。

---

## REPL Slash 命令

| 命令 | 状态 | 说明 |
|------|------|------|
| `/help` | 已实现 | 显示所有可用命令 |
| `/model` | 已实现 | 查看或切换当前 Provider/Model |
| `/new` | 已实现 | 开始新的 session（清除当前上下文） |
| `/retry` | 已实现 | **创建新 session** 重试上一次请求 |
| `/compress` | 已实现（探针） | 仅检查当前 Provider 是否支持上下文压缩 |
| `/skills` | 已实现 | 查看和管理当前 Agent 的技能 |
| `/usage` | 已实现 | 查看当前 session 的 token / 事件用量 |
| `/agent <id>` | 已实现 | 切换当前 Agent |
| `/sessions` | **Phase 1.5 规划** | REPL 内列出最近 session 并切换 |
| `/memory` | **Phase 1.5 规划** | REPL 内 FTS5 搜索记忆 |
| `/logs` | **Phase 1.5 规划** | REPL 内查看最近事件 |
| `/budget` | **Phase 1.5 规划** | REPL 内查看当前 session 预算消耗 |

> 设计约束：slash 命令只在 CLI 本地消费，不透传给其他 Channel。

---

## Web UI 等价对照表

为了保证 CLI-first 原则不被无意打破，下表列出每个 Web Dashboard 页面对应的 CLI 命令。任何 Web Dashboard 新增页面或动作都必须先确认 CLI 等价命令存在或同步规划。

| Web Dashboard 页面 / 动作 | CLI 等价命令 | 状态 |
|--------------------------|--------------|------|
| `/bootstrap` 首用户创建 | `haro user create <name> --role owner` | 已实现（批次 2） |
| `/login` 登录 | `haro auth login`（CLI 不强制登录，本地 token 直读） | 自用模式不需要 |
| `/chat` 对话 | `haro chat` | 已实现（批次 1） |
| `/sessions` 会话列表 | `haro session list` | 已实现（批次 1） |
| `/sessions/<id>` 会话详情 | `haro session show <id>` | 已实现（批次 1） |
| `/agent` Agent 编辑 | `haro agent create/edit/delete/show` | 已实现（批次 1） |
| `/skills` Skill 管理 | `haro skills *` + `haro skill <name> *` | 部分实现 |
| `/knowledge` 记忆 | `haro memory query/remember/list/show/export` | 已实现（批次 2） |
| `/logs` 日志 | `haro logs tail/show/export` | 已实现（批次 2） |
| `/monitor` 监控 | `haro status` + `haro logs show --component provider` | 已实现（status 待统一 --json/--human）|
| `/dispatch` 编排 | `haro workflow list/show/replay/checkpoints` | 已实现（批次 2，replay read-only）|
| `/channel` Channel 管理 | `haro channel *` + `haro gateway *` | 已实现 |
| `/gateway` Gateway 控制 | `haro gateway start/stop/status` | 已实现 |
| `/settings` 系统设置 | `haro config get/set/unset` + `haro provider *` | 已实现（批次 2） |
| `/users` 用户管理 | `haro user *` | 已实现（批次 2） |

---

## CLI 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 命令路由 | commander.js | 命令树清晰，扩展简单 |
| 持续 REPL 输入 | readline/promises | 最小依赖、适合长期循环 |
| 一次性交互 | @clack/prompts | 视觉反馈好，适合确认/选择 |
| 日志 | pino | 结构化日志，支持双输出 |
| 输出格式化 | 内置 + chalk + 自维护 table renderer | 避免重型 TUI 依赖 |

---

## 日志配置

- stdout：开发模式可读输出
- 文件：`~/.haro/logs/haro.log`
- `haro doctor` 会检查日志目录可写性与最近错误摘要

---

## 相关文档

- [Getting Started](./getting-started.md) — 从安装到跑通第一条任务
- [Install](./install.md) — 全平台安装与卸载
- [Configuration](./configuration.md) — 配置层级、环境变量与敏感数据原则
- [Channels](./channels.md) — Channel 启用、配置与 Gateway 控制
- [Troubleshooting](./troubleshooting.md) — 常见故障排查
- [架构总览 § 三层解耦](./architecture/overview.md#三层解耦cli--web-api--web-前端) — CLI / Web API / Web 前端 解耦原则
- [路线图 § Phase 1.5](../roadmap/phases.md#phase-15-workbench-parity--日用底座补完--架构解耦) — CLI 等价补完所属阶段
- [2026-05-01 重设计规划](./planning/redesign-2026-05-01.md) — CLI-first 边界约束的来源
