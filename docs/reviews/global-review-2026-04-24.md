# Haro 全项目 Release/Blocker Review — 2026-04-24

结论：**REQUEST CHANGES**

本次审查覆盖 `packages/core`、`packages/cli`、`packages/skills`、`packages/channel*`、`packages/provider*`、`packages/web`、`docs/`、`specs/`、`scripts/`，重点核对 FEAT-013~019、设计原则、多 Agent 约束、运行时状态机、checkpoint/resume、CLI/Web 安全与可用性、测试覆盖和误入仓库文件。

## 验证摘要

已执行：

- `pnpm -r --filter "./packages/*" run test`：通过，9 个 workspace package；CLI 测试过程中出现 `MaxListenersExceededWarning` 与 `punycode` deprecation warning。
- `pnpm -r --filter "./packages/*" run build`：通过。
- `pnpm lint`：通过。
- `pnpm -F @haro/web lint`：通过。
- `pnpm smoke`：通过。
- `git status --short --untracked-files=all`：发现未跟踪临时脚本 `scripts/omx-global-review-2026-04-24.sh`。
- `git ls-files | grep -E '(^|/)(dist/|tsconfig\.tsbuildinfo$|\.omx/|coverage/|scripts/omx-|.*\.log$)'`：发现已跟踪 `scripts/omx-review-plan.md`。

正向确认：

- FEAT-013/014/015 frontmatter 分别为 `status: done`。
- FEAT-016~019 frontmatter 为 `status: approved`，未发现未删除线关闭的 Open Questions。
- `dist/` 与 `tsconfig.tsbuildinfo` 当前被 `.gitignore` 覆盖，未发现被 git 跟踪。

## Blockers

### B1 — FEAT-014 标记 done，但 CLI 仍把 team workflow 回退成 single-agent

- 定位：
  - `packages/cli/src/index.ts:1102-1122`：Router 产生 `decision`/`workflow` 后，`decision.executionMode === 'team'` 只构造 `fallbackExecutionMode: 'single-agent'` 和 `teamOrchestratorPending: true`，随后调用 `logTeamFallback()`。
  - `packages/cli/src/index.ts:1122-1132`：无论是否 team，最终都创建单个 `AgentRunner` 并执行一次 leaf session。
  - `packages/cli/src/index.ts:1134-1160`：checkpoint 的 `nodeType` 固定为 `agent`，team 分支状态只是 fallback 标记，没有 branch ledger / merge envelope。
  - `packages/cli/test/cli.test.ts:201-267`：测试仍把“team-mode requests warn and fall back to single-agent”作为期望行为。
  - `docs/modules/scenario-router.md:20-29`：文档仍写明 “Team Orchestrator 仍未实现” 且 “实际执行要等 FEAT-014”。
- 违反：
  - `specs/phase-1/FEAT-014-team-orchestrator.md:493-510`（AC1、AC2、AC9）：Team Orchestrator 应直接消费 `RoutingDecision + ScenarioWorkflow`，leaf branch 映射到 AgentRunner，并在 fork/leaf/merge 写 checkpoint。
  - `specs/phase-1/FEAT-014-team-orchestrator.md:511-514`（AC10/AC11）：partial merge 恢复与 hub-spoke Phase 1 语义需要真实 team runtime，而不是隐式 fallback。
  - `specs/multi-agent-design-constraints.md` 约束②/③：team 推理应 fork-and-merge；当前 release 路径没有 fork，也没有 merge。
  - `specs/design-principles.md` P3/P6/P7：Harness 和验证循环必须成为产品能力；当前测试把过渡行为固化，不能证明 done AC。
- 影响：已合入 main 后，复杂 analysis/review/design 场景虽然被 Router 判为 team，但实际只跑单 Agent。用户会看到 warning，checkpoint 记录 team 决策但不可恢复为 FEAT-014 branch ledger/merge 状态。
- 必须修复后才能继续：**是**。至少需要在 CLI `executeTask()` team 分支接入 `TeamOrchestrator.executeWorkflow()`，删除/迁移 fallback 测试，并新增 CLI 集成测试证明 hub-spoke/debate 等 team workflow 产生 branch ledger、merge envelope 与可恢复 checkpoint。

### B2 — FEAT-016/FEAT-019 的 Agent API 合约与当前 AgentConfig 严格 schema 冲突

