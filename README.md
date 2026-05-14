# Haro

> Haro 是 AgentDock 的可插拔 self-evolution sidecar。AgentDock 负责日用 agent runtime / workbench；Haro 通过 MCP server、AgentDock 定时任务和 skills 编排运行，持续观察 AgentDock/Haro 使用信号、吸收外部前沿情报，生成可验证、可审批、可回滚的自优化建议。

## 当前定位

2026-05-08 起，Haro 不再继续自建完整 workbench/runtime。新的边界如下：

| 项目 | 定位 | 负责范围 |
| --- | --- | --- |
| AgentDock | 独立运行的 agent runtime / workbench | Session、Runner、Memory Agent、MCP、IM、Scheduler、Web/PWA、skills 运行面 |
| Haro | AgentDock 的 self-evolution sidecar | 观察 AgentDock 与 Haro 自身使用数据、吸收外部 agent 前沿情报、生成 evolution proposal、验证风险与回滚路径、登记 evolution assets、在审批后执行 gated L0/L1 变更 |

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
haro intake frontier --source-config ~/.haro/frontier-sources.json --since last
haro propose --auto-dry-run --include-frontier
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

## 自进化闭环

Haro 的长期目标不是简单运行 `observe/propose/validate` 三个命令，而是形成完整 OODA 闭环：

```text
AgentDock runtime + Haro sidecar + external frontier sources
  -> Observe: 采集 AgentDock 使用信号、Haro 自身健康信号、外部前沿情报
  -> Orient: 关联失败、成功模式、资产历史和外部趋势
  -> Propose: 对 runner / web / 消息端 / memory / MCP / scheduler / skills / Haro 自身生成建议
  -> Validate: 对抗性 review、风险分级、测试计划、回滚计划
  -> Approve: 通过 AgentDock 原 channel 让用户/维护者审批
  -> Apply: L0/L1 gated apply，L2/L3 只生成 patch branch 和验证报告
```

外部前沿情报包括 X、YouTube、论文、开源仓库 release notes、官方文档、benchmark 等，但它们只能作为带来源的 proposal evidence，不能绕过 validation / approval / rollback gate。

详见 [Haro Sidecar Operating Model](docs/architecture/sidecar-operating-model.md)。

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
- AgentDock runner、Web/PWA、消息端、scheduler、MCP/tools、skills 的使用观测与优化建议链路。
- 外部前沿情报 intake：X / YouTube / paper / release note / official doc / benchmark 只作为带来源 evidence。
- MCP tools 的 permission / timeout / audit 守门链。
- Evolution Asset Registry。
- eat/shit 代谢思想。
- Evolution Proposal / Validation / Auto-Refactorer specs 中与 sidecar 相关的部分。

### 降级/收缩为 sidecar 辅助面

- CLI：保留 sidecar admin/debug/verification 命令。
- Web：只保留 proposal review 工作台，用于查看 Haro 自动提案并写入人审 decision；不再作为通用 Dashboard / 执行控制面。
- Cron：保留 CLI scheduled sidecar 命令，由 AgentDock scheduler 触发；Haro Web 不再提供 cron 管理面。
- Scenario Router / Team Orchestrator 中可服务 validation 的片段。

### 不再作为主路径继续建设

- Haro 自建 Provider 抽象。
- Haro 自建 Channel 抽象。
- Haro 自建 Session runtime。
- Haro 内部 workbench 主链路。

## 目标组件

