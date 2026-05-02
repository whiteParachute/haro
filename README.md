# Haro

> Haro 是一个**自进化多 Agent 中间件平台**——不只让 Agent 完成一次任务，而是让 **Agent、编排方式和平台本身** 在持续使用中自动变得更好。

## 双层架构

Haro 把"日用 workbench"和"自我进化"放在两层，进化层寄生在 workbench 之上：

```
┌─────────────────────────────────────────────────┐
│  进化层（Haro 真正的差异化）                     │
│  - 使用记忆驱动（Self-Monitor）                  │
│  - 业界趋势驱动（Industry Intel）                │
│  - 用户决策驱动（Evolution Proposal/Approval）   │
│  - Agent 自判断驱动（Pattern Miner + 自规划）    │
└─────────────────────────────────────────────────┘
                      ↑ 喂数据
┌─────────────────────────────────────────────────┐
│  Workbench 层（happyclaw 级别的日用底座）        │
│  - CLI / Web Channel / 飞书 / Telegram           │
│  - Agent Runtime / Memory Fabric / Skills        │
│  - MCP 工具层 / 定时任务 / 流式 UX               │
│  - 多 Agent 编排 + 权限/Token 预算守门           │
└─────────────────────────────────────────────────┘
```

底座没有日用数据流过，进化层就没东西可吃。所以"先 workbench 稳，再上进化"是必然顺序。

## 四条边界约束

任何模块设计、任何 spec 评审都要先过这四条：

1. **CLI 优先**：CLI 是"功能等价 Web UI 减去图形化体验"的完整入口，必须能在脱离 Web UI 的情况下完成全部使用与配置（hermes-agent 风格）
2. **Web UI 与后端解耦**：Web 前端通过稳定的 HTTP/JSON contract 与 Web API 通信，前后端独立 `package.json`，可独立发布（hermes-web-ui 风格）
3. **多 provider 抽象保留**：当前唯一正式实现是 Codex；抽象层完整，规划接入 xiaomi-token-plan / kimi-token-plan 等
4. **多 channel 抽象保留**：CLI / 飞书 / Telegram 已实现；Phase 1.5 新增 Web channel；后续可能继续接入

## 项目状态

**截至 2026-05-01：Phase 0 与 Phase 1 主线已 done，进入 Phase 1.5（自用底座补完）。**

- Phase 0 验收闭环已完成（见 [`docs/reviews/phase-0-audit-2026-04-19.md`](docs/reviews/phase-0-audit-2026-04-19.md)）
- Phase 1 18 个 spec 中 17 个已 done，FEAT-030（ChatGPT 订阅认证 Dashboard UI）draft
- 当前规划：[`docs/planning/redesign-2026-05-01.md`](docs/planning/redesign-2026-05-01.md) 是 2026-05-01 重设计的恢复点
- 当前仓库版本：`0.1.0`
- 当前形态：**源码运行 + 自用为主**，欢迎多人使用但不是对外发布的稳定产品版本

## 已实现 vs 进行中

### 已实现（可直接使用）

- **CLI 入口** — `haro` REPL + `haro run` 单次任务 + `haro provider/setup/doctor/skills/status` 等命令族
- **Codex Provider** — `@openai/codex-sdk` + ChatGPT 订阅认证（device flow，FEAT-029）
- **Channel 层** — CLI / 飞书 / Telegram adapter 三个 channel
- **Memory Fabric v1** — 三层记忆 + SQLite FTS5 + scope/verification/assetRef + aria-memory 兼容
- **Skills 子系统** — 15 预装 + 安装/卸载/查询 + 手动 eat/shit
- **多 Agent 核心** — Scenario Router + Team Orchestrator + 编排调试 timeline
- **Web Dashboard** — Chat / Session / Agent / Skill / Memory / Logs / Monitor / Settings / Channel / Workflow / Users 页
- **权限/Token 预算守门** — 操作分级 + 预算阻断 + 并行 Agent 汇总（FEAT-023）
- **Evolution Asset Registry** — eat/shit 产物、prompt、skill、编排规则统一资产化（FEAT-022）
- **多用户支持** — 本地多用户 + RBAC + Bootstrap + Audit Log（FEAT-028，自用为主，欢迎多人使用）
- **Web API 解耦**（FEAT-038）— `packages/web-api/` 独立服务，CLI `haro web` 是薄启动器；`pnpm -F @haro/web-api start` 也可独立启动

