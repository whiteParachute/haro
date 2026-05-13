# AgentDock Kernel + Haro Sidecar Architecture

Status: draft / new baseline
Date: 2026-05-08

## 结论

Haro 不再继续自建完整 workbench/runtime。新的项目定位是：

```text
agent-dock
  独立运行的 agent runtime / workbench
  负责 Session、Runner、Memory Agent、MCP、IM、Scheduler、Web/PWA 体验

haro
  可插拔的 self-evolution sidecar
  通过 MCP server、定时任务、skills 编排、只读观测和少量可写配置入口接入 AgentDock
```

依赖方向只能是：

```text
haro -> AgentDock public API / MCP / event export / filesystem contract
```

AgentDock 不能 import Haro。Haro 也不能 import AgentDock 的内部 `src/*` 模块。这样 AgentDock 层可以持续吸收外部或上游改动，Haro 只围绕稳定 contract 做自进化能力。

## 背景

Haro 原设计把 workbench 和 self-evolution 放在同一个项目中：

- Workbench: CLI / Web Channel / Feishu / Telegram / Agent Runtime / Memory / Skills / MCP / Cron（历史基线）。
- Evolution: Self-Monitor / Industry Intel / Pattern Miner / Proposal / Auto-Refactorer。

现在判断是，workbench/runtime 与 AgentDock 的现有主线高度重叠。继续在 Haro 内维护一套 Provider、Channel、Session runtime、Web API、CLI 等价能力，会让 Haro 的差异化被基础设施消耗掉。

Haro 的差异化应该集中在：

- 观察 AgentDock 的真实使用数据。
- 观察 Haro sidecar 自身 MCP / CLI / Evolution Store / Asset Registry 的运行质量。
- 从 X、YouTube、论文、开源仓库 release notes、官方文档、benchmark 等来源摄入 agent 前沿情报。
- 生成进化提案。
- 验证提案风险、测试计划和回滚路径。
- 资产化 prompt / skill / rule / tool config；memory 由 AgentDock 侧提供，Haro 只引用 observation refs。
- 在安全边界内执行 L0/L1 级自进化。

## 设计原则

1. **AgentDock 完整可独立运行**
   Haro 插上去增强自进化能力；拔掉以后 AgentDock 仍然是完整 workbench。

2. **Haro 是 sidecar，不是 fork**
   Haro 不能污染 AgentDock runtime 主链路，也不要求 AgentDock 为 Haro 引入深度插件系统。

3. **MCP 是主动交互面**
   AgentDock 通过已有外部 MCP server 注册能力加载 `haro mcp`。Agent 可以显式调用 Haro 暴露的 MCP tools 来观察、提案、验证、登记资产或执行受控变更。

4. **定时任务是后台驱动面**
   周期性 observe/propose/maintain 通过 AgentDock 已有 scheduler / script task 触发，不依赖普通聊天上下文，不要求 agent 每次记得调用 Haro。

5. **skills 是编排辅助面**
   AgentDock 已有 skills / workflow 能力可以编排 Haro MCP tools 或 Haro CLI。Haro 不因此成为 AgentDock 内部插件，也不接管 AgentDock session。

6. **contract 优先于内部依赖**
   两个项目之间只通过 schema、API、MCP tool contract、event export、文件目录约定和 capability version 协作。

7. **先只读，后可写**
   Haro 初期只观察和生成 dry-run proposal；确认 contract 和验证门稳定后，再开放 L0/L1 apply。

8. **外部情报必须证据化**
   X、YouTube、论文、release notes 等外部信号只作为带 source ref 的 evidence。任何基于外部趋势的建议，都必须进入 proposal / validation / approval / rollback gate。

## 接入方式约束

Haro 接入 AgentDock 只走三条现有能力，不新增第四条主链路：

| 接入面 | AgentDock 已有能力 | Haro 使用方式 | 禁止事项 |
| --- | --- | --- | --- |
| MCP server 注册 | 外部 MCP server 管理 | 注册 `haro mcp`，暴露 observe/propose/validate/query tools | 不在 AgentDock 内部 import Haro |
| 定时任务 | scheduler + script task | 周期执行 `haro observe/propose/validate` | 不把后台维护塞进普通聊天上下文 |
| skills / agent 编排 | AgentDock skills + MCP 调用面 | 在 session 中显式调用 Haro tools 并通过原 channel 汇报 | Haro 不直接接管 IM/Web/Runner/Memory 主链路 |

