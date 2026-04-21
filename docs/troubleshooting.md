# 故障排查

## haro doctor 失败排查

`haro doctor` 检查 Phase 0 核心组件的健康状态。如果输出中 `ok: false`，按以下顺序排查：

### 1. 配置文件合法性

如果 doctor 无法启动并抛出 `HaroConfigValidationError`：

```
Invalid Haro config (/home/user/.haro/config.yaml):
  providers.codex.apiKey: Codex Provider 不接受 YAML 配置中的 apiKey ...
```

**解决**：

1. 根据报错中的文件路径，定位到具体配置文件（全局 `~/.haro/config.yaml` 或项目级 `.haro/config.yaml`）
2. 删除或修正报错字段
3. 重新运行 `haro doctor`

常见非法字段：

- `providers.codex.apiKey` — 凭证必须通过 `OPENAI_API_KEY` 环境变量注入，禁止写入 YAML
- 未知的顶层字段 — 检查拼写，参考 [configuration.md](configuration.md) 中的配置示例

### 2. Provider 健康检查

如果 `providers.codex.healthy` 为 `false`：

**症状 A**：`Codex Provider: OPENAI_API_KEY is not set`

- 检查 `OPENAI_API_KEY` 是否已导出：`echo $OPENAI_API_KEY`
- 确认导出命令与运行 `haro` 的 shell 是同一个会话
- 如需持久化，将 `export OPENAI_API_KEY=sk-xxx` 写入 `~/.bashrc` 或 `~/.zshrc` 后重新加载

**症状 B**：网络超时或 API 返回错误

- 检查当前网络是否可访问 OpenAI API
- 如果使用了代理，确认代理环境变量（`HTTPS_PROXY` 等）已正确设置
- 部分企业网络可能需要配置 `providers.codex.baseUrl` 指向内部网关

### 3. 数据目录可读写

如果报告 `数据目录不可写`：

```bash
# 检查目录权限
ls -ld ~/.haro

# 修复权限
chmod u+rwx ~/.haro

# 或使用自定义目录
export HARO_HOME=/path/to/writable/dir
haro doctor
```

### 4. SQLite 连接

如果 SQLite 初始化失败：

- 检查 `~/.haro/haro.db` 是否被其他进程占用
- 检查磁盘空间是否充足
- 尝试删除 `haro.db` 让它重新初始化（会丢失本地 session 历史）

### 5. Channel 健康状态

`haro doctor` 本身不输出 `channels` 健康块。要排查 Channel 问题，应直接使用 Channel 级诊断命令：

```bash
haro channel doctor feishu
haro channel doctor telegram
```

常见错误码：

- `missing_credentials` → 环境变量未设置，或 `config.yaml` 中的 `${...}` 引用语法错误
- 网络超时 → 检查当前网络是否可到达飞书/Telegram 服务端

## OPENAI_API_KEY 常见问题

### 症状：setup 报告 "未检测到 OPENAI_API_KEY"

```bash
haro setup
# ...
# FAIL OPENAI_API_KEY 已设置 — 缺失
```

**排查步骤**：

1. 确认已导出：`echo $OPENAI_API_KEY`
2. 确认值非空且非纯空格
3. 如果使用 `sudo` 或 `su` 切换用户，环境变量会丢失；改用同一用户会话执行
4. 在 Windows PowerShell 中使用 `$env:OPENAI_API_KEY = 'sk-xxx'` 而非 `export`

### 症状：run 时报 auth 错误

```bash
haro run "..."
# Error: Codex Provider: OPENAI_API_KEY is not set
```

即使 `echo $OPENAI_API_KEY` 有值，也可能因为：

- Haro 是在另一个 shell 会话（如 VS Code 内置终端 vs 系统终端）中启动的
- 环境变量只写入了 `.bashrc` 但未 `source ~/.bashrc`
- IDE 的启动配置未继承当前 shell 的环境变量

**建议**：在运行 Haro 的同一个终端中先执行 `export OPENAI_API_KEY=sk-xxx`，确认无误后再运行命令。

### 症状：key 已设置但 doctor 仍报 unhealthy

可能是网络或 API 侧问题：

- Key 是否过期或被撤销
- 账户余额是否充足
- 是否使用了不支持 Codex 的 key（Codex 需要特定权限的 OpenAI key）

