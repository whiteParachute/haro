# AgentDock takeover evidence 盘点（FEAT-081M / FEAT-081N / FEAT-081O / FEAT-081P / FEAT-081R / FEAT-081T / FEAT-081U / FEAT-081V / FEAT-081X）

> 日期：2026-05-28
>
> 范围：081M 只做文档、guard 状态说明与替代证据盘点；081N 只退役 Haro CLI `provider setup/onboarding` 入口；081O 只删除 setup-only Codex wizard dead file 并清理旧 provider setup remediation；081P 只删除旧 setup env-file writer helper；081R 只删除 provider setup retired 子命令 stub；081T/B-1 只固化非 review Web/API surface 为空的 guard/docs schema closure；081U/C-1 只删除 `haro run --legacy-memory` CLI opt-in/wiring；081V/D-1 只退役 `marketplace:<name>` 占位 install surface；081X/F-1 只退役 standalone `haro provider` CLI 管理面；081X/F-2 只退役 Haro-owned memory write surfaces（CLI `memory remember` 与 legacy MCP `memory_remember` 执行 fail-closed）。本文不是 provider runtime/package、Web/API runtime/package、MemoryFabric runtime 或 packages/skills/SkillsManager 删除批准，不触发真实数据迁移，不修改 core memory runtime、MCP memory tools、Web/MCP/AgentDock host，不触碰真实 `~/.haro`、`~/.haro/evolution` 或 aria-memory-vault。
>
> 当前结论：channel-layer 已在 FEAT-081K/081L 后完成 Haro-owned package 退役；FEAT-081N 已按用户产品决策退役 `haro provider setup ...` 初始化入口；FEAT-081O 已删除 `packages/cli/src/provider-codex-wizard.ts` setup-only dead file；FEAT-081P 已删除 `packages/cli/src/provider-onboarding.ts#writeProviderEnvFile` 写入 helper；FEAT-081R 已删除 `packages/cli/src/index.ts#provider-setup-retired-stub` 子命令注册 stub；FEAT-081T 已确认非 review Web/API surface 为空并将 `web-dashboard-non-review` guard status 收口为 done；FEAT-081U 已删除 `haro run --legacy-memory` opt-in 和 CLI-side MemoryFabric wiring，但不修改 core memory runtime、`haro memory`、MCP `memory_query`/`memory_remember` 默认 registry、真实 `~/.haro*` 或 aria-memory-vault；FEAT-081V 已将 `marketplace:<name>` placeholder install 改为 retired/fail-closed，仍保留 packages/skills、SkillsManager、local/git install、eat/shit、sync-runtime 与 prepareTask；FEAT-081X/F-1 已将 standalone `haro provider` CLI 管理面（root/list/doctor/models/select/env）统一 retired/fail-closed，由 AgentDock/ModelHub 承接 provider 管理 owner，但 `packages/provider-codex` runtime、diagnostics provider stage 与 sidecar/review/run/chat LLM provider path 仍保留；FEAT-081X/F-2 已将 `haro memory remember` 与 legacy MCP `memory_remember` 执行路径 retired/fail-closed，AgentDock memory / aria-memory-vault 承接 durable memory writes，core MemoryFabric、read-only/forensic memory、MCP `memory_query` 与真实数据仍保留。

## 0. 081M guard 口径

- `planning.stage=FEAT-081M` 仅表示证据刷新。
- `planning.lastCompletedStage=FEAT-081L`，因为 081M 不是物理删除阶段。
- `planning.lastUpdatedBy=FEAT-081M`。
- `deleteAllowedCount=0`、`physicalDeleteApproved=false`、`wouldDelete=false` 必须保持。
- `nextDeletionCandidate=null`、`nextReviewCandidate=null`；本文不把任何剩余候选升级为删除批准。

## 1. 总览

