# AgentDock Kernel + Haro Sidecar 架构总览

## 结论

Haro 的新架构基线是：

```text
AgentDock = agent runtime / workbench kernel
Haro      = self-evolution sidecar
```

AgentDock 负责日用执行链路。Haro 通过 AgentDock 已有能力接入，负责进化闭环。

```text
AgentDock
  Sessions / Runner / Memory Agent / MCP / IM / Scheduler / Web/PWA / Skills
        ↑
        │ MCP server registration + scheduled script task + skills/MCP call
        │
Haro
  Observe / Propose / Validate / Asset Registry / Gated Apply
```

依赖方向只能是：

```text
haro -> AgentDock public API / MCP / event export / filesystem contract
```

AgentDock 不 import Haro。Haro 不 import AgentDock 内部 `src/*`。

## 背景

Haro 旧设计把 workbench 和 self-evolution 放在同一仓库：

- Workbench：CLI、Web Channel、飞书、Telegram、Agent Runtime、Memory、Skills、MCP、Cron（历史基线）。
- Evolution：Self-Monitor、Industry Intel、Pattern Miner、Proposal、Auto-Refactorer。

2026-05-08 的判断是：Workbench/runtime 与 AgentDock 主线高度重叠。继续在 Haro 内维护 Provider、Channel、Session runtime、Web API、CLI parity，会把 Haro 的差异化消耗在基础设施上。

新的差异化集中在：

- 观察 AgentDock 真实使用数据。
- 生成进化提案。
- 验证提案风险、测试计划和回滚路径。
- 资产化 prompt、skill、rule、tool config；memory 由 AgentDock 侧提供，Haro 只引用 observation refs。
- 在安全边界内执行 L0/L1 低风险变更。

## 设计原则

| 原则 | 说明 |
| --- | --- |
| AgentDock 独立运行 | Haro 插上去增强自进化；拔掉以后 AgentDock 仍完整可用 |
| Haro 是 sidecar，不是 fork | Haro 不污染 AgentDock runtime 主链路 |
| MCP 是主动交互面 | AgentDock agent 显式调用 Haro MCP tools |
| 定时任务是后台驱动面 | 周期性 observe/propose/validate 不依赖聊天上下文 |
| Skills 是编排辅助面 | Haro 可被 AgentDock 已有 skills/workflow 调用，不新增深度插件主链路 |
| Contract 优先于内部依赖 | 只通过 schema、API、MCP、event export、filesystem contract 协作 |
| 先只读，后可写 | 第一版全部 read-only / dry-run；L0/L1 apply 后置 |

## AgentDock 侧能力

Haro 不要求 AgentDock 内嵌 Haro，只要求 AgentDock 保持已有能力稳定。

| 能力 | 用途 | 当前接入判断 |
| --- | --- | --- |
| 外部 MCP server 注册 | 注册 `haro mcp` | AgentDock 已有 `src/routes/mcp-servers.ts` |
| Runner 合入 MCP 配置 | 让 session 可见 Haro tools | AgentDock 已有 `src/runtime-runner.ts` |
| 定时任务 | 周期性触发 Haro CLI | AgentDock 已有 `src/routes/tasks.ts` / `src/task-scheduler.ts` |
| Script task | 后台执行 observe/propose/validate | AgentDock scheduler 已支持 script execution |
| Skills / agent 调用面 | 在普通 session 中主动调用 Haro | 复用 AgentDock 现有 skills/MCP 能力 |

这些是 contract 的来源，不是源码依赖许可。Haro 实现中不得 import 上述 AgentDock 内部文件。

## 接入路径

### 路径 A：外部 MCP server

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

首批 tools：

| Tool | 作用 | 权限 |
| --- | --- | --- |
| `haro_observe` | 收集 AgentDock 当前状态或增量状态 | read-only |
| `haro_propose` | 基于观察结果生成 evolution proposal | read-only |
| `haro_validate` | 验证 proposal 风险、测试计划、回滚路径 | read-only |
| `haro_asset_query` | 查询资产、事件、版本和效果 | read-only |

### 路径 B：AgentDock 定时任务

```text
AgentDock scheduler
  -> script task
  -> haro observe --since last
  -> haro propose --auto-dry-run
  -> haro validate --pending
  -> Haro writes ~/.haro/evolution/*
```

后台维护不通过普通聊天上下文触发，避免把自进化流程混入用户 session。

### 路径 C：AgentDock skills / session 编排

```text
AgentDock session
  -> Agent decides to inspect self-evolution state
  -> calls Haro MCP tools
  -> summarizes proposal / validation through normal AgentDock channel
```

Haro 不直接发 IM，不直接接管 AgentDock channel。用户可见输出仍通过 AgentDock 原有 channel 完成。