这三条接入面都属于 AgentDock 已有能力。Haro 的实现目标是适配这些能力，而不是要求 AgentDock 为 Haro 引入深度插件系统。

## AgentDock 侧最小要求

AgentDock 不需要内嵌 Haro。只需要保持这些能力稳定：

### 1. 外部 MCP server 注册

AgentDock 当前已有外部 MCP server 管理入口，支持 stdio / http / sse 配置。Haro 应作为一个普通外部 MCP server 注册，例如：

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

已确认的 AgentDock 接入点：

- `src/routes/mcp-servers.ts` 支持新增、启用、禁用外部 MCP server。
- `src/runtime-runner.ts` 会把用户配置的 MCP servers 合入 runner settings/env。

### 2. 定时任务

AgentDock 现有 scheduler 可以触发 agent task，也可以执行 script task。Haro 的后台维护应优先用 script task：

```bash
haro observe --agentdock-url http://127.0.0.1:3000 --since last
haro propose --auto-dry-run
haro validate --pending
```

原因：

- 后台维护不依赖聊天上下文。
- 失败可以写结构化日志并重试。
- 不会把自进化流程混进普通 session。

### 3. AgentDock skills / agent 编排

AgentDock 普通 session 中，agent 可以通过已有 skills / MCP 调用面主动使用 Haro：

```text
AgentDock session
  -> calls haro_observe / haro_propose / haro_validate
  -> sends summary to user through AgentDock channel
```

Haro 不直接发送 IM，不绕过 AgentDock channel，不持有 AgentDock session lifecycle。

### 4. 只读观测接口

Haro 至少需要读取这些信息：

- sessions
- messages / turns
- runner id / model / profile
- tool calls and results
- scheduled task runs
- AgentDock memory activity refs（只读/引用）
- Web/PWA 状态与操作路径
- IM/message routing 与用户等待信号
- runner errors / recoverable errors
- usage records
- Haro MCP/CLI/Evolution Store/Asset Registry 自身健康信号
- 外部前沿情报 refs（X / YouTube / paper / release / doc / benchmark）

初期可以通过 AgentDock 已有 API、DB export、日志目录或只读文件约定实现。后续再收敛为稳定 `event export` 或 `event stream`。

### 5. 受控可写入口

Haro apply 阶段只允许改这些低风险对象：

- Haro 自己的 evolution DB / asset registry。
- AgentDock 可扫描的 skill 目录。
- AgentDock runner profile / prompt / task config。
- Haro MCP server 自身配置。

代码级修改不通过 MCP tool 直接落地。代码级自进化必须生成 proposal、patch branch、验证报告和回滚计划。

## Haro 侧组件

### 1. Haro MCP Server

Haro 对 AgentDock 暴露一组 MCP tools：

| Tool | 作用 | 初期权限 |
| --- | --- | --- |
| `haro_observe` | 收集 AgentDock 当前状态或增量状态 | read-only |
| `haro_propose` | 基于观察结果生成 evolution proposal | read-only |
| `haro_validate` | 验证 proposal 风险、测试计划、回滚路径 | read-only |
| `haro_asset_query` | 查询资产、事件、版本和效果 | read-only |
| `haro_asset_register` | 登记 prompt/skill/rule/tool config 为资产 | write-haro，Phase 4 后开放；memory 不登记为 Haro asset |
| `haro_apply` | 应用 L0/L1 变更 | gated-write，Phase 5 后开放 |
| `haro_rollback` | 回滚已应用的 L0/L1 变更 | gated-write，Phase 5 后开放 |

首批 MCP tools 只开放 `haro_observe`、`haro_propose`、`haro_validate`、`haro_asset_query`。`haro_apply` 默认只接受 dry-run proposal id，不接受自由文本改动。

### 2. Haro Daemon / Scheduled CLI

Haro 需要支持无交互后台命令：

```bash
haro connect agent-dock --base-url http://127.0.0.1:3000
haro observe --since last
haro propose --auto-dry-run
haro validate --pending
haro status
haro doctor
```

这些命令可以被 AgentDock script task 定期调用，也可以由用户手动运行。

