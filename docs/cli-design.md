# CLI 设计文档

## 概述

Haro CLI 采用三层组合：

- **commander.js**：命令路由与子命令注册
- **readline/promises**：持续 REPL 输入循环
- **@clack/prompts**：欢迎横幅、确认、选择器等一次性交互

目标是：**REPL 可持续、命令面清晰、Channel 抽象一致**。

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

首次引导命令。`onboard` 是 `setup` 的别名。

```bash
haro setup
haro onboard
```

**Phase 0 最小职责**：
- 检查 Node 版本（`>=22`）
- 检查 `pnpm` 是否可用
- 检查 `~/.haro/` 数据目录可写
- 检查 `OPENAI_API_KEY`
- 写入非敏感默认配置（例如 `providers.codex.defaultModel`）
- 输出明确下一步：`haro doctor` / `haro run "..."` / `haro channel setup feishu`

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

查看和切换当前 Provider 和 Model。

```bash
haro model
haro model --select
haro model codex <live-model-id>
```

### `haro config`

配置管理。

```bash
haro config
haro config set memory.path /path/to/aria-memory
haro config get providers.codex.defaultModel
```

**配置层级**：
1. 命令行参数
2. 项目级 `.haro/config.yaml`
3. 全局 `~/.haro/config.yaml`
4. 内置默认值

### `haro doctor`

系统诊断，检查 Phase 0 核心组件的健康状态。

```bash
haro doctor
```

**Phase 0 最小检查项**：
- 配置文件合法性
- Provider `healthCheck()`
- `~/.haro/` 目录可读写
- SQLite 可连接
- 已启用 Channel 的基本健康状态

### `haro skills`

技能管理（**兼容 Claude Code skill 格式**）。

```bash
haro skills list
haro skills install <git-url-or-path>
haro skills info <skill-name>
haro skills enable <skill-name>
```

### `haro channel`

消息渠道管理。详见 [Channel Layer 设计](./modules/channel-layer.md)。

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

Gateway / daemon 控制，统一启动所有 enabled 的外部消息渠道（Feishu / Telegram），使 Haro 成为持续运行的助手。

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
| `/compress` | 压缩当前上下文（仅当当前 Provider 支持 `contextCompaction`） |
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