## Haro 侧组件

| 组件 | 职责 | 数据写入 |
| --- | --- | --- |
| AgentDock Contract | connection / observation / proposal / validation / asset event schema | repo code |
| Observation Source | 读取 AgentDock API、event export、日志或文件约定 | read-only |
| Haro MCP Server | 暴露 observe/propose/validate/query tools | Haro 自有日志 |
| Scheduled CLI | 支持 connect/observe/propose/validate/status/doctor | `~/.haro/evolution/*` |
| Evolution Store | 保存 observations/proposals/validations/applications | `~/.haro/evolution/*` |
| Asset Registry | 管理 prompt/skill/profile/rule/tool config 资产 | `~/.haro/assets/*`；memory 不作为 Haro asset kind |
| Gated Apply | 应用 L0/L1 低风险变更 | 受控目标 + snapshot |

## 数据目录

Haro 自己维护独立数据目录，不写 AgentDock DB：

```text
~/.haro/
  agentdock-connections.json
  evolution/
    observations/
    proposals/
    validations/
    applications/
  assets/
    registry.sqlite
    manifests/
  logs/
```

AgentDock 数据是被观察对象，不是 Haro 内部状态。

## 观测范围

第一版至少覆盖：

- sessions
- messages / turns
- runner id / model / profile
- tool calls and results
- scheduled task runs
- AgentDock memory activity refs（只读/引用）
- runner errors / recoverable errors
- usage records

观测源可以先走 AgentDock 已有 API、DB export、日志目录或只读文件约定。稳定后再收敛为 event export / event stream。

## 写入边界

Haro apply 阶段只允许写入低风险对象：

- Haro 自己的 evolution DB / asset registry。
- AgentDock 可扫描的 skill 目录。
- AgentDock runner profile / prompt / task config。
- Haro MCP server 自身配置。

代码级修改不通过 MCP tool 直接落地。代码级自进化必须生成 proposal、patch branch、验证报告和回滚计划。

## 自进化分级

| Level | 范围 | 是否允许 MCP apply |
| --- | --- | --- |
| L0 | prompt 文案、skill 描述、配置默认值 | 允许，需 proposal + validation |
| L1 | skill 文件、runner profile、schedule/routing config | 允许，需 snapshot + rollback |
| L2 | Haro sidecar 代码 | 不直接 apply，生成 patch branch |
| L3 | AgentDock kernel 代码或跨项目 contract | 不直接 apply，必须人工决策 |

## 历史模块状态

| 历史模块 | 新状态 | 处理方式 |
| --- | --- | --- |
| Memory 接入 | AgentDock-owned | Haro 通过 AgentDock MCP/API/任务上下文读取记忆；不维护自有 Memory Fabric |
| MCP tools permission/audit | 保留经验 | 复用守门链，重建 sidecar MCP tools |
| Evolution Asset Registry | 保留并迁移 | 移入 sidecar 数据目录 |
| eat/shit | 保留思想 | 作为 asset metabolism 使用 |
| CLI parity | 降级 | admin/debug/control surface |
| Web API / Dashboard | 降级 | 可选控制面 |
| Scenario Router / Team Orchestrator | 冻结 | 只保留 validation 相关能力 |
| Provider / Channel / Session runtime | 废弃主路径 | 不再继续扩展 |

## 实施路线

| 阶段 | 目标 | 验收 |
| --- | --- | --- |
| Phase A | 文档基线重置 | README / roadmap / overview / planning 一致 |
| Phase B | Contract skeleton | schema + fake source + contract tests |
| Phase C | Read-only MCP sidecar | `haro mcp` 暴露 read-only tools |
| Phase D | Scheduled sidecar | AgentDock script task 可周期触发 Haro CLI |
| Phase E | Asset registry adapter | 资产事件写入 sidecar store |
| Phase F | Gated apply L0/L1 | proposal + validation + snapshot + rollback gate |

## 架构变更记录

- **2026-05-08**：架构基线切换为 AgentDock Kernel + Haro Sidecar。Haro 不再继续自建完整 workbench/runtime；通过 AgentDock 外部 MCP server 注册、定时任务和 skills/MCP 调用面接入。
- **2026-05-07**：FEAT-034 流式 UX 升级 done。该能力作为历史 workbench 资产保留，不再决定后续主路径。
- **2026-05-06**：FEAT-032 MCP 工具层实现交付。permission / timeout / audit 经验保留，tool 语义后续迁移到 Haro sidecar。
- **2026-05-06**：FEAT-031 Web Channel 实现交付。后续冻结为历史 channel 资产。
- **2026-05-01**：双层架构（workbench + 进化）+ 三层解耦重写。该路线已归档，见 `docs/planning/archive/redesign-2026-05-01.md`。