### 3. Evolution Store

Haro 自己维护独立数据目录，不写入 AgentDock DB：

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

AgentDock 数据是被观察对象，不是 Haro 的内部状态。

### 4. Asset Registry

保留 Haro 已有 Evolution Asset Registry 思路，用于统一管理：

- skills
- prompts
- runner profiles
- routing / task rules
- AgentDock memory observation refs
- MCP tool configs
- archives

每个资产必须有：

- stable id
- kind
- version
- source ref
- content ref
- content hash
- status
- events
- rollback metadata

## 交互流程

### 流程 A：后台观察

```text
AgentDock scheduler
  -> script task: haro observe --since last
  -> Haro reads AgentDock observation source
  -> Haro writes ~/.haro/evolution/observations/*
  -> Haro updates cursor
```

### 流程 B：外部情报 intake

```text
AgentDock scheduler
  -> script task: haro intake frontier --since last
  -> Haro reads configured public/approved sources
  -> Haro writes frontier signal records with source refs
  -> Haro does not apply changes
```

### 流程 C：自动提案 dry-run

```text
AgentDock scheduler
  -> script task: haro propose --auto-dry-run --include-frontier
  -> Haro consumes AgentDock observations + Haro self signals + frontier signals + asset history
  -> Haro writes proposal
  -> Haro does not apply changes
```

### 流程 D：AgentDock skills / Agent 主动调用 Haro

```text
AgentDock skill / AgentDock session
  -> calls haro_observe
  -> calls haro_propose
  -> calls haro_validate
  -> sends summary to user through normal AgentDock channel
```

这里的 skills 是 AgentDock 现有编排面。Haro 不新增 AgentDock 内部 skill runtime，也不改变 AgentDock skill 加载机制。

### 流程 E：受控应用

```text
User approves proposal
  -> Agent calls haro_apply({ proposalId })
  -> Haro checks proposal status and validation report
  -> Haro snapshots target asset/config
  -> Haro applies L0/L1 change
  -> Haro records application event and rollback ref
```

## 自进化分级

| Level | 范围 | 是否允许 MCP apply |
| --- | --- | --- |
| L0 | prompt 文案、skill 描述、配置默认值 | 允许，需 proposal + validation |
| L1 | skill 文件、runner profile、schedule/routing config | 允许，需 snapshot + rollback |
| L2 | Haro sidecar 代码 | 不直接 apply，生成 patch branch |
| L3 | AgentDock kernel 代码或跨项目 contract | 不直接 apply，必须人工决策 |

## Haro 旧模块处理

### 保留

- AgentDock Memory Agent / memory MCP 接入经验：Haro 只读取或引用 AgentDock 暴露的记忆，不维护自有 Memory Fabric。
- MCP tools 的 permission / timeout / audit 守门链。
- Evolution Asset Registry。
- eat/shit 代谢思想。
- Evolution Proposal / Validation / Auto-Refactorer specs 中与 sidecar 相关的部分。

### 降级

- CLI 等价：从产品目标降级为 admin/debug surface。
- Web API：从主产品面降级为可选控制面。
- Scenario Router / Team Orchestrator：冻结，后续只保留能服务 validation 的部分。

### 废弃主路径

- Haro 自建 Provider 抽象。
- Haro 自建 Channel 抽象。
- Haro 自建 Session runtime。
- Haro 内部 workbench 主链路。

## Implementation Plan

### Phase 0: 存档与文档

- 创建 main 存档分支。
- 新建 feature 分支。
- 落地本文档。
- 改写 README / roadmap / architecture overview，让 sidecar 定位成为唯一新基线。
- 先完成文档基线；后续允许删除确定不需要的历史代码/文档，保持 sidecar 边界。

### Phase 1: Contract Skeleton

- 新增 `@haro/agentdock-contract` 或等价内部模块。
- 定义 AgentDock connection、observation、proposal、validation、asset event schema。
- 添加 fake AgentDock source，用于 Haro 单测。

### Phase 2: Haro MCP Server

- 实现 `haro mcp` stdio server。（已完成首版）
- 暴露 `haro_observe`、`haro_propose`、`haro_validate`、`haro_asset_query`。（已完成首版）
- 首批 tools 全部 read-only，且 sidecar 启动不创建 Haro-owned MemoryFabric / `$HARO_HOME/memory`。

