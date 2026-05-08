# Haro

> Haro 是 AgentDock 的可插拔 self-evolution sidecar。AgentDock 负责日用 agent runtime / workbench；Haro 负责观察、提案、验证、资产登记和受控低风险自进化。

## 当前定位

2026-05-08 起，Haro 不再继续自建完整 workbench/runtime。新的边界如下：

| 项目 | 定位 | 负责范围 |
| --- | --- | --- |
| AgentDock | 独立运行的 agent runtime / workbench | Session、Runner、Memory Agent、MCP、IM、Scheduler、Web/PWA、skills 运行面 |
| Haro | AgentDock 的 self-evolution sidecar | 观察 AgentDock 使用数据、生成 evolution proposal、验证风险与回滚路径、登记 evolution assets、执行 gated L0/L1 变更 |

依赖方向只有一条：

```text
haro -> AgentDock public API / MCP / event export / filesystem contract
```

约束：

- AgentDock 不能 import Haro。
- Haro 不能 import AgentDock 内部 `src/*` 模块。
- Haro 不要求 AgentDock 为它新增深度插件主链路。
- Haro 只通过稳定 contract 接入 AgentDock 已有能力。

## 接入方式

Haro 接入 AgentDock 的方式固定为三类，不引入第四条主链路。

### 1. 外部 MCP server 注册

Haro 作为普通外部 MCP server 注册到 AgentDock：

```json
{
  "id": "haro",
  "command": "haro",
  "args": ["mcp"],
  "env": {
    "HARO_AGENTDOCK_BASE_URL": "http://127.0.0.1:3000",
    "HARO_HOME": "/path/to/.haro"
  },
  "enabled": true
}
```

AgentDock 侧复用已有 MCP server 管理能力：新增、启用、禁用、运行时合入 runner settings/env。

### 2. AgentDock 定时任务

后台 observe / propose / validate 通过 AgentDock 已有 scheduler 触发，优先使用 script task：

```bash
haro observe --agentdock-url http://127.0.0.1:3000 --since last
haro propose --auto-dry-run
haro validate --pending
```

原因：

- 不依赖普通聊天上下文。
- 可以独立记录结构化日志。
- 失败可重试，不污染用户 session。

### 3. AgentDock skills / agent 能力编排

AgentDock agent 在需要时通过 MCP tools 或已有 skills 显式调用 Haro：

```text
AgentDock session
  -> haro_observe
  -> haro_propose
  -> haro_validate
  -> 通过 AgentDock 原有 channel 向用户汇报
```

Haro 不直接接管 AgentDock 的聊天、IM、Web、Runner 或 Memory Agent 主链路。

## 当前已确认的 AgentDock 能力

基于本地 AgentDock 仓库检查，第一版接入可以依赖以下现有能力：

| 能力 | AgentDock 位置 | Haro 使用方式 |
| --- | --- | --- |
| 外部 MCP server 管理 | `src/routes/mcp-servers.ts` | 注册 `haro mcp` |
| Runner 合入 MCP 配置 | `src/runtime-runner.ts` | 让 AgentDock session 可见 Haro tools |
| 定时任务 | `src/routes/tasks.ts` / `src/task-scheduler.ts` | 周期触发 `haro observe/propose/validate` |
| script task | `src/task-scheduler.ts` | 后台执行 Haro CLI，无需聊天上下文 |

这些是接入事实，不代表 Haro 可以依赖 AgentDock 内部源码。正式实现仍应通过 public API、MCP contract、event export 或文件目录约定协作。

## Haro 侧目标能力

### 已保留经验

- AgentDock Memory Agent / memory MCP 的接入经验：Haro 只读取或引用 AgentDock 暴露的记忆，不维护自有 Memory Fabric。
- MCP tools 的 permission / timeout / audit 守门链。
- Evolution Asset Registry。
- eat/shit 代谢思想。
- Evolution Proposal / Validation / Auto-Refactorer specs 中与 sidecar 相关的部分。

### 降级为 admin/debug/control surface

- CLI 等价能力。
- Web API。
- Cron 任务。
- Web Dashboard。
- Scenario Router / Team Orchestrator 中可服务 validation 的片段。

### 不再作为主路径继续建设

- Haro 自建 Provider 抽象。
- Haro 自建 Channel 抽象。
- Haro 自建 Session runtime。
- Haro 内部 workbench 主链路。

