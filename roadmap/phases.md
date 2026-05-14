# Haro 路线图

> 2026-05-08 新基线：Haro 不再继续自建完整 workbench/runtime。AgentDock 是 kernel/workbench，Haro 是可插拔 self-evolution sidecar。
>
> 历史路线见 [`docs/planning/archive/redesign-2026-05-01.md`](../docs/planning/archive/redesign-2026-05-01.md)。旧 Phase 0/1/1.5 作为已完成历史资产保留，不再决定后续主路径。

## 总览

| 阶段 | 状态 | 目标 | 核心交付 | 写权限 |
| --- | --- | --- | --- | --- |
| Phase A: Baseline Reset | 进行中 | 文档与边界切到 AgentDock sidecar 新基线 | README / roadmap / architecture overview / planning 文档改写 | 无 |
| Phase B: Contract Skeleton | 已实现 skeleton | 建立 Haro 与 AgentDock 的稳定 contract | `@haro/agentdock-contract`、schema、fake source、contract tests | 无 |
| Phase C: Read-only MCP Sidecar | 已实现，live smoke 已通过 | 让 AgentDock agent 可以显式调用 Haro 观察与提案 | `haro mcp`、`haro_observe`、`haro_propose`、`haro_validate`、`haro_asset_query`；sidecar 启动不创建 Haro-owned memory 目录 | Haro 自有日志/资产目录 |
| Phase D: Scheduled Sidecar | 核心闭环已落地 | 通过 AgentDock 定时任务后台驱动 observe/propose/validate/status/doctor | `haro connect agent-dock`、`haro observe --since last`、`haro propose --auto-dry-run`、`haro validate --pending`、`haro status`、`haro doctor --component sidecar` | Haro 自有目录，不写 memory |
| Phase E: Signal Intake + Asset Registry | 进行中，frontier evidence + registry adapter 已接入 propose/validate | 把外部前沿情报与 skills/prompts/profiles/rules/tool config 纳入进化证据和资产事件 | `FrontierSignal` schema、`haro intake frontier --source-config`、`haro propose --auto-dry-run --include-frontier`、frontier-signals sidecar 数据目录；`~/.haro/assets/manifests` + `events` file-backed registry；proposed/validated asset event 写入；memory 仅保存 AgentDock refs | Haro 自有目录，不写 memory |
| Phase F: Gated Apply L0/L1 | sidecar-local apply/rollback + opt-in MCP bridge 已落地，人审 gate 已补强 | 在 validation + human review gate 后执行低风险变更 | `ApplicationRecord` / `AssetSnapshotRecord` / `RollbackRecord` contract、`humanReviewRequired` / `humanApprovalRefs`、`haro snapshot --proposal-id`、sidecar-local `snapshot-content`、`haro apply --proposal-id` / `haro rollback --application-id`、`haro mcp --enable-gated-write` 的 `haro_apply` / `haro_rollback` | 只改 Haro sidecar-owned `assets/current`，不改 AgentDock 内部资产；缺 approval ref 返回 `HUMAN_REVIEW_REQUIRED`；默认 MCP 仍 read-only |
| Phase G: Patch Branch L2/L3 | plan artifact 第一段已落地 | 对 Haro 代码或 AgentDock contract 生成 patch branch 与验证报告 | `PatchBranchPlanRecord`、`haro patch-branch --proposal-id`、`~/.haro/evolution/patch-branches` plan artifacts；真实 branch executor 待实现 | 不直接 apply；不创建真实 branch；不写 memory |
| Phase H: Approval Requests | approval artifact 第一段已落地 | 把 proposal 变成可给用户逐条审批的 why/how/benefit 请求 | `ApprovalRequestRecord`、`haro approval-request --pending`、`~/.haro/evolution/approval-requests` | 只产出审批请求；不签发 approval、不 apply、不写 memory |

## 关键判断

Haro 后续价值不在重新实现 AgentDock 已经具备的 runtime/workbench 能力，而在三件事：

