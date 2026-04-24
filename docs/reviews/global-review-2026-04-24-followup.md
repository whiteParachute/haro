# Haro 全项目 Follow-up Review — 2026-04-24

结论：**APPROVE**

本次复审基于 `docs/reviews/global-review-2026-04-24.md` 的 B1/B2/B3/W1/W2/W3/W4/W5/N1 原始 finding，检查当前工作区代码、spec、docs、测试与工作区卫生状态。

## 验证摘要

已执行：

- `pnpm lint`：通过，无输出 warning。
- `pnpm -F @haro/web lint`：通过，无输出 warning。
- `pnpm test`：通过；未再出现原 W5 的 `MaxListenersExceededWarning`、`[DEP0040] punycode` warning 或 Vite CJS deprecation warning。
- `pnpm build`：通过。
- `pnpm smoke`：通过。
- `git status --short --untracked-files=all`：仍存在大量待提交变更；`docs/reviews/*` 和 `packages/web/test/api-client.test.ts` 为未跟踪文件。
- `git status --short --ignored --untracked-files=all | grep -E 'scripts/omx-|docs/reviews/'`：`scripts/` 下已无 OMX 临时 launcher；review 文档保留在 `docs/reviews/`。
- `git ls-files | grep -E '(^|/)(dist/|tsconfig\.tsbuildinfo$|\.omx/|coverage/|scripts/omx-|.*\.log$)'`：无 `scripts/omx-*` 临时文件；`scripts/omx-review-plan.md` 已从脚本目录移出，当前工作区以删除旧路径、新增 `docs/reviews/omx-review-plan.md` 的方式保留 review plan。

## Finding 复核结果

| Finding | 状态 | 复核结论 |
| --- | --- | --- |
| B1 | PASS | CLI team runtime 已真实接入 `TeamOrchestrator.executeWorkflow()`，旧 fallback 成功路径已改为集成测试。 |
| B2 | PASS | FEAT-016/019 Agent API 已统一为 `summary` read-model，未再要求 `description` 或单 Agent `type` 写入 core `AgentConfig`。 |
| B3 | PASS | branch retry 改为显式 `retryOfSessionId` 且 `continueLatestSession:false`，避免按 agent/provider 续接 latest session。 |
| W1 | PASS | FEAT-017/019 Channel 管理边界已唯一化：FEAT-017 只读健康摘要，FEAT-019 独占 `/api/v1/channels*`。 |
| W2 | PASS | Dashboard API key 前端链路已补齐，API client 注入 `x-api-key`，401 提示与测试已覆盖。 |
| W3 | PASS | Hono 静态服务已增加 BrowserRouter SPA fallback，并测试深链与 `/api`/asset 非 fallback。 |
| W4 | PASS | FEAT-014 文档已同步为 CLI 直接调用 team runtime，不再描述 release 路径 fallback。 |
| W5 | PASS | 原 `MaxListenersExceededWarning` 与 `DEP0040` 已清理/抑制并记录；复跑 `pnpm test` 未再出现 release-blocking warning。 |
| N1 | PASS | review plan 已从 `scripts/` 迁往 `docs/reviews/`，本地 OMX launcher 已删除，`scripts/` 仅保留项目脚本。 |

## 逐条说明

### B1 — FEAT-014 标记 done，但 CLI 仍把 team workflow 回退成 single-agent

**状态：PASS**

证据：

- `packages/cli/src/index.ts:1121-1130` 在 `decision.executionMode === 'team'` 时直接调用 `executeTeamWorkflow()` 并返回，不再进入 single-agent runner。
- `packages/cli/src/index.ts:1199-1225` 构造 `TeamOrchestrator` 并调用 `orchestrator.executeWorkflow(workflow, decision, rawContextRefs)`。
- `packages/cli/src/index.ts:1278-1286` 输出 `branchLedger` 与 `mergeEnvelope`。
- `packages/cli/test/cli.test.ts:201-305` 已从 fallback 断言迁移为“team-mode requests execute through TeamOrchestrator and checkpoint branch/merge state”，覆盖无 `WARN [FEAT-014]`、branch checkpoint、merge checkpoint、leaf sessions、`fallbackExecutionMode:null`、`teamOrchestratorPending:false`。

