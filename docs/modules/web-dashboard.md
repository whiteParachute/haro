# Web Dashboard 设计

## 概述

Web Dashboard 是 Haro 的可视化呈现层。FEAT-015 交付的是基础框架：`packages/web` 前端包、嵌入在 CLI 内的 Hono HTTP 服务，以及 `haro web` 启动命令。该模块遵守可插拔原则，不改动 `packages/core` 的执行语义；关闭或移除 Dashboard 后，既有 CLI 命令仍独立工作。

## 组成

| 层 | 路径 | 职责 |
| --- | --- | --- |
| 前端 | `packages/web/` | React 19 + Vite 8 + Tailwind 4 + shadcn/ui 风格组件，提供 Dashboard shell、首页、Chat、Sessions、Session Detail、主题切换、API/WS client 与 auth/chat/session stores。 |
| 后端 | `packages/cli/src/web/` | Hono app factory、API key 认证中间件、Agents/Sessions REST、`/ws` WebSocket 协议、HTTP server 启停、生产静态文件服务。 |
| CLI | `packages/cli/src/index.ts` | 通过 `registerCommand()` 注册 `haro web`，支持 `--port` 与 `--host`。 |
| 根脚本 | `package.json` | `pnpm dev:web` 同时启动 Vite dev server 与 Hono API server。 |

## 开发模式

```bash
pnpm dev:web
```

- 前端：Vite dev server 固定使用 `http://127.0.0.1:5173`
- 后端：Hono API server 固定使用 `http://127.0.0.1:3456`
- Vite proxy：`/api` → `http://localhost:3456`
- 健康检查：访问 `http://127.0.0.1:5173/api/health` 会经 Vite proxy 转发到 Hono，返回 `service=haro-web` 与 `status=ok`

根脚本使用 `concurrently -k`，任一进程失败时会停止另一侧，避免开发服务器残留。

## 生产模式

```bash
pnpm -F @haro/web build
pnpm -F @haro/cli exec haro web --port 3456 --host 127.0.0.1
```

生产模式由 Hono 直接 serve `packages/web/dist/`：

- `GET /` 返回 Dashboard HTML，占位首页挂载在 `<div id="root"></div>`
- `GET /assets/*.js` 与 `GET /assets/*.css` 返回 Vite 构建产物
- `GET /chat`、`GET /sessions`、`GET /status` 等 BrowserRouter 深链会 fallback 到
  `index.html`，便于直接打开或刷新客户端路由