1. 观察 AgentDock 的真实使用数据和 Haro sidecar 自身组件健康信号。
2. 从 X、YouTube、论文、release notes、官方文档、benchmark 等来源吸收带 citation 的 agent 前沿情报。
3. 生成可验证、可回滚、需审批的进化提案。
4. 将 prompt、skill、rule、tool config、frontier source ref 的变化资产化；memory 由 AgentDock 侧提供，Haro 不生成 memory asset。

因此后续路线按 sidecar 接入面推进，而不是继续扩大 Haro 自建 Provider、Channel、Session runtime、Web Dashboard。

## 接入原则

| 原则 | 说明 |
| --- | --- |
| AgentDock 独立运行 | Haro 拔掉后，AgentDock 仍是完整 workbench |
| Haro 是外部 MCP server | 通过 AgentDock 已有 MCP server 注册能力接入 |
| 定时任务走 AgentDock scheduler | 后台 observe/propose/validate 通过 script task 执行 |
| Agent 编排走 AgentDock skills/MCP | 普通 session 中由 AgentDock agent 显式调用 Haro tools |
| 只依赖稳定 contract | Haro 不 import AgentDock `src/*` |
| 先只读，后可写 | 第一批能力全部 read-only / dry-run |

## Phase A: Baseline Reset — 文档基线重置

**状态**：进行中（2026-05-08 启动）

**目标**：把仓库公开叙事从“自建 workbench + 进化层”切到“AgentDock kernel + Haro sidecar”。

**交付项**：

| 交付项 | 文件 | 状态 |
| --- | --- | --- |
| 项目定位重写 | `README.md` | 进行中 |
| 路线图重写 | `roadmap/phases.md` | 进行中 |
| 架构总览重写 | `docs/architecture/overview.md` | 进行中 |
| sidecar planning 补强 | `docs/planning/agentdock-kernel-sidecar-architecture.md` | 进行中 |

**验收标准**：

- README 第一屏明确 Haro 是 AgentDock self-evolution sidecar。
- roadmap 不再把 Haro 自建 workbench 作为后续主线。
- architecture overview 明确 AgentDock 侧、Haro 侧、contract、观测源、写入边界。
- planning 文档明确接入方式：MCP server 注册 + AgentDock scheduler + AgentDock skills/MCP 调用。

## Phase B: Contract Skeleton

**目标**：先定义 contract，再写集成代码。

**交付项**：

| 交付项 | 内容 |
| --- | --- |
| AgentDock connection schema | baseUrl、authRef、capabilityVersion、observationSource |
| Observation schema | sessions、turns、tool calls、scheduled runs、AgentDock memory activity refs、runner errors、usage |
| Proposal schema | proposal id、target kind、risk level、change set、test plan、rollback plan |
| Validation schema | risk verdict、required tests、rollback readiness、apply eligibility |
| Asset event schema | stable id、kind、version、content hash、status、events |
| Fake AgentDock source | 用于 contract tests，不依赖真实 AgentDock runtime |

**边界**：

- 不 import AgentDock 内部模块。
- 不做真实 API 适配。
- 不开放写入能力。

## Phase C: Read-only MCP Sidecar

**目标**：让 AgentDock agent 能把 Haro 当作外部 MCP server 使用。当前代码已实现首批 read-only sidecar tools，并已通过 AgentDock 注册 MCP live smoke（2026-05-08）。

**首批 tools**：

| Tool | 作用 | 权限 |
| --- | --- | --- |
| `haro_observe` | 收集 AgentDock 当前状态或增量状态 | read-only |
| `haro_propose` | 基于观察结果生成 evolution proposal | read-only |
| `haro_validate` | 验证 proposal 风险、测试计划、回滚路径 | read-only |
| `haro_asset_query` | 查询资产、事件、版本和效果 | read-only |

**明确不做**：

- 不提供自由文本 apply。
- 不改 AgentDock DB。
- 不接管 AgentDock session lifecycle。
- `haro mcp` 与默认 `haro run` 不创建或写入 Haro-owned MemoryFabric；记忆由 AgentDock 侧提供，历史兼容只能显式开启。