结论：原 blocker 已修复。

### B2 — FEAT-016/FEAT-019 的 Agent API 合约与当前 AgentConfig 严格 schema 冲突

**状态：PASS**

证据：

- `packages/core/src/agent/types.ts` 与 `packages/core/src/agent/schema.ts` 仍保持 FEAT-004 的严格 `AgentConfig`，未引入 `description` 或单 Agent `type`。
- `specs/phase-1/FEAT-016-web-dashboard-agent-interaction.md:51-53` 改为返回 `id/name/summary/defaultProvider/defaultModel` 与详情 `systemPrompt/tools`。
- `specs/phase-1/FEAT-016-web-dashboard-agent-interaction.md:142-163` 明确 `summary` 为只读 read-model，由 `systemPrompt` 派生，不写回 YAML，不参与 `AgentConfig` schema。
- `specs/phase-1/FEAT-019-web-dashboard-channel-agent-management.md:67-73` 与 FEAT-016 对齐，不返回 `description` 或单 Agent `type`。
- `specs/phase-1/FEAT-019-web-dashboard-channel-agent-management.md:86-93` 明确 YAML CRUD 只接受 `{ yaml }` envelope，并继续使用 FEAT-004 strict schema；`description`、`summary`、单 Agent `type` 作为 unknown field 拒绝。

结论：原 spec/API/schema 冲突已解除。

### B3 — FEAT-014 branch retry 可能加载同 agent/provider 的“最新 session”

**状态：PASS**

证据：

- `packages/core/src/team-orchestrator.ts:915-927` retry 时仅在已有当前 branch `leafSessionRef.sessionId` 时传 `retryOfSessionId`，并固定 `continueLatestSession:false`。
- `packages/core/test/team-orchestrator.test.ts:385-416` 覆盖 retry attempt 递增、第二次调用传入第一轮 branch session、两次均不使用 latest continuation。
- `packages/core/test/team-orchestrator.test.ts:418-452` 覆盖 branch retry 不会拿另一个 branch 的 session。

结论：原 branch 隔离 blocker 已修复。

### W1 — FEAT-017 与 FEAT-019 对 Channel 管理职责重叠

**状态：PASS**

证据：

- `specs/phase-1/FEAT-017-web-dashboard-system-management.md:24-46` 明确 FEAT-017 只覆盖 Status/Settings 中的 Channel 只读摘要与基础健康检查，不定义独立 `/api/v1/channels*`。
- `specs/phase-1/FEAT-017-web-dashboard-system-management.md:125-129` AC/Test Plan 要求本 FEAT 不出现 channel mutation 按钮或端点。
- `specs/phase-1/FEAT-019-web-dashboard-channel-agent-management.md:50-55` 将 Channel list/enable/disable/remove/doctor/setup 统一归 FEAT-019。
- `specs/phase-1/FEAT-019-web-dashboard-channel-agent-management.md:201` 明确 FEAT-019 是唯一拥有独立 `/api/v1/channels*` contract 的 spec。
- `specs/README.md` 与 `docs/modules/web-dashboard.md` 同步说明 FEAT-017 只读、FEAT-019 独占操作性 Channel contract。

结论：职责重叠已修复。

### W2 — Web Dashboard API key 前端链路未闭合

**状态：PASS**

证据：

- `packages/web/src/stores/auth.ts` 新增 `haro:web-api-key` 持久化、读取、设置、清除。
- `packages/web/src/api/client.ts:21-24` 从 zustand store 或 localStorage 解析 API key。
- `packages/web/src/api/client.ts:59-62` 自动注入 `x-api-key`。
- `packages/web/src/api/client.ts:43-48` 对 401 返回可恢复诊断信息。
- `packages/web/src/pages/HomePage.tsx` 新增 API key 输入/保存/清除入口。
- `packages/web/test/api-client.test.ts:62-90` 覆盖 store 注入、localStorage fallback、401 诊断信息。

结论：前端认证链路和测试已补齐。

### W3 — 生产 BrowserRouter 深链刷新 404

**状态：PASS**

证据：