### Phase 3: Scheduled Sidecar

- `haro connect agent-dock` 已实现：保存 AgentDock HTTP connection。
- `haro observe --since last` 已实现：复用 HTTP observation source，写入 `~/.haro/evolution/observations/` 并更新 base64url-encoded connection cursor；去重与锁均按 connection 隔离。
- `haro propose --auto-dry-run` 已实现：读取未消费 observation batches，写入 `~/.haro/evolution/proposals/` dry-run proposal；source refs 作为 consumption marker，重复运行幂等；`--limit` 限制单次 proposal 打包的 observation batch 数，损坏 observation/proposal 会在 JSON 结果和 stderr warning 中显式暴露。
- `haro validate --pending` 已实现：读取未验证 pending proposals，写入 `~/.haro/evolution/validations/` advisory validation report；已有 validation report 作为 consumption marker，重复运行幂等；`--limit` 限制单次处理的 pending proposal 数，损坏 proposal/validation 会在 JSON 结果和 stderr warning 中显式暴露。
- `haro status` 已实现：在现有 top-level status 中增加 sidecar 段，汇总 connection、cursor、observation、frontier signal、proposal、validation 计数和 corrupt 文件计数；只读 sidecar evolution store，不读取或写入 memory。
- `haro doctor --component sidecar` 已实现：检查 HARO_HOME/sidecar store 写权限、connection 配置、AgentDock `/api/health` reachability、schema/corrupt artifacts（含 frontier signals），并输出修复建议；默认 `haro doctor` 也包含 sidecar stage；不读取或写入 memory。
- Phase D 核心闭环完成；下一步进入 Phase E（frontier signal intake + sidecar asset registry）或补更细的 doctor 自动修复。
- 通过 AgentDock script scheduled task 周期触发。

### Phase 4: Frontier Intelligence Intake

- `FrontierSignal` schema 已定义在 `@haro/agentdock-contract`，覆盖 source type、source ref、summary、claims、target domains、confidence、status。
- `haro intake frontier --source-config <file> --since last --json` 第一段已实现：读取 curated `FrontierSignal[]` / `{ signals: [...] }` source config，按 sourceRef 去重，写入 `~/.haro/evolution/frontier-signals/`，并维护 frontier cursor。
- `haro status` / `haro doctor --component sidecar` 已纳入 frontier signal 计数和 corrupt file 检查。
- 下一步：让 `haro propose --auto-dry-run --include-frontier` 同时引用内部 observation refs 与 active frontier signal refs。

### Phase 5: Asset Registry Adapter

- 将 Haro Evolution Asset Registry 迁到 sidecar 数据目录。
- skill/prompt/profile/task config/frontier source refs 的变更全部登记资产事件。

### Phase 6: Gated Apply

- 实现 L0/L1 `haro_apply`。
- 增加 snapshot / rollback。
- 增加 validation gate：无 validation report 不允许 apply。

## Acceptance Criteria

- AgentDock 不 import Haro，Haro 不 import AgentDock 内部源码。
- Haro 可以作为外部 MCP server 注册到 AgentDock。
- Haro 可以通过 AgentDock 定时任务周期执行 observe/propose/validate。
- Haro 可以被 AgentDock 现有 skills / agent 编排面调用，并通过 AgentDock 原 channel 汇报。
- Haro 能基于真实 AgentDock 状态、Haro 自身信号和外部 frontier signals 生成 dry-run proposal。
- Haro 的所有资产变更写入独立 Evolution Asset Registry。
- L0/L1 apply 有 proposal、validation、snapshot、rollback ref。
- AgentDock 升级时，只需要跑 Haro contract tests 判断兼容性。

## Open Questions

- AgentDock 观测源第一版走 API、DB 只读、日志目录，还是新增 event export？
- 外部前沿情报第一版走官方 API/RSS/search provider，还是由 AgentDock skill 生成 curated refs？
- Haro apply L1 时，AgentDock skill/profile/task config 的最小稳定写入口是什么？
- Haro 是否需要自己的轻量 Web UI，还是全部通过 AgentDock session + MCP tool 交互？
- contract version 由 AgentDock 暴露，还是 Haro 自己通过 capability probe 推断？