## Phase D: Scheduled Sidecar

**目标**：用 AgentDock 已有定时任务能力驱动 Haro 后台维护。

**命令面**：

```bash
haro connect agent-dock --base-url http://127.0.0.1:3000
haro observe --since last
# next
haro intake frontier --source-config ~/.haro/frontier-sources.json --since last
haro propose --auto-dry-run --include-frontier
haro validate --pending
haro status
haro doctor
```

**AgentDock 调度方式**：

```text
AgentDock scheduler
  -> script task
  -> haro observe/propose/validate
  -> Haro writes ~/.haro/evolution/*
```

**验收标准**：

- 定时任务失败不影响普通 AgentDock session。
- Haro 日志可独立排查。
- 复用 FEAT-045 已落地的 AgentDock HTTP observation source。
- cursor 可恢复，不重复消费已处理 observation，且跨 connection 不互相去重/碰撞。

## Phase E: Signal Intake + Asset Registry

**目标**：把外部前沿情报 intake 和 Haro 资产模型迁移合并到 sidecar 证据/资产目录，继续保留 eat/shit 代谢思想。

**Frontier signals**：

- X / 社交短讯
- YouTube / 公开视频
- 论文 / preprint
- 开源仓库 release notes
- 官方文档 / blog
- benchmark / eval report

每条 signal 必须包含 source ref、发布时间或版本、抓取时间、摘要、置信度和目标域；只能作为 proposal evidence，不能直接触发 apply。

当前已实现 `FrontierSignal` contract schema、`haro intake frontier --source-config <file> --since last --json` 与 `haro propose --auto-dry-run --include-frontier`。source config 由人工或 AgentDock skill 先整理为 `FrontierSignal[]` / `{ signals: [...] }`，Haro 负责 schema 校验、sourceRef 去重、cursor、落盘，并在生成 dry-run proposal 时引用 active frontier evidence。

Asset registry 已改为 sidecar file-backed registry：manifest 写入 `~/.haro/assets/manifests`，asset event 写入 `~/.haro/assets/events`，`haro_asset_query` 读取该 sidecar registry manifests/events 并支持 kind/status/query/limit 过滤；`haro propose --auto-dry-run` / `haro validate --pending` 会分别写 `proposed` / `validated` asset events；旧 core EvolutionAssetRegistry 不再作为 sidecar query 来源。

**资产范围**：

- skills
- prompts
- runner profiles
- routing / task rules
- AgentDock memory observation refs
- frontier intelligence source refs
- MCP tool configs
- archives

**每个资产必须包含**：

- stable id
- kind
- version
- source ref
- content ref
- content hash
- status
- events
- rollback metadata

## Phase F: Gated Apply L0/L1

**目标**：只在验证通过后应用低风险变更。

| Level | 范围 | Apply 策略 |
| --- | --- | --- |
| L0 | prompt 文案、skill 描述、配置默认值 | proposal + validation 后允许 |
| L1 | skill 文件、runner profile、schedule/routing config | proposal + validation + human approval + snapshot + rollback 后允许 |

**硬约束**：

- `haro_apply` 只接受 proposal id。
- `haro_rollback` 只接受 application id。
- proposal 未验证不允许 apply。
- snapshot / rollback ref 缺失时必须先生成并绑定 refs。
- apply / rollback 事件必须写入 Evolution Store 和 Asset Registry。
- 默认 `haro mcp` 仍 read-only；只有显式 `--enable-gated-write` 才注册 write tools。