- `GET /api/health` 返回基础健康检查 JSON
- `GET /api/v1/agents` / `GET /api/v1/agents/:id` 返回 Agent 只读 read-model；列表仅暴露 `id`、`name`、`summary`、`defaultProvider`、`defaultModel`，详情额外暴露 `systemPrompt` 与 `tools`
- `POST /api/v1/agents/:id/run` 与 `/chat` 使用严格请求体 schema，未知字段返回 400；执行事件通过 `/ws` 推送
- `GET /api/v1/sessions`、`GET /api/v1/sessions/:id`、`GET /api/v1/sessions/:id/events`、`DELETE /api/v1/sessions/:id` 提供 session 浏览、详情与删除能力
- `GET /api/v1/status` 返回系统概览：SQLite/FTS5、session 统计、provider health、Channel 只读健康摘要（`id/enabled/health/lastCheckedAt/config`）
- `GET /api/v1/doctor` 返回按 filesystem/database/config/providers/channels 分组的 doctor 报告；Channel 分组仅诊断展示，不提供 lifecycle 操作
- `GET /api/v1/config`、`PUT /api/v1/config`、`GET /api/v1/config/sources` 提供合并配置、项目级 `.haro/config.yaml` 写入、字段来源展示；PUT 写入前通过现有 config schema/loading path 校验，失败返回字段级 issues
- `GET /api/v1/guard/workflows`、`GET /api/v1/guard/workflows/:workflowId` 提供 FEAT-023 权限/预算只读 read model，返回 workflow budget state、`budgetExceeded`、`blockedReason`、branch token ledger 与 permission audit 摘要；该 API 不提供 Web 审批队列或写操作。
- `GET /api/v1/workflows`、`GET /api/v1/workflows/:id`、`GET /api/v1/workflows/:id/checkpoints` 提供 FEAT-018 Orchestration Debugger 只读 read model，返回 workflow summary、branch ledger、merge envelope、checkpoint metadata / JSON、leafSessionRefs、rawContextRefs 与 stalled branch 信息。
- `GET /api/v1/logs/session-events` 支持 `sessionId/agentId/eventType/from/to/limit` 查询并返回结构化 payload；`GET /api/v1/logs/provider-fallbacks` 返回 original/fallback provider、trigger、ruleId 与时间。
- `GET /api/v1/providers/stats` 按 `24h`、`7d`、`all` 三个固定窗口聚合 `session_events`、`provider_fallback_log` 与 FEAT-023 `token_budget_ledger`，返回 provider/model 调用、成功/失败、fallback、`avgLatencyMs`、token 和估算成本。
- `GET /api/v1/memory/query`、`POST /api/v1/memory/write`、`GET /api/v1/memory/stats`、`POST /api/v1/memory/maintenance` 提供 FEAT-024 Knowledge contract。查询支持 `keyword/scope/agentId/layer/verificationStatus/limit`；写入仅允许 `shared` 和当前 agent scope，`platform` scope 一律拒绝；maintenance 返回 `202 + taskId` 异步 contract。
- `GET /api/v1/skills`、`GET /api/v1/skills/:id`、`POST /api/v1/skills/:id/enable|disable`、`POST /api/v1/skills/install`、`DELETE /api/v1/skills/:id` 提供 FEAT-024 Skills contract。列表展示 enabled/source/installedAt/preinstalled/usage/asset status；预装 skill 不可卸载；user skill install/uninstall 必须返回 asset audit 结果或显式 `unsupported`。

## 认证与日志

- `HARO_WEB_API_KEY` 未配置时，Dashboard 允许本地无认证访问，并写入 WARN：`Dashboard running in unauthenticated mode — set HARO_WEB_API_KEY to enable auth`
- 配置 `HARO_WEB_API_KEY` 后，请求需携带 `x-api-key`，否则返回 `401 {"error":"Unauthorized"}`
- 前端首页的 Foundation APIs 卡片提供最小 API key 配置入口；key 持久化在
  `localStorage["haro:web-api-key"]`，API client 会自动注入 `x-api-key`
- 当前端收到 401，会提示 Dashboard API key 缺失或不匹配，并指向首页配置入口与
  `haro:web-api-key` localStorage key，便于用户恢复
- 所有 HTTP 请求通过 `createLogger()` 写入 `~/.haro/logs/haro.log`，日志为 pino JSON 格式，至少包含 `method`、`path`、`statusCode`、`durationMs`

### Phase 1 产品成熟度补齐（FEAT-028）

当前 API key 认证只适合单机单人调试。FEAT-028 将补齐 KeyClaw 风格管理面基础：

- 本地多用户模型：`owner`、`admin`、`operator`、`viewer`，并提供 owner bootstrap。
- User token/session token：兼容现有 `HARO_WEB_API_KEY`，但不再把单一 API key 作为长期唯一认证模型。
- 统一服务端分页：Sessions、Logs、Knowledge、Skills、Users 等列表统一 `page/pageSize/sort/order/q` contract，避免前端一次性拉全量数据。
- 中文本地化基线：默认 `zh-CN`，所有用户可见文案走 i18n resource，保留 `en-US` fallback。
- 角色化操作与审计：删除、配置写入、禁用 channel、重置 token 等高风险操作必须经过权限检查并写 audit event。

## Agent Interaction（FEAT-016）

FEAT-016 在 foundation 上补齐 Agent 交互层：

- Chat 页面使用 WebSocket `authenticate`、`chat.start`、`chat.message`、`chat.cancel`、`subscribe` 协议接收实时事件；前端断线后按 1s、2s、4s 指数退避重连，最大 30s，并恢复未完成 session 观察。
- 服务端推送 `authenticated`、`event.stream`、`event.result`、`event.error`、`session.update`、`system.status`，并通过 `AgentRunner.run({ onEvent })` 旁路推送事件；Dashboard 不修改 Runner 核心执行语义。
- Sessions 列表默认仅展示 `sessionId`、`agentId`、`status`、`createdAt`，详情页将连续 text delta 折叠为消息，tool_call/tool_result 默认收起 JSON。
- Chat 最近选择持久化到 `localStorage["haro:lastChatConfig"]`，包括 `agentId`、`providerId`、`modelId`。