| 候选 | AgentDock / 共享能力替代证据 | Haro 当前 blocker | 081M 判断 | 推荐下一步 |
| --- | --- | --- | --- | --- |
| `provider-codex` | AgentDock/ModelHub 已承担 runner/model 能力方向；用户产品决策接受外部 codex CLI/auth 与 AgentDock/ModelHub 管理面作为前置 | `haro provider setup ...` 已由 FEAT-081N/R retired/removed；FEAT-081O/P 删除 wizard/env-writer；FEAT-081X 已 retired standalone `haro provider` root/list/doctor/models/select/env 管理面；provider-codex runtime、CLI bootstrap、diagnostics provider stage 与 sidecar/review/run/chat LLM path 仍在 Haro | setup/onboarding + wizard/env-writer/stub + standalone CLI management cleanup done；runtime blocked | 不再恢复 Haro provider setup/wizard/env-file writer/retired stub/CLI 管理面；provider runtime 删除必须另行证明无业务引用 |
| `memory-fabric` | AgentDock memory 与共享 aria-memory-vault 是目标 owner；FEAT-081U 已移除 `haro run --legacy-memory` CLI opt-in/wiring；FEAT-081X/F-2 已 retired `haro memory remember` 与 legacy MCP `memory_remember` write surface | 真实 `~/.haro` 数据、aria-memory-vault、MCP `memory_query` read path、core MemoryFabric runtime 与 read-only/forensic `haro memory` 仍有风险 | C-1 + F-2 write surface done；memory runtime/read path blocked | 不恢复 CLI opt-in 或 Haro-owned write surfaces；后续必须先证明 MCP read/default registry、真实数据和 core runtime owner 边界 |
| `skills-marketplace` | AgentDock skills 是目标 owner；FEAT-081V 已退役 `marketplace:<name>` 占位 install surface | `haro skills install/enable/disable`、`SkillsManager`、local/git install、eat/shit、sync-runtime、prepareTask 仍存在且受保护 | D-1 done；packages/skills deferred/freeze | 不恢复 marketplace placeholder；后续必须先拆清 AgentDock skills owner 与保留兼容资产边界 |
| `web-dashboard-non-review` | AgentDock 是平台 Web/API host；FEAT-081T 已枚举 Review Board allowlist 与非 review Web/API 路由，非 review surface 为空 | Review Board、approval conversation、auth/bootstrap、health/fallback/infrastructure 不能误删；包级删除仍禁止 | done / freeze | 保持 allowlist/freeze；不得从 081T 推导 `packages/web` / `packages/web-api` 包级或 runtime 删除批准 |
| `agent-runtime-router` | AgentDock scheduler / workspace / runner 是目标 owner | 用户指定第 4 项 deferred；仍需证明 AgentDock 定时任务能稳定触发 Haro 提案到 Review Board | deferred | 等 AgentDock 定时任务 → Haro 提案 → approval request → Review Board 可审链路稳定后再评估 |

## 2. `provider-codex`

### 已有替代证据

- AgentDock / ModelHub 方向已经承担 runner/model/provider runtime 能力。
- 081M 只确认方向，不确认 Haro provider package 可删。
- 081N 用户产品决策确认：新产品不需要等价 Haro `provider setup codex`，可以把外部 `codex login` / AgentDock Codex runner 作为前置。
- 081O 只读盘点确认 `provider-codex-wizard.ts` 已无 runtime/CLI 业务入口，仅剩自身、测试与历史文档/guard 引用，因此删除 setup-only wizard 文件和旧 wizard 测试。
- 081P 只读盘点确认 `writeProviderEnvFile` / `ProviderEnvFileWriteResult` 仅剩定义与 guard/docs 说明引用；`ProviderEnvFileSummary`、`readProviderEnvFileSummary`、`resolveProviderEnvFile` 仍服务 provider env/doctor 只读 summary，因此只删除 writer，不删除 summary。
- 081R 只删除 `packages/cli/src/index.ts#provider-setup-retired-stub`；`haro provider setup ...` 现在由 provider command unknown-command fail-closed，不再依赖 retired stub marker。
- 081X 用户产品决策确认 Haro 仅保留当前产品必要基本功能；standalone `haro provider` CLI 管理面已 retired/fail-closed，AgentDock/ModelHub 是 provider 管理 owner。

### 仍在 Haro 的证据