- 定位：
  - `specs/phase-1/FEAT-016-web-dashboard-agent-interaction.md:51-53`：Agents REST 摘要要求返回 `description`。
  - `specs/phase-1/FEAT-019-web-dashboard-channel-agent-management.md:66-68`：Agent 列表/详情要求 `type`、`description`、`systemPrompt` 等字段。
  - `specs/phase-1/FEAT-019-web-dashboard-channel-agent-management.md:85-91`：Agent CRUD 计划从 `AgentRegistry.list()` 产出 `type`/`description`，并通过 Zod 校验写回 Agent YAML。
  - `packages/core/src/agent/types.ts:7-12`：`AgentConfig` 只包含 `id/name/systemPrompt/tools/defaultProvider/defaultModel`。
  - `packages/core/src/agent/schema.ts:21-34`：`agentConfigSchema.strict()` 严格拒绝未知字段。
  - `packages/core/src/agent/schema.ts:39-41`：未知字段错误明确写明 “Agent 的行为由 tools 决定，不由字段描述”。
- 违反：
  - FEAT-016 R5 与 FEAT-019 R11/R12/R13/R14/R16 之间要求 Dashboard 返回/编辑 `description`、`type`，但 FEAT-004/当前 core schema 不接受这些字段。
  - `specs/multi-agent-design-constraints.md` 约束⑤（Tools Define Capability, Not Role）：`type` 容易滑向 role/persona 字段；若必须新增，应先修改基础 Agent spec，而不是在 Web FEAT 中绕过。
  - `specs/design-principles.md` P7 “One way to do X”：同一个 Agent 配置对象出现 Web-only 扩展字段与 core strict schema 两套口径。
- 影响：FEAT-016/019 若按 approved spec 实现，要么 API 无法从 `AgentRegistry.list()` 提供字段，要么写入 YAML 后被 loader/schema 拒绝，导致 AgentEditorPage 保存后无法 reload。
- 必须修复后才能继续：**是（阻塞 FEAT-016/019 实现）**。需要在 spec 层先决策：删除 `type/description`，改为从 `systemPrompt` 派生只读摘要；或正式修订 FEAT-004 AgentConfig/schema 并补充迁移与 unknown-field 策略。

### B3 — FEAT-014 branch retry 可能加载同 agent/provider 的“最新 session”，破坏 branch 隔离

- 定位：
  - `packages/core/src/team-orchestrator.ts:899-925`：`dispatchBranch()` 中 `next.attempt` 递增后调用 `agentRunner.run()`。
  - `packages/core/src/team-orchestrator.ts:910-924`：`continueLatestSession: next.attempt > 1`，但没有传入该 branch 上一次 `leafSessionRef.sessionId` 或 `providerResponseId`。
  - `packages/core/src/runtime/runner.ts:393-435`：`loadContinuationContext()` 在 `continueLatestSession=true` 时按 `agent_id + provider` 查询最近 completed session，不限定 workflow/branch。
  - `specs/phase-1/FEAT-014-team-orchestrator.md:168-175`：branch attempt 与 leaf session 是分层绑定关系。
  - `specs/phase-1/FEAT-014-team-orchestrator.md:211-212`：默认每次 branch attempt 新建或 fork 隔离上下文；若新增 leaf session，必须显式追加到 `leafSessionRefs`。
- 违反：
  - FEAT-014 5.3/Q1 结论：默认隔离，复用必须显式保证状态隔离。
  - `specs/multi-agent-design-constraints.md` 约束①/②：branch 上下文不能从其他 branch/session 继承摘要或隐式状态。
- 影响：一旦 team runtime 被 CLI 接入，某个 branch retry 可能续接另一个分支或上一个普通 CLI session 的 provider response，造成跨分支上下文泄漏，merge 的 evidence 不再可审计。
- 必须修复后才能继续：**是（阻塞 FEAT-014 release 路径）**。应让 TeamOrchestrator 显式传递 branch 的 `retryOfSessionId`/continuation ref，或默认 `continueLatestSession:false` 并以 checkpoint 中的 `leafSessionRef` 精确恢复。

## Warnings

### W1 — FEAT-017 与 FEAT-019 对 Channel 管理职责重叠且状态均为 approved

