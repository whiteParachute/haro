# Haro

> Haro 是一个自进化多 Agent 中间件平台。
>
> 它的目标不是只让 Agent 完成一次任务，而是让 **Agent、编排方式和平台本身** 在持续使用中一起变好。

## 项目状态

**截至 2026-04-20，Phase 0 已完成验收闭环。**

Haro 当前已经交付并验证的基础能力包括：CLI 运行入口、Codex Provider 接入、单 Agent 执行循环、独立 Memory Fabric、Channel 抽象层（Feishu / Telegram）、Skills 子系统、手动 eat/shit 代谢流程。

对应的 Phase 0 审计记录见：[`docs/reviews/phase-0-audit-2026-04-19.md`](docs/reviews/phase-0-audit-2026-04-19.md)

## 一句话定位

Haro 面向的是这样一类问题：

- Agent 不只需要一次性回答问题，还需要长期运行
- 输入不只来自 CLI，还来自飞书、Telegram 等消息渠道
- 能力不只靠 prompt 堆积，还需要可安装、可淘汰、可回滚的 skill / memory / tool 体系
- 多 Agent 编排和平台演进需要有明确边界，而不是无限长 prompt + 临时脚本

设计原则、架构总览与竞争格局见 [docs/architecture/overview.md](docs/architecture/overview.md)。

## 快速开始

### Web Dashboard 首次访问

```bash
pnpm build
pnpm -F @haro/cli exec haro web --port 3456 --host 127.0.0.1
```

浏览器打开 `http://127.0.0.1:3456/` 后，首次无用户实例会自动进入
`/bootstrap`：创建第一个 `owner` → 自动登录 → 进入 `/chat`。后续访问会先到
`/login`，登录后进入 Dashboard；旧部署仍可在迁移窗口内继续使用
`HARO_WEB_API_KEY` / `x-api-key` 兼容 API 访问。

### 安装

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/haro-ai/haro/main/scripts/install.sh | bash
```

**Windows (PowerShell)**

```powershell
iwr -useb https://raw.githubusercontent.com/haro-ai/haro/main/scripts/install.ps1 | iex
```

**或者使用 npm / pnpm 全局安装**

```bash
npm install -g @haro/cli@latest
# 或
pnpm add -g @haro/cli@latest
```

更多安装方式（环境准备、从源码运行、卸载）见 [docs/install.md](docs/install.md)。

### 最短可跑通路径

```bash
# 1. 配置 Provider 凭证（不会写入 YAML）
export OPENAI_API_KEY=<your-key>

# 2. 配置 Codex provider、发现 live models、选择默认模型
haro provider setup codex --scope global --non-interactive
haro provider models codex
haro provider select codex <live-model-id>

# 3. 跑首次引导（会按 stage 检查并写入/确认非敏感默认配置）
haro setup --profile global

# 4. 先做结构化诊断；如目录/SQLite 缺失，可执行安全修复
haro doctor --json
haro doctor --fix

# 5. 执行第一条任务
haro run "列出当前目录下的 TypeScript 文件"

# 6. 进入交互式 REPL
haro
```

完整的从安装到跑通第一条任务的新手路径、常用命令速查与故障排查见 [docs/getting-started.md](docs/getting-started.md)。

### 从源码运行（开发备选）

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
pnpm haro setup --profile dev
pnpm haro doctor --json
pnpm haro run "列出当前目录下的 TypeScript 文件"
```

> 注：`pnpm setup` 与 pnpm 内置命令冲突，等价路径为 `pnpm run setup` 或 `pnpm haro setup`。

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

- [Getting Started](docs/getting-started.md) — 从安装到跑通第一条任务的完整新手路径
- [Install](docs/install.md) — 全平台安装指南
- [Configuration](docs/configuration.md) — 配置层级、环境变量、敏感数据原则
- [Channels](docs/channels.md) — 飞书 / Telegram 启用、配置与 Gateway 控制
- [Troubleshooting](docs/troubleshooting.md) — 常见故障排查
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
- Scenario Router、Team Orchestrator、Dashboard 基础和 Codex runtime `shit` skill 已进入 Phase 1 交付闭环
- Memory Fabric v1 已完成：核心 API、SQLite FTS5 read model、三层记忆、scope/verification/assetRef 和 aria-memory rebuild 已在 core 包内落地；Evolution Asset Registry、权限/Token 预算和 Dashboard 编排调试仍属于 Phase 1 后续工作
- Evolution Engine、自动 eat/shit、Provider 动态重评估仍属于 Phase 2+
- 当前仓库版本是 `0.1.0`
- 当前更适合 **源码运行和继续开发**，还不是对外发布的稳定产品版本

## 路线图

| 阶段 | 状态 | 目标 |
| --- | --- | --- |
| Phase 0 | 已完成基础闭环 | CLI + Codex Provider + 单 Agent Runtime + Memory + Channel + Skills + 手动 eat/shit |
| Phase 1 | 进行中 | Scenario Router + Team Orchestrator + Dashboard 控制面 + Memory Fabric v1 + Evolution Asset Registry + 权限/Token 预算 |
| Phase 2 | 规划中 | Evolution Engine + 自动 eat/shit + 编排调试增强 + 会话生命周期 + checkpoint 人机介入 |
| Phase 3 | 规划中 | Agent-as-Developer + 平台自主维护 + L2/L3 架构演进 |
| Phase 4 | 规划中 | 开放生态、团队资产共享与跨实例协作 |

## 开发验证

常用验证命令：

```bash
pnpm lint
pnpm test
pnpm build
pnpm smoke
```

## License

待定