当前已实现 CLI gate preflight、snapshot artifacts、sidecar-local apply/rollback、人审 gate 与 opt-in MCP bridge：`haro snapshot --proposal-id <id>` 写 `~/.haro/evolution/snapshots/*` 和 `rollbacks/*`，并对 L0/L1 allowlisted targets 从 Haro sidecar-owned `~/.haro/assets/current/<kind>/` 复制当前内容到 `~/.haro/evolution/snapshot-content/<snapshot-id>/`；`haro apply --proposal-id <id>` 会拒绝 L2/L3、未验证 proposal、缺少 `humanApprovalRefs`、`applyEligible=false` 的请求，缺 approval ref 时返回 `HUMAN_REVIEW_REQUIRED` 且不生成 snapshot/application；通过人审 gate 后，缺 snapshot/rollback ref 时先生成 refs，然后从 `~/.haro/evolution/proposal-content/<proposal-id>/` 读取拟应用内容，写入 `~/.haro/assets/current/{prompt,mcp-tool-config,skill,runner-profile,schedule-config,routing-rule}/`，并写 applied application record 与 `applied` asset event；`haro rollback --application-id <id>` 可恢复 snapshot-content 或删除 apply 创建的 current content，并写 `rolled-back` event；`haro mcp --enable-gated-write` 只把同一套 CLI gate 以 `haro_apply` / `haro_rollback` 暴露给 AgentDock MCP。当前仍不修改 AgentDock 内部资产、不写 memory。

## Phase G: Patch Branch L2/L3

**目标**：代码级变更不通过 MCP 直接落地，只生成可审查产物。

| Level | 范围 | 输出 |
| --- | --- | --- |
| L2 | Haro sidecar 代码 | patch branch + tests + rollback plan |
| L3 | AgentDock kernel 代码或跨项目 contract | proposal + patch branch + 人工决策 |

**硬约束**：

- Haro 不能直接修改 AgentDock kernel 主分支。
- 跨项目 contract 变更必须人工决策。
- 自动生成 patch 后必须附验证证据和回滚路径。
- 第一段只生成 patch branch plan artifact，不 checkout、不创建真实 branch、不修改代码。

当前已实现 `haro patch-branch --proposal-id <id>`：要求 L2/L3 proposal 已验证，生成 deterministic `PatchBranchPlanRecord`，写入 `~/.haro/evolution/patch-branches/`，包含推荐 branchName、requiredTests、manualChecks、regressionRisks、rollbackPlan 和 evidence refs；L0/L1 调用会返回 `PATCH_BRANCH_NOT_REQUIRED`。

## Phase H: Approval Requests

**目标**：把每个 proposal 自动整理成用户可审批的结构化请求。

当前已实现 `haro approval-request --pending`：读取已有 validation、尚未有 approval request、且缺少 `humanApprovalRefs` 的 proposal，写入 `~/.haro/evolution/approval-requests/`。每个 request 包含 whyChange、howChange、expectedBenefits、requiredTests、manualChecks、regressionRisks、rollbackPlan 和 `approve / reject / request-changes` 决策选项。下一步由 AgentDock 将这些 artifact 渲染为飞书/Web 审批消息，并在用户同意后签发 `humanApprovalRef`。

## 历史资产处理

| 历史模块 | 新状态 | 处理方式 |
| --- | --- | --- |
| Memory 接入 | 改为 AgentDock-owned | Haro 通过 AgentDock MCP/API/任务上下文读取记忆；不维护 sidecar memory asset |
| MCP tools permission/audit | 保留经验 | 复用守门链思想，重建 Haro sidecar tools |
| Evolution Asset Registry | 保留并迁移 | 移到 sidecar 数据目录 |
| eat/shit | 保留思想 | 作为 asset metabolism 继续使用 |
| CLI parity | 降级 | admin/debug/control surface |
| Web API / Dashboard | 降级 | 可选控制面，不再主推 |
| Scenario Router / Team Orchestrator | 冻结 | 只保留 validation 相关经验 |
| Provider / Channel / Session runtime | 废弃主路径 | 不再继续扩展 |

## 当前验证命令

```bash
git diff --check
pnpm lint
pnpm test
pnpm build
```

sidecar 代码阶段需至少通过 `pnpm lint && pnpm build && pnpm test && pnpm smoke && git diff --check`；文档-only 改动可降级为 `git diff --check` 和人工一致性检查。
