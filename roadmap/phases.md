# Haro 路线图

> 2026-05-08 新基线：Haro 不再继续自建完整 workbench/runtime。AgentDock 是 kernel/workbench，Haro 是可插拔 self-evolution sidecar。
>
> 历史路线见 [`docs/planning/archive/redesign-2026-05-01.md`](../docs/planning/archive/redesign-2026-05-01.md)。旧 Phase 0/1/1.5 作为已完成历史资产保留，不再决定后续主路径。

## 总览

| 阶段 | 状态 | 目标 | 核心交付 | 写权限 |
| --- | --- | --- | --- | --- |
| Phase A: Baseline Reset | 进行中 | 文档与边界切到 AgentDock sidecar 新基线 | README / roadmap / architecture overview / planning 文档改写 | 无 |
| Phase B: Contract Skeleton | 已实现 skeleton | 建立 Haro 与 AgentDock 的稳定 contract | `@haro/agentdock-contract`、schema、fake source、contract tests | 无 |
| Phase C: Read-only MCP Sidecar | 已实现，待 live smoke | 让 AgentDock agent 可以显式调用 Haro 观察与提案 | `haro mcp`、`haro_observe`、`haro_propose`、`haro_validate`、`haro_asset_query`；sidecar 启动不创建 Haro-owned memory 目录 | Haro 自有日志/资产目录 |
| Phase D: Scheduled Sidecar | 待启动 | 通过 AgentDock 定时任务后台驱动 observe/propose/validate | `haro connect agent-dock`、`haro observe --since last`、`haro propose --auto-dry-run`、`haro validate --pending` | Haro 自有目录 |
| Phase E: Asset Registry Adapter | 待启动 | 把 skills/prompts/profiles/rules/tool config 纳入资产事件 | sidecar 数据目录、manifest、hash、rollback metadata；memory 仅记录 AgentDock observation refs | Haro 自有目录 |
| Phase F: Gated Apply L0/L1 | 待启动 | 在 validation gate 后执行低风险变更 | `haro_apply`、snapshot、rollback、application event | 受控写入 |
| Phase G: Patch Branch L2/L3 | 规划中 | 对 Haro 代码或 AgentDock contract 生成 patch branch 与验证报告 | proposal、patch branch、test report、rollback plan | 不直接 apply |

## 关键判断

Haro 后续价值不在重新实现 AgentDock 已经具备的 runtime/workbench 能力，而在三件事：

1. 观察 AgentDock 的真实使用数据。
2. 生成可验证、可回滚的进化提案。
3. 将 prompt、skill、rule、tool config 的变化资产化；memory 由 AgentDock 侧提供，Haro 不生成 memory asset。

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

**目标**：让 AgentDock agent 能把 Haro 当作外部 MCP server 使用。当前代码已实现首批 read-only sidecar tools，下一步是注册到 AgentDock 后做 live smoke。

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
haro propose --auto-dry-run
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
- cursor 可恢复，不重复消费已处理 observation。

## Phase E: Asset Registry Adapter

**目标**：把 Haro 资产模型迁到 sidecar 数据目录，继续保留 eat/shit 代谢思想。

**资产范围**：

- skills
- prompts
- runner profiles
- routing / task rules
- AgentDock memory observation refs
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
| L1 | skill 文件、runner profile、schedule/routing config | proposal + validation + snapshot + rollback 后允许 |

**硬约束**：

- `haro_apply` 只接受 proposal id。
- proposal 未验证不允许 apply。
- snapshot / rollback ref 缺失不允许 apply。
- apply 事件必须写入 Evolution Store 和 Asset Registry。

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
