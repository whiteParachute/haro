# Haro 安装 / 上手体验改进计划 — 2026-04-20

## 背景

当前 `README.md` 已经同步到 Phase 0 已验收完成的事实，但**“仓库说明清楚”不等于“用户可以直接上手”**。

Haro 现在还不够直接可用，核心问题不是文案，而是产品入口没有闭环。

## 外部参考结论

### Hermes Agent

参考：
- GitHub README: https://github.com/NousResearch/hermes-agent

Hermes 当前采用的是 **“一条安装命令 + 一个统一入口命令 + setup/doctor/update 配套”** 的方式：

- 一条安装命令：`curl ... install.sh | bash`
- 安装后直接执行：`hermes`
- 首次使用入口清晰：`hermes setup`
- 常用命令集中：`model / tools / gateway / doctor / update`
- README 把 Quick Install、Getting Started、CLI vs Messaging、Migration、Contributing 分层拆开

### OpenClaw

参考：
- GitHub README: https://github.com/openclaw/openclaw/blob/main/README.md
- Installer README: https://github.com/openclaw/openclaw.ai/blob/main/README.md

OpenClaw 当前采用的是 **“全局安装 + onboard 向导 + daemon/gateway 常驻 + 源码开发路径平行存在”** 的方式：

- 全局安装：`npm install -g openclaw@latest`
- 首次推荐命令：`openclaw onboard --install-daemon`
- CLI / Gateway / Message Send / Agent 对话都有明确入口
- 有单独的安装脚本（macOS/Linux/Windows）
- README 明确区分：Install、Quick start、From source、Configuration、Security

## Haro 当前缺口

对比 Hermes / OpenClaw，Haro 目前缺的不是“再多写一点 README”，而是以下 5 个入口层能力：

### 1. 安装入口缺口

当前用户需要：

- clone 仓库
- `pnpm install`
- `pnpm build`
- 手动运行 `node packages/cli/bin/haro.js ...`
- 自己知道还要配置 `OPENAI_API_KEY`

这条路径对开发者可接受，对第一次接触 Haro 的用户不够直接。

### 2. 首次上手入口缺口

当前没有顶层的：

- `haro setup`
- `haro onboard`
- `haro init`

用户不知道第一次到底应该先做：配置 provider、跑 doctor、进入 REPL、还是开 channel。

### 3. “可运行” 与 “可使用” 之间缺口

现在 `haro doctor` 能告诉你 provider unhealthy，但：

- 没有明确 fix suggestion
- 没有自动引导下一步
- 没有把失败原因翻译成第一次用户能执行的动作

### 4. 常驻消息入口缺口

Hermes / OpenClaw 都把 messaging/gateway 当成第一层入口。

Haro 当前虽然已经有 Feishu / Telegram adapter，但仍缺少一个明确的：

- `haro gateway start`
- `haro gateway doctor`
- `haro gateway status`
- daemon/后台运行方案

否则消息渠道更像“代码能力已存在”，但不是“产品入口已成立”。

### 5. 发布形态缺口

当前 Haro 更接近“源码仓库 + 开发态 CLI”，还不是：

- npm 全局包
- 一键安装脚本
- `npx` / `pnpm dlx` 可试用入口
- 稳定升级路径

## 建议目标

把 Haro 的上手体验收敛成一句话：

> 安装 Haro → 跑一次 setup/onboard → 执行第一条任务 → 如有需要再开飞书/Telegram。

## 分阶段计划

### M0：README 补齐可执行入口（文档即刻改进）

目标：让开发者在不读源码的情况下，能按 README 跑通第一次任务。

交付：

- README 写清 `OPENAI_API_KEY` 是必需前置条件
- README 提供“最短可跑通路径”
- README 明确“源码运行”和“未来发布安装”是两条路径
- README 补充 `doctor` 失败时的排查说明

完成标准：

- 新用户只看 README，可以知道第一步到第四步分别做什么

### M1：补顶层 onboarding 命令

目标：消灭“第一次应该先做什么”的歧义。

建议命令：

- `haro setup`
- 或 `haro onboard`

建议能力：

1. 检查 Node / pnpm / data dir
2. 检查 `OPENAI_API_KEY`
3. 引导选择默认 provider/model
4. 写入非敏感配置到 `~/.haro/config.yaml`
5. 结束时给出下一步：
   - `haro doctor`
   - `haro run "..."`
   - `haro channel setup feishu`

完成标准：

- 用户只需要记住一个首次命令

### M2：补“直接可运行”的开发入口

目标：让源码仓库也有接近产品安装版的使用体验。

建议改动：

- 增加 `pnpm haro -- ...` 或 `pnpm dev:cli -- ...`
- 增加 `pnpm setup`
- 增加 `pnpm smoke` 的 README 对应说明
- 把 `node packages/cli/bin/haro.js` 收敛成开发态内部路径，不作为主要用户入口

完成标准：

- 开发者不需要记住深路径 bin 文件

### M3：补 gateway / daemon 运行面

目标：让 Feishu / Telegram 真正成为第一类使用方式。

建议命令：

- `haro gateway start`
- `haro gateway stop`
- `haro gateway status`
- `haro gateway doctor`

建议能力：

- 统一启动所有 enabled channels
- 前台 / 后台运行两种模式
- 明确日志路径
- 明确 session / credential / channel data 路径

完成标准：

- 用户可以把 Haro 当成一个持续运行的助手，而不是只在终端里短暂执行一次命令

### M4：补发布与安装形态

目标：把 Haro 从“开发仓库”推进到“可安装产品”。

建议交付：

- npm 全局包发布
- `curl | bash` 安装脚本（macOS/Linux）
- Windows 安装脚本
- `haro update`
- 版本化 changelog / upgrade 指引

完成标准：

- README 首屏能写成“Install (recommended)”而不是“从源码运行”

### M5：补用户文档体系

目标：README 只放首屏入口，细节下沉到 docs。

建议新增文档：

- `docs/getting-started.md`
- `docs/install.md`
- `docs/configuration.md`
- `docs/channels.md`
- `docs/troubleshooting.md`

完成标准：

- README 负责“带你开始”
- docs 负责“把问题讲透”

## 优先级判断

如果只做最小闭环，优先级建议是：

1. **M0 README 可执行化**
2. **M1 setup/onboard**
3. **M2 开发入口收敛**
4. **M3 gateway/daemon**
5. **M4 发布安装形态**
6. **M5 文档拆分**

## 结论

当前 Haro 最大的问题不是“没有功能”，而是：

**Phase 0 的能力已经存在，但安装入口、首次上手入口、常驻运行入口还没有收敛成一个用户可以直接记住的主路径。**

所以后续工作不建议继续只补 README，而应该按 `README → setup/onboard → gateway → install` 这条链路推进。