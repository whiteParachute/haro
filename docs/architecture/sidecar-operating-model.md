# Haro Sidecar Operating Model

## 目标

Haro 是 AgentDock 的 self-evolution sidecar，不是第二套 workbench。它通过 AgentDock 已有能力运行：

1. **外部 MCP server 注册**：AgentDock 把 `haro mcp` 注册为普通 MCP server，Agent 在 session 中显式调用 `haro_observe` / `haro_propose` / `haro_validate` / `haro_asset_query`。
2. **AgentDock 定时任务**：AgentDock scheduler/script task 周期执行 Haro CLI，完成后台 observe / propose / validate / intake。
3. **AgentDock skills / workflow 编排**：已有 skills 负责任务入口、用户汇报和审批，不新增 Haro 专用 AgentDock 内部插件链路。

Haro 的核心职责是把内部使用信号、Haro 自身运行信号和外部前沿情报统一为可审计 observation，再生成可验证、可回滚的自优化建议；所有改动必须在审批和 validation gate 之后执行。

## 总体闭环

```text
AgentDock runtime + Haro sidecar + external frontier sources
  -> Observe: collect internal usage, sidecar health, frontier intelligence
  -> Orient: correlate failures, usage patterns, asset history, external trends
  -> Propose: produce evolution proposals with evidence and target scope
  -> Validate: adversarial review, risk level, test plan, rollback plan
  -> Approve: user / maintainer approval through AgentDock channel
  -> Apply: gated L0/L1 direct apply or L2/L3 patch branch
  -> Learn: record result as asset/application event for the next cycle
```

Haro 不把“最新趋势”直接变成代码改动。外部情报只能成为 proposal evidence；是否执行仍由风险分级、验证和审批决定。

## 信号源

### 1. AgentDock 内部使用信号

Haro 通过 AgentDock public API / MCP / event export / filesystem contract 读取，不 import AgentDock 内部 `src/*`：

| 信号面 | 关注点 | 典型优化方向 |
| --- | --- | --- |
| Runner / model / profile | 模型选择、runner 错误、超时、上下文压缩、工具循环表现 | runner profile、模型路由、重试策略、上下文预算 |
| Web / PWA | 页面使用路径、运行状态可见性、工具 timeline、错误暴露 | Web UX、状态解释、debug 信息结构化 |
| 消息端 / IM | Feishu/Telegram/Web 消息投递、回复延迟、用户等待、附件处理 | 显式 `send_message` 习惯、进度提示、消息路由规则 |
| MCP / tools | tool call 成功率、权限拒绝、超时、schema 错误 | tool 描述、超时、权限分级、错误 remediation |
| Scheduler / tasks | 定时任务成功率、重试、卡住、脚本输出 | task template、cron 频率、health check、失败告警 |
| Memory | AgentDock memory query/remember/wrapup 引用与效果 | memory 查询触发策略、摘要质量、去重；Haro 不维护自有 MemoryFabric |
| Skills / workflows | skill 触发率、完成率、人工干预点 | skill 描述、routing rule、workflow guard |

### 2. Haro 自身组件信号

Haro 也必须观察 sidecar 自身，而不是只观察 AgentDock：

| 组件 | 观测内容 | 典型优化方向 |
| --- | --- | --- |
| Haro MCP server | tool latency、error code、schema mismatch、audit log | MCP schema、error mapping、tool contract |
| Scheduled CLI | connect/observe/propose/validate 退出码、cursor、lock、重复消费 | CLI 幂等、cursor 策略、doctor/status 输出 |
| Evolution Store | observation/proposal/validation/application 数量和状态 | retention、索引、schema migration |
| Asset Registry | asset event 生命周期、rollback metadata、superseded/archived 比例 | eat/shit 策略、资产去重、rollback 可用性 |
| Gated Apply | apply 成功率、rollback 成功率、validation 阻断原因 | apply gate、测试模板、审批提示 |

### 3. 外部前沿情报

Haro 需要持续吸收 agent 演进方向，但只能把外部内容作为带来源的 evidence：

