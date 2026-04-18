# CLI 设计文档

## 概述

Haro CLI 基于 **commander.js**（命令路由）+ **@clack/prompts**（交互式提示），参考 Hermes 的命令集设计，追求轻量且符合 Haro 平台逻辑。

## 命令列表

### `haro`

启动交互式 REPL（不带任何子命令时）。

```bash
haro
```

进入 REPL 后显示：
```
Haro v0.1.0 — 自进化多 Agent 平台
当前 Provider: claude (claude-sonnet-4-5)
输入 /help 查看可用命令

>
```

### `haro run`

单次任务执行，不进入 REPL。

```bash
haro run "列出当前目录下的 TypeScript 文件"
haro run "帮我审查 src/provider.ts" --agent code-reviewer
haro run "..." --provider codex --model codex-1
```

**选项**：
- `--agent <id>`：指定使用的 Agent（不填则使用默认 Agent）
- `--provider <id>`：覆盖 Provider 选择规则
- `--model <name>`：覆盖 Model 选择规则
- `--no-memory`：本次执行不写入记忆

### `haro model`

查看和切换当前 Provider 和 Model。

```bash
# 查看当前选择
haro model

# 交互式切换
haro model --select

# 直接切换
haro model claude claude-opus-4-5
```

**输出示例**：
```
当前配置：
  Provider: claude
  Model:    claude-sonnet-4-5

可用 Provider：
  ● claude   (healthy)  claude-haiku-4-5 / claude-sonnet-4-5 / claude-opus-4-5
  ● codex    (healthy)  codex-1-mini / codex-1
```

### `haro config`

配置管理。

```bash
# 查看当前配置
haro config

# 设置配置项
haro config set memory.primary.path /path/to/aria-memory

# 查看特定配置
haro config get providers.codex.apiKey
```

**配置层级**（优先级从高到低）：
1. 命令行参数
2. 项目级 `.haro/config.yaml`
3. 全局 `~/.haro/config.yaml`
4. 内置默认值

### `haro doctor`

系统诊断，检查所有关键组件的健康状态。

```bash
haro doctor
```

**输出示例**：
```
Haro 系统诊断
─────────────────────────────────

配置文件
  ✓ ~/.haro/config.yaml         存在且格式正确
  ✓ ~/.haro/selection-rules.yaml 存在且格式正确

Provider 状态
  ✓ claude                       认证有效，SDK 可访问
  ✗ codex                        API Key 未配置
    → 请设置环境变量 OPENAI_API_KEY 或运行 haro config set providers.codex.apiKey <key>

数据目录
  ✓ ~/.haro/agents/              存在，2 个 Agent 配置
  ✓ ~/.haro/memory/              存在，可读写
  ✓ ~/.haro/channels/            存在，2 个 Channel 配置
  ✓ ~/.haro/skills/              存在，15 个预装 skill
  ✓ ~/.haro/haro.db              SQLite 正常，WAL 模式
  ✓ ~/.haro/logs/                存在，可写

Channel 状态
  ✓ cli                          enabled
  ✓ feishu                       enabled (long-polling, 1 session 活跃)
  - telegram                     disabled

Agent 配置
  ✓ haro-assistant               配置有效
  ✓ code-reviewer                配置有效

总结：1 个问题需要处理
```

### `haro skills`

技能管理（agentskills.io 标准兼容）。

```bash
# 列出所有技能
haro skills list

# 安装技能
haro skills install <skill-name>

# 查看技能详情
haro skills info <skill-name>

# 为 Agent 启用技能
haro skills enable <skill-name> --agent <agent-id>
```

### `haro channel`

消息渠道管理。详见 [Channel Layer 设计](./modules/channel-layer.md)。

```bash
# 列出所有已注册 channel
haro channel list

# 启用 / 停用 / 移除
haro channel enable <id>
haro channel disable <id>
haro channel remove <id>

# channel 级健康检查
haro channel doctor <id>

# 飞书接入向导（调用 lark-setup skill）
haro channel setup feishu

# Telegram 接入向导
haro channel setup telegram
```

### `haro eat` / `haro shit`

进化代谢。详见 [Evolution 代谢机制规范](../specs/evolution-metabolism.md)。

```bash
# 摄入：把外部内容沉淀为 rules / skills / memory
haro eat https://example.com/article
haro eat ./local-doc.md
haro eat "一段直接粘贴的文本"

# 排出：扫描并淘汰不必要的外挂组件
haro shit --scope skills --days 90
haro shit --scope all --dry-run      # 预览不执行
haro shit rollback <archive-id>       # 回滚
```

### `haro status`

查看当前运行状态（活跃 session、队列等）。

```bash
haro status
```

**输出示例**：
```
Haro 运行状态
─────────────────────────────────
活跃 Session:  0
等待队列:      0
今日 Session:  12
今日成功率:    91.7% (11/12)

最近 Session:
  sess_abc123  code-reviewer  claude  完成  2分钟前
  sess_def456  haro-assistant codex   完成  15分钟前
```

## REPL Slash 命令

在 REPL 交互模式（`haro`）中可使用以下斜杠命令：

| 命令 | 说明 |
|------|------|
| `/model` | 查看或切换当前 Provider/Model |
| `/new` | 开始新的 session（清除当前上下文） |
| `/retry` | 重试上一次请求 |
| `/compress` | 压缩当前上下文（触发 compaction，仅 Claude） |
| `/skills` | 查看和管理当前 Agent 的技能 |
| `/usage` | 查看当前 session 的 token 用量 |
| `/agent <id>` | 切换当前 Agent |
| `/help` | 显示所有可用命令 |

## CLI 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 命令路由 | commander.js | 最流行、简单直接、生态完善 |
| 交互式提示 | @clack/prompts | 美观、轻量、TypeScript 原生 |
| 日志 | pino | 结构化日志，支持双输出 |
| 参考设计 | Hermes CLI | 命令集设计参考 |

## 日志配置

pino 双输出配置（参考 Hermes）：

```typescript
const logger = pino({
  transport: {
    targets: [
      // 开发模式：美化输出到 stdout
      { target: 'pino-pretty', options: { colorize: true } },
      // 持久化：写入日志文件
      {
        target: 'pino/file',
        options: { destination: '~/.haro/logs/haro.log' }
      },
    ],
  },
})
```

`haro doctor` 会检查日志目录是否可写，并报告最近的错误日志摘要。