- 定位：
  - `specs/phase-1/FEAT-017-web-dashboard-system-management.md:41-43`：FEAT-017 已声明 Channels REST：list/enable/disable/setup/doctor。
  - `specs/phase-1/FEAT-017-web-dashboard-system-management.md:115-122`：AC6 要求 “Channels 页面可列出所有 channel，执行 enable/disable/setup/doctor”。
  - `specs/phase-1/FEAT-019-web-dashboard-channel-agent-management.md:20-26`：FEAT-019 又以 “Dashboard 缺少独立 Channel 管理页面” 为背景。
  - `specs/phase-1/FEAT-019-web-dashboard-channel-agent-management.md:47-62`：FEAT-019 重新定义 channel enable/disable/setup/doctor，并额外增加 remove。
- 违反：
  - `specs/design-principles.md` P7 “One way to do X”：Channel 管理页面/API 归属不唯一。
  - FEAT-016~019 依赖顺序应清晰；当前 FEAT-019 声称补 FEAT-017 已验收的能力。
- 影响：实现阶段容易重复创建 `channels.ts`、ChannelPage/SettingsPage 双入口、测试 AC 重复或互相覆盖。
- 必须修复后才能继续：**建议在实现 FEAT-017/019 前修复**。可选方案：FEAT-017 只保留 Status/Settings 中的 channel 只读摘要，将操作性 ChannelPage 全部归 FEAT-019；或 FEAT-017 交付基础 Channel API，FEAT-019 只扩展 delete/gateway/agent，并更新 AC 文案。

### W2 — Web Dashboard 的 API key 前端链路未闭合，配置 HARO_WEB_API_KEY 后未来业务 API 会直接 401

- 定位：
  - `packages/cli/src/web/auth.ts:23-34`：后端要求请求头 `x-api-key` 等于 `HARO_WEB_API_KEY`。
  - `packages/web/src/api/client.ts:16-25`：fetch wrapper 只设置 `Content-Type`，没有从 `useAuthStore` 注入 `x-api-key`。
  - `packages/web/src/stores/auth.ts:10-23`：auth store 存在，但未被 API client 使用，也没有持久化/登录入口。
  - `docs/modules/web-dashboard.md:42-46`：文档声明配置 `HARO_WEB_API_KEY` 后请求需携带 `x-api-key`。
- 违反：
  - FEAT-015 R8 的认证边界只完成了后端半边；后续 FEAT-016~019 的 API client 若沿用当前封装会无法通过认证。
  - `specs/design-principles.md` P7 Observability/agent-friendly：认证失败将表现为泛化 Error，缺少可恢复 UX。
- 影响：未配置 API key 的开发模式可用；一旦按文档开启 API key，前端后续页面发起 `/api/*` 请求会 401，用户无法在 Dashboard 内输入或保存 key。
- 必须修复后才能继续：**可作为 FEAT-016 的前置 BUG/改造**。至少需要 API client 注入 `x-api-key`、401 错误态、key 输入/持久化策略，并测试带 key 的前端请求。

### W3 — 生产模式使用 BrowserRouter，但 Hono 静态服务没有 SPA fallback，深链刷新 404

- 定位：
  - `packages/web/src/App.tsx:40-62`：前端使用 `BrowserRouter`，声明 `/chat`、`/sessions`、`/status`、`/settings` 等客户端路由。
  - `packages/cli/src/web/index.ts:48`：Hono 只通过 `serveStatic` 服务静态文件，没有对非 `/api` 路径 fallback 到 `index.html`。
  - 实测：`createWebApp().request('/')` 返回 200；`createWebApp().request('/chat')` 返回 404。
- 违反：
  - FEAT-015 AC3 只覆盖根路径，但当前 Dashboard shell 已暴露多路由；缺少 fallback 会破坏后续 FEAT-016~019 页面直接访问/刷新。
  - `specs/design-principles.md` P7 Fast feedback / agent-friendly codebase：缺少生产路由回归测试。
- 影响：从首页点击导航可工作，但浏览器刷新 `/chat` 或直接打开 URL 会 404。
- 必须修复后才能继续：**建议 FEAT-016 前修复**。可改用 hash router，或在 Hono 中对非 `/api` 且非静态 asset 的 GET fallback 到 `index.html`，并加测试。

### W4 — FEAT-014 相关文档仍描述“Team Orchestrator 尚未实现”，与 done 状态冲突

