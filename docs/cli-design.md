# CLI 设计文档

## 概述

Haro CLI 采用三层组合：

- **commander.js**：命令路由与子命令注册
- **readline/promises**：持续 REPL 输入循环
- **@clack/prompts**：欢迎横幅、确认、选择器等一次性交互

目标是：**REPL 可持续、命令面清晰、Channel 抽象一致**。

> 如果你是第一次使用 Haro，建议先阅读 [Getting Started](./getting-started.md)。

## 开发态入口

在源码仓库中，可直接使用顶层 pnpm 脚本调用 CLI，无需记忆深路径：

```bash
pnpm haro                  # 等同于 node packages/cli/bin/haro.js
pnpm haro setup            # 首次引导
pnpm haro doctor           # 诊断
pnpm haro run "..."        # 单次任务
```

> 注：`pnpm setup` 与 pnpm 内置命令冲突，等价路径为 `pnpm run setup` 或 `pnpm haro setup`。

## 命令列表

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

### `haro setup` / `haro onboard`

首次引导命令。`onboard` 是 `setup` 的别名。详见 [Getting Started](./getting-started.md)。

```bash
haro setup
haro onboard
```

**FEAT-027 staged setup**：
- 按 `prerequisites`、`global-command`、`data-directory`、`configuration`、`provider`、`database`、`web-service`、`channels`、`smoke-test` 分阶段检查。
- 支持 `--profile dev|global|systemd`：`dev` 面向源码 `pnpm haro`，`global` 要求 `haro` 在 PATH，`systemd` 额外检查 user-level web service。
- 支持 `--check` 只检查、`--repair` 执行安全修复、`--json` 输出机器可读 report。
- setup 只写非敏感默认配置；不会写入 provider secret、修改 shell profile、安装 Node/pnpm、创建系统级 systemd unit 或调整防火墙。
- provider 缺失时，provider/smoke stage 会提示 `haro provider setup codex`，并用 offline dry-run 证明 CLI/config/database 基础链路可用。

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

> Phase 0 未实现交互式 `--select` 选择器；当前仅支持通过位置参数直接写入默认 Provider / Model。

### `haro provider`（FEAT-026）

Provider 配置与诊断命令族。`haro model` 保留为快速查看/切换默认模型，复杂 provider 首配、secretRef、model discovery 和 remediation 统一归入 `haro provider`。

```bash
haro provider list
haro provider setup codex
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

### `haro config`

查看当前合并后的配置与来源。详见 [Configuration](./configuration.md)。

```bash
haro config
```

> Phase 0 当前只提供只读配置查看；`config set/get` 子命令尚未实现。修改配置请直接编辑项目级 `.haro/config.yaml` 或全局 `~/.haro/config.yaml`。

**配置层级**：
1. 命令行参数
2. 项目级 `.haro/config.yaml`
3. 全局 `~/.haro/config.yaml`
4. 内置默认值

### `haro doctor`

系统诊断，检查 staged setup 使用的同一套实时探测结果。排查指南见 [Troubleshooting](./troubleshooting.md)。

```bash
haro doctor
haro doctor --json
haro doctor --component provider|web|database|channel|config|cli|systemd
haro doctor --fix
```

**FEAT-027 结构化诊断**：
- 输出结构化 issue：`code`、`severity`、`component`、`evidence`、`remediation`、`fixable`。
- `--component` 可缩小到 provider、web/systemd、database、channel、config 或 cli。
- `--fix` 只执行安全修复：创建 Haro 目录、写非敏感默认配置、初始化 SQLite、收紧用户拥有目录权限、创建/更新 user-level systemd unit。
- web/systemd 检查覆盖监听地址、端口占用、user service active/enabled 状态、env file 可读性和 `HARO_WEB_API_KEY` 模式。
- setup/doctor 每次实时探测，不创建也不依赖 `~/.haro/setup-state.json`。

### `haro skills`

技能管理（**兼容 Claude Code skill 格式**）。

```bash
haro skills list
haro skills install <git-url-or-path>
haro skills info <skill-name>
haro skills enable <skill-name>
```

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

### `haro gateway`

Gateway / daemon 控制，统一启动所有 enabled 的外部消息渠道（Feishu / Telegram），使 Haro 成为持续运行的助手。详见 [Channels 用户指南](./channels.md#gateway-控制)。

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

### `haro update`

检查 npm registry 上是否有更新的 Haro CLI 版本，并提示升级命令。

```bash
haro update        # 检查更新并提示升级命令
haro update --check # 仅预览，不输出安装提示
```

**行为**：
- 向 `https://registry.npmjs.org/@haro/cli/latest` 查询最新版本
- 若当前版本 < 最新版本：输出版本差异与升级命令（`npm install -g @haro/cli@latest`）
- 若当前版本 == 最新版本：提示已是最新
- 若 registry 不可达（如尚未发布）：输出友好错误，不中断其他命令

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

### `haro status`

查看当前运行状态（活跃 session、队列、最近执行情况）。

```bash
haro status
```

## REPL Slash 命令

| 命令 | 说明 |
|------|------|
| `/model` | 查看或切换当前 Provider/Model |
| `/new` | 开始新的 session（清除当前上下文） |
| `/retry` | **创建新 session** 重试上一次请求 |
| `/compress` | 仅检查当前 Provider 是否支持上下文压缩，并提示 Phase 0 尚未接入压缩执行路径 |
| `/skills` | 查看和管理当前 Agent 的技能 |
| `/usage` | 查看当前 session 的 token / 事件用量 |
| `/agent <id>` | 切换当前 Agent |
| `/help` | 显示所有可用命令 |

> 设计约束：slash 命令只在 CLI 本地消费，不透传给其他 Channel。

## CLI 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 命令路由 | commander.js | 命令树清晰，扩展简单 |
| 持续 REPL 输入 | readline/promises | 最小依赖、适合长期循环 |
| 一次性交互 | @clack/prompts | 视觉反馈好，适合确认/选择 |
| 日志 | pino | 结构化日志，支持双输出 |

## 日志配置

- stdout：开发模式可读输出
- 文件：`~/.haro/logs/haro.log`
- `haro doctor` 会检查日志目录可写性与最近错误摘要

## 相关文档

- [Getting Started](./getting-started.md) — 从安装到跑通第一条任务
- [Install](./install.md) — 全平台安装与卸载
- [Configuration](./configuration.md) — 配置层级、环境变量与敏感数据原则
- [Channels](./channels.md) — Channel 启用、配置与 Gateway 控制
- [Troubleshooting](./troubleshooting.md) — 常见故障排查