## 目标组件

| 组件 | 职责 | 第一版状态 |
| --- | --- | --- |
| `@haro/agentdock-contract` | AgentDock connection、observation、proposal、validation、asset event schema | 进行中 |
| Haro MCP Server | 暴露 `haro_observe` / `haro_propose` / `haro_validate` / `haro_asset_query` | 待实现 |
| Haro Scheduled CLI | 支持 `connect agent-dock`、`observe`、`propose`、`validate`、`status`、`doctor` | 待实现 |
| Evolution Store | `~/.haro/evolution/*` 独立存储 observations/proposals/validations/applications | 待迁移 |
| Asset Registry | 管理 skills/prompts/profiles/rules/tool config 资产事件 | 复用并迁移；memory 由 AgentDock 提供，Haro 仅保存 observation refs |
| Gated Apply | L0/L1 proposal + validation + snapshot + rollback 后应用 | 后续实现 |

## 自进化分级

| Level | 范围 | 是否允许 MCP apply |
| --- | --- | --- |
| L0 | prompt 文案、skill 描述、配置默认值 | 允许，需 proposal + validation |
| L1 | skill 文件、runner profile、schedule/routing config | 允许，需 snapshot + rollback |
| L2 | Haro sidecar 代码 | 不直接 apply，生成 patch branch |
| L3 | AgentDock kernel 代码或跨项目 contract | 不直接 apply，必须人工决策 |

## 仓库结构

当前仓库仍保留历史 workbench 代码。第一阶段不做物理删除，先完成文档基线与 sidecar contract。

```text
packages/
├── agentdock-contract/ # AgentDock sidecar contract schema、fake source、contract tests
├── core/               # 历史核心能力；保留 Evolution / Guard 等可迁移部分；自有 Memory 逻辑不进入 sidecar 基线
├── cli/                # 后续降级为 sidecar admin/debug CLI
├── mcp-tools/          # 历史 MCP 工具层；后续新增/迁移为 Haro sidecar MCP server
├── skills/             # Skills 与 eat/shit 代谢能力
├── web-api/            # 历史控制面；后续按需保留
├── web/                # 历史 Dashboard；不再作为主产品面扩展
├── channel*/           # 历史 channel adapter；冻结主路径
└── provider*/          # 历史 provider adapter；冻结主路径

docs/                   # 架构、模块、规划文档
specs/                  # 历史 spec + 后续 sidecar-era spec
roadmap/                # sidecar-era 路线图
scripts/                # 辅助脚本
```

## 文档导航

当前新基线：

- [AgentDock Kernel + Haro Sidecar Architecture](docs/planning/agentdock-kernel-sidecar-architecture.md)
- [架构总览](docs/architecture/overview.md)
- [路线图](roadmap/phases.md)
- [Sidecar-era specs](specs/sidecar) — FEAT-043 到 FEAT-047
- [2026-05-01 重设计规划](docs/planning/archive/redesign-2026-05-01.md) — 历史基线，已归档

历史模块文档仍保留，但阅读时以 2026-05-08 sidecar 文档为准。若旧文档仍描述 Haro 自建 workbench 主路径，视为 historical baseline，不作为后续实现依据。

## 开发流程

当前阶段采用“文档基线 → contract skeleton → read-only integration → gated write”的顺序。

1. 文档基线清理：README、roadmap、architecture overview、planning 文档对齐 sidecar 定位。
2. Contract skeleton：新增 AgentDock contract schema 与 fake source tests。
3. Read-only MCP/CLI：实现 observe/propose/validate/query，默认 dry-run。
4. Scheduled sidecar：通过 AgentDock script task 周期触发。
5. Gated apply：只开放 L0/L1，必须有 validation、snapshot、rollback ref。

每次开发任务结束按顺序执行：

1. `/codex:review` — 独立评审本次改动。
2. `/neat-freak` — 同步项目文档与 Agent 记忆。

## 开发验证

```bash
pnpm lint
pnpm test
pnpm build
pnpm smoke
```

文档-only 改动至少检查：

```bash
git diff --check
git diff -- README.md roadmap/phases.md docs/architecture/overview.md docs/planning/agentdock-kernel-sidecar-architecture.md
```

## License

待定
