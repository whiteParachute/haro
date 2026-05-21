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
7. Haro approval 的 AgentDock 侧桥接通知与 decision 写入入口。

### 0.2 Haro 必须继续保留的能力

这些是 Haro 作为 AgentDock self-evolution sidecar 的核心职责，不能按“AgentDock 已承接 runtime”来删除：

1. proposal / validation / approval-request / approval-decision contract；
2. application / snapshot / rollback / blocked-proposal-event contract；
3. feedback / revision metadata 与后续 feedback-driven rewrite；
4. MCP sidecar tools 的 observe / propose / validate / asset query / daily workflow / lint；
5. Haro Web review board 与 approval conversation；
6. L0/L1 gated apply / rollback 的 artifact 记录与 gate 检查。

### 0.3 可以冻结或 deprecated，但不能马上物理删除的 Haro 残留

这些能力方向已被 AgentDock 承接或不再发展，但当前代码和测试仍有依赖，不能直接删：

- `packages/provider-codex`
- `packages/channel*`
- `packages/skills`
- `packages/core/src/memory/*`
- `packages/core/src/team-orchestrator.ts`
- `packages/core/src/scenario-router.ts`
- legacy CLI 的 provider/channel/memory/team/runtime 入口
- 非 review-board 的旧 dashboard/control-plane 页面或 API（若后续发现仍存在）

物理删除前必须补齐：影响面、替代方案、export/import 解绑、回滚方案、`test:sidecar` + `test:legacy` 验证，以及 owner/supervisor 明确批准。

## 1. AgentDock 已承接能力：证据表