### 进行中（Phase 1.5）

- **Web Channel**（FEAT-031）— Web UI 作为 IM channel
- **MCP 工具层**（FEAT-032）— 内置 MCP server + 4 个核心工具
- **定时任务**（FEAT-033）— cron + 一次性
- **流式 UX 升级**（FEAT-034）— thinking 折叠、tool timeline、Hook 状态
- **CLI 等价补完**（FEAT-039）— 批次 1 + 2 已落地：chat / session / agent / memory / logs / workflow / budget / user / skill 单数 / config get-set-unset；批次 3（REPL slash + 全命令 `--json/--human` 统一 + E2E + 类型守门 CI）规划中

### 远期（Phase 2.0+）

- **进化感知层**（Phase 2.0）— Self-Monitor / Industry Intel / 自动 eat/shit 触发
- **进化提案层**（Phase 2.5）— Pattern Miner + Evolution Proposal + 用户审批闭环
- **受控自演化**（Phase 3.0）— Auto-Refactorer L0–L1 + 灰度 + 回滚
- **Agent-as-Developer**（Phase 3.5）— L2/L3 改动、自写 spec、自提 PR

完整阶段路线见 [`roadmap/phases.md`](roadmap/phases.md)。

## 快速开始

### Web Dashboard 首次访问

```bash
pnpm build
pnpm -F @haro/cli exec haro web --port 3456 --host 127.0.0.1
```

浏览器打开 `http://127.0.0.1:3456/`：首次无用户实例自动进入 `/bootstrap`，创建第一个 `owner` → 自动登录 → `/chat`。后续访问先到 `/login`。旧部署仍可在迁移窗口内继续使用 `HARO_WEB_API_KEY` / `x-api-key` 兼容 API 访问。

### 安装

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/haro-ai/haro/main/scripts/install.sh | bash
```

**Windows (PowerShell)**

```powershell
iwr -useb https://raw.githubusercontent.com/haro-ai/haro/main/scripts/install.ps1 | iex
```

**npm / pnpm 全局安装**

```bash
npm install -g @haro/cli@latest
# 或
pnpm add -g @haro/cli@latest
```

更多安装方式见 [`docs/install.md`](docs/install.md)。

### 最短可跑通路径（CLI 优先）

```bash
# 1. 配置 Provider 凭证（不会写入 YAML）
export OPENAI_API_KEY=<your-key>

# 2. 配置 Codex provider、发现 live models、选择默认模型
haro provider setup codex --scope global --non-interactive
haro provider models codex
haro provider select codex <live-model-id>

# 3. 跑首次引导
haro setup --profile global

# 4. 结构化诊断（必要时执行安全修复）
haro doctor --json
haro doctor --fix

# 5. 执行第一条任务
haro run "列出当前目录下的 TypeScript 文件"

# 6. 进入交互式 REPL
haro
```

完整新手路径与命令速查见 [`docs/getting-started.md`](docs/getting-started.md)。

### 从源码运行（开发备选）

```bash
git clone https://github.com/haro-ai/haro.git
cd haro
pnpm install
pnpm build
pnpm haro setup --profile dev
pnpm haro doctor --json
pnpm haro run "列出当前目录下的 TypeScript 文件"
```

> 注：`pnpm setup` 与 pnpm 内置命令冲突，等价路径为 `pnpm run setup` 或 `pnpm haro setup`。

## 仓库结构

```text
packages/
├── core/               # 核心运行时、配置、存储、Memory Fabric、Scenario Router、Team Orchestrator、Permission Budget、Evolution Registry
├── provider-codex/     # Codex Provider（含 ChatGPT 订阅认证）
├── providers/          # 其他 Provider 占位位（计划接入 xiaomi-token-plan / kimi-token-plan 等）
├── channel/            # 共享 Channel 协议层
├── channel-feishu/     # 飞书 adapter
├── channel-telegram/   # Telegram adapter
├── skills/             # Skills 子系统与 eat/shit 代谢
├── cli/                # CLI 入口；`haro web` 是 @haro/web-api 的薄启动器
├── web-api/            # Web 后端服务（FEAT-038 已交付，独立可发布）
└── web/                # Web Dashboard 前端（React 19 SPA）