- `packages/provider-codex/package.json` 仍存在。
- `packages/cli/package.json` 仍依赖 `@haro/provider-codex`。
- `packages/cli/src/index.ts` 仍引用 `createCodexProvider` 进行默认 provider bootstrap。
- `packages/cli/src/index.ts` 不再注册 `haro provider setup ...`；调用会由 provider command unknown-command fail-closed，不再调用 setup wizard/config/env/doctor 写入流程。
- `packages/cli/src/index.ts` 的 standalone provider root/list/doctor/models/select/env 管理面已由 FEAT-081X 改为统一 retired/fail-closed；不再调用 `formatProviderList`、`runProviderDoctor`、`listProviderModels`、`writeProviderConfig` 或 `parseProviderScope`。
- `packages/cli/src/provider-onboarding.ts` 仍保留 runtime/diagnostics 可用的 provider helper；旧 `provider-codex-wizard.ts` 已由 FEAT-081O 删除，旧 `writeProviderEnvFile` writer 已由 FEAT-081P 删除。
- `packages/cli/src/diagnostics.ts` provider stage 保留；081X 后 remediation 不再引导 standalone `haro provider doctor` 管理面，而指向 AgentDock/ModelHub provider management、外部 `codex login --device-auth` / `OPENAI_API_KEY` 与 `haro setup --check`。
- `packages/provider-codex/test/*` 仍覆盖 auth、capability、models、health 等 provider 行为。

### Blockers

1. `haro provider setup/onboarding` 与 standalone provider CLI 管理面已摘线，但不能扩展为 provider-codex package/runtime 删除。
2. diagnostics provider stage 和 sidecar/review/run/chat LLM provider path 仍需保护。
3. CLI 默认 provider bootstrap 仍依赖 `createCodexProvider`。
4. 082A/082B 的 LLM draft / feedback rewrite 仍需要 provider path 或等价 bridge。

### FEAT-081N / FEAT-081O / FEAT-081P / FEAT-081R 完成记录

081N 已完成窄面摘线：`haro provider setup ...` 当时退役并 fail-closed；081R 进一步删除 retired 子命令 stub，当前调用走 unknown-command fail-closed。该结论不代表 `packages/provider-codex`、`createCodexProvider`、`readLocalCodexAuth`、diagnostics provider stage 或 run/chat/LLM provider path 可删；FEAT-081X 后 standalone provider CLI 管理面已单独 retired。

081O 已完成上述下一步中的最小安全项：删除 `packages/cli/src/provider-codex-wizard.ts` 与只服务该 wizard 的测试，并清理 provider diagnostics/remediation 旧 setup 文案。081P 继续删除无业务入口的 `writeProviderEnvFile` / `ProviderEnvFileWriteResult` 旧 setup env-file writer 残留，同时保留 env file 只读 summary。081R 删除最后的 provider setup retired 子命令 stub，让 `haro provider setup ...` 走 unknown-command fail-closed。该结论仍不代表 provider-codex runtime/package 删除批准。

### FEAT-081X 完成记录

FEAT-081X/F-1 退役 standalone `haro provider` CLI 管理面：`haro provider`、`provider list`、`provider doctor`、`provider models`、`provider select`、`provider env` 均 fail-closed，输出 FEAT-081X retired / AgentDock/ModelHub owner 文案，不写 provider config/env/state。该记录只覆盖 CLI 管理 surface，不代表 `packages/provider-codex` runtime、`createCodexProvider`、`readLocalCodexAuth`、diagnostics provider stage 或 sidecar/review/run/chat LLM path 可删。

## 3. `memory-fabric`

### 已有替代证据

- memory owner 方向应收口到共享 aria-memory-vault / AgentDock memory。
- Haro sidecar 主线只应记录 proposal/validation/approval/application artifacts，不应拥有用户长期记忆。
- FEAT-081U/C-1 已删除 `haro run --legacy-memory` CLI opt-in、CLI-side MemoryFabric factory/path resolver/wrapup hook wiring；普通 `haro run` 不创建 `memory/` 目录，也不注入 `<memory-context>`。

### 仍在 Haro 的证据

- `packages/core/src/index.ts` 仍导出 `createMemoryFabric`。
- `packages/core/src/memory/*` 与 core legacy tests 仍存在。
- `packages/cli/src/commands/memory.ts` 仍存在 legacy memory CLI。
- `packages/mcp-tools/src/index.ts` 默认 registry 仍注册 `memory_query` / `memory_remember`；081X/F-2 后 `memory_remember` 保留注册但执行 `TARGET_DISABLED` fail-closed。
- `packages/mcp-tools/src/tools/memory-query.ts` 仍提供 read-only 兼容 MCP tool；`memory-remember.ts` 仅保留 fail-closed compatibility surface。
- `packages/core/src/memory/*`、`packages/core/src/services/memory.ts` 仍受保护；`packages/cli/src/commands/memory.ts` 仅退役 `remember` 写入口，query/list/show/export/recover-snapshot 仍保留。