| 能力域 | 直接证据 | 复核判断 | 对 Haro 减法的影响 |
| --- | --- | --- | --- |
| session / runtime | AgentDock `src/session-runtime-manager.ts:5-12` 明确是 session/runtime facade；`src/routes/sessions.ts:139-164` 处理 session alias 与 session record 解析 | AgentDock 是会话与 runtime host | Haro-owned workbench/runtime/control-plane 不再发展，只保留迁移/兼容所需代码 |
| runner / model | AgentDock `src/runner-registry.ts:7-17` 注册 runner，`src/runner-registry.ts:28-57` 根据 model 推断 runner，`src/routes/runners.ts:13-37` 提供 runner list/health/models/profile-schema API | AgentDock 管 runner/model/catalog/profile | Haro `provider-codex` / ChatGPT auth onboarding 只应作为 legacy；删除前要清 CLI 依赖 |
| memory runner | AgentDock `src/runner-registry.ts:87-120` 判断 memory runner；`src/routes/memory.ts:138-168` 返回 memory session 和 runner 能力；`src/routes/memory.ts:835-903` 管 memory config | AgentDock 管 memory 会话与 memory runner 选择 | Haro MemoryFabric 不再是主线 memory owner，但因为 mcp-tools legacy memory 仍依赖，不能直接删 |
| IM / channel | AgentDock `src/im-manager.ts:1-18` 统一创建 Feishu/Telegram/QQ/WeChat channel；`src/im-manager.ts:84-105` 连接 channel；`src/im-manager.ts:119-146` 按 JID 自动路由发送消息 | AgentDock 管 IM/channel | Haro-owned channel packages 冻结/deprecated；删除前清 CLI/mcp-tools 依赖 |
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
| `packages/provider-codex` | AgentDock runner/model | `packages/cli/package.json:28-37` 仍依赖 `@haro/provider-codex`；`packages/cli/src/index.ts`、provider wizard、diagnostics 仍引用 provider-codex | deprecated/freeze；不能删 | 移除/隐藏 CLI provider onboarding；删除 package 依赖；legacy 测试迁移或归档；`pnpm test:sidecar` 与 `pnpm test:legacy` 通过 |
| `packages/channel`, `channel-feishu`, `channel-telegram` | AgentDock IM manager/channel | `packages/cli/package.json:32-34` 仍依赖 channel packages；`packages/mcp-tools/package.json:29-31` 仍依赖 `@haro/channel` | deprecated/freeze；不能删 | 移除 CLI channel legacy 入口与 mcp-tools 依赖；确认 Haro approval notify 全走 AgentDock bridge 或 Haro Web 配置；测试通过 |
| `packages/skills` / skills marketplace | AgentDock skills/agent runtime | `packages/cli/package.json:36` 仍依赖 `@haro/skills`；旧 docs/spec 已打 legacy | freeze；不能直接删 | 移除 CLI legacy skills 入口与测试；确认 sidecar MCP 不依赖 skills package |
| Haro MemoryFabric | AgentDock memory / aria-memory-vault | `packages/mcp-tools/src/tools/memory-query.ts:1-6` 和 `memory-remember.ts:1-7` 都标注为 historical compatibility；`packages/core/src/memory/memory-fabric.ts:139-142` 明确 sidecar baseline 消费 AgentDock-owned memory refs；`packages/core/package.json:83-84` legacy tests 仍覆盖 memory-fabric | deprecated compatibility；不能删 | 移除或替换 `memory_query`/`memory_remember` legacy tool；清 `createMemoryFabric` exports；保留观察引用；legacy tests 更新 |
| `team-orchestrator.ts` | AgentDock workspace/multi-agent execution | `packages/core/src/team-orchestrator.ts:35-46` 仍定义 legacy team 状态；`packages/core/src/index.ts:173-210` 仍导出；`packages/core/package.json:84` legacy tests 含 `team-orchestrator.test.ts` | freeze；不能直接删 | 先取消 public exports；迁移 workflows service；确认 no import；保留或归档 tests |
| `scenario-router.ts` | AgentDock routing/workspace dispatch | `packages/core/src/scenario-router.ts:6-20` 仍定义 task/execution/orchestration modes；`packages/core/src/index.ts:141-172` 仍导出；`packages/core/package.json:84` legacy tests 含 `scenario-router.test.ts` | freeze；不能直接删 | 先解绑 exports/imports；确认 CLI run/chat 不依赖；迁移/归档 tests |
| legacy CLI provider/channel/memory/team/runtime 入口 | AgentDock Web/API/runner/memory | `packages/cli/package.json:23-24` 已把 sidecar/legacy 测试拆开，legacy suite 仍保留 provider/channel/wizard 等测试 | 保留 warning；逐步隐藏 | 继续保持 human warning；JSON 不污染；删除前跑 `@haro/cli test:legacy` |
| 旧 docs/specs | Haro 新主线 docs | legacy banner 与删除候选文档已经存在 | 第一批可进入 archive/review | 搬到 `docs/planning/archive/legacy-workbench/` 前确认 link/check；不影响 `test:sidecar` |

## 4. Unknown / 需要后续确认

1. **AgentDock 是否已覆盖所有旧 Haro Web dashboard 页面**：当前 Haro Web 源码显示 review-board 边界很窄，但仍需在物理删除前逐 route/page 列表确认。
2. **provider/channel/memory package 的发布面**：删除 package 前还要查 `pnpm-workspace.yaml`、package exports、dist、发布脚本、外部部署是否引用。
3. **feedback/revision contract 仍不完整**：当前 `FeedbackContextSchema` 是基础，但还不能完整表达“修订自哪个 proposal、吸收/未吸收哪些意见、替代哪些旧 proposal”。删除与 feedback 相关的旧能力前，必须先补第 3 阶段。
4. **L2/L3 workspace dispatch contract 未定义**：AgentDock 能派 workspace，但 Haro 到 AgentDock 的 patch/execution plan contract 还未落正式 schema；因此不能把 team/scenario 物理删除当作已经完成 L2/L3。

## 5. 10B 对后续路线的约束

### 5.1 可以推进的减法

1. docs/spec archive：优先级最高，风险最低；
2. legacy CLI warning/hidden：继续保持 JSON 不污染；
3. public export unlink：先从 `scenario-router` / `team-orchestrator` 这类单文件模块做只读影响面；
4. package dependency unlink：provider/channel/skills/memory package 删除前必须先清依赖。

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
