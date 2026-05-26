# Haro 10B AgentDock 边界复核

> 日期：2026-05-21
>
> 来源：owner 原始 0-10 流程中的 **10B：AgentDock 边界复核**。
> 本文只回答“哪些旧 Haro 能力已由 AgentDock 承担、哪些不能删”。
> 本文不是删除批准；不触发真实 `~/.haro/evolution/` 写入，不重启服务，不 approve/apply/rollback。

## 0. 复核结论

### 0.1 已由 AgentDock 承担的能力

以下能力已有 AgentDock 侧直接证据，因此 Haro 不应继续把它们作为自有主线能力发展：

1. session / runtime / workspace 生命周期；
2. runner / model / runner profile；
3. IM channel，包括 Feishu / Telegram / QQ / WeChat 的统一连接与发送；
4. scheduler / task 执行与任务注入；
5. memory 运行会话、memory runner 选择与 memory API；
6. workspace delegation 与短窗口重复委托去重；
7. Haro approval 的 AgentDock 侧 IM 通知桥与 decision 转发入口；注意这只是桥接，不代表 AgentDock 拥有 Haro approval artifact。

### 0.2 Haro 必须继续保留的能力

这些是 Haro 作为 AgentDock self-evolution sidecar 的核心职责，不能按“AgentDock 已承接 runtime”来删除：

1. proposal / validation / approval-request / approval-decision contract；
2. application / snapshot / rollback / blocked-proposal-event contract；
3. feedback / revision metadata 与后续 feedback-driven rewrite；
4. MCP sidecar tools 的 observe / propose / validate / asset query / daily workflow / lint；
5. observation batch / frontier source intake / proposal-content 等生成 proposal 所需的 evidence contract；
6. Haro Web review board 与 approval conversation；
7. L0/L1 gated apply / rollback 的 artifact 记录与 gate 检查。

### 0.3 可以冻结或 deprecated，但不能马上物理删除的 Haro 残留

这些能力方向已被 AgentDock 承接或不再发展，但当前代码和测试仍有依赖，不能直接删：

- `packages/provider-codex`
- `packages/skills`
- `packages/core/src/memory/*`
- `packages/core/src/scenario-router.ts`
- legacy CLI 的 provider/memory/skills/team/runtime 入口
- 非 review-board 的旧 dashboard/control-plane 页面或 API（若后续发现仍存在）

FEAT-081K/081L 已完成 channel-layer 解绑与物理删除：`packages/channel`、`packages/channel-feishu`、`packages/channel-telegram` 不再是当前 blocker；MCP `send_message` 保留并走 AgentDock IPC messages contract。

物理删除前必须补齐：影响面、替代方案、export/import 解绑、回滚方案、`test:sidecar` + `test:legacy` 验证，以及 owner/supervisor 明确批准。081M 只刷新证据，不新增删除批准。

## 1. AgentDock 已承接能力：证据表

