# Haro

> Haro 是一个自进化多 Agent 中间件平台。
>
> 它的目标不是只让 Agent 完成一次任务，而是让 **Agent、编排方式和平台本身** 在持续使用中一起变好。

## 项目状态

**截至 2026-04-20，Phase 0 已完成验收闭环。**

当前仓库已经交付并验证的基础能力包括：

- CLI 运行入口：`haro` / `haro run` / `haro doctor` / `haro status`
- Codex Provider 接入与模型选择
- 单 Agent 执行循环与 session 持久化
- 独立 Memory Fabric
- Channel 抽象层 + Feishu / Telegram adapter
- Skills 子系统 + 15 个预装 skill
- 手动 `eat` / `shit` 代谢流程

当前阶段的判断很明确：**Haro 已经不是概念设计仓库，而是一个完成了 Phase 0 最小闭环的工程仓库。**

## 一句话定位

Haro 面向的是这样一类问题：

- Agent 不只需要一次性回答问题，还需要长期运行
- 输入不只来自 CLI，还来自飞书、Telegram 等消息渠道
- 能力不只靠 prompt 堆积，还需要可安装、可淘汰、可回滚的 skill / memory / tool 体系
- 多 Agent 编排和平台演进需要有明确边界，而不是无限长 prompt + 临时脚本

## 设计原则

### 1. 非核心组件皆可插拔

Provider、Channel、Skill、MCP、Memory Backend 等外围能力必须满足：

- 独立注册
- 独立装载 / 卸载
- 对核心模块零硬编码
- 通过标准接口暴露能力

Phase 0 的正式实现里，**当前唯一落地的 Provider 是 Codex**；但 Provider Abstraction Layer 继续保留多 Provider 扩展位。

### 2. 代谢优于堆积

Haro 不追求能力数量持续增长，而追求能力结构持续优化：

- `eat`：把外部知识吸收为可复用能力
- `shit`：把低价值、重复、失效能力从系统中清出去
- rollback：允许对淘汰动作做回滚

这套机制是平台自进化的基础，不是额外插件。

### 3. 人类负责方向，Agent 负责执行与提案

在 Haro 的设计里：

- 人类负责目标、边界、审阅和最终裁决
- Agent 可以发现问题、提出改进、执行实现、补充验证
- 重要变更仍然由人类做最终确认

## 当前已交付能力

| 模块 | 当前状态 | 说明 |
| --- | --- | --- |
| `@haro/core` | 已交付 | 配置、日志、文件系统、SQLite、Agent 定义、单 Agent runtime、Memory Fabric |
| `@haro/provider-codex` | 已交付 | 基于 `@openai/codex-sdk` 的 Codex Provider |
| `@haro/channel` | 已交付 | 共享 Channel 协议、注册表、session store |
| `@haro/channel-feishu` | 已交付 | 飞书 adapter，基于已验证 client 路径封装 |
| `@haro/channel-telegram` | 已交付 | Telegram adapter，支持私聊流式 / 群聊降级 |
| `@haro/skills` | 已交付 | skill 安装、卸载、启停、匹配、用量统计、预装 skill 管理 |
| `@haro/cli` | 已交付 | REPL、单次运行、状态诊断、channel 管理、skills 管理、eat/shit 命令 |

对应的 Phase 0 审计记录见：[`docs/reviews/phase-0-audit-2026-04-19.md`](docs/reviews/phase-0-audit-2026-04-19.md)

## 快速开始

> 当前推荐路径仍然是**从源码运行**；但首次使用已经收敛到一个统一入口：`haro setup` / `haro onboard`。

### 环境要求

- Node.js `>= 22`
- pnpm `10.x`
- `OPENAI_API_KEY`（当前正式实现的 Provider 是 Codex，凭证必须通过环境变量提供）

### 最短可跑通路径

```bash
# 1. 安装依赖
pnpm install

# 2. 构建
pnpm build

# 3. 配置 Provider 凭证
export OPENAI_API_KEY=<your-key>

# 4. 跑首次引导
node packages/cli/bin/haro.js setup
# 或
node packages/cli/bin/haro.js onboard

# 5. 先做诊断
node packages/cli/bin/haro.js doctor

# 6. 执行第一条任务
node packages/cli/bin/haro.js run "列出当前目录下的 TypeScript 文件"

# 7. 进入交互式 REPL
node packages/cli/bin/haro.js
```

`setup/onboard` 会检查 Node / pnpm / `~/.haro/` / `OPENAI_API_KEY`，并把默认的非敏感配置写入 `~/.haro/config.yaml`。
如果第 5 步里 `providers.codex.healthy` 仍然是 `false`，优先检查：

- `OPENAI_API_KEY` 是否已导出到当前 shell
- 当前 shell 是否和执行 `node packages/cli/bin/haro.js` 的 shell 是同一个会话
- 网络是否可访问 Codex 所需接口

### 常用命令