| 来源类型 | 示例 | 进入 Haro 的形式 |
| --- | --- | --- |
| X / 社交短讯 | agent 架构、产品发布、实践经验 | source ref + 摘要 + 作者/时间 + 置信度 |
| YouTube / 公开视频 | demo、talk、engineering deep dive | transcript/summary ref + 关键观点 + 适用边界 |
| 论文 / preprint | agent memory、tool use、planning、eval、multi-agent | paper metadata + 摘要 + 方法/限制 |
| 开源仓库 / release notes | runner、MCP、agent framework、browser/workbench 变化 | repo/ref + release diff summary |
| 官方文档 / blog | 平台 API、模型能力、MCP/spec 变化 | doc URL + version/date + migration note |
| benchmark / eval report | coding agent、tool-use、web agent、memory eval | metric ref + 可迁移判断 |

外部情报约束：

- 必须记录 source ref、抓取时间、发布时间或版本信息；不能把无来源结论当成事实。
- 不抓取私有、付费墙、违反来源条款或需要未授权凭据的内容。
- 不因单条社交媒体观点直接生成 apply；至少进入 proposal + validation。
- 过期或被证伪的情报通过 asset/event 状态标记为 `superseded` / `rejected`。

## Proposal 目标域

Haro 生成的 proposal 必须明确目标域和风险级别：

| 目标域 | 可建议内容 | 默认风险级别 |
| --- | --- | --- |
| Runner / model routing | profile 默认值、模型选择规则、重试/压缩策略 | L1；涉及 runner code 为 L3 |
| Web / PWA | 状态可见性、错误解释、操作入口、review 可观测性 | L1；涉及前端代码为 L3 |
| 消息端 / IM | 进度提示模板、回复路由、附件处理规范 | L0/L1；channel runtime 代码为 L3 |
| Memory | query/remember 触发准则、摘要模板、去重规则 | L0/L1；Haro 不写 memory store |
| MCP/tools | tool 描述、schema、timeout、permission hints | L1；MCP runtime 代码为 L3 |
| Scheduler/tasks | script task 模板、cron 频率、失败重试策略 | L1 |
| Skills/workflows | skill 描述、routing rules、workflow guard | L0/L1 |
| Haro sidecar | CLI/MCP contract、proposal/validation 规则、asset registry | L2；需要 patch branch |
| AgentDock kernel | public API/event export/contract 变更 | L3；必须人工决策 |

## 审批与执行规则

| Level | 范围 | 执行方式 |
| --- | --- | --- |
| L0 | prompt 文案、skill 描述、说明性配置默认值 | validation 通过 + 用户审批后可由 Haro apply |
| L1 | skill 文件、runner profile、schedule/routing config、MCP tool config | validation + snapshot + rollback + 用户审批后可由 Haro apply |
| L2 | Haro sidecar 代码 | 生成 patch branch / commit / test report，不通过 MCP 直接 apply |
| L3 | AgentDock kernel 代码或跨项目 contract | 生成 proposal + patch branch + 人工决策；不得自动落地主分支 |

审批必须通过 AgentDock 原有 channel 呈现，Haro 不直接接管 IM/Web 输出。每次 apply 后必须写 application event、asset event 和 rollback ref。

## 与现有 specs 的对应关系

| 能力 | Spec |
| --- | --- |
| AgentDock contract / observation schema | [FEAT-043](../../specs/sidecar/FEAT-043-agentdock-contract-skeleton.md) |
| Read-only MCP sidecar | [FEAT-044](../../specs/sidecar/FEAT-044-read-only-mcp-sidecar.md) |
| Scheduled CLI observe/propose/validate | [FEAT-045](../../specs/sidecar/FEAT-045-scheduled-sidecar-cli.md) |
| Asset registry and rollback metadata | [FEAT-046](../../specs/sidecar/FEAT-046-sidecar-asset-registry-adapter.md) |
| Gated apply L0/L1 | [FEAT-047](../../specs/sidecar/FEAT-047-gated-apply-l0-l1.md) |
| External frontier intelligence intake | [FEAT-048](../../specs/sidecar/FEAT-048-frontier-intelligence-intake.md) |