docs/                   # 架构、模块、演进、评审、规划文档
specs/                  # 单一真源：feature / defect / protocol / constraints
roadmap/                # 阶段路线图
scripts/                # 辅助脚本
```

## 文档导航

### 先看这几份

- [Getting Started](docs/getting-started.md) — 从安装到跑通第一条任务
- [Install](docs/install.md) — 全平台安装指南
- [Configuration](docs/configuration.md) — 配置层级、环境变量、敏感数据原则
- [Channels](docs/channels.md) — 飞书 / Telegram / Web channel 启用与 Gateway 控制
- [架构总览](docs/architecture/overview.md) — 双层架构 + 三层解耦 + 四进化驱动源
- [路线图](roadmap/phases.md) — Phase 0/1/1.5/2.0/2.5/3.0/3.5
- [2026-05-01 重设计规划](docs/planning/redesign-2026-05-01.md) — 当前进行中的精简方案
- [spec 体系与开发流程](specs/README.md)
- [Troubleshooting](docs/troubleshooting.md)

### 按主题阅读

**架构与约束**
- [架构总览](docs/architecture/overview.md)
- [设计原则](specs/design-principles.md)
- [多 Agent 设计约束](specs/multi-agent-design-constraints.md)
- [Provider 协议](specs/provider-protocol.md)
- [Channel 协议](specs/channel-protocol.md)
- [Evolution 代谢机制](specs/evolution-metabolism.md)
- [Evolution Engine 协议](specs/evolution-engine-protocol.md)
- [Team Orchestration 协议](specs/team-orchestration-protocol.md)

**模块说明**
- [CLI 设计](docs/cli-design.md)
- [数据目录](docs/data-directory.md)
- [模块文档](docs/modules)

**研究与评审**
- [竞品调研](docs/research/landscape.md)
- [自有项目资产](docs/research/prior-art.md)
- [Phase 0 审计](docs/reviews/phase-0-audit-2026-04-19.md)

## 开发流程

Haro 采用 **spec 驱动开发**：

1. `specs/` 是单一真源
2. 新 feature / defect 先补 spec，再实现
3. Requirement、Acceptance Criteria、测试、文档同步闭环
4. docs 与 spec 漂移视为未完成

每次开发任务结束按顺序调用：
1. `/codex:review` — Codex 独立评审本次改动
2. `/neat-freak` — 同步项目文档与 Agent 记忆

详细规则见 [`specs/README.md`](specs/README.md)。

## 当前边界

为了避免 README 说得比代码多，明确写清楚：

- 当前正式实现的 Provider 只有 **Codex**；多 provider 抽象保留，规划接入 xiaomi-token-plan / kimi-token-plan 等
- 当前已实现的 Channel：**CLI / 飞书 / Telegram**；Phase 1.5 新增 Web channel
- Phase 0 + Phase 1 主线已完成；进入 **Phase 1.5（自用底座补完）**
- Evolution Engine、自动 eat/shit、Industry Intel 仍属于 Phase 2.0+
- Agent-as-Developer（自改代码、自提 PR）属于 Phase 3.5+
- 当前形态：**源码运行 + 自用为主**，不是稳定发布版本
- 不引入：Agent Store / 跨实例协作（Phase 4 已移除）；企业 SSO/OIDC；向量数据库（FTS5 够用到 Phase 2+）

## 路线图

| 阶段 | 状态 | 目标 |
| --- | --- | --- |
| Phase 0 Foundation | 已完成 | CLI + Codex + 单 Agent + Memory + Channel + Skills + 手动 eat/shit |
| Phase 1 Intelligence & Safety | 已完成 | Scenario Router + Team Orchestrator + Dashboard + Memory Fabric v1 + Asset Registry + 权限预算 |
| Phase 1.5 Workbench Parity | **进行中** | Web API 解耦 + CLI 等价补完 + Web Channel + MCP 工具层 + 定时任务 + 流式 UX |
| Phase 2.0 Evolution Awareness | 规划中 | Self-Monitor + Industry Intel + 自动 eat/shit 触发 |
| Phase 2.5 Evolution Proposal | 规划中 | Pattern Miner + Evolution Proposal + 用户审批闭环 |
| Phase 3.0 Controlled Self-Evolution | 规划中 | Auto-Refactorer L0–L1 + 灰度 + 回滚 |
| Phase 3.5 Agent-as-Developer | 视情况 | L2/L3 改动 + 自写 spec + 自提 PR |

## 开发验证

```bash
pnpm lint
pnpm test
pnpm build
pnpm smoke
```

## License

待定
