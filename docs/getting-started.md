# Getting Started

> 本文档面向第一次使用 Haro 的用户。如果你已经安装并配置过 Haro，可以直接跳到 [CLI 设计](cli-design.md) 或 [Channel 文档](channels.md)。

## Haro 是什么

Haro 是一个自进化多 Agent 中间件平台。它的目标不是只让 Agent 完成一次任务，而是让 **Agent、编排方式和平台本身** 在持续使用中一起变好。

- 输入不只来自 CLI，还来自飞书、Telegram 等消息渠道
- 能力不只靠 prompt 堆积，还需要可安装、可淘汰、可回滚的 skill / memory / tool 体系
- 多 Agent 编排和平台演进需要有明确边界，而不是无限长 prompt + 临时脚本

## 前置条件

在开始之前，请确认你的环境满足以下要求：

- **Node.js >= 22**
- **Codex Provider 认证**（任选其一，FEAT-029）：
  - 开发者 / 组织账号：导出 `OPENAI_API_KEY`
  - ChatGPT Plus/Pro 订阅用户：通过 `haro provider setup codex` 走官方 `codex login` OAuth，无需 API key

> 如果你没有 Node.js 22+，可以参考 [install.md](install.md) 中的环境准备章节。

## 安装

选择以下任一方式安装 Haro：

```bash
# macOS / Linux（推荐）
curl -fsSL https://raw.githubusercontent.com/haro-ai/haro/main/scripts/install.sh | bash

# Windows PowerShell
iwr -useb https://raw.githubusercontent.com/haro-ai/haro/main/scripts/install.ps1 | iex

# 或使用 npm / pnpm 全局安装
npm install -g @haro/cli@latest
# 或
pnpm add -g @haro/cli@latest
```

更详细的安装选项（包括从源码运行）见 [install.md](install.md)。

## 最短可跑通路径

```bash
# 1. 配置 Codex Provider 认证（任选其一）
#    A. 开发者 / 组织账号
export OPENAI_API_KEY=<your-key>
#    B. ChatGPT 订阅用户（推荐）
haro provider setup codex   # 选 "Sign in with ChatGPT"，走官方 codex login OAuth

# 2. 跑首次引导
haro setup
# 或
haro onboard

# 3. 先做诊断
haro doctor

# 4. 执行第一条任务
haro run "列出当前目录下的 TypeScript 文件"

# 5. 进入交互式 REPL
haro
```

`setup` / `onboard` 会依次检查：

- Node.js 版本是否 >= 22
- pnpm / npm 是否可用
- `~/.haro/` 数据目录是否可写
- Codex 认证状态：`OPENAI_API_KEY` 或 `~/.codex/auth.json`（FEAT-029 任一即可）

检查通过后，它会将默认的非敏感配置（如 `providers.codex.defaultModel`、`providers.codex.authMode`）写入 `~/.haro/config.yaml`，并给出明确的下一步建议。

如果 `haro doctor` 中 `providers.codex.healthy` 为 `false`，优先排查：

1. 当前 `authMode`：env 模式确认 `OPENAI_API_KEY` 已导出；chatgpt 模式确认 `~/.codex/auth.json` 存在 `tokens.access_token`（必要时重跑 `haro provider setup codex`）
2. 当前 shell 是否与执行 `haro` 的 shell 是同一个会话
3. 网络是否可访问 Codex 所需接口

## 首次引导之后

完成首次引导后，你可以：

```bash
# 查看当前状态
haro status

# 查看当前配置来源
haro config

# 查看已安装 skills
haro skills list

# 查看 channel 状态
haro channel list

# 启动 gateway（前台运行所有 enabled channels）
haro gateway start

# 后台运行 gateway
haro gateway start --daemon

# 查看 gateway 状态
haro gateway status
```

完整 CLI 能力列表见 [CLI 设计](cli-design.md)。

## 配置文件位置

Haro 采用双层配置：

- **全局配置**：`~/.haro/config.yaml`
- **项目级覆盖**：`<project>/.haro/config.yaml`

配置层级优先级：命令行参数 > 项目级 `.haro/config.yaml` > 全局 `~/.haro/config.yaml` > 内置默认值。

详细配置说明见 [configuration.md](configuration.md)。

## 故障排查

如果以上步骤遇到问题，请参考 [troubleshooting.md](troubleshooting.md)。常见问题包括：

- `haro doctor` 失败排查
- `OPENAI_API_KEY` 配置未生效
- Node.js / pnpm 版本不足
- gateway 进程残留
- 配置文件校验错误

## 下一步阅读

| 主题 | 文档 |
|------|------|
| 安装方式详解 | [install.md](install.md) |
| 配置层级与敏感数据原则 | [configuration.md](configuration.md) |
| 消息渠道（飞书 / Telegram） | [channels.md](channels.md) |
| CLI 完整命令参考 | [cli-design.md](cli-design.md) |
| 数据目录结构 | [data-directory.md](data-directory.md) |
| 故障排查 | [troubleshooting.md](troubleshooting.md) |