## Orchestration Debugger（FEAT-018）

FEAT-018 将 `/dispatch` 从占位页升级为 Team workflow 只读调试面：

- Workflows 列表展示 `workflowId`、`executionMode`、`orchestrationMode`、`templateId`、`status`、`currentNodeId`、`blockedReason` 与最新 checkpoint。
- 详情页用 fork-and-merge 图展示并行 branch 和统一 merge 点，禁止把 branch 渲染为串行 chain。
- Branch Ledger 表格展示 `branchId/memberKey/status/attempt/lastError/leafSessionRef/outputRef/consumedByMerge`，用于定位 stalled branch。
- Checkpoint Timeline 可打开只读 Debug Drawer，分区展示 `rawContextRefs`、`sceneDescriptor/routingDecision`、`branchState.branches`、`branchState.merge`、`leafSessionRefs`、`budgetState/permissionState` 与完整 checkpoint JSON。
- 对 budget/permission 阻断仅展示“需要人类介入”和详情，不渲染 approve、continue、stop、retry、skip 等写操作按钮。

数据来源优先级保持 Phase 1 边界：workflow/checkpoint 以 SQLite `workflow_checkpoints.state` JSON 为主 read model；预算/权限摘要复用 `PermissionBudgetStore` / `/guard` read model；不修改 `TeamOrchestrator`、`ScenarioRouter`、`PermissionBudgetStore` 的核心执行语义。

## Runtime Logs & Provider Monitoring（FEAT-025）

FEAT-025 将 `/logs`、`/invoke` 与 `/monitor` 从占位升级为运维可观测面：

- Logs 页面读取 `/api/v1/logs/session-events`，可按 sessionId、agentId、eventType、时间范围筛选，并用格式化 JSON 展示原始事件 payload。
- 同页读取 `/api/v1/logs/provider-fallbacks`，展示 originalProvider/originalModel、fallbackProvider/fallbackModel、trigger、ruleId、createdAt。
- Invoke / Provider Monitoring 页面读取 `/api/v1/providers/stats`，同时展示 `24h`、`7d`、`all` 三个窗口的调用次数、成功率、fallback 次数、平均延迟、input/output tokens 和 estimatedCost。
- Monitor 页面通过 WebSocket 订阅 `system.status` 与 `session.update`，WebSocket client 断线后会重连并恢复 `system`、`sessions` 以及已观察 session 订阅。
- provider unhealthy / fallback spike 仅作为只读告警展示；页面不自动修改 provider selection rules，也不提供 provider 切换写操作。

Runtime latency 来源保持在 Runner 边界：Provider adapter 仍只实现 `provider.query()` 协议，Runner 对 terminal `result/error` 事件补充 provider/model/latencyMs 并落库 `session_events.latency_ms`，不改变 ProviderRegistry 或 AgentRunner 核心调用语义。

## Knowledge & Skills（FEAT-024）

FEAT-024 将 `/knowledge` 与 `/skills` 从占位升级为可用管理面：

- Knowledge 页面按 keyword/scope/layer/verificationStatus 查询 Memory Fabric v1，结果展示 `summary/sourceRef/verificationStatus/assetRef/timestamp`，并可展开完整内容。
- Knowledge 写入表单默认 `shared`；选择 `agent` 时必须填写 `agentId`；页面不提供 `platform` 写入入口，后端也会拒绝 platform 写入，避免绕过治理边界。
- Skills 页面按 `Preinstalled skills` 与 `User skills` 分组展示，包含 enabled/source/installedAt/isPreinstalled/assetStatus/lastUsedAt/useCount。
- enable/disable 是低风险操作，会走 SkillsManager 现有 lifecycle；install/uninstall 返回 Evolution Asset Registry audit 结果。
- 预装 skill 的 uninstall 按钮禁用；user skill uninstall 使用 archive/uninstall 语义，不直接绕过审计删除文件。
- 页面只提示 `haro shit` 代谢流程，不在浏览器中直接执行代谢清理。