- 定位：
  - `docs/modules/scenario-router.md:20-29`：当前实现边界仍写 team 只记录决策并回退，实际执行等待 FEAT-014。
  - `specs/phase-1/FEAT-014-team-orchestrator.md:477-484`：5.11 仍描述 CLI fallback 当前路径。
  - `docs/modules/team-orchestrator.md:5-14`：TeamOrchestrator 文档声明 runtime 已存在，与 Scenario Router 文档冲突。
- 违反：
  - `specs/design-principles.md` P7 “One way to do X”：同一模块状态在 docs/modules 互相矛盾。
- 影响：维护者无法判断 release 行为到底是 fallback 还是 team runtime；这也掩盖了 B1。
- 必须修复后才能继续：**随 B1 一起修复**。若 CLI 暂不接入，则 FEAT-014 不应为 done；若接入，则更新 Scenario Router 文档与测试。

### W5 — 测试全绿但 CLI 测试输出运行时 warning，说明进程级 listener/依赖健康仍有噪声

- 定位：
  - 验证输出：`packages/cli test` 出现 `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 exit listeners added to [process]`。
  - 验证输出：`packages/channel-telegram test` 与 CLI 测试出现 `[DEP0040] DeprecationWarning: The punycode module is deprecated`。
  - `packages/core/src/logger/index.ts:186-195`：`createLogger()` 默认启用 rolling transport；CLI 测试会反复 bootstrap logger，可能是 `exit` listener 累积来源之一。
  - `packages/cli/src/web/server.ts:31-56`：Web server 也有进程级 signal listener 注册/移除路径，建议一并纳入 listener 泄漏排查。
- 违反：
  - `specs/design-principles.md` P6/P7：release 验证应无已知 runtime warning；warning 会降低 CI 信噪比。
- 影响：目前不导致测试失败，但可能掩盖真实泄漏或依赖退化。
- 必须修复后才能继续：**可记录为 BUG，建议 release 前清理**。至少应定位 `exit` listener 来源（logger transport / server signal / test harness），并对 Node deprecation 做依赖替换或 suppress 策略。

## Nits

### N1 — review/OMX 临时脚本存在误入风险

- 定位：
  - `git status --short --untracked-files=all`：`?? scripts/omx-global-review-2026-04-24.sh`。
  - `scripts/omx-global-review-2026-04-24.sh:1-9`：本地 review launcher，调用 `omx --madmax --high ...`。
  - `git ls-files`：`scripts/omx-review-plan.md` 已被跟踪。
  - `scripts/omx-review-plan.md:176-182`：文档自身要求 done 后删除本地临时 ralph 脚本。
- 违反：用户本次审查要求检查临时脚本、生成物、无关文件是否误入 git；`specs/design-principles.md` P7 要求仓库对 agent 友好、减少噪声。
- 影响：未跟踪脚本会污染工作树；已跟踪 review plan 是否应留在 `scripts/` 需要维护者确认。
- 必须修复后才能继续：未跟踪脚本需在提交前删除或明确纳入；`scripts/omx-review-plan.md` 建议移动到 `docs/reviews/` 或删除。

## 测试覆盖缺口

- 缺少 CLI 层 FEAT-014 集成测试：当前 `packages/cli/test/cli.test.ts:201-267` 仍验证 fallback，未证明 CLI 会调用 `TeamOrchestrator.executeWorkflow()`。
- 缺少 branch retry 隔离测试：没有测试 retry 时使用同一 branch 的 checkpoint/leafSessionRef，而非 AgentRunner 的 latest session。
- 缺少 Dashboard 认证前端测试：没有覆盖 `HARO_WEB_API_KEY` 配置后，前端 API client 携带 `x-api-key`。
- 缺少生产深链测试：没有覆盖 `GET /chat`、`GET /sessions` 等客户端路由 fallback 到 `index.html`。
- FEAT-016~019 尚为 approved 未实现；当前测试不能证明这些 AC，只能证明 spec 已关闭 Open Questions。

## 整体结论

**REQUEST CHANGES**。

当前不能以 release/blocker 级标准继续合入 main：FEAT-014 的 done 状态与 CLI 实际 fallback 路径不一致，且 FEAT-016/019 approved 合约与 core Agent schema 存在硬冲突。建议先修复 B1/B2/B3，再重新运行 `pnpm lint && pnpm test && pnpm build && pnpm smoke && pnpm -F @haro/web lint`，并补充上述缺失的集成测试。