```bash
# 查看 CLI 帮助
node packages/cli/bin/haro.js --help

# 首次引导
node packages/cli/bin/haro.js setup
node packages/cli/bin/haro.js onboard

# 查看当前状态
node packages/cli/bin/haro.js status

# 查看当前配置来源
node packages/cli/bin/haro.js config

# 查看已安装 skills
node packages/cli/bin/haro.js skills list

# 查看 channel 状态
node packages/cli/bin/haro.js channel list

# 配置飞书 channel
node packages/cli/bin/haro.js channel setup feishu
node packages/cli/bin/haro.js channel doctor feishu

# 配置 Telegram channel
node packages/cli/bin/haro.js channel setup telegram
node packages/cli/bin/haro.js channel doctor telegram

# 手动知识吸收
node packages/cli/bin/haro.js eat <url|path|text>

# 手动代谢清理（预览）
node packages/cli/bin/haro.js shit --scope skills --dry-run
```

### 当前配置位置

- 全局配置：`~/.haro/config.yaml`
- 项目级覆盖：`<project>/.haro/config.yaml`
- 数据目录：`~/.haro/`

当前 `config.yaml` 里**不写** Codex 的 API Key；凭证只通过环境变量注入。

## CLI 能力范围

当前 CLI 已经覆盖的能力包括：

- `haro`：启动 REPL
- `haro setup` / `haro onboard`：首次引导、环境检查与默认配置落盘
- `haro run <task>`：执行单次任务
- `haro model [provider] [model]`：查看或切换 provider / model
- `haro config`：配置管理
- `haro doctor`：配置与依赖诊断
- `haro status`：查看运行状态
- `haro channel ...`：管理消息渠道
- `haro skills ...`：管理 skill
- `haro eat <input>`：手动吸收知识
- `haro shit ...`：扫描、归档、回滚冗余能力

REPL 内还支持本地命令能力，例如 `/new`、`/retry`、`/model` 等。

## 仓库结构

```text
packages/
├── core/               # 核心运行时、配置、存储、记忆
├── provider-codex/     # Codex Provider
├── providers/          # 其他 Provider 预留位
├── channel/            # 共享 Channel 协议层
├── channel-feishu/     # 飞书 adapter
├── channel-telegram/   # Telegram adapter
├── skills/             # skills 子系统与代谢逻辑
└── cli/                # CLI 入口与本地 channel

docs/                   # 架构、模块、演进、评审文档
specs/                  # 单一真源：feature / defect / protocol / constraints
roadmap/                # 阶段路线图
scripts/                # 辅助脚本
```

## 文档导航

### 先看这几份

- [架构总览](docs/architecture/overview.md)
- [四阶段路线图](roadmap/phases.md)
- [spec 体系与开发流程](specs/README.md)
- [Phase 0 审计](docs/reviews/phase-0-audit-2026-04-19.md)
- [安装 / 上手体验改进计划](docs/reviews/install-ux-plan-2026-04-20.md)

### 按主题阅读

**架构与约束**
- [架构总览](docs/architecture/overview.md)
- [设计原则](specs/design-principles.md)
- [多 Agent 设计约束](specs/multi-agent-design-constraints.md)
- [Provider 协议](specs/provider-protocol.md)
- [Channel 协议](specs/channel-protocol.md)
- [Evolution 代谢机制](specs/evolution-metabolism.md)

**模块说明**
- [CLI 设计](docs/cli-design.md)
- [数据目录](docs/data-directory.md)
- [模块文档](docs/modules)

**研究与评审**
- [竞品调研](docs/research/landscape.md)
- [自有项目资产](docs/research/prior-art.md)
- [Phase 0 审计](docs/reviews/phase-0-audit-2026-04-19.md)

## 开发流程

Haro 当前采用 **spec 驱动开发**。

约束如下：

1. `specs/` 是单一真源
2. 新 feature / defect 先补 spec，再实现
3. Requirement、Acceptance Criteria、测试、文档要同步闭环
4. docs 与 spec 漂移视为未完成

详细规则见：[`specs/README.md`](specs/README.md)

## 当前边界

为了避免 README 说得比代码多，当前边界明确写清楚：

- 当前正式实现的 Provider 只有 Codex
- 多 Provider 智能选择、Scenario Router、Team Orchestrator、Evolution Engine 仍属于后续 phase
- 当前仓库版本是 `0.0.0`
- 当前更适合 **源码运行和继续开发**，还不是对外发布的稳定产品版本

## 路线图

| 阶段 | 状态 | 目标 |
| --- | --- | --- |
| Phase 0 | 已完成基础闭环 | CLI + Codex Provider + 单 Agent Runtime + Memory + Channel + Skills + 手动 eat/shit |
| Phase 1 | 规划中 | Scenario Router + Team Orchestrator + Memory Fabric v1 |
| Phase 2 | 规划中 | Evolution Engine + 自动 eat/shit + Provider 动态重评估 |
| Phase 3 | 规划中 | Agent-as-Developer + 平台自主维护 |
| Phase 4 | 规划中 | 开放生态与跨实例协作 |

## 开发验证

常用验证命令：

```bash
pnpm lint
pnpm test
pnpm build
```

## License

待定