## System Management（FEAT-017）

FEAT-017 在 Web Dashboard 中补齐系统管理页面：

- Status 页面展示健康卡片网格（数据库、目录可写性、providers、channels、sessions）以及 grouped doctor report。
- Settings 页面展示常用配置表单（`logging.level`、`defaultAgent`、`runtime.taskTimeoutMs`）、配置来源层级、字段生效来源以及 Channel 配置摘要。
- 高级 YAML 模式使用现有 `<textarea>` 原语实现，未引入 CodeMirror/Monaco 等新依赖；保存仍走同一后端 schema/loading 校验。
- Config API 只写项目级 `.haro/config.yaml`，不修改全局配置、默认配置或 CLI overrides。
- Channel 在 FEAT-017 中仅作为 Status/Doctor/Config response 内嵌的只读摘要出现；独立 `/api/v1/channels*` contract、enable/disable/setup/remove、Gateway 控制与 Channel 专属页面仍由 FEAT-019 拥有。

## Orchestration Debugger（FEAT-018）

FEAT-018 在 Web Dashboard 中新增 Dispatch / Orchestration Debugger 页面，用于只读排查 team workflow：

- 列出 workflows，并突出 `blocked`、`needs-human-intervention`、`stalled` 等需要关注的状态。
- 选择 workflow 后展示 fork-and-merge 拓扑：branch 平行排列，merge 位于所有 branch 下游；不得渲染成 branch-to-branch chain。
- 展示 checkpoint timeline、branch ledger、merge envelope、leafSessionRefs 与 latest checkpoint ref。
- stalled branch 需要突出展示 `branchId`、`memberKey`、`status`、`attempt`、`lastEventAt`、`lastError`、`leafSessionRef`、`outputRef`、`consumedByMerge`。
- 点击 checkpoint 打开只读 debug drawer，分区展示完整结构化 JSON：`rawContextRefs`、`sceneDescriptor/routingDecision`、`branchState.branches`、`branchState.merge`、`leafSessionRefs`、`budgetState/permissionState`。
- 预算/权限摘要来自 FEAT-023 `/api/v1/guard/workflows*`；页面只展示阻断原因，不提供 approve/continue/stop、重跑 branch、跳过 branch 或策略修改。

## 与后续 FEAT 的边界

FEAT-015 交付 Dashboard foundation，FEAT-016 交付 Chat/Sessions/WebSocket。后续 FEAT 在该基础上扩展：

- FEAT-016：Agent Interaction（Chat、Sessions、WebSocket）— 已完成。
- FEAT-017：System Management（Status、Settings、Status/Doctor/Config REST）— done；仅通过 `/status`/`/doctor`/config sources 内嵌 Channel Health，只读消费，不拥有独立 `/api/v1/channels*`；真实 provider 连通测试暂无 harness，已按 owner 指示跳过。
- FEAT-018：Orchestration Debugger（Dispatch、workflow graph、checkpoint timeline、stalled branch debug）— done；只读消费 `workflow_checkpoints` 与 FEAT-023 guard summary，不提供 workflow 写操作。
- FEAT-019：Channel & Agent Management（独立 `/api/v1/channels*`、Channel 操作、Gateway、Agent YAML 管理）
- FEAT-023：Permission & Token Budget Guard（done；Dashboard 只消费 `/api/v1/guard/*` read model，页面与审批队列仍不在本 FEAT 内）
- FEAT-024：Knowledge & Skills（done；Memory 搜索/安全写入、Skills 生命周期、asset 追溯）
- FEAT-025：Runtime Logs & Provider Monitoring（done；Session events、provider fallback、Provider/token/latency 三窗口统计、Monitor 只读告警）
- FEAT-026：Provider Onboarding Wizard（由 CLI/PAL 拥有；Dashboard 只消费 provider status/config read model）
- FEAT-027：Guided Setup & Doctor Remediation（由 CLI 拥有；Dashboard 只消费 doctor/setup JSON report）
- FEAT-028：Web Dashboard Product Maturity（本地多用户、统一服务端分页、中文本地化、角色化操作）
