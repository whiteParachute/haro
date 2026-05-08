# AgentDock Kernel + Haro Sidecar Architecture

Status: draft
Date: 2026-05-08

## 结论

Haro 不再继续自建完整 workbench/runtime。新的项目定位是：

```text
agent-dock
  独立运行的 agent runtime / workbench
  负责 Session、Runner、Memory Agent、MCP、IM、Scheduler、Web/PWA 体验

haro
  可插拔的 self-evolution sidecar
  通过 MCP server、定时任务、只读观测和少量可写配置入口接入 AgentDock
```

依赖方向只能是：

```text
haro -> AgentDock public API / MCP / event export / filesystem contract
```

AgentDock 不能 import Haro。Haro 也不能 import AgentDock 的内部 `src/*` 模块。这样 AgentDock 层可以持续吸收外部或上游改动，Haro 只围绕稳定 contract 做自进化能力。

## 背景

Haro 原设计把 workbench 和 self-evolution 放在同一个项目中：

- Workbench: CLI / Web Channel / Feishu / Telegram / Agent Runtime / Memory / Skills / MCP / Cron。
- Evolution: Self-Monitor / Industry Intel / Pattern Miner / Proposal / Auto-Refactorer。

现在判断是，workbench/runtime 与 AgentDock 的现有主线高度重叠。继续在 Haro 内维护一套 Provider、Channel、Session runtime、Web API、CLI 等价能力，会让 Haro 的差异化被基础设施消耗掉。

Haro 的差异化应该集中在：

- 观察 AgentDock 的真实使用数据。
- 生成进化提案。
- 验证提案风险、测试计划和回滚路径。
- 资产化 prompt / skill / rule / memory / tool config。
- 在安全边界内执行 L0/L1 级自进化。

## 设计原则

1. **AgentDock 完整可独立运行**
   Haro 插上去增强自进化能力；拔掉以后 AgentDock 仍然是完整 workbench。

2. **Haro 是 sidecar，不是 fork**
   Haro 不能污染 AgentDock runtime 主链路，也不要求 AgentDock 为 Haro 引入深度插件系统。

3. **MCP 是主动交互面**
   Agent 可以显式调用 Haro 暴露的 MCP tools 来观察、提案、验证、登记资产或执行受控变更。

4. **定时任务是后台驱动面**
   周期性 observe/propose/maintain 不依赖普通聊天上下文，不要求 agent 每次记得调用 Haro。

5. **contract 优先于内部依赖**
   两个项目之间只通过 schema、API、MCP tool contract、文件目录约定和 capability version 协作。

6. **先只读，后可写**
   Haro 初期只观察和生成 dry-run proposal；确认 contract 和验证门稳定后，再开放 L0/L1 apply。

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

### 3. 只读观测接口

Haro 至少需要读取这些信息：

- sessions
- messages / turns
- runner id / model / profile
- tool calls and results
- scheduled task runs
- memory wrapup / global sleep logs
- runner errors / recoverable errors
- usage records

初期可以通过 AgentDock 已有 API、DB export、日志目录或只读文件约定实现。后续再收敛为稳定 `event export` 或 `event stream`。

### 4. 受控可写入口

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
| `haro_asset_register` | 登记 prompt/skill/rule/memory/tool config 为资产 | write-haro |
| `haro_asset_query` | 查询资产、事件、版本和效果 | read-only |
| `haro_apply` | 应用 L0/L1 变更 | gated-write |
| `haro_rollback` | 回滚已应用的 L0/L1 变更 | gated-write |

`haro_apply` 默认只接受 dry-run proposal id，不接受自由文本改动。

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
- memory entries
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

### 流程 B：自动提案 dry-run

```text
AgentDock scheduler
  -> script task: haro propose --auto-dry-run
  -> Haro consumes observations + asset history
  -> Haro writes proposal
  -> Haro does not apply changes
```

### 流程 C：Agent 主动调用 Haro

```text
Agent in AgentDock session
  -> calls haro_observe
  -> calls haro_propose
  -> calls haro_validate
  -> sends summary to user through normal AgentDock channel
```

### 流程 D：受控应用

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

- Memory Fabric v2 的文件模型、pending merge、wrapup/sleep、snapshot recover 经验。
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
- 暂不改 runtime 代码。

### Phase 1: Contract Skeleton

- 新增 `@haro/agentdock-contract` 或等价内部模块。
- 定义 AgentDock connection、observation、proposal、validation、asset event schema。
- 添加 fake AgentDock source，用于 Haro 单测。

### Phase 2: Haro MCP Server

- 实现 `haro mcp` stdio server。
- 暴露 `haro_observe`、`haro_propose`、`haro_validate`、`haro_asset_query`。
- 首批 tools 全部 read-only。

### Phase 3: Scheduled Sidecar

- 实现 `haro connect agent-dock`。
- 实现 `haro observe --since last`。
- 实现 `haro propose --auto-dry-run`。
- 通过 AgentDock script scheduled task 周期触发。

### Phase 4: Asset Registry Adapter

- 将 Haro Evolution Asset Registry 迁到 sidecar 数据目录。
- skill/prompt/profile/task config 的变更全部登记资产事件。

### Phase 5: Gated Apply

- 实现 L0/L1 `haro_apply`。
- 增加 snapshot / rollback。
- 增加 validation gate：无 validation report 不允许 apply。

## Acceptance Criteria

- AgentDock 不 import Haro，Haro 不 import AgentDock 内部源码。
- Haro 可以作为外部 MCP server 注册到 AgentDock。
- Haro 可以通过 AgentDock 定时任务周期执行 observe/propose。
- Haro 能基于真实 AgentDock 状态生成 dry-run proposal。
- Haro 的所有资产变更写入独立 Evolution Asset Registry。
- L0/L1 apply 有 proposal、validation、snapshot、rollback ref。
- AgentDock 升级时，只需要跑 Haro contract tests 判断兼容性。

## Open Questions

- AgentDock 观测源第一版走 API、DB 只读、日志目录，还是新增 event export？
- Haro apply L1 时，AgentDock skill/profile/task config 的最小稳定写入口是什么？
- Haro 是否需要自己的轻量 Web UI，还是全部通过 AgentDock session + MCP tool 交互？
- contract version 由 AgentDock 暴露，还是 Haro 自己通过 capability probe 推断？