| 能力域 | 直接证据 | 复核判断 | 对 Haro 减法的影响 |
| --- | --- | --- | --- |
| session / runtime | AgentDock `src/session-runtime-manager.ts:5-12` 明确是 session/runtime facade；`src/routes/sessions.ts:139-164` 处理 session alias 与 session record 解析 | AgentDock 是会话与 runtime host | Haro-owned workbench/runtime/control-plane 不再发展，只保留迁移/兼容所需代码 |
| runner / model | AgentDock `src/runner-registry.ts:7-17` 注册 runner，`src/runner-registry.ts:28-57` 根据 model 推断 runner，`src/routes/runners.ts:13-37` 提供 runner list/health/models/profile-schema API | AgentDock 管 runner/model/catalog/profile | Haro `provider-codex` / ChatGPT auth onboarding 只应作为 legacy；删除前要清 CLI 依赖 |
| memory runner | AgentDock `src/runner-registry.ts:87-120` 判断 memory runner；`src/routes/memory.ts:138-168` 返回 memory session 和 runner 能力；`src/routes/memory.ts:835-903` 管 memory config | AgentDock 管 memory 会话与 memory runner 选择 | Haro MemoryFabric 不再是主线 memory owner，但因为 mcp-tools legacy memory 仍依赖，不能直接删 |
| IM / channel | AgentDock `src/im-manager.ts:1-18` 统一创建 Feishu/Telegram/QQ/WeChat channel；`src/im-manager.ts:84-105` 连接 channel；`src/im-manager.ts:119-146` 按 JID 自动路由发送消息；FEAT-081K/081L 后 Haro MCP `send_message` 已改走 AgentDock IPC，`packages/channel*` 已删除 | AgentDock 管 IM/channel | channel-layer 已完成本轮收口；继续保护 MCP `send_message` 与 AgentDock 生产消息链路 |
| scheduler / task | AgentDock `src/task-scheduler.ts:28-41` 定义 scheduler deps；`src/task-scheduler.ts:64-117` 把 agent task 注入 chat；`src/task-scheduler.ts:153-193` 执行 script task；`src/routes/tasks.ts:156-220` 创建 task API | AgentDock 管定时任务与 host task lifecycle | Haro 不再扩通用 cron/scheduler；Haro daily 只能作为被 AgentDock/MCP 触发的 sidecar workflow |
| workspace delegation | AgentDock `src/workspace-delegation-dedupe.ts:68-92` 分类 exact_text / similar_title 重复委托；AgentDock commit `24f5894` 已修短窗口重复 workspace 委托 | AgentDock host 管跨 workspace dispatch 与重复抑制 | Haro 不自建多 workspace supervisor/runtime；L2/L3 只产出 execution plan，由 AgentDock 派 workspace |
| Haro approval bridge | AgentDock `src/routes/haro-approvals.ts:39-54` 读取 approval requests；`src/routes/haro-approvals.ts:66-100` 写 decision；`src/routes/haro-approvals.ts:103-173` 通过 IM 通知 request/decision；`src/haro-approval.ts:24-75` 复刻 approval schemas，`src/haro-approval.ts:157-167` 原子写 JSON | AgentDock 已有 Haro approval 桥接层，但只是桥接，不是 Haro artifact owner | Haro Web review board 和 contract 不能删；AgentDock route 是外部操作入口/通知桥 |

## 2. Haro 必须保留能力：证据表

| 能力域 | 直接证据 | 复核判断 | 删除结论 |
| --- | --- | --- | --- |
| proposal + feedback context | Haro `packages/agentdock-contract/src/proposal.ts:5-14` 定义 target kinds；`packages/agentdock-contract/src/proposal.ts:38-46` 定义 `FeedbackContextSchema`；`packages/agentdock-contract/src/proposal.ts:48-66` 定义 `EvolutionProposalSchema` | proposal 是 Haro 的核心 artifact，且已出现 feedback metadata | keep；下一步应补强 revision metadata，不应删除 |
| approval request / decision | Haro `packages/agentdock-contract/src/approval-request.ts:20-47` 定义 approval request；`packages/agentdock-contract/src/approval-request.ts:49-70` 定义 decision 且要求 request-changes 必须有 direction | 用户 review 的关键 contract | keep；第 3 阶段 feedback-driven rewrite 依赖它 |
| application / snapshot / rollback | Haro `packages/agentdock-contract/src/application.ts:5-22` 定义 gate codes；`packages/agentdock-contract/src/application.ts:24-30` 定义 application status；`packages/agentdock-contract/src/application.ts:52-61` snapshot；`packages/agentdock-contract/src/application.ts:80-89` rollback；`packages/agentdock-contract/src/application.ts:91-163` application invariants | 执行闭环与回滚保障属于 Haro artifact ledger | keep；L0/L1 gated apply、后续 L2/L3 执行结果都要落这里 |
| blocked proposal event | Haro `packages/agentdock-contract/src/blocked-proposal-event.ts:4-20` 定义 `AWAITING_FEEDBACK_INCORPORATION` blocked event | self-heal 与 feedback rewrite 的阻断事件已有 contract | keep；后续可补更多 feedback/revision 事件类型 |
| sidecar MCP surface | Haro `packages/mcp-tools/src/sidecar-tools.ts:1-8` 明确 AgentDock-facing registry 默认只读/干跑，gated-write opt-in；`packages/mcp-tools/src/sidecar-tools.ts:36-47` 区分 sidecar read-only tool 与 gated write tool；`packages/mcp-tools/src/sidecar-tools.ts:366-378` daily workflow 只写 Haro sidecar artifacts，不 apply；`packages/mcp-tools/src/sidecar-tools.ts:462-483` 只有 `options.gatedWrite` 才注册 apply/rollback | 这是 Haro 与 AgentDock 的主 contract surface | keep；不能因为旧 MCP/workbench 遗留而删除 sidecar registry |
| Haro Web review board | Haro `packages/web-api/src/standalone.ts:1-6` 明确 Web API 只服务 approval-request review，AgentDock 是 execution host；`packages/web/src/components/layout/Sidebar.tsx:43-46` 显示“Haro Web 只做看板，不承担 workflow runtime”；`packages/web-api/src/routes/approval-requests.ts:206-240` 提供 request detail/decision；`packages/web-api/src/routes/approval-requests.ts:246-272` approve 后才触发 auto apply | Web review board 是 Haro 核心人审面，不是旧通用 dashboard | keep；只能删除非 review-board 的旧 dashboard/control-plane 残留 |
| approval conversation | Haro `packages/web-api/src/routes/approval-requests.ts:438-465` 调用 `runtime.reviewConversationReply` 流式生成审批对话回复 | 这是 feedback-driven rewrite 的前置交互能力 | keep；第 3 阶段应把 conversation/direction 接入 revision metadata |

