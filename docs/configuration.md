# 配置指南

## 配置层级

Haro 采用四层优先级配置：

1. **命令行参数** — 如 `--provider codex --model <id>`
2. **项目级配置** — `<project>/.haro/config.yaml`
3. **全局配置** — `~/.haro/config.yaml`
4. **内置默认值** — 硬编码在 `@haro/core` 中

上层配置会覆盖下层同名字段，但不会删除下层其他字段。例如项目级配置只改 `channels.feishu.enabled`，全局配置中的 `providers.codex.defaultModel` 仍然有效。

## 数据目录位置

默认全局数据目录为 `~/.haro/`，可通过环境变量覆盖：

```bash
export HARO_HOME=/path/to/custom/haro/dir
haro doctor
```

项目级配置目录固定为项目根目录下的 `.haro/`，不受 `HARO_HOME` 影响。

数据目录完整结构见 [data-directory.md](data-directory.md)。

## 全局配置示例

`~/.haro/config.yaml`：

```yaml
providers:
  codex:
    defaultModel: <live-codex-model-id>

memory:
  path: ~/.haro/memory

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

runtime:
  taskTimeoutMs: 600000

logging:
  level: info
  stdout: true
  file: ~/.haro/logs/haro.log

defaultAgent: haro-assistant
```

## 项目级配置示例

`<project>/.haro/config.yaml`：

```yaml
# 仅覆盖需要差异化的部分
channels:
  feishu:
    enabled: true

memory:
  path: ./.haro/memory

defaultAgent: code-reviewer
```

项目级配置适合在特定代码仓库中启用不同的 Agent 或 Channel。

## 环境变量

### 核心环境变量

| 变量名 | 作用 | 示例 |
|--------|------|------|
| `OPENAI_API_KEY` | Codex Provider 在 `authMode=env` 时使用的 API key；ChatGPT 订阅用户走 `codex login` 路径，不需要这个变量 | `sk-...` |
| `HARO_HOME` | 覆盖全局数据目录路径 | `/data/haro` |
| `HARO_CODEX_LOGIN_MODE` | `haro provider setup codex` ChatGPT 登录模式：默认 `device-auth`（适配 devbox/SSH/headless）；本机带浏览器者设为 `browser` 走 localhost callback | `browser` |
| `NPM_CONFIG_REGISTRY` | `haro update` 使用的 registry | `https://registry.npmmirror.com` |

### Channel 凭证环境变量

Haro 的 Channel 配置支持 `${ENV_VAR}` 语法注入环境变量，避免敏感凭证落盘：

| Channel | 配置项 | 推荐环境变量 |
|---------|--------|-------------|
| Feishu | `appId` | `FEISHU_APP_ID` |
| Feishu | `appSecret` | `FEISHU_APP_SECRET` |
| Telegram | `botToken` | `TELEGRAM_BOT_TOKEN` |

配置写法：

```yaml
channels:
  feishu:
    appId: "${FEISHU_APP_ID}"
    appSecret: "${FEISHU_APP_SECRET}"
  telegram:
    botToken: "${TELEGRAM_BOT_TOKEN}"
```

在运行时，Channel adapter 会解析 `${...}` 并从 `process.env` 读取对应值。如果环境变量未设置，对应配置项会解析为空字符串，Channel 的 `doctor` 会报告 `missing_credentials`。

## Provider 凭证注入规则

当前正式实现的 Provider 只有 **Codex**，支持两种认证模式（FEAT-029）。其凭证注入遵循以下规则：

1. **`authMode=env`（开发者 / 组织账号）**：从 `process.env.OPENAI_API_KEY` 读取；`config.yaml` 禁止写入 `providers.codex.apiKey`，校验会拒绝加载
2. **`authMode=chatgpt`（ChatGPT Plus/Pro 订阅）**：通过 `haro provider setup codex` → 内部 `spawn('codex', ['login', '--device-auth'])` 走 OAuth，凭证由 codex CLI 写入并刷新 `~/.codex/auth.json`；Haro **不**复制 token，YAML 只写 `authMode: chatgpt`
3. **`authMode=auto`（默认）**：env 优先，否则若 `~/.codex/auth.json` 存在 access_token 则走 chatgpt，再否则报错并提示运行 `haro provider setup codex`
4. **YAML 只保存引用与非敏感字段**：`providers.codex.secretRef: env:OPENAI_API_KEY`、`authMode`、`enabled`、`baseUrl`、`defaultModel` 可写入配置；schema 显式拒绝任何 `tokens.*` 字段
5. **Live model 列表**：env 模式从 `${baseUrl}/models` 拉取；chatgpt 模式从 codex CLI 维护的 `~/.codex/models_cache.json` 读取（无硬编码 slug）

