# Haro Web 收缩为 Proposal Review 工作台

## 背景

当前 sidecar 分支已经明确：Haro 只作为 AgentDock 的 self-evolution sidecar，通过 MCP、Haro 托管服务定时任务和 AgentDock skills/agent 编排接入，不再承担通用 agent runtime / workbench。

因此历史 Web Dashboard 中的通用控制面需要清理。Haro 仍可以保留一个极小 Web 端，但职责只限于 **review Haro 自己生成的 proposal / approval request** 和 **承载 Haro 自己的每日 frontier intake 调度**，类似 issue 页面 + sidecar 后台 worker。

## 保留边界

保留：

- Web server 基础能力：静态文件服务、健康检查、最小认证。
- Haro-owned daily frontier scheduler：
  - 每天自动执行 external frontier intake / observe / propose / validate / approval-request。
  - 运行记录写入 `~/.haro/evolution/daily-frontier-runs/`。
  - 不修改 AgentDock 代码，不写 AgentDock DB/memory。
- Approval request review：
  - 列出 `~/.haro/evolution/approval-requests/*.json`
  - 查看 why / how / benefits / risks / tests / rollback
  - 写入 approve / reject / request-changes 决策 artifact
  - approve 时向 proposal 写入 human approval ref
  - reject 时将 proposal 标记为 rejected

## 删除边界

删除 Web 中这些通用 workbench / 控制面能力：

- Dashboard chat / Web Channel
- WebSocket session/event streaming
- Agent CRUD / run / chat
- Session history UI/API
- Cron HTTP 管理
- Channel / Gateway 管理
- Provider / invocation / monitor / logs 页面
- Memory / Knowledge 页面
- Skill 管理页面
- Generic config editor
- Web user management UI/API
- Workflow / dispatch debug UI

说明：CLI / MCP / sidecar scheduled commands 不在本轮删除范围；它们仍是 sidecar 主链路。

## Cleanup pass 顺序

1. **行为锁定**
   - 增加 approval request Web API 测试：list / get / decide。
   - 增加 Web smoke：只渲染 proposal review 入口，不再引用旧 dashboard route。

2. **API 收缩**
   - `packages/web-api` 只挂载 `/api/health`、`/api/v1/auth`、`/api/v1/approval-requests`、`/api/v1/daily-frontier/status`。
   - 删除 WebSocket manager、cron ticker、旧 routes。

3. **前端收缩**
   - `packages/web` 只保留登录/bootstrap、layout、proposal review list/detail。
   - 删除旧 pages/stores/components/api/ws。

4. **测试收缩**
   - 删除旧 dashboard 行为测试。
   - 保留 auth、approval review、server/static smoke。

5. **验证**
   - `pnpm -F @haro/web-api build`
   - `pnpm -F @haro/web build`
   - `pnpm -F @haro/web-api test`
   - `pnpm -F @haro/web test`
   - `pnpm lint`
   - `pnpm build`
   - `pnpm test`
   - `pnpm smoke`

## 非目标

- 不删除 sidecar CLI / MCP / contract。
- 不删除 AgentDock approval path；Haro Web review 与 AgentDock/飞书 review 是并行的人审入口。
- 不恢复 Haro 自有 Memory / workbench 主链路。

## 2026-05-14 执行结果

- `packages/web-api` 已收缩到 health / auth / approval-requests / daily-frontier status 路由。
- `packages/web` 已收缩到 login / bootstrap / proposal review 页面。
- 旧 WebSocket manager、Dashboard routes、chat/session/config/cron/memory/skills/users/workflow pages 和相关 stores/tests 已删除。
- `@haro/channel-web` 包已删除；Haro Web 不再作为 IM channel。
- 验证通过：`pnpm lint`、`pnpm -F @haro/web lint`、`pnpm build`、`pnpm test`、`pnpm smoke`、`git diff --check`。

## 2026-05-15 设计修正

- 每日外部信息收集不应依赖用户每天说“去 X 平台收集”，也不应通过新增 AgentDock 代码实现。
- Haro Web 托管服务内置 `HARO_DAILY_FRONTIER_ENABLED=1` 后台调度，按 cron 自动串联 `intake frontier → observe → propose → validate → approval-request`。
- AgentDock 仍只作为 sidecar 交互底座：MCP、skills/agent 编排、IM 呈现可复用，但不新增 AgentDock 内置 Haro scheduler 代码。