## 3. 旧 Haro 模块删除 readiness

| 模块 / 方向 | AgentDock 替代或归属 | 当前 Haro 依赖证据 | 当前结论 | 物理删除前置条件 |
| --- | --- | --- | --- | --- |
| `packages/provider-codex` | AgentDock runner/model / ModelHub | `packages/cli/package.json` 仍依赖 `@haro/provider-codex`；`packages/cli/src/index.ts`、provider wizard、diagnostics 仍引用 provider-codex；新用户 Codex/ChatGPT 登录与凭据初始化尚未被 AgentDock 等价证明 | deprecated/freeze；不能删 | 先补 AgentDock/ModelHub provider bridge、登录/凭据初始化、doctor/list/models 等价证据；081N 最多评审 setup/onboarding 子面 |
| `packages/channel`, `channel-feishu`, `channel-telegram` | AgentDock IM manager/channel | 历史 blocker 已在 FEAT-081K/081L 处理：mcp-tools 不再依赖 `@haro/channel`，CLI `haro channel list/doctor` 与 `packages/channel*` 已删除；081L hotfix `03c35cb` / `c3ae19b` 要求退役 `haro channel ...` fail-closed | done；无下一项 channel 删除授权 | 继续保护 MCP `send_message`、AgentDock 生产消息与真实 Feishu/Telegram/IM 投递链路 |
| `packages/skills` / skills marketplace | AgentDock skills/agent runtime | `packages/cli/package.json:36` 仍依赖 `@haro/skills`；旧 docs/spec 已打 legacy | freeze；不能直接删 | 移除 CLI legacy skills 入口与测试；确认 sidecar MCP 不依赖 skills package |
| Haro MemoryFabric | AgentDock memory / aria-memory-vault | `packages/mcp-tools/src/tools/memory-query.ts:1-6` 和 `memory-remember.ts:1-7` 都标注为 historical compatibility；`packages/core/src/memory/memory-fabric.ts:139-142` 明确 sidecar baseline 消费 AgentDock-owned memory refs；`packages/core/package.json:83-84` legacy tests 仍覆盖 memory-fabric | deprecated compatibility；不能删 | 移除或替换 `memory_query`/`memory_remember` legacy tool；清 `createMemoryFabric` exports；保留观察引用；legacy tests 更新 |
| `team-orchestrator.ts` | AgentDock workspace/multi-agent execution | `packages/core/src/team-orchestrator.ts:35-46` 仍定义 legacy team 状态；`packages/core/src/index.ts:173-210` 仍导出；`packages/core/package.json:84` legacy tests 含 `team-orchestrator.test.ts` | freeze；不能直接删 | 先取消 public exports；迁移 workflows service；确认 no import；保留或归档 tests |
| `scenario-router.ts` | AgentDock routing/workspace dispatch | `packages/core/src/scenario-router.ts:6-20` 仍定义 task/execution/orchestration modes；`packages/core/src/index.ts:141-172` 仍导出；`packages/core/package.json:84` legacy tests 含 `scenario-router.test.ts` | freeze；不能直接删 | 先解绑 exports/imports；确认 CLI run/chat 不依赖；迁移/归档 tests |
| legacy CLI provider/channel/memory/team/runtime 入口 | AgentDock Web/API/runner/memory | `packages/cli/package.json:23-24` 已把 sidecar/legacy 测试拆开，legacy suite 仍保留 provider/channel/wizard 等测试 | 保留 warning；逐步隐藏 | 继续保持 human warning；JSON 不污染；删除前跑 `@haro/cli test:legacy` |
| 旧 docs/specs | Haro 新主线 docs | legacy banner 与删除候选文档已经存在 | 第一批可进入 archive/review | 搬到 `docs/planning/archive/legacy-workbench/` 前确认 link/check；不影响 `test:sidecar` |