| 组件 | 职责 | 第一版状态 |
| --- | --- | --- |
| `@haro/agentdock-contract` | AgentDock connection、observation、proposal、validation、frontier signal、asset event、snapshot、rollback、application schema | 已实现 skeleton + fake source；FrontierSignal 与 Phase F snapshot source / rollback / application schema 已落地 |
| Haro MCP Server | 默认暴露 `haro_observe` / `haro_propose` / `haro_validate` / `haro_asset_query`；`haro mcp --enable-gated-write` 额外暴露 `haro_apply` / `haro_rollback` | 默认 read-only sidecar 已实现，AgentDock 注册 MCP live smoke 已通过（2026-05-08）；gated-write tools 复用 CLI apply/rollback gate 且默认关闭 |
| Haro Scheduled CLI | 支持 `connect agent-dock`、`observe`、`intake frontier`、`propose`、`validate`、`approval-request`、`snapshot`、`apply`、`rollback`、`patch-branch`、`status`、`doctor` | `connect agent-dock` + `observe --since last` + `intake frontier --source-config` + `propose --auto-dry-run --include-frontier` + `validate --pending` + `approval-request --pending` + `snapshot --proposal-id` + `apply --proposal-id` + `rollback --application-id` + `patch-branch --proposal-id` + `status` + `doctor --component sidecar` 已实现；approval-request 把 proposal 转为 why/how/benefit 审批 artifact；apply 会消费 approval decision：approve 补齐 human approval evidence，reject/request-changes 阻止当前 proposal apply；propose/validate/apply/rollback 会写入 sidecar asset events；snapshot 会为 allowlisted sidecar-local L0/L1 内容复制 snapshot-content；apply/rollback 支持 sidecar-local L0 `prompt` / `mcp-tool-config` 与 L1 `skill` / `runner-profile` / `schedule-config` / `routing-rule` 文件；patch-branch 为 L2/L3 写 plan artifact，不创建真实分支；不修改 AgentDock 内部资产；status/doctor 汇总 connection/cursor/evolution store 健康，不读写 memory |
| Evolution Store | `~/.haro/evolution/*` 独立存储 observations/frontier-signals/proposals/validations/approval-requests/approval-decisions/snapshots/snapshot-content/rollbacks/applications/patch-branches | observations/frontier-signals/proposals/validations/approval-requests/approval-decisions/snapshots/snapshot-content/rollbacks 已落盘；applications 已记录 applied / rolled-back 状态；patch-branches 已记录 L2/L3 plan |
| Asset Registry | 管理 skills/prompts/profiles/rules/tool config/frontier source ref 资产事件 | 已实现：file-backed sidecar registry 写入 `~/.haro/assets/manifests` + `~/.haro/assets/events`，`haro_asset_query` 读取 sidecar registry；scheduled propose/validate 会登记 `proposed` / `validated` event；memory 由 AgentDock 提供，Haro 仅保存 refs |
| Frontier Intelligence Intake | 从 X、YouTube、论文、release notes、官方文档等来源生成带 citation 的 external signals | 已实现：读取 curated source-config 中的 `FrontierSignal`，去重后写入 `~/.haro/evolution/frontier-signals/`；`propose --include-frontier` 会把 active signals 作为 proposal evidence |
| Gated Apply | L0/L1 proposal + validation + human approval + snapshot + rollback 后应用 | 已实现 gate preflight、human-review gate、snapshot/rollback metadata、L0/L1 sidecar-local content snapshot，以及 sidecar-local apply/rollback executor；AgentDock 原生写入口后续实现 |
| Haro Web Proposal Review | 类 issue 页面的人审工作台，只 review approval request | 已收缩为 `/api/v1/approval-requests` + 前端 proposal cards；旧 Chat/WebSocket/cron/config/memory/skills/users 等 Dashboard 控制面已删除 |

## 自进化分级

| Level | 范围 | 是否允许 MCP apply |
| --- | --- | --- |
| L0 | prompt 文案、skill 描述、配置默认值 | 允许，需 proposal + validation |
| L1 | skill 文件、runner profile、schedule/routing config | 允许，需 snapshot + rollback |
| L2 | Haro sidecar 代码 | 不直接 apply，生成 patch branch |
| L3 | AgentDock kernel 代码或跨项目 contract | 不直接 apply，必须人工决策 |

## 仓库结构

当前仓库仍保留部分历史 workbench 代码，但 sidecar 分支已经允许删除确定不再需要的代码与文档。后续判断以“AgentDock-owned runtime / Haro sidecar”边界为准：能服务 contract、read-only MCP、validation 或资产登记的经验保留；会重新引入 Haro 自有 workbench / memory 主链路的资产继续清理。