### Blockers

1. 真实 `~/.haro` 数据不在删除范围内，不能被测试或清理任务误触碰。
2. aria-memory-vault 是共享资产，不属于 Haro repo 删除面。
3. MCP `memory_query` read path 尚未完成隔离或替代；`memory_remember` 已由 081X/F-2 fail-closed，但仍保留注册以维持 legacy tools/list 稳定。
4. 未证明 sidecar 主链路完全不读写 Haro-owned MemoryFabric。
5. 081U/F-2 的 scoped removals 仅限 run opt-in 与 write surfaces，不代表 core MemoryFabric、read-only/forensic `haro memory` 或 MCP `memory_query` 可删。

### 下一步

继续只读边界证明：列出真实数据路径、MCP `memory_query` 注册路径、core barrel export 下游 import，并设计 read-only/forensic 替代或 ownership 方案；没有这些证据前不得删除 memory runtime、read-only memory CLI 或 MCP memory_query tool。

### FEAT-081X/F-2 完成记录

FEAT-081X/F-2 退役 Haro-owned memory write surfaces：`haro memory remember` 保留 known subcommand/options 但 fail-closed，legacy MCP `memory_remember` 继续出现在 default registry/tools-list 但执行直接返回 `TARGET_DISABLED`，文案指向 AgentDock memory / aria-memory-vault。该记录不读写、迁移或删除真实 `~/.haro*` / aria-memory-vault，不批准 `packages/core/src/memory/**`、`createMemoryFabric`、MCP `memory_query`、`haro memory query/list/show/export/recover-snapshot` 或 forensic data path 删除。

## 4. `skills-marketplace`

### 已有替代证据

- AgentDock skills 是目标 owner。
- Haro 不再发展通用 skills marketplace。
- FEAT-081V/D-1 已将 `marketplace:<name>` 占位 install surface 改为明确 retired/fail-closed：提示使用 AgentDock skills 做 marketplace 分发，或显式安装 local/git skill。

### 仍在 Haro 的证据

- `packages/skills/package.json` 仍存在。
- `packages/cli/src/index.ts` 仍初始化 `SkillsManager`。
- CLI 仍保留 `haro skills install/enable/disable` 等用户入口。
- `SkillsManager.install` 仍保留 local path / git URL 安装分支；仅 `marketplace:<name>` placeholder 变为 retired/fail-closed。
- eat/shit 兼容资产、`syncRuntimeSkills` 与 `prepareTask` 仍保留并有测试覆盖。

### Blockers

1. marketplace placeholder 已退役，但必须保留的 local/git install、eat/shit 兼容资产、sync-runtime 与 prepareTask 边界仍需继续保护。
2. 未证明 `haro skills install/enable/disable` 整体已由 AgentDock skills 等价承接或明确退役。
3. 相关 legacy tests 仍需分类稳定后再考虑删除 packages/skills 或 SkillsManager。

### 下一步

081V 后继续把 skills 保持 freeze/defer：不要恢复 marketplace placeholder；继续把 local/git install、runtime skill sync、eat/shit 兼容资产、prepareTask 分为 keep / freeze / candidate 三类。只有明确无主链路依赖的窄面才能另起单项评审。

## 5. `web-dashboard-non-review`

### 已有替代证据

- AgentDock 是平台 Web/API host。
- Haro Web 当前主线已收敛为 proposal review board、approval conversation、auth/bootstrap。
- FEAT-081T/B-1 已完成 Review Board allowlist 与非 review Web/API 路由枚举；非 review Web/API surface 为空。
- Guard 中 `web-dashboard-non-review.candidatePriority.status=done` 只表示 schema/enumeration closure，不表示 runtime 或包级删除批准。

### 仍需保护