## Node.js / pnpm 版本不足

### 症状：setup 报告 Node.js 版本不满足

```
FAIL Node.js >= 22 — 当前 v20.x.x
```

**升级方法**：

```bash
# macOS (Homebrew)
brew install node@22

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 使用 nvm
nvm install 22
nvm use 22

# 使用 fnm
fnm install 22
fnm use 22
```

### 症状：未检测到 pnpm

```
FAIL 包管理器可用 — 未检测到
```

pnpm 不是硬性要求，npm 可以作为 fallback。但推荐安装 pnpm：

```bash
npm install -g pnpm
```

## gateway 进程残留

### 症状：gateway start 报 already running

```bash
haro gateway start
# Gateway already running (PID 12345)
```

但你想启动一个新的 gateway 实例。

**排查**：

```bash
haro gateway status
# 或手动检查
ps aux | grep haro
```

**解决**：

```bash
# 正常停止
haro gateway stop

# 如果 stop 无效（PID 文件与实际进程不一致）
# 1. 找到实际进程并 kill
kill -15 <pid>   # SIGTERM
kill -9 <pid>    # SIGKILL（强制）

# 2. 删除残留的 PID 文件
rm ~/.haro/gateway.pid
```

### 症状：gateway stop 报 stale PID

```bash
haro gateway stop
# Stale PID 12345 removed. Gateway was not running.
```

这通常是因为 gateway 进程异常退出（如系统重启、kill -9），但 PID 文件未清理。`haro gateway stop` 会自动清理 stale PID，无需额外操作。

### 症状：端口或连接冲突

如果飞书或 Telegram Channel 报告连接冲突，可能是：

- 另一个 Haro 实例在运行
- 之前的 gateway 进程没有正确退出

**解决**：

```bash
# 彻底清理所有相关进程
haro gateway stop
ps aux | grep "haro.js\|node.*haro" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null
rm -f ~/.haro/gateway.pid
```

## 配置文件校验错误路径定位

当 Haro 启动时报 `HaroConfigValidationError`，错误消息会包含配置文件路径：

```
Invalid Haro config (/home/user/.haro/config.yaml):
  ...
```

或：

```
Invalid Haro config (/home/user/project/.haro/config.yaml):
  ...
```

**定位规则**：

1. 先看错误消息中的绝对路径，直接定位到该文件
2. 如果不确定是全局还是项目级配置在生效，运行 `haro config` 查看 `sources` 字段
3. `sources` 按优先级列出所有配置来源，例如：
   ```json
   {
     "sources": ["defaults", "/home/user/.haro/config.yaml", "/home/user/project/.haro/config.yaml"]
   }
   ```

**常见错误字段**：

| 错误路径 | 含义 | 修正方式 |
|---------|------|---------|
| `providers.codex.apiKey` | 凭证禁止写入 YAML | 删除该字段，改用 `export OPENAI_API_KEY` |
| `channels.feishu.appSecret` | 值格式问题 | 确保使用 `"${FEISHU_APP_SECRET}"` 或直接写值（不推荐） |
| `<root>` | 顶层结构错误 | 检查缩进、冒号后空格、是否混用了 Tab |

## 其他常见问题

### haro 命令未找到

```bash
which haro
# 无输出
```

- 确认已完成全局安装或源码构建
- 检查全局 bin 目录是否在 PATH 中
- 重启终端或执行 `hash -r`（bash）/ `rehash`（zsh）

### REPL 无法输入中文

- 检查终端编码是否为 UTF-8
- 尝试切换终端模拟器（如 iTerm2、Windows Terminal）

### skill 命令无响应

```bash
haro skills list
# 空白输出或报错
```

- 确认 `~/.haro/skills/` 目录存在且可读写
- 检查 `haro doctor` 中的数据目录状态
- 预装 skill 在首次运行时会自动初始化，如遇问题可尝试重新初始化数据目录

## 获取帮助

如果以上排查未能解决问题：

1. 运行 `haro doctor` 和 `haro gateway doctor`，保存完整输出
2. 查看日志：`cat ~/.haro/logs/haro.log`
3. 查看 gateway 日志（如果使用了后台模式）：`cat ~/.haro/logs/gateway.log`
4. 带上日志和报错信息提交 issue