## 4. Unknown / 需要后续确认

1. **AgentDock 是否已覆盖所有旧 Haro Web dashboard 页面**：当前 Haro Web 源码显示 review-board 边界很窄，但仍需在物理删除前逐 route/page 列表确认。
2. **provider/memory/skills package 的发布面**：删除 package 前还要查 `pnpm-workspace.yaml`、package exports、dist、发布脚本、外部部署是否引用；channel package 发布面已在 FEAT-081L 收口。
3. **feedback/revision contract 仍不完整**：当前 `FeedbackContextSchema` 是基础，但还不能完整表达“修订自哪个 proposal、吸收/未吸收哪些意见、替代哪些旧 proposal”。删除与 feedback 相关的旧能力前，必须先补第 3 阶段。
4. **L2/L3 workspace dispatch contract 未定义**：AgentDock 能派 workspace，但 Haro 到 AgentDock 的 patch/execution plan contract 还未落正式 schema；因此不能把 team/scenario 物理删除当作已经完成 L2/L3。
5. **Web review board endpoint allowlist 未固化**：后续删除 Web/API 旧 dashboard 前，应列出 approval-request / conversation / decision / auto-apply lifecycle 必需 endpoint，避免误删 review board。

## 5. 10B 对后续路线的约束

### 5.1 可以推进的减法

1. docs/spec archive：优先级最高，风险最低；
2. legacy CLI warning/hidden：继续保持 JSON 不污染；
3. public export unlink：先从 `scenario-router` / `team-orchestrator` 这类单文件模块做只读影响面；
4. package dependency unlink：provider/channel/skills/memory package 删除前必须先清依赖。
5. workspace/package publish surface：删除 package 前必须同步清 `pnpm-workspace.yaml`、package `main`/`exports`、dist 暴露面和发布脚本引用。

### 5.2 不能推进的减法

1. 不直接删除 `@haro/agentdock-contract`；
2. 不删除 Haro Web approval review board；
3. 不删除 application/snapshot/rollback artifacts；
4. 不删除 feedback/revision 基础字段；
5. 不删除 sidecar MCP observe/propose/validate/daily/lint/apply/rollback registry；
6. 不动真实 `~/.haro/evolution/` 数据作为“清理”。

### 5.3 对下一步的建议

按 owner 原始 0-10 计划，10B 完成后，下一步不应继续扩大 self-heal 自动写入；主线应回到 **第 3 节：feedback-driven proposal rewrite**。

推荐切片：

1. `FEAT-076A revision metadata contract`：补正式 revision artifact/schema；
2. `FEAT-076B feedback rewrite planner`：把 request-changes direction 结构化；
3. `FEAT-076C anti no-op rewrite gate`：防止引用了 feedback 但 proposal 实际没变；
4. `FEAT-076D review board rewrite flow`：从 Web conversation / decision 串到 revision proposal 重提。

