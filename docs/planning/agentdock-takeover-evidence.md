# AgentDock takeover evidence 盘点（FEAT-081M）

> 日期：2026-05-26
>
> 范围：081M 只做文档、guard 状态说明与替代证据盘点。本文不是删除批准，不触发物理删除，不修改 provider/memory/skills/runtime/Web/MCP 业务代码，不触碰真实 `~/.haro`、`~/.haro/evolution` 或 aria-memory-vault。
>
> 当前结论：channel-layer 已在 FEAT-081K/081L 后完成 Haro-owned package 退役；剩余 provider、memory、skills、web、runtime 均缺少“窄面 + AgentDock 替代证据齐全”的删除条件，继续 fail-closed。

## 0. 081M guard 口径

- `planning.stage=FEAT-081M` 仅表示证据刷新。
- `planning.lastCompletedStage=FEAT-081L`，因为 081M 不是物理删除阶段。
- `planning.lastUpdatedBy=FEAT-081M`。
- `deleteAllowedCount=0`、`physicalDeleteApproved=false`、`wouldDelete=false` 必须保持。
- `nextDeletionCandidate=null`、`nextReviewCandidate=null`；本文不把任何剩余候选升级为删除批准。

## 1. 总览

| 候选 | AgentDock / 共享能力替代证据 | Haro 当前 blocker | 081M 判断 | 推荐下一步 |
| --- | --- | --- | --- | --- |
| `provider-codex` | AgentDock/ModelHub 已承担 runner/model 能力方向 | 新用户 Codex/ChatGPT 登录、凭据初始化、doctor/list/models、CLI bootstrap 仍在 Haro | blocked | 先补 AgentDock 等价登录/凭据初始化证据；081N 最多只评审 setup/onboarding 子面 |
| `memory-fabric` | AgentDock memory 与共享 aria-memory-vault 是目标 owner | 真实 `~/.haro` 数据、aria-memory-vault、MCP `memory_query` / `memory_remember` 默认注册仍有风险 | blocked | 先做只读数据/owner 边界证明与 MCP memory tool 隔离方案 |
| `skills-marketplace` | AgentDock skills 是目标 owner | `haro skills install/enable/disable`、`SkillsManager`、eat/shit 兼容资产仍存在 | deferred | 先拆 marketplace 扩展面与保留兼容资产边界 |
| `web-dashboard-non-review` | AgentDock 是平台 Web/API host；Haro Web 主线已收敛为 review board | Review Board、approval conversation、auth/bootstrap 不能误删 | blocked / freeze | 固化 Review Board endpoint allowlist，再逐路由评审非 review surface |
| `agent-runtime-router` | AgentDock scheduler / workspace / runner 是目标 owner | 用户指定第 4 项 deferred；仍需证明 AgentDock 定时任务能稳定触发 Haro 提案到 Review Board | deferred | 等 AgentDock 定时任务 → Haro 提案 → approval request → Review Board 可审链路稳定后再评估 |

## 2. `provider-codex`

### 已有替代证据

- AgentDock / ModelHub 方向已经承担 runner/model/provider runtime 能力。
- 081M 只确认方向，不确认 Haro provider package 可删。

### 仍在 Haro 的证据

- `packages/provider-codex/package.json` 仍存在。
- `packages/cli/package.json` 仍依赖 `@haro/provider-codex`。
- `packages/cli/src/index.ts` 仍引用 `createCodexProvider` 进行默认 provider bootstrap。
- `packages/cli/src/provider-onboarding.ts` 与 `packages/cli/src/provider-codex-wizard.ts` 仍读取 `readLocalCodexAuth`，承载 `haro provider setup codex` / ChatGPT 登录与本地凭据检查。
- `packages/cli/src/diagnostics.ts` 仍给出 `haro provider setup codex`、`haro provider doctor codex` remediation。
- `packages/provider-codex/test/*` 仍覆盖 auth、capability、models、health 等 provider 行为。

### Blockers

1. 未证明 AgentDock/ModelHub 对新用户 Codex/ChatGPT 登录与凭据初始化有等价路径。
2. 未替代 `haro provider doctor/list/models` 的诊断与自助修复体验。
3. CLI 默认 provider bootstrap 仍依赖 `createCodexProvider`。
4. 082A/082B 的 LLM draft / feedback rewrite 仍需要 provider path 或等价 bridge。

### 081N 建议

081N 不能直接删除 `packages/provider-codex` 或 provider runtime。若继续减法，建议只做只读评审：`haro provider setup/onboarding` 子面是否可先转为 legacy warning，并以“AgentDock 等价登录/凭据初始化证据齐全”为前置条件。

## 3. `memory-fabric`

### 已有替代证据