```text
packages/
├── agentdock-contract/ # AgentDock sidecar contract schema、fake source、contract tests
├── core/               # 历史核心能力；保留 Evolution / Guard 等可迁移部分；自有 Memory 逻辑不进入 sidecar 基线
├── cli/                # 后续降级为 sidecar admin/debug CLI
├── mcp-tools/          # Haro MCP 工具层；默认 sidecar registry 暴露 4 个 read-only/dry-run tools，显式开启后才暴露 gated apply/rollback
├── skills/             # Skills 与 eat/shit 代谢能力
├── web-api/            # Haro Web proposal review API；只保留 auth + approval-requests
├── web/                # Haro Web proposal review 前端；旧 Dashboard 已收缩删除
├── channel*/           # Feishu / Telegram 等历史 channel adapter；Web Channel 已移除
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
- [Haro Sidecar Operating Model](docs/architecture/sidecar-operating-model.md)
- [路线图](roadmap/phases.md)
- [Sidecar-era specs](specs/sidecar) — FEAT-043 到 FEAT-050
- [2026-05-01 重设计规划](docs/planning/archive/redesign-2026-05-01.md) — 历史基线，已归档

历史模块文档仍保留，但阅读时以 2026-05-08 sidecar 文档为准。若旧文档仍描述 Haro 自建 workbench 主路径，视为 historical baseline，不作为后续实现依据。

## 开发流程

当前阶段采用“文档基线 → contract skeleton → read-only integration → gated write”的顺序。

1. 文档基线清理：README、roadmap、architecture overview、planning 文档对齐 sidecar 定位。
2. Contract skeleton：新增 AgentDock contract schema 与 fake source tests。
3. Read-only MCP/CLI：`haro mcp` 默认只暴露 observe/propose/validate/query 4 个 read-only tools；AgentDock 注册 MCP live smoke 已通过（2026-05-08，`haro_observe` 返回 `source=agentdock-http`）。如显式使用 `haro mcp --enable-gated-write`，才会额外暴露 `haro_apply` / `haro_rollback`，且只接受 proposal/application id。
4. Scheduled sidecar：`connect agent-dock` + `observe --since last` + `propose --auto-dry-run --include-frontier` + `validate --pending` + `approval-request --pending` + `status` + `doctor --component sidecar` 已落地，可由 AgentDock script task 周期触发；propose 的 `--limit` 限制单次 proposal 打包的 observation batch 数，validate/approval-request 的 `--limit` 限制单次处理的 pending proposal 数，且 propose/validate 会同步写入 sidecar asset events；启动阶段自动 proposal 均写入 `humanReviewRequired=true` 和空 `humanApprovalRefs`；approval-request 会产出 why/how/benefit、风险、测试和回滚计划，供 AgentDock/飞书或 Haro Web proposal review 工作台渲染审批；approval-decision 会影响后续 apply：approve 补齐 human approval evidence，reject/request-changes 阻止当前 proposal；JSON 结果暴露损坏 observation/proposal/validation/frontier-signal/approval-decision 计数；status/doctor 只统计和检查 sidecar evolution store，不读写 memory。
5. Frontier intelligence：`FrontierSignal` schema + `haro intake frontier --source-config <file> --since last --json` + `haro propose --auto-dry-run --include-frontier` 已落地，把 curated X / YouTube / paper / release note / official doc / benchmark refs 归一为带来源 signals，并在 dry-run proposal 中引用 active frontier evidence；不写 AgentDock DB 或 memory。
6. Asset registry adapter：新增 file-backed sidecar asset registry，资产 event/manifest 写入 `~/.haro/assets/*`，`haro_asset_query` 直接查询 sidecar registry，不再读取旧 core EvolutionAssetRegistry；scheduled propose/validate 已接入 `proposed` / `validated` event 写入。
7. Gated apply：Phase F 已落地 sidecar-local L0/L1 gated apply/rollback。`haro snapshot --proposal-id <id>` 生成 snapshot/rollback artifacts，并会把 sidecar-owned `~/.haro/assets/current/<kind>/` 中的当前内容复制到 `~/.haro/evolution/snapshot-content/`；`haro apply --proposal-id <id>` 会执行 L0/L1 gate，若 proposal 缺少 `humanApprovalRefs` 会返回 `HUMAN_REVIEW_REQUIRED` 且不生成 snapshot/application；通过人审 gate 后，缺 refs 时先生成 snapshot/rollback refs，然后从 sidecar-owned `~/.haro/evolution/proposal-content/<proposal-id>/` 读取拟应用内容并写回 `~/.haro/assets/current/<kind>/`，同时写 `ApplicationRecord(status=applied)` 和 `applied` asset event；`haro rollback --application-id <id>` 可基于 rollback record 恢复 snapshot-content 或删除 apply 创建的 sidecar-local 内容，并写 `rolled-back` event。`haro mcp --enable-gated-write` 可把同一套 gate 暴露为 `haro_apply({proposalId})` / `haro_rollback({applicationId})`；默认 MCP surface 仍为 read-only，当前仍不修改 AgentDock 内部资产、不写 memory。
8. Patch branch：Phase G 第一段已落地 `haro patch-branch --proposal-id <id>`，只为 validated L2/L3 proposal 写入 `~/.haro/evolution/patch-branches/` plan artifact；不创建真实 git branch、不修改代码、不写 memory。
9. Web proposal review：Haro Web 已收缩为 issue-like review 工作台，只读取 `approval-requests` 并写入 approve/reject/request-changes decision artifact；旧 Dashboard chat/WebSocket/cron/config/memory/skills/users/workflow UI 与 Web Channel 包已清理删除。


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