## 6. 验证要求

任何后续删除 PR 至少要跑：

```bash
git diff --check
pnpm test:sidecar
pnpm test:legacy
```

按触及范围追加：

```bash
pnpm -F @haro/cli test:sidecar
pnpm -F @haro/cli test:legacy
pnpm -F @haro/core test:legacy
pnpm -F @haro/mcp-tools test
pnpm -F @haro/web-api test
```

如触及 AgentDock bridge，则还要在 AgentDock 侧至少跑对应 route/unit/build 验证，并确认不自动重启 `happyclaw.service`。

## 7. Otherway 只读复核补充（2026-05-21）

> 来源：`wdeleg_mpfh0744_p09n7q`，复核 `haro-side@823d3e7` / `haro@1ae31f9`。
> 该回执未修改文件、未提交、未 push、未重启、未触碰真实 `~/.haro/evolution`。

### 7.1 对本文结论的确认

Otherway 的复核结论与本文一致：

- Haro 旧 workbench/runtime 方向继续 freeze/deprecate；
- proposal / validation / approval / snapshot / rollback / feedback / review board / sidecar MCP-CLI 主链路必须保留；
- 物理删除要先解除 CLI、core barrel export、mcp legacy default registry、tests/docs 依赖。

### 7.2 必须补入“必须保留”的能力

Otherway 额外确认以下能力也是 keep 范围：

| 能力 | 额外证据 | 保留原因 |
| --- | --- | --- |
| validation gate | `packages/agentdock-contract/src/validation.ts:5-48` | 没有 validation 就无法判断风险、requiredTests、rollbackReady、applyEligible、blockingReasons；不能安全 apply |
| patch branch plan | `packages/agentdock-contract/src/patch-branch.ts:9-42`、`packages/cli/src/commands/agentdock-sidecar.ts:1119-1150` | L2/L3 代码级变更不能让 Haro 直接 apply，必须以 patch/execution plan 交给 AgentDock workspace |
| asset event / registry artifact | `packages/agentdock-contract/src/asset-event.ts:4-57` | proposal/application/rollback 需要审计轨迹和 asset lifecycle |

这些补充进一步说明：第 6.2 的 L2/L3 方向不是“删掉 Haro 执行能力”，而是让 Haro 只保留 plan/artifact contract，由 AgentDock 执行 workspace 侧实现。

### 7.3 更细的 deletion blockers

物理删除旧模块前，需额外检查下列 blocker：

| blocker | 额外证据 | 要求 |
| --- | --- | --- |
| core barrel exports | `packages/core/src/index.ts:26-55` 仍导出 agent；`:56-81` 仍导出 MemoryFabric；`:141-180` 仍导出 scenario/team；`:211-219` 仍导出 runtime runner | 删除前先解除 `packages/core/src/index.ts` public export，并确认下游 import 清零 |
| CLI bootstrap | `packages/cli/src/index.ts:1757-1808` 仍初始化 skills/agent/runtime；`:1980-2121` 仍有旧 run/chat execution path | 删除前先让 CLI run/chat 完全 legacy 化、隐藏或迁移 |
| MCP legacy default registry | `packages/mcp-tools/src/index.ts` 仍注册 legacy `send_message`、`memory_*`、`schedule_task`；FEAT-081K 已让 `send_message` 改走 AgentDock IPC，但 `memory_*` 与 `schedule_task` 仍需分别评审 | 必须区分 sidecar registry 与 legacy registry；确认 `haro mcp` 主链路只暴露 sidecar tools |
| channel legacy tools | FEAT-081K 已移除 `mcp-tools` 对 `@haro/channel` / `ChannelRegistry` 的依赖；FEAT-081L 已删除 `packages/channel*`；081L hotfix 要求退役 `haro channel ...` 不落入 REPL fallback | 当前无下一项 channel 删除授权；继续保护 MCP `send_message` 与 AgentDock 生产消息链路 |
| provider-codex CLI 依赖 | `packages/cli/src/index.ts:2895-2898` 仍调用 `createCodexProvider` | 删除 provider-codex 前先迁移 provider bridge 或改为 legacy-only warning |
| skills CLI 依赖 | `packages/cli/src/index.ts:1757-1762` 初始化 `SkillsManager`；`:1985-1987` 仍执行 `prepareTask` | 删除 skills 前先确认 sidecar 不依赖 old skills，保留 eat/shit 资产语义的迁移路径 |
| scenario/team execution path | `packages/cli/src/index.ts:2006-2011` 仍 classify/route/createWorkflow；`:2087-2103` 仍有旧 team execution path | 删除 scenario/team 前先移除旧执行路径和 legacy tests |
| permission-budget | `packages/core/src/index.ts:105-140` 导出；`packages/cli/src/index.ts:2018-2026` 仍创建 BudgetStore | 删除前确认 sidecar apply gate 不再借用旧 budget |
| 真实数据目录 | `docs/planning/haro-legacy-remove-candidate-review.md:283-313` negative scope 已包括 `~/.haro/evolution/`、approval decisions、proposals、validations、snapshots、rollbacks | 删除任务不得触碰真实数据；smoke 必须使用临时 `HARO_HOME` |