- memory owner 方向应收口到共享 aria-memory-vault / AgentDock memory。
- Haro sidecar 主线只应记录 proposal/validation/approval/application artifacts，不应拥有用户长期记忆。

### 仍在 Haro 的证据

- `packages/core/src/index.ts` 仍导出 `createMemoryFabric`。
- `packages/core/src/memory/*` 与 core legacy tests 仍存在。
- `packages/cli/src/commands/memory.ts` 仍存在 legacy memory CLI。
- `packages/mcp-tools/src/index.ts` 默认 registry 仍注册 `memory_query` / `memory_remember`。
- `packages/mcp-tools/src/tools/memory-query.ts`、`memory-remember.ts` 仍提供兼容 MCP tool。

### Blockers

1. 真实 `~/.haro` 数据不在删除范围内，不能被测试或清理任务误触碰。
2. aria-memory-vault 是共享资产，不属于 Haro repo 删除面。
3. MCP `memory_query` / `memory_remember` 默认注册尚未完成隔离或替代。
4. 未证明 sidecar 主链路完全不读写 Haro-owned MemoryFabric。

### 下一步

先做只读边界证明：列出真实数据路径、MCP memory tool 注册路径、core barrel export 下游 import，并设计 fail-closed 替代方案；没有这些证据前不得物理删除。

## 4. `skills-marketplace`

### 已有替代证据

- AgentDock skills 是目标 owner。
- Haro 不再发展通用 skills marketplace。

### 仍在 Haro 的证据

- `packages/skills/package.json` 仍存在。
- `packages/cli/src/index.ts` 仍初始化 `SkillsManager`。
- CLI 仍保留 `haro skills install/enable/disable` 等用户入口。
- eat/shit 相关兼容语义和历史资产仍在 docs/tests 中被引用。

### Blockers

1. marketplace 扩展面与必须保留的 eat/shit 兼容资产尚未拆清。
2. 未证明 `haro skills install/enable/disable` 已由 AgentDock skills 等价承接或明确退役。
3. 相关 legacy tests 仍需分类稳定后再考虑删除。

### 下一步

先把 marketplace 扩展能力、runtime skill sync、eat/shit 兼容资产分为 keep / freeze / candidate 三类；只允许对明确无主链路依赖的 marketplace 扩展面做后续评审。

## 5. `web-dashboard-non-review`

### 已有替代证据

- AgentDock 是平台 Web/API host。
- Haro Web 当前主线已收敛为 proposal review board、approval conversation、auth/bootstrap。

### 仍需保护

- `packages/web-api/src/routes/approval-requests.ts` 是 review board 主路由。
- `packages/web/src` 仍承载审批看板 UI。
- approval conversation / decision / auto-apply lifecycle 不能误删。
- auth/bootstrap 是 Review Board 可用性的前置，不可作为“非 review dashboard”粗暴删除。

### Blockers

1. Review Board endpoint allowlist 尚未固化。
2. 非 review dashboard/API 路由清单尚未逐项列出。
3. 包级删除 `packages/web` / `packages/web-api` 明确禁止。

### 下一步

只做 allowlist/freeze：先列出 approval request list/detail/decision/conversation/auto-apply lifecycle 的必需 endpoint，再对 allowlist 外路由逐项评审。

## 6. `agent-runtime-router`

### 已有替代证据

- AgentDock scheduler / workspace / runner 是通用执行 owner。
- FEAT-081D 已物理删除 `TeamOrchestrator` 旧兼容入口。

### 仍在 Haro 的证据

- `packages/core/src/scenario-router.ts` 仍存在。
- `packages/core/src/runtime/*` 与 runtime tests 仍存在。
- `packages/cli/src/index.ts` 仍构造/引用 `ScenarioRouter`。
- MCP `schedule_task`、Haro daily workflow 与 sidecar propose/validate 链路仍需要明确边界。

### Blockers

1. 用户已指定 run/router/runtime/scenario-router 为 deferred。
2. 需要先证明 AgentDock 定时任务能稳定触发 Haro 生成提案。
3. 需要稳定生成 approval request 并在 Review Board 可审。
4. 需要证明该链路不依赖旧 `haro run/chat/team/scenario`。

### 下一步

继续 deferred。等 AgentDock 定时任务 → Haro 提案 → approval request → Review Board 可审链路稳定后，再重新评估 runtime/router/scenario 是否有窄面可退役。

## 7. 明确未做事项

- 未删除任何文件或 package。
- 未修改 provider/memory/skills/runtime/Web/MCP 业务代码。
- 未修改 AgentDock host。
- 未触碰真实 `~/.haro/evolution`、真实 `~/.haro` 或 aria-memory-vault。
- 未 approve/apply/rollback/confirm。
- 未把任何候选改为可物理删除批准。
