# 安装指南

## 环境要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | 22 | 必须 |
| pnpm | 任意 | 推荐；npm 可作为 fallback |
| npm | 任意 | 随 Node.js 附带 |

验证当前环境：

```bash
node --version   # 应输出 v22.x.x 或更高
pnpm --version   # 优先检查 pnpm
npm --version    # fallback 检查
```

## macOS / Linux：curl \| bash（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/haro-ai/haro/main/scripts/install.sh | bash
```

安装脚本会执行以下动作：

1. 检查 Node.js 版本（>= 22）
2. 检测包管理器（优先 pnpm，fallback npm）
3. 全局安装 `@haro/cli@latest`
4. 验证 `haro` 命令是否在 PATH 中
5. 创建 `~/.haro/` 数据目录

安装完成后，先运行 `haro setup --check --json` 查看 staged 诊断；配置 `OPENAI_API_KEY` 后运行 `haro setup --profile global`。如果目录或 SQLite 缺失，可运行 `haro doctor --fix` 做安全修复。


## 从空环境到可用

```bash
# 1. 预检：只读检查，不写 provider secret
haro setup --check --json

# 2. 配置 Codex 认证（任选其一）
#    A. 开发者 / 组织账号：导出 OPENAI_API_KEY（Haro 不会把 key 写入 YAML）
export OPENAI_API_KEY=<your-key>
haro provider setup codex --scope global --non-interactive
#    B. ChatGPT 订阅用户：交互向导走官方 codex login（device-auth OAuth）
haro provider setup codex     # 选 "Sign in with ChatGPT"
# devbox / SSH / headless 默认就走 device-auth；本机带浏览器者可设
# HARO_CODEX_LOGIN_MODE=browser 回退到 localhost callback。

# 3. 选择默认模型并验证 provider 健康
haro provider models codex
haro provider select codex <live-model-id>

# 4. 全局 CLI profile：检查 haro 是否在 PATH，并写入/确认非敏感默认配置
haro setup --profile global

# 5. 修复允许的本地问题：目录、默认配置、SQLite、user-level systemd unit
haro doctor --fix

# 6. 跑第一条任务
haro run "列出当前目录下的 TypeScript 文件"
```

Profile 差异：

| profile | 适用场景 | 额外检查 |
|---------|----------|----------|
| `dev` | 源码仓库内使用 `pnpm haro` | 不要求全局 `haro` 在 PATH |
| `global` | npm/pnpm 全局安装后日常使用 | 要求 `haro` 全局命令可执行 |
| `systemd` | user-level Web Dashboard 服务 | 检查/可修复 `~/.config/systemd/user/haro-web.service`、监听端口、env file、`HARO_WEB_API_KEY` 模式 |

安全边界：`--repair` / `--fix` 不会安装 Node/pnpm、不修改 shell profile、不写 provider secret、不创建系统级 systemd unit、不开放防火墙。

## Windows：PowerShell

```powershell
iwr -useb https://raw.githubusercontent.com/haro-ai/haro/main/scripts/install.ps1 | iex
```

PowerShell 脚本逻辑与 bash 脚本一致，安装完成后同样会提示下一步。

## npm / pnpm 全局安装

如果你已经配置了 Node.js 和包管理器，也可以跳过安装脚本，直接全局安装：

```bash
# 使用 npm
npm install -g @haro/cli@latest

# 或使用 pnpm（推荐）
pnpm add -g @haro/cli@latest
```

安装后如果 `haro` 命令未找到，可能需要：

- 重启终端
- 或将全局 bin 目录添加到 PATH：
  ```bash
  # npm 全局 bin 路径
  npm bin -g
  
  # pnpm 全局 bin 路径
  pnpm bin -g
  ```

## 从源码运行（开发备选）

如果你希望参与开发或使用最新源码：

```bash
# 1. Clone 仓库
git clone https://github.com/haro-ai/haro.git
cd haro

# 2. 安装依赖
pnpm install

# 3. 构建
pnpm build

# 4. 使用仓库内 CLI
pnpm haro setup
pnpm haro doctor
pnpm haro run "列出当前目录下的 TypeScript 文件"
```

> 注：`pnpm setup` 与 pnpm 内置命令冲突，等价路径为 `pnpm run setup` 或 `pnpm haro setup`。

开发态入口无需记忆深路径 bin 文件，`pnpm haro` 等同于 `node packages/cli/bin/haro.js`。

## 卸载方式

### 全局包卸载

```bash
# 如果使用 npm 全局安装
npm uninstall -g @haro/cli

# 如果使用 pnpm 全局安装
pnpm remove -g @haro/cli
```

### 数据目录清理

Haro 的数据目录默认位于 `~/.haro/`（可通过 `HARO_HOME` 环境变量覆盖）。卸载全局包后，如需彻底清理数据：

```bash
# macOS / Linux
rm -rf ~/.haro

# Windows PowerShell
Remove-Item -Recurse -Force "$env:USERPROFILE\.haro"
```

数据目录包含以下内容，清理前请确认是否需要备份：

- `config.yaml` — 全局配置
- `agents/` — Agent 定义与状态
- `skills/` — 已安装 skill
- `channels/` — Channel 状态与 session 映射
- `memory/` — Memory Fabric 数据
- `haro.db` — SQLite 数据库（sessions、events、checkpoints）
- `logs/` — 运行日志
- `archive/` — eat/shit 归档

### 源码仓库清理

如果是从源码运行，卸载时只需删除仓库目录即可：

```bash
cd ..
rm -rf haro
```

## 升级

Haro 内置 `haro update` 命令检查最新版本：

```bash
haro update        # 检查并提示升级命令
haro update --check # 仅预览，不输出安装提示
```

如果当前版本低于 registry 最新版本，会输出升级命令：

```bash
npm install -g @haro/cli@latest
```

## 安装故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| `Node.js 未安装` | 系统缺少 Node.js | 安装 Node.js 22+ |
| `Node.js 版本过低` | 当前 Node.js < 22 | 升级 Node.js |
| `未找到 npm 或 pnpm` | 包管理器未在 PATH | 确认 npm 随 Node.js 正确安装 |
| `全局安装失败` | 网络或 registry 问题 | 检查网络、切换 registry 镜像 |
| `haro 命令未在 PATH` | 全局 bin 未加入 PATH | 手动添加或重启终端 |

更多运行时故障排查见 [troubleshooting.md](troubleshooting.md)。