### 7.4 删除顺序补强

结合 Otherway 回执，删除顺序调整为：

1. archive 旧 docs/spec；
2. 固化 CLI legacy warning；
3. 切断 `packages/core/src/index.ts` barrel exports；
4. 分离 `@haro/mcp-tools` legacy default registry 与 sidecar registry（channel 依赖已由 FEAT-081K/081L 收口，剩余重点是 memory_* / schedule_task 边界）；
5. 移除 CLI 对 provider/channel/agent/runtime/memory/skills/router/budget 的默认构造；
6. 再评审单文件删除，优先 `team-orchestrator.ts`、`scenario-router.ts`；
7. 最后才考虑 provider/channel/memory/runtime package 物理删除。

第 7.4 节是 6.4 删除候选评审的细化执行序；删除 PR 以 `docs/planning/haro-legacy-remove-candidate-review.md` 的候选边界为上游依据，以本文第 7.4 的 blocker 顺序为执行检查清单。


### 7.5 Claudeway 异构复核补充（2026-05-21）

> 来源：`wdeleg_mpfhkqav_ucaadd`，Claudeway/Opus 异构只读复核。
> 结论：通过，可合，无需补改；未修改文件、未动真实 `~/.haro/`、未 approve/apply/rollback、未重启、未 push。

Claudeway 逐条 spot-check 了约 20 个 AgentDock / Haro file:line 引用，确认本文三类划分与当前 HEAD 代码实情吻合，未发现虚构引用、缺证据或过度推断。

复核补充的 P2 已吸收如下：

1. 在 must-keep 中显式列入 observation batch / frontier source intake / proposal-content evidence contract；
2. 在删除前置条件中补入 `pnpm-workspace.yaml`、package `main`/`exports`、dist 暴露面和发布脚本；
3. 将 AgentDock approval bridge 表述明确为“IM 通知桥与 decision 转发入口”，不是 Haro artifact owner；
4. 在 unknown 中补入 Web review board endpoint allowlist；
5. 明确本文第 7.4 与 `haro-legacy-remove-candidate-review.md` 的关系。

### 7.6 Selfway AgentDock 侧复核补充（2026-05-21）

> 来源：`wdeleg_mpfhj4g3_bvxvi5`，Selfway 对 AgentDock 当前实现的只读复核重发版。
> 结论：AgentDock 已承接平台控制面；Haro 仍应保留 evolution 领域内核和 sidecar 边界。

Selfway 从 AgentDock 侧补充了更细的平台控制面证据：