详细认证语义、`resolveAuth()` 优先级和数据流图见 [docs/architecture/provider-layer.md](architecture/provider-layer.md#phase-1-chatgpt-subscription-authfeat-029)。

示例：

```bash
# A. env 模式（developer / org accounts）
export OPENAI_API_KEY=<your-key>
haro provider setup codex --auth-mode env --non-interactive
haro run "分析当前代码"

# B. ChatGPT subscription 模式（推荐订阅用户）
haro provider setup codex
# → 选 "Sign in with ChatGPT"，spawn 官方 codex login 完成 device-auth OAuth
haro run "分析当前代码"

# 错误：试图在 config.yaml 中写入 apiKey 或 tokens
# providers:
#   codex:
#     apiKey: <your-key>   # ← HaroConfigValidationError
#     tokens: { ... }      # ← schema 直接拒绝
```

### Provider 引导配置（FEAT-026）

`haro provider` 命令族用于解释 `OPENAI_API_KEY`、`config.yaml`、provider env file 与 systemd/user service 的关系，并提供可执行修复入口：

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

配置示例：

```yaml
providers:
  codex:
    enabled: true
    secretRef: env:OPENAI_API_KEY
    baseUrl: https://api.openai.com/v1   # 可选
    defaultModel: <live-model-id>
```

原则：

- `config.yaml` 只写入 `defaultModel`、`baseUrl`、`enabled`、`secretRef` 等非敏感字段。
- 默认不写 env file；只有显式 `--write-env-file` 才会把当前进程中的 secret 原子写入 `~/.config/haro/providers.env`（或 XDG 等价路径），并强制 0600 权限。
- `haro provider env codex` 只展示模板、来源摘要和 masked 状态，不回显真实 key。
- `haro doctor` 与 Web Dashboard 只展示脱敏后的 provider 配置状态和 remediation。
- systemd 用户服务与 CLI 前台运行必须能解释各自读取到的 env 来源，避免“命令行可用但服务不可用”。

## 敏感数据不落盘原则

Haro 在设计上强制区分**配置**与**凭证**：

- **配置**（非敏感）：model 选择、timeout、channel 开关、session scope 等 —— 可以写入 `config.yaml`
- **凭证**（敏感）：API Key、App Secret、Bot Token 等 —— 只通过环境变量注入

具体约束：

| 数据 | 存储位置 | 说明 |
|------|---------|------|
| `OPENAI_API_KEY` | 环境变量 | 绝不写入任何配置文件或 state 文件 |
| `FEISHU_APP_SECRET` | 环境变量 → Channel 内存 | 通过 `${FEISHU_APP_SECRET}` 注入，不持久化到磁盘 |
| `TELEGRAM_BOT_TOKEN` | 环境变量 → Channel 内存 | 同上 |
| Channel state | `~/.haro/channels/<id>/state.json` | 禁止写入任何凭证字段；仅保存 transport、sessionScope、lastConnectedAt 等非敏感运行态 |

如果你通过 `haro channel setup <id>` 交互式输入凭证，返回的配置会被完整写入 `config.yaml`（包括明文凭证）。**如果你希望凭证不落盘**，应在运行 setup 前预先在 `config.yaml` 中写入 `${...}` 环境变量引用，而不是在交互中直接粘贴真实值。

## 配置校验

Haro 使用 Zod schema 校验配置。如果 `config.yaml` 包含非法字段，启动时会报错并指出具体路径：

```
Invalid Haro config (/home/user/.haro/config.yaml):
  providers.codex.apiKey: Codex Provider 不接受 YAML 配置中的 apiKey — 请通过 OPENAI_API_KEY 环境变量传递凭证
```

遇到校验错误时：

1. 根据报错路径定位到具体文件（全局或项目级）
2. 修正或删除非法字段
3. 重新运行 `haro doctor` 确认

## 运行时覆盖

部分命令支持通过命令行参数临时覆盖配置，不影响配置文件：

```bash
haro run "..." --provider codex --model <live-model-id>
haro run "..." --no-memory
```

这些覆盖只在当前命令生效，优先级高于所有配置文件。