- `packages/cli/src/web/index.ts:40-44` 定义 SPA fallback 条件：仅 GET、排除 `/api` 与 `/assets`、要求无文件扩展名。
- `packages/cli/src/web/index.ts:72-79` 静态资源未命中后对符合条件的路由返回 `index.html`。
- `packages/cli/test/web.test.ts:149-161` 覆盖 `/chat`、`/sessions`、`/status` 深链 fallback 到 dashboard HTML。
- `packages/cli/test/web.test.ts:164-176` 覆盖 `/api/missing` 与缺失 asset 不 fallback。

结论：SPA fallback 已修复并有回归测试。

### W4 — FEAT-014 文档仍描述“Team Orchestrator 尚未实现”

**状态：PASS**

证据：

- `docs/modules/scenario-router.md` 已更新为 Router 将 team workflow 交给 `TeamOrchestrator`，CLI team 路径直接调用 `TeamOrchestrator.executeWorkflow()`。
- `docs/modules/team-orchestrator.md` 说明 CLI release 路径不再 warning 后 fallback 到 single-agent，fallback 字段仅保留兼容/unsupported 边界语义。
- `specs/phase-1/FEAT-014-team-orchestrator.md` 当前状态描述为 CLI 将 `RoutingDecision + ScenarioWorkflow + rawContextRefs` 交给 `TeamOrchestrator.executeWorkflow()`，AC12 也要求不得保留 fallback single-agent 成功路径。

结论：文档状态已与 B1 修复后的实现对齐。

### W5 — 测试输出运行时 warning

**状态：PASS**

证据：

- `package.json` 与 `packages/cli/package.json` 的 test script 设置 `HARO_LOG_ROLLING=0`，避免 pino rolling transport 在 Vitest 进程内累积 `exit` listener。
- `package.json`、`packages/cli/package.json`、`packages/channel-telegram/package.json` 设置 `NODE_OPTIONS="${NODE_OPTIONS:-} --disable-warning=DEP0040"`，抑制已定位为 dev-only dependency 链路的 `punycode` warning。
- `docs/reviews/w5-warning-cleanup-2026-04-24.md` 记录了 MaxListeners 与 DEP0040 的定位、处理策略和未选择依赖升级的理由。
- 本次 `pnpm test` 未再出现原 review 中的 `MaxListenersExceededWarning`、`[DEP0040]` 或 Vite CJS deprecation warning。

结论：原 W5 已修复，验证命令输出不再包含 release-blocking warning。

### N1 — review/OMX 临时脚本存在误入风险

**状态：PASS**

证据：

- `.gitignore` 增加了 `scripts/omx-*.sh`，防止后续本地 launcher 误入提交。
- `find scripts -maxdepth 2 -type f -print` 不再显示 `scripts/omx-*.sh` 临时 launcher。
- `scripts/omx-review-plan.md` 已从脚本目录移出，review plan 保留为 `docs/reviews/omx-review-plan.md`。
- `docs/reviews/global-review-2026-04-24.md`、`docs/reviews/global-review-2026-04-24-followup.md`、`docs/reviews/omx-review-plan.md`、`docs/reviews/w5-warning-cleanup-2026-04-24.md` 为本次 review 归档文档，应随本批修复一起提交。

结论：原 N1 已修复。`scripts/` 下的 OMX 临时脚本已删除，review 文档已归档到 `docs/reviews/`。

## 验证命令详情

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `pnpm lint` | PASS | 无 warning 输出。 |
| `pnpm -F @haro/web lint` | PASS | 无 warning 输出。 |
| `pnpm test` | PASS | 所有测试通过；无 MaxListeners/DEP0040/Vite CJS deprecation warning。 |
| `pnpm build` | PASS | 所有 workspace build 通过，Web build 成功产物写入 ignored dist。 |
| `pnpm smoke` | PASS | 返回 `{ "ok": true }`，包含 AC1/AC3/AC4/AC5 checks。 |

## Final Verdict

**APPROVE**

剩余提交前检查：

1. 将 `scripts/omx-review-plan.md` 删除与 `docs/reviews/omx-review-plan.md` 新增作为同一批变更提交。
2. 将本次新增的 review 归档文档与 `packages/web/test/api-client.test.ts` 纳入提交边界。

B1/B2/B3 三个 blocker 均已修复，W1/W2/W3/W4/W5/N1 也已修复；当前仅剩正常的提交整理工作。
