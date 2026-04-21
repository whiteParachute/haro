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
| `OPENAI_API_KEY` | Codex Provider 认证凭证（**必需**） | `sk-...` |
| `HARO_HOME` | 覆盖全局数据目录路径 | `/data/haro` |
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

当前正式实现的 Provider 只有 **Codex**。其凭证注入遵循以下规则：

1. **只读环境变量**：`OPENAI_API_KEY` 是 Codex Provider 唯一接受的凭证来源
2. **配置文件中禁止写入 apiKey**：`config.yaml` 中若出现 `providers.codex.apiKey`，配置校验会显式报错并拒绝加载
3. **Provider 构造时读取**：`@haro/provider-codex` 在实例化时从 `process.env.OPENAI_API_KEY` 读取凭证

示例：

```bash
# 正确：通过环境变量注入
export OPENAI_API_KEY=sk-xxx
haro run "分析当前代码"

# 错误：试图在 config.yaml 中写入 apiKey
# providers:
#   codex:
#     apiKey: sk-xxx   # ← 会导致 HaroConfigValidationError
```

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

如果运行 `haro setup` 或 `haro channel setup <id>`，交互过程中输入的凭证也不会被保存到 `config.yaml`；只有 `${...}` 引用或空值会被持久化。

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
