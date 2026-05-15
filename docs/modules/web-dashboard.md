# Haro Web Proposal Review Workbench

> **2026-05-14 状态：Haro Web 已从历史 Dashboard 收缩为提案 Review 工作台。**
>
> Haro 的主定位是 AgentDock self-evolution sidecar。AgentDock 负责 runtime / workbench / IM / memory；Haro Web 不再提供 chat、agent run、config、memory、skill、logs、provider、session 等通用控制面，但承载 Haro 自己的每日 frontier intake 调度和 proposal review。

## 目标

Haro Web 只解决一个问题：当 Haro 自动生成需要人审的 `ApprovalRequestRecord` 时，维护者可以像看 issue 一样查看提案并作出决策。

每个提案必须清楚展示：

- 为什么改（whyChange）
- 怎么改（howChange）
- 预期收益（expectedBenefits）
- 风险等级、回归风险、必须测试、人工检查
- rollback plan
- reviewer instruction

维护者可以给出三类决策：

| 决策 | 行为 |
| --- | --- |
| approve | 写入 `approval-decisions/*.json`，并向对应 proposal 追加 `human-approval` ref |
| reject | 写入 decision，并把对应 proposal 标记为 `rejected` |
| request-changes | 写入带 direction 的 decision，把当前 proposal 标记为 `superseded`，要求 Haro 后续按方向重做 proposal |

## 组成

| 层 | 路径 | 职责 |
| --- | --- | --- |
| 前端 | `packages/web/` | React + Vite + Tailwind。只保留 login/bootstrap、layout、theme toggle、proposal review list/cards。 |
| 后端 | `packages/web-api/` | Hono app。只挂载 `/api/health`、`/api/v1/auth`、`/api/v1/approval-requests`、`/api/v1/daily-frontier/status`。 |
| CLI | `packages/cli/src/index.ts` | `haro web --port <n> --host <addr>` 薄启动器，只启动 review Web 与 Haro-owned daily frontier scheduler，不启动 channels/runtime。 |

## API surface

```http
GET  /api/health
GET  /api/v1/auth/status
POST /api/v1/auth/bootstrap
POST /api/v1/auth/login
GET  /api/v1/auth/me
POST /api/v1/auth/logout

GET  /api/v1/approval-requests?status=pending|decided|all
GET  /api/v1/approval-requests/:id
POST /api/v1/approval-requests/:id/decision
GET  /api/v1/daily-frontier/status
```

`POST /decision` body:

```json
{
  "decision": "approve | reject | request-changes",
  "direction": "request-changes 时必填"
}
```

## 数据边界

Haro Web 只读写 Haro sidecar-owned evolution store：

```text
~/.haro/evolution/
├── approval-requests/
├── approval-decisions/
└── proposals/
```

它不写 AgentDock DB、不写 AgentDock memory、不启动 Haro runner、不接管任何 IM channel。每日外部情报收集由 Haro Web 托管服务内的轻量 scheduler 触发，不需要修改 AgentDock 代码。

每日 frontier scheduler 的环境变量：

```bash
HARO_DAILY_FRONTIER_ENABLED=1
HARO_DAILY_FRONTIER_CRON="0 2 * * *"                    # 默认每天 02:00
HARO_DAILY_FRONTIER_SOURCE_CONFIG="$HARO_HOME/frontier-sources.json"
HARO_DAILY_FRONTIER_COLLECT_COMMAND="<optional command>" # 可选：输出 FrontierSignal JSON 到 stdout
HARO_DAILY_FRONTIER_HARO_CMD="haro"                      # 可选：覆盖 haro CLI 命令
```

每次运行会顺序执行：

```text
optional collect command -> haro intake frontier -> haro observe -> haro propose --include-frontier -> haro validate -> haro approval-request
```

运行记录写入 `~/.haro/evolution/daily-frontier-runs/*.json`；前端只展示启用状态、下次运行时间和最近运行结果，不提供通用 cron 管理。

`approval-decisions/*.json` 由共享 `ApprovalDecisionRecord` contract 校验。后续 `haro apply --proposal-id` 会消费这些 decision：

- `approve`：补齐 proposal `humanApprovalRefs`，通过 human-review gate 后继续进入 snapshot/content/apply gate。
- `reject`：把 proposal 标记为 `rejected`，apply 返回 `APPROVAL_REJECTED`。
- `request-changes`：把 proposal 标记为 `superseded`，apply 返回 `CHANGES_REQUESTED` 并携带 reviewer direction。

## 已删除的历史 Dashboard 能力

以下能力属于旧 Haro workbench 路线，已从当前代码面删除或下线：

- Web Chat / Web Channel / WebSocket streaming
- Agent CRUD / run
- Sessions UI/API
- 通用 Cron HTTP management
- Channel / Gateway management
- Provider / monitor / invocation stats
- Logs / Knowledge / Memory pages
- Skills management pages
- Generic config editor
- Web user management UI/API
- Workflow dispatch debugger UI
- i18n / pagination / chat streaming UI infrastructure

保留最小 Web auth 是为了保护 proposal review decision；不代表 Haro Web 重新成为通用控制面。

## 与 AgentDock 审批路径的关系

Haro Web review 与 AgentDock/飞书中的审批呈现是并行入口：

- Haro Web hosted daily frontier loop 负责周期生成 frontier signal / proposal / validation / approval request。
- AgentDock 可以通过 MCP/skill/IM 把 approval request 发给用户审批。
- Haro Web 可以直接查看同一批 approval request artifacts。
- 所有 apply 仍必须经过 validation + human approval refs + snapshot/rollback gate；reject/request-changes 会在进入后续 gate 前 fail closed。

## 启动

```bash
pnpm -F @haro/web build
haro web --port 3456 --host 127.0.0.1
```

源码开发：

```bash
pnpm dev:web
```