- `packages/web-api/src/routes/approval-requests.ts` 是 review board 主路由。
- `packages/web/src` 仍承载审批看板 UI。
- approval conversation / decision / auto-apply lifecycle 不能误删。
- auth/bootstrap、`/api/health`、SPA fallback、404 fail-closed 与共享基础设施是 Review Board 可用性的前置，不可作为“非 review dashboard”粗暴删除。

### 081T closure 结果

1. Review Board allowlist 已固化为保留范围。
2. 非 review dashboard/API 路由清单为空。
3. 包级删除 `packages/web` / `packages/web-api` 与 Web/API runtime 删除仍明确禁止。
4. 081T 不新增 `physicalRemovals`；`completedPhysicalRemovals` 保持 13。

### 下一步

继续保持 allowlist/freeze：如未来新增非 review Web/API surface，必须逐路由单项评审；不得从 081T 推导 Web/API 包级删除批准。

## 6. `agent-runtime-router`

### 已有替代证据

- AgentDock scheduler / workspace / runner 是通用执行 owner。
- FEAT-081D 已物理删除 `TeamOrchestrator` 旧兼容入口。
- FEAT-081S 已删除 `packages/cli/src/index.ts#legacy-team-orchestrator-removed-result`，team-mode 无 skill directOutput 时不再返回专用 removed-result payload，而是走普通 single-agent runner/fallback。

### 仍在 Haro 的证据

- `packages/core/src/scenario-router.ts` 仍存在。
- `packages/core/src/runtime/*` 与 runtime tests 仍存在。
- `packages/cli/src/index.ts` 仍构造/引用 `ScenarioRouter`。
- MCP `schedule_task`、Haro daily workflow 与 sidecar propose/validate 链路仍需要明确边界。

### Blockers

1. 081S 只解除 TeamOrchestrator removed-result 兼容 payload 的窄面；不能扩大为 scenario-router/runtime 删除。
2. `packages/core/src/scenario-router.ts`、runtime、run/chat/LLM provider path 仍有业务引用。
3. 需要稳定生成 approval request 并在 Review Board 可审。
4. 需要证明 AgentDock runner/workspace path 可替代旧 `haro run/chat/team/scenario` 才能继续评估。

### 下一步

081S 后继续 blocked/fail-closed：只记录 removed-result payload scoped removal。等 AgentDock 定时任务 → Haro 提案 → approval request → Review Board 可审链路稳定后，才能重新评估 runtime/router/scenario 是否还有窄面可退役。

## 7. 明确未做事项

- 未删除任何文件或 package。
- 除 FEAT-081V 退役 `marketplace:<name>` placeholder 文案/测试外，未修改 provider/memory/runtime/Web/MCP 业务代码，也未删除 packages/skills、SkillsManager、local/git install、eat/shit、sync-runtime 或 prepareTask。
- 未修改 AgentDock host。
- 未触碰真实 `~/.haro/evolution`、真实 `~/.haro` 或 aria-memory-vault。
- 未 approve/apply/rollback/confirm。
- 未把任何候选改为可物理删除批准。

## FEAT-081X/F-3 takeover evidence — legacy MCP `memory_query` read entry retired

FEAT-081X/F-3 retires only the legacy MCP `memory_query` read execution path. This closes the Haro-owned MCP read surface while preserving compatibility and current product-essential Haro sidecar behavior.

Evidence:
- `memory_query` is still registered in the default MCP registry and tools/list remains stable alongside `send_message`, `memory_remember`, and `schedule_task`.
- `packages/mcp-tools/src/tools/memory-query.ts` advertises retired `FEAT-081X/F-3` semantics and returns `TARGET_DISABLED` for valid calls.
- The implementation does not access `ctx.deps.memory` or call `searchMemoryFiles`; no `~/.haro` memory data is read.
- F-2 remains in force: `memory_remember` write surfaces stay retired/fail-closed.

Boundary:
- This does not approve deleting MemoryFabric/core runtime, `createMemoryFabric`, read-only/forensic `haro memory query/list/show/export/recover-snapshot`, real `~/.haro*` data, `~/.haro/evolution`, AgentDock memory, or aria-memory-vault.
- Haro current product shape remains AgentDock self-evolution sidecar proposal/review workflows, Review Board, approval APIs, sidecar artifacts/MCP mainline, and product-essential provider/run/review paths.