| AgentDock 能力 | 补充证据 | 对 Haro 边界的含义 |
| --- | --- | --- |
| session/workspace/runner 数据模型 | `src/db.ts:871-930` 定义 sessions / session_bindings / session_state / worker_sessions / runner_profiles；`src/types.ts:237-249` 定义 `SessionKind = main/workspace/worker/memory` 与 runner/model/thinking_effort 字段 | Haro 不应再拥有通用 session/workspace/runner 控制面 |
| session/workspace API | `src/routes/sessions.ts:1030-1258` 创建 session/workspace；`:1261-1308` 列举 session；`:1874-1905` 读取 session messages | Haro 旧 workbench/session UI 只能 legacy/freeze |
| runtime 启动 | `src/runtime-runner.ts:861-943` 注入 workspace/memory/IPC/skills/MCP/runner config；`:1042-1178` spawn agent-runner 并处理 stdout/stderr/timeout/close | Haro 不自建 runner；L2/L3 由 AgentDock workspace 执行 |
| worker / conversation agent | `src/routes/agents.ts:161-223` 创建 conversation agent；`src/db.ts:4342-4410` 同步为 `sessions(kind='worker')` + `worker_sessions` | Haro team/scenario 只能保留 plan/artifact，不能继续扩执行器 |
| SDK task / subagent 生命周期 | `src/index.ts:2560-2670` 处理 `task_start`、`tool_use_end`、`task_notification` | AgentDock 是多 agent 生命周期 host |
| one-shot invoke_agent | `container/agent-runner/src/plugins/invoke-agent-plugin.ts:1-8`、`:90-149` 定义跨 provider one-shot agent 调用；`:4-7`、`:57-64` 说明 one-shot 子 agent 没有 AgentDock MCP 工具 | 可用于 bounded review/research，但不是 Haro evolution 内核替代 |
| workspace delegation 回传 | `container/agent-runner/node_modules/agentdock-agent-runner-core/src/plugins/messaging.ts:66-130` 写 `workspace_message` IPC；`src/index.ts:3907-4022` host 处理目标解析、权限、去重、写入目标 chat、enqueue；`src/index.ts:3711-3767` 回写 delegation result；`src/workspace-delegation-return-tracker.ts:14-107` 维护 pending meta | 跨 workspace dispatch/回传归 AgentDock；Haro 只记录 execution/application artifact |
| IM 显式发送模型 | `container/agent-runner/node_modules/agentdock-agent-runner-core/src/plugins/messaging.ts:23-63` 明确 stdout 不会发 IM，必须显式 `send_message` | supervisor 回执必须用 AgentDock send_message，不把 IM 当 RPC |
| memory 平台控制面 | `src/memory-storage.ts:37-60` 定义 memory content/state 目录；`src/memory-agent.ts:201-330` 初始化 memory dirs；`src/routes/memory-agent.ts:50-195` 提供 query/remember/session-wrapup；`src/routes/memory.ts:681-1044` 提供 Web memory API；`src/index.ts:6230-6242` 初始化 MemoryOrchestrator | Haro MemoryFabric 只能 compatibility；Haro 不拥有 memory |
| Web/API 挂载 | `src/web.ts:196-214` 挂载 sessions/memory/config/tasks/skills/mcp-servers/runners/haro/internal APIs | AgentDock 是平台 API host；Haro Web 保持 review board |
| Haro approval bridge | `src/haro-approval.ts:122-138` 使用 `HARO_HOME` 或 `~/.haro/evolution` 中 approval/proposal 目录；`:220-363` 只读 request / 写 decision / patch proposal；`src/routes/haro-approvals.ts:39-173` 提供 Web API；`src/index.ts:1127-1195` 提供 `/haro` IM command | AgentDock 只提供人机审批桥接，不生成 proposal/validation/approval-request，也不拥有 Haro evolution lifecycle |

Selfway 额外强调的删除约束：

1. 不能因为 AgentDock 有通用 scheduler/runner/workspace，就删除 Haro 的 proposal / validation / approval-request 生成逻辑；
2. 不能因为 AgentDock 有 `/api/haro` 与 `/haro` 命令，就删除 Haro Web review board 或 `.haro/evolution` schema；
3. 不能因为 AgentDock 能加载外部 MCP，就删除 Haro sidecar MCP/CLI 工具本体；
4. 不能因为 AgentDock 有通用执行框架，就删除 Haro apply/rollback 的领域执行与 artifact 记录。
