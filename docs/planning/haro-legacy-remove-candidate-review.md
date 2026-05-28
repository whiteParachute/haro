# Haro legacy 删除候选评审

## 0. 结论

本文不是删除批准。
当前没有任何文件、目录或 package 获得自动删除授权。

本轮只给 legacy remove-candidate 建立评审口径。
实际删除必须另开任务。
删除前必须同时满足 6 个条件：

1. 有影响面列表。
2. 已完成依赖解绑。
3. 有可执行回滚方案。
4. `pnpm test:sidecar` 通过。
5. `pnpm test:legacy` 或指定 legacy 子集通过。
6. 用户或 supervisor 明确批准。

当前建议：

- docs/spec 可以先进入 archive 评审。
- CLI legacy 入口继续 freeze。
- channel-layer 已在 FEAT-081K/081L 后收口；MCP `send_message` 继续保留。
- provider、memory、skills、Web/API、runtime 暂不删除。
- 先补 AgentDock takeover evidence、bridge 和 export 解绑证明。
- 最后才考虑新的物理删除 package。

## 1. 评审原则

| 原则 | 判断 |
| --- | --- |
| 不默认删除 | remove-candidate 只是候选，不是批准 |
| 先解绑再删除 | 仍被 import、re-export、CLI、Web 使用的对象不能删 |
| 先替代再删除 | AgentDock 或 sidecar contract 必须先承接能力 |
| 先验证再删除 | 删除 PR 必须跑 sidecar 与 legacy 验证 |
| 可回滚 | 每项都要能通过 git revert 或 package 恢复 |

## 2. 删除前置条件

| 条件 | 最低要求 |
| --- | --- |
| 影响面列表 | 列出 package、CLI、Web、docs、tests、exports |
| 依赖解绑 | barrel export、workspace dependency、CLI 注册全部处理 |
| 替代方案 | 明确 AgentDock 承接，或 Haro sidecar contract 承接 |
| 回滚方案 | 至少支持 git revert；运行数据不得迁移破坏 |
| sidecar 验证 | `git diff --check` + `pnpm test:sidecar` |
| legacy 验证 | `pnpm test:legacy` 或明确子集 |
| 批准 | 用户或 supervisor 明确批准 |

## 3. 候选分类表

字段说明：

- `current_state`：当前建议状态。
- `still_imported_by`：已知依赖入口。
- `replacement`：替代承接方。
- `blocking_dependencies`：删除前阻塞项。
- `risk_if_removed`：误删风险。
- `rollback_plan`：恢复方式。
- `required_verification`：删除前验证。
- `decision`：本轮建议。

### 3.1 packages/provider-codex

| 字段 | 内容 |
| --- | --- |
| current_state | deprecate |
| still_imported_by | `packages/cli/src/index.ts` 默认 provider 注册；provider doctor/list/models/select/env；`@haro/provider-codex` package tests；081N 后 setup/onboarding CLI 已 retired/fail-closed；081O 已删除 setup-only wizard dead file；081P 已删除旧 setup env-file writer helper |
| replacement | AgentDock 统一 provider / ModelHub；Haro 只通过 sidecar contract 读取运行结果 |
| blocking_dependencies | provider runtime 仍被 CLI bootstrap/run/chat/LLM path 引用；provider doctor/list/models/select/env 与 diagnostics provider stage 仍需保留；删除 runtime 前需单项评审 |
| risk_if_removed | `haro run/chat`、provider doctor/list/models/select/env、LLM draft/rewrite provider path 与 legacy tests 失效 |
| rollback_plan | git revert 删除 PR；恢复 package 与 workspace dependency |
| required_verification | `pnpm test:sidecar`；`pnpm -F @haro/provider-codex test`；`pnpm -F @haro/cli test:legacy` |
| decision | FEAT-081N 只退役 `haro provider setup ...`；FEAT-081O 只删除 setup-only wizard dead file并清理 remediation；FEAT-081P 只删除旧 env-file writer helper；FEAT-081R 只删除 provider setup retired stub；保持 deprecate，不删除 provider-codex package/runtime |

### 3.2 packages/channel / channel-feishu / channel-telegram

| 字段 | 内容 |
| --- | --- |
| current_state | done；FEAT-081L 已删除 Haro-owned `packages/channel*` 与 CLI `haro channel list/doctor` |
| still_imported_by | 无当前 Haro package 依赖；MCP `send_message` 保留，但 FEAT-081K 后已走 AgentDock IPC messages contract，不再依赖 `@haro/channel` / `ChannelRegistry` |
| replacement | AgentDock IM / channel layer；Haro 只保留 MCP `send_message` 对外工具和 sidecar approval feedback |
| blocking_dependencies | 当前无下一项 channel 删除授权；继续保护 MCP `send_message`、AgentDock 生产消息能力、真实 Feishu/Telegram/IM 投递链路 |
| risk_if_removed | 已删除 package 可通过 revert FEAT-081L 恢复；误删 MCP `send_message` 或 AgentDock IM 链路仍是禁止范围 |
| rollback_plan | git revert FEAT-081K/081L/hotfix；恢复 packages、workspace dependencies、CLI list/doctor 或 fail-closed 行为 |
| required_verification | `pnpm -F @haro/mcp-tools test -- test/tools/send-message.test.ts`；`pnpm -F @haro/cli test -- test/legacy-removal-guard.test.ts`；`pnpm test:sidecar`；`pnpm test:legacy` |
| decision | channel-layer 当前已完成本轮收口；不产生 provider/memory/skills/Web/runtime 的删除批准 |

### 3.3 packages/skills

| 字段 | 内容 |
| --- | --- |
| current_state | freeze |
| still_imported_by | CLI skill 命令；旧 eat/shit 资产流程；`packages/skills/test/*` |
| replacement | Haro sidecar artifacts；AgentDock skills / MCP 编排 |
| blocking_dependencies | 明确哪些 preinstalled skill 仍被 sidecar docs 或 tests 使用；补充 artifact migration 清单 |
| risk_if_removed | 旧 skill metabolism tests 失败；历史 eat/shit 文档无法复现 |
| rollback_plan | git revert；恢复 `packages/skills` |
| required_verification | `pnpm test:sidecar`；`pnpm -F @haro/skills test`；`pnpm -F @haro/cli test:legacy` |
| decision | 保持 freeze；不新增 marketplace 能力；暂不删除 |

### 3.4 packages/core/src/memory/* / MemoryFabric

| 字段 | 内容 |
| --- | --- |
| current_state | deprecate |
| still_imported_by | `createMemoryFabric` exports；core memory tests；CLI memory 命令；部分 runner 兼容路径 |
| replacement | AgentDock memory MCP；Haro 不拥有 memory，不改 aria-memory vault |
| blocking_dependencies | AgentDock memory bridge 完成；CLI memory 迁移到 sidecar tool 或 legacy-only；删除 direct `.haro/memory` 读写 |
| risk_if_removed | 旧 memory tests 失败；runner context-compaction 兼容路径断裂；历史 data migration 无法验证 |
| rollback_plan | git revert；恢复 memory package exports；不迁移真实数据 |
| required_verification | `pnpm test:sidecar`；`pnpm -F @haro/core test:legacy`；memory boundary tests |
| decision | 保持 deprecate，不删除；先完成 AgentDock memory bridge |

### 3.5 packages/core/src/agent/*

| 字段 | 内容 |
| --- | --- |
| current_state | freeze |
| still_imported_by | `AgentRegistry`、default agent、CLI run/chat、runner tests |
| replacement | AgentDock workspace / agent registry；Haro 只表达 proposal 执行需求 |
| blocking_dependencies | L2/L3 workspace execution plan contract；CLI run/chat 彻底 legacy 化 |
| risk_if_removed | CLI run/chat 失效；provider resolver 失效；旧 tests 大面积失败 |
| rollback_plan | git revert；恢复 exports 与 CLI 注册 |
| required_verification | `pnpm test:sidecar`；`pnpm -F @haro/core test:legacy`；`pnpm -F @haro/cli test:legacy` |
| decision | 保持 freeze；先不删 agent registry |

### 3.6 packages/core/src/runtime/*

| 字段 | 内容 |
| --- | --- |
| current_state | freeze |
| still_imported_by | `AgentRunner`、runtime runner tests、CLI run/chat |
| replacement | AgentDock runner / workspace runtime；Haro 只发 execution request artifact |
| blocking_dependencies | L2/L3 patch executor contract；AgentDock workspace dispatch 稳定；legacy CLI 退出主线 |
| risk_if_removed | 旧 agent execution 完全不可用；runtime selection tests 失败 |
| rollback_plan | git revert；恢复 runtime exports |
| required_verification | `pnpm test:sidecar`；`pnpm -F @haro/core test:legacy`；`pnpm -F @haro/cli test:legacy` |
| decision | 保持 freeze；不进入近期删除 |

### 3.7 packages/core/src/team-orchestrator.ts

| 字段 | 内容 |
| --- | --- |
| current_state | removed-by-FEAT-081D，仅限 TeamOrchestrator 单项 |
| still_imported_by | 不应再有主链路 import；历史 docs/specs 仍可能引用概念 |
| replacement | AgentDock 多 agent / workspace orchestration；Haro 只选择 proposal 对应 workspace |
| blocking_dependencies | 已完成 081B 默认路径解绑；081D 已移除 legacy re-export、package export、旧测试与 CLI 兼容执行路径 |
| risk_if_removed | 旧 team workflow 无法使用；历史 specs 无法直接复现 |
| rollback_plan | git revert FEAT-081D commit，恢复源码、legacy export、CLI env 兼容路径与旧测试 |
| required_verification | `pnpm test:sidecar`；`pnpm test:legacy`；`pnpm -F @haro/core build`；`pnpm -F @haro/cli build` |
| decision | 仅 TeamOrchestrator 获得 081D 单项物理删除授权；scenario-router、runtime、agent 其它候选仍未批准删除 |

### 3.8 packages/core/src/scenario-router.ts

| 字段 | 内容 |
| --- | --- |
| current_state | remove-candidate |
| still_imported_by | CLI run 路由；scenario-router tests；phase-1 spec |
| replacement | AgentDock session / workspace router；Haro sidecar 不做通用场景路由 |
| blocking_dependencies | `haro run/chat` legacy 化后确认无需 router；移除 CLI run 依赖或封存 |
| risk_if_removed | `haro run` 旧路径行为变化；FEAT-013 测试失败 |
| rollback_plan | git revert；恢复 router 与 tests |
| required_verification | `pnpm test:sidecar`；`pnpm -F @haro/core test:legacy -- test/scenario-router.test.ts`；`pnpm -F @haro/cli test:legacy` |
| decision | 可进入删除评审；不能先于 CLI run/chat 迁移 |

### 3.9 packages/core/src/permission-budget.ts

| 字段 | 内容 |
| --- | --- |
| current_state | freeze |
| still_imported_by | runner / budget service；CLI budget；permission-budget tests |
| replacement | AgentDock execution budget；Haro proposal risk / gate 元数据 |
| blocking_dependencies | 明确 sidecar apply gate 是否仍引用 budget 概念；AgentDock budget bridge 明确 |
| risk_if_removed | 旧 runner budget 失效；CLI budget 失败；permission tests 失败 |
| rollback_plan | git revert；恢复 file 与 exports |
| required_verification | `pnpm test:sidecar`；`pnpm -F @haro/core test:legacy -- test/permission-budget.test.ts`；`pnpm -F @haro/cli test:legacy` |
| decision | 保持 freeze；暂不删除 |

### 3.10 packages/core/src/services/{agents,sessions,users,workflows,cron,budget}

| 字段 | 内容 |
| --- | --- |
| current_state | keep / freeze（逐项评审） |
| still_imported_by | web-api auth / approval board；CLI session/agent/workflow/budget/cron；service tests |
| replacement | AgentDock session、workspace、scheduler、auth；Haro 只保留 approval review 所需服务 |
| blocking_dependencies | 拆分 approval board 必需服务与旧 dashboard 服务；Web API 只读/decision 写入边界明确 |
| risk_if_removed | Haro Web 登录、approval board、旧 CLI 管理命令可能同时受影响 |
| rollback_plan | git revert；按 service 逐项恢复 |
| required_verification | `pnpm test:sidecar`；`pnpm -F @haro/web-api test`；`pnpm -F @haro/core test:legacy`；`pnpm -F @haro/cli test:legacy` |
| decision | 不做整体删除；逐 service 评审。approval board 依赖项 keep，其他 freeze |

### 3.11 packages/cli 旧入口

| 字段 | 内容 |
| --- | --- |
| current_state | deprecate |
| still_imported_by | `packages/cli/src/index.ts` 命令注册；`commands/*`；CLI tests |
| replacement | AgentDock host CLI / MCP；Haro sidecar CLI 只保留 observe/propose/validate/approval/apply/rollback/mcp/daily workflow |
| blocking_dependencies | 迁移提示稳定；脚本消费者扫描；sidecar CLI docs 完成 |
| risk_if_removed | 用户脚本、legacy tests、历史文档命令不可用 |
| rollback_plan | git revert；恢复 command registration |
| required_verification | `pnpm test:sidecar`；`pnpm -F @haro/cli test:legacy` |
| decision | 保持 deprecate；先不删除。只继续收窄入口提示 |

覆盖旧入口：

- `run` / `chat`。
- `memory`。
- `provider` / provider onboarding。
- `channel` / gateway。
- `session` / `agent` / `workflow`。

### 3.12 packages/web / packages/web-api 通用 dashboard 能力

| 字段 | 内容 |
| --- | --- |
| current_state | keep / remove-candidate（逐路由评审） |
| still_imported_by | Haro Web review board；web-api auth；approval request routes；旧 dashboard specs |
| replacement | AgentDock Web / workspace runtime；Haro Web 只保留 proposal review board |
| blocking_dependencies | 明确 review board 必需 API；确认没有 provider/channel/runtime 页面仍在路由中 |
| risk_if_removed | 误删 approval board；用户无法 review proposal |
| rollback_plan | git revert；恢复 Web/API 路由 |
| required_verification | `pnpm test:sidecar`；`pnpm -F @haro/web-api test`；如改 Web 再跑 `pnpm -F @haro/web build` |
| decision | review board keep；其它 dashboard/provider/channel/runtime 页面为 remove-candidate，但需逐路由评审 |

### 3.13 phase-0 / phase-1 / phase-1.5 旧 specs/docs

| 字段 | 内容 |
| --- | --- |
| current_state | remove-candidate |
| still_imported_by | README、planning docs、历史 review 文档、agent 检索上下文 |
| replacement | `docs/planning/haro-sidecar-subtraction-and-feedback-loop.md`；sidecar specs |
| blocking_dependencies | legacy banner 已覆盖；需要 archive 索引；链接替换完成 |
| risk_if_removed | 历史设计依据丢失；旧链接失效；review 追溯困难 |
| rollback_plan | git revert；或从 archive 恢复 |
| required_verification | `git diff --check`；链接检查；grep 确认主线文档不引用已删路径 |
| decision | 优先做 archive，不直接删除；这是最安全的第一批候选 |

## 4. 优先级建议

| 顺序 | 动作 | 理由 |
| --- | --- | --- |
| P0 | docs/spec archive 评审 | 风险最低，不影响运行 |
| P1 | CLI legacy 入口提示稳定 | 已有提示，继续观察脚本影响 |
| P2 | 解绑 barrel exports | 删除前先切断 import 面 |
| P3 | 拆 package dependency | 减少 workspace 级耦合 |
| P4 | 单文件删除评审 | 先从 team/scenario router 开始 |
| P5 | package 物理删除 | provider/channel/memory/runtime 最后做 |

建议的安全顺序：

1. 归档 phase-0 / phase-1 / phase-1.5 旧 specs。
2. 保留 docs 链接索引。
3. 固化 CLI legacy warning。
4. 切断 core barrel exports。
5. 移除 CLI 对旧模块的默认注册。
6. 删除单文件模块。
7. 删除 provider/channel/memory/runtime package。

## 5. 删除 PR 验证模板

每个删除 PR 必须给出：

```text
影响面：
- package / directory / file
- import / export / CLI / Web / tests

替代：
- AgentDock 承接点
- Haro sidecar contract

验证：
- git diff --check
- pnpm test:sidecar
- pnpm test:legacy 或指定 legacy subset

回滚：
- git revert <commit>
- 如有 package lock 变化，恢复 lockfile
```

## 6. negative scope

以下内容不属于删除候选。
不能在任何 legacy cleanup PR 中顺手修改。

- `~/.haro/evolution/` 真实数据。
- `~/.haro/` 运行数据。
- aria-memory vault。
- approval decisions。
- approval requests。
- proposal content。
- validations。
- applications。
- rollbacks。
- snapshots。
- blocked proposal events。
- Haro Web review board。
- AgentDock 内部代码。
- AgentDock scheduler。
- AgentDock workspace runtime。
- ModelHub service 配置。

## 7. 本轮不做事项

- 不删除文件。
- 不移动文件。
- 不改代码。
- 不改测试脚本。
- 不重启服务。
- 不 push。
- 不改变任何真实 evolution 数据。

## 8. 当前判断

第一批可进入详细删除评审的是历史 docs/spec archive。
第二批才是 `team-orchestrator.ts` 与 `scenario-router.ts`。
provider、channel、MemoryFabric、runtime 不应近期删除。
这些模块仍有 CLI、tests、exports 或历史兼容依赖。

## 8. FEAT-081A 删除前置解绑守卫（2026-05-23）

FEAT-081A 只完成删除前置守卫。

它不是物理删除批准。

新增只读命令：

```bash
haro legacy-removal guard --dry-run --json
haro legacy-removal guard --dry-run --human
```

该命令会输出机器可读报告。

报告包含：

- legacy candidate id。
- 当前状态。
- 仍被引用的证据。
- 替代承接方。
- 删除前 blocker。
- 必跑验证命令。
- negative scope。

命令默认 fail-closed。

不带 `--dry-run` 会拒绝。

传 `--confirm` 也会拒绝。

报告里的 `deleteAllowed` 固定为 `false`。

`physicalDeleteApproved` 固定为 `false`。

这保证后续 agent 不能把候选清单当删除授权。

FEAT-081A 覆盖的首批 guard：

| guard id | 当前状态 | 说明 |
| --- | --- | --- |
| `provider-codex` | deprecate | 仍被 CLI provider bootstrap 和 package dependency 引用 |
| `channel-layer` | deprecate | 仍有 CLI channel 和 MCP send_message legacy 入口 |
| `memory-fabric` | deprecate | 仍有 core export、CLI memory 和 MCP memory tools |
| `agent-runtime-router` | freeze | 仍有 agent/runtime/team/scenario 旧路径 |
| `skills-marketplace` | freeze | 仍有 skills package 和 CLI bootstrap 依赖 |
| `web-dashboard-non-review` | freeze | review board keep，其它 Web/API 需逐路由评审 |

下一步 FEAT-081B 才能考虑单项解绑。

081B 仍不能直接删除文件。

081B 应先处理 export/import 或 registry 隔离。

每个解绑 PR 必须继续通过：

```bash
git diff --check
pnpm test:sidecar
pnpm test:legacy
```

## 9. FEAT-081B 单项解绑试点（2026-05-25）

081B 只选择一个候选。

本次选择 `team-orchestrator`。

原因：

- 它只服务旧 workbench team mode。
- sidecar 主链路不需要它。
- 文件可以保留。
- 兼容入口可以显式打开。
- 风险低于 provider、channel、memory。

本次不动其它候选。

未选择其它项的原因：

- provider 仍被 CLI provider bootstrap 引用。
- channel 仍有 legacy IM 入口。
- memory 仍有 CLI/MCP 兼容入口。
- skills 仍有 eat/shit 兼容流程。
- Web/API 需要逐路由评审。

081B 做的只是默认路径解绑。

具体行为：

- `@haro/core` 默认 barrel 不再导出 `TeamOrchestrator`。
- 新增显式 legacy 入口：
  `@haro/core/legacy/team-orchestrator`。
- CLI 不再静态 import `TeamOrchestrator`。
- 默认 `haro run` 遇到 team workflow 会 fail closed。
- 只有设置 `HARO_ENABLE_LEGACY_TEAM_ORCHESTRATOR=1`，
  才会走旧 team orchestrator。

这不是物理删除批准。

`packages/core/src/team-orchestrator.ts` 仍保留。

legacy test 仍可显式验证旧路径。

guard 报告新增 `pilotUnbind`。

它只表达“默认路径已解绑”。

`deleteAllowed` 仍固定为 `false`。

081D 后续已经把此兼容入口升级为单项物理删除：
081B 的 `HARO_ENABLE_LEGACY_TEAM_ORCHESTRATOR=1` 说明只作为历史记录保留，
当前代码不再支持该旧兼容执行路径。

后续如果继续 081C，

也必须逐项评审。

不能顺手删除多个候选。

## 10. FEAT-081C 单项解绑试点（2026-05-25）

081C 继续只选择一个候选。

本次选择 `gateway` CLI 入口。

它归属 channel/control-plane 旧方向。

选择原因：

- gateway 只服务旧后台 channel daemon。
- sidecar 主链路不需要它。
- 081C 阶段源码和测试先保留。
- 081C 阶段旧命令可以用显式环境变量复核。
- 风险低于 provider、memory、skills、Web。

本次不动其它候选。

未选择其它项的原因：

- provider 仍被 provider bootstrap 引用。
- memory 仍有 run 的显式 legacy 记忆路径。
- skills 仍有 eat/shit 兼容流程。
- Web/API 仍承载 Review Board。
- scenario-router 仍被 `haro run` 旧路径使用。

081C 做的只是默认命令路径隔离。

具体行为：

- 默认 CLI 不再注册真实 gateway daemon 命令。
- 默认 `haro gateway ...` 只返回 disabled 报告。
- 报告说明这是 legacy control-plane 路径。
- 报告不会启动 daemon。
- 只有设置 `HARO_ENABLE_LEGACY_GATEWAY_COMMANDS=1`，
  才会注册旧 gateway 命令。

这不是物理删除批准。

`packages/cli/src/gateway.ts` 在 081C 后仍保留。

081E 后续已经把 gateway 旧 CLI daemon 入口升级为单项物理删除：
`HARO_ENABLE_LEGACY_GATEWAY_COMMANDS=1` 只作为历史记录保留，当前代码不再支持该旧兼容执行路径。

channel packages 仍保留。

legacy test 在 081E 后不再验证旧 daemon 实现，只验证 removed/fail-closed 报告。

guard 报告在 `channel-layer` 下新增 `pilotUnbind`。

它只表达“gateway 默认命令路径已解绑”。

`deleteAllowed` 仍固定为 `false`。

后续如果继续 081D，

也必须逐项评审。

不能顺手删除多个候选。

## 11. FEAT-081D 首个真实物理删除（2026-05-25）

081D 只处理一个已摘线候选。

本次删除 `TeamOrchestrator` 旧兼容路径。

删除原因：

- 081B 已经把它从默认执行路径解绑。
- sidecar 主链路不依赖 Haro-owned team runtime。
- 多 agent/workspace orchestration 应由 AgentDock 承接。
- 删除范围可以通过 git revert 清晰回滚。

本次删除内容：

- `packages/core/src/team-orchestrator.ts`。
- `packages/core/src/legacy/team-orchestrator.ts`。
- `packages/core/test/team-orchestrator.test.ts`。
- `@haro/core/legacy/team-orchestrator` package export。
- CLI 中 `HARO_ENABLE_LEGACY_TEAM_ORCHESTRATOR=1` 的旧动态执行路径。

本次保留内容：

- `scenario-router`。
- `agent` / `runtime` / services 旧路径。
- gateway、provider、channel、memory、skills、Web/API。
- 历史 docs/specs 中的背景记录。

守卫状态：

- `agent-runtime-router` 的 FEAT-081D 删除记录统一保留在 `physicalRemovals[]`，状态为 `physically-removed`。
- `physicalRemovals[].removedBy=FEAT-081D`。
- `deleteAllowed` 仍固定为 `false`。
- `physicalDeleteApproved` 仍为 `false`，表示 guard 报告本身不是后续删除批准。

回滚方式：

- revert FEAT-081D commit。
- 重新运行 core/cli build、legacy tests、sidecar tests。

后续规则：

- 081D 不能推广成其它候选的删除批准。
- 081E 已单项删除 gateway 旧 CLI daemon 入口。
- 不得顺手删除 provider/channel/memory/skills/Web/scenario-router。

## 12. FEAT-081E 第二个真实物理删除（2026-05-25）

081E 只处理一个已摘线候选。

本次删除 `gateway` 旧 CLI daemon/control-plane 入口。

删除原因：

- 081C 已经把真实 gateway daemon 命令从默认 CLI 路径摘线。
- gateway 只服务旧 Haro-owned channel/control-plane 方向。
- sidecar 主链路不需要 Haro 自有后台 channel daemon。
- 删除范围可以通过 git revert 清晰回滚。

本次删除内容：

- `packages/cli/src/gateway.ts`。
- `packages/cli/test/gateway.test.ts`。
- CLI 中 `HARO_ENABLE_LEGACY_GATEWAY_COMMANDS=1` 恢复旧 gateway 命令的注册路径。
- `@haro/cli` legacy test script 中的 gateway 单测入口。

本次保留内容：

- `packages/channel`。
- `packages/channel-feishu`。
- `packages/channel-telegram`。
- `haro channel ...` 旧兼容入口。
- MCP `send_message` 相关兼容工具。
- provider、memory、skills、Web/API、scenario-router、agent/runtime/services。

CLI 行为：

- `haro gateway ...` 仍保留为 fail-closed stub。
- 输出 `LEGACY_GATEWAY_COMMANDS_REMOVED`。
- 不启动 daemon。
- 设置旧环境变量也不能恢复 daemon。

守卫状态：

- `channel-layer` 的 FEAT-081E 删除记录统一保留在 `physicalRemovals[]`，状态为 `physically-removed`。
- `physicalRemovals[].removedBy=FEAT-081E`。
- `deleteAllowed` 仍固定为 `false`。
- `physicalDeleteApproved` 仍为 `false`，表示 guard 报告本身不是后续删除批准。

回滚方式：

- revert FEAT-081E commit。
- 重新运行 CLI build、legacy tests、sidecar tests。

后续规则：

- 081E 不能推广成 channel/provider/memory/skills/Web/scenario-router 的删除批准。
- 如继续 081F，必须再选择一个候选并单独评审。
- 不得顺手删除 channel package 或飞书/Telegram 消息能力。

## 13. FEAT-081F 剩余候选体检与排序（2026-05-25）

081F 只做剩余 legacy 删除候选的体检和排序。

它不是物理删除批准。

本轮没有删除任何源码、目录、package 或测试文件。

`deleteAllowed`、`physicalDeleteApproved`、`wouldDelete` 仍必须保持 `false`。

### 13.1 已完成项

| 候选 | 当前状态 | 证据 | 后续约束 |
| --- | --- | --- | --- |
| TeamOrchestrator | removed/done | FEAT-081D 已删除 `packages/core/src/team-orchestrator.ts`、legacy re-export、旧 CLI env 兼容路径 | 不能扩大成 scenario-router / agent / runtime 删除批准 |
| gateway CLI daemon | removed/done | FEAT-081E 已删除 `packages/cli/src/gateway.ts`、旧 gateway 测试、legacy env 注册路径 | 不能扩大成 channel package、Feishu/Telegram 或 MCP send_message 删除批准 |

guard 中的“应缺席”检查已经从普通 evidence 拆到 `verifiedAbsent`：

- TeamOrchestrator 源文件、legacy re-export、package export 必须缺席。
- gateway 源文件、legacy env 注册判断必须缺席。

如果这些 `verifiedAbsent` 变回 present，说明历史删除被意外恢复或回归。

### 13.2 下一步最小安全候选

下一步建议候选只有一个：`channel-layer` 的 `packages/cli/src/channel.ts#setup-onboarding`。

理由：

- gateway 旧 daemon/control-plane 已删除。
- `haro channel setup` 仍属于旧 Haro-owned channel onboarding 方向。
- 它比删除 channel package、Feishu/Telegram channel、MCP send_message 风险更小。
- 可以先做 fail-closed/removed 提示和单项测试，不触碰生产消息链路。

明确禁止把该候选扩大到：

- `packages/channel`。
- `packages/channel-feishu`。
- `packages/channel-telegram`。
- `packages/mcp-tools/src/tools/send-message.ts`。
- 飞书/Telegram 生产消息能力。

### 13.3 暂不删除候选

| 候选 | 081F 排序 | 阻塞原因 | 删除前必须完成 |
| --- | --- | --- | --- |
| provider / provider-codex | blocked | CLI bootstrap 仍构造 provider；082A/082B LLM draft/rewrite 仍需要 provider path 或替代桥 | AgentDock/ModelHub provider bridge 接管默认能力，移除 CLI `createCodexProvider` 默认构造，验证 LLM draft provider 替代路径 |
| memory / MemoryFabric / memory CLI | blocked | 涉及真实 `~/.haro` 数据、MCP memory tools、aria-memory owner 边界 | 明确数据保留/迁移策略，隔离 MCP memory 默认注册，证明 sidecar 主链路不读写 Haro-owned memory |
| skills / marketplace / eat/shit 兼容 | defer | `packages/skills` 仍承载 eat/shit 兼容语义 | 先拆分 marketplace 扩展面与保留技能资产，确认替代承接方 |
| scenario-router / agent / runtime / services | blocked | `haro run/chat`、legacy tests、L2/L3 execution plan contract 仍有引用 | 完成 run/chat 迁移或 legacy 化，解除 ScenarioRouter 默认 bootstrap，完成 L2/L3 contract |
| Web / Web API / Review Board | forbidden | Review Board 是 Haro sidecar 主链路看板 | 只能逐个非 review 路由评审；不得删除 `packages/web` / `packages/web-api` 包级能力 |
| channel package / Feishu / Telegram / MCP send_message | forbidden for 081G | 生产 IM 和 MCP 消息边界未完成替代证明 | 只能在 channel setup onboarding 单项完成后重新评审 |

### 13.4 guard 输出契约

081F 后 `legacy-removal guard --dry-run --json` 必须提供：

- `planning.stage=FEAT-081F`。
- `planning.nextDeletionCandidate`：当前为 `channel-layer` / `packages/cli/src/channel.ts#setup-onboarding`。
- `planning.forbiddenCandidateIds`：当前至少包含 `web-dashboard-non-review`。
- `planning.blockedCandidateIds`：当前至少包含 `provider-codex`、`memory-fabric`、`agent-runtime-router`。
- `planning.completedPhysicalRemovals`：记录 FEAT-081D / FEAT-081E 已删除项。
- `summary.verifiedAbsentCount` / `summary.verifiedAbsentFailedCount`。
- `summary.nextSafeCandidateCount`、`blockedCandidateCount`、`forbiddenCandidateCount`。

human 输出必须用通俗语言说明：下一步建议做什么、哪些不能碰、为什么仍不是删除批准。

### 13.5 验收方式

081F 只允许文档、guard 报告和测试变化。

验收命令：

```bash
git diff --check HEAD~1..HEAD
pnpm -F @haro/cli build
pnpm -F @haro/cli test -- test/legacy-removal-guard.test.ts
pnpm test:legacy
pnpm test:sidecar
```

验收重点：

- 不新增物理删除。
- `deleteAllowedCount=0`。
- `physicalDeleteApproved=false`。
- `verifiedAbsentFailedCount=0`。
- 下一候选只指向 channel setup/onboarding 子入口。
- channel package、provider、memory、skills、Web/API、scenario-router、agent/runtime 仍未获得删除批准。

## 14. FEAT-081G channel setup/onboarding 默认路径摘线（2026-05-25）

081G 只处理 081F 排序出的最小安全候选：`haro channel setup/onboarding` 旧入口。

本轮不是物理删除批准。

本轮没有删除任何源码、目录、package 或测试文件。

### 14.1 摘线内容

默认运行以下入口时，CLI 只返回 removed/fail-closed 报告：

```bash
haro channel setup <id>
haro channel onboarding <id>
```

输出含义：

- `status=removed`。
- `code=LEGACY_CHANNEL_ONBOARDING_REMOVED`。
- `wouldConfigure=false`。
- `pilotUnbind.candidate=packages/cli/src/channel.ts#setup-onboarding`。
- 不调用旧 `channel.setup(...)`。
- 不写入 `config.yaml` 的 channel 配置。
- 不启用 channel。

### 14.2 明确保留范围

081G 不处理以下对象：

- `packages/channel`。
- `packages/channel-feishu`。
- `packages/channel-telegram`。
- Feishu / Telegram 生产消息能力。
- MCP `packages/mcp-tools/src/tools/send-message.ts`。
- provider、memory、skills、Web/API、scenario-router、agent/runtime/services。
- AgentDock host。

### 14.3 guard 状态

`channel-layer` 在 guard 中更新为：

- `candidatePriority.status=done`。
- `pilotUnbind.status=default-path-unbound`。
- `pilotUnbind.candidate=packages/cli/src/channel.ts#setup-onboarding`。
- `verifiedAbsent` 额外检查旧 `channel.setup(...)` 调用和旧 config 写入路径缺席。

同时仍保持：

- `deleteAllowed=false`。
- `physicalDeleteApproved=false`。
- `wouldDelete=false`。
- gateway 的 FEAT-081E 物理删除记录继续保留，但 guard schema 已在 FEAT-081Q 统一为 `physicalRemovals[]`。
- channel package 和 MCP send_message 仍显示为 present，表示未删除、未批准删除。

### 14.4 回滚方式

如需恢复旧 onboarding，可 revert FEAT-081G commit。

恢复后必须重新运行：

```bash
pnpm -F @haro/cli build
pnpm -F @haro/cli test -- test/cli.test.ts test/legacy-removal-guard.test.ts
pnpm test:legacy
pnpm test:sidecar
```

### 14.5 验收方式

081G 验收重点：

- `haro channel setup feishu --json` 返回 removed/fail-closed，不调用旧 setup callback。
- `haro channel onboarding telegram --json` 返回 removed/fail-closed，不写配置。
- 当时 `haro channel list`、`haro channel doctor` 等非 onboarding 路径继续可用；FEAT-081L 后这些路径已删除，hotfix `03c35cb` / `c3ae19b` 要求退役 `haro channel ...` fail-closed。
- guard JSON/human 展示 081G 摘线状态。
- `deleteAllowedCount=0`。
- `physicalDeleteApproved=false`。
- 没有物理删除 channel package、Feishu/Telegram channel 或 MCP send_message。

## 15. FEAT-081G-1 guard 阶段表达与下一评审候选（2026-05-25）

081G-1 只修正 guard/report 的表达。

本轮没有删除任何源码、目录、package 或测试文件。

本轮也没有批准任何下一项删除。

### 15.1 当前 report 语义

`legacy-removal guard --dry-run --json` 当前应表达：

- `planning.stage=FEAT-081G-1`。
- `planning.lastCompletedStage=FEAT-081G`。
- `planning.lastUpdatedBy=FEAT-081G-1`。
- `planning.nextDeletionCandidate=null`。
- `planning.nextReviewCandidate` 可提示后续评审对象，但不是删除批准。
- `deleteAllowed=false`。
- `physicalDeleteApproved=false`。
- `wouldDelete=false`。
- `summary.deleteAllowedCount=0`。

### 15.2 下一评审候选

当前 `nextReviewCandidate` 指向：

- candidate：`channel-layer`。
- scope：`packages/cli/src/channel.ts#setup-onboarding`。
- purpose：`physical-delete-review`。

含义：

- 081G 已完成默认路径摘线。
- 后续如果要考虑物理删除 channel onboarding stub，必须另开单项评审。
- 这不是删除授权。
- 执行前必须提交影响面、回滚方案和验证结果。

禁止把该评审扩大到：

- `packages/channel`。
- `packages/channel-feishu`。
- `packages/channel-telegram`。
- Feishu / Telegram 生产消息能力。
- MCP `packages/mcp-tools/src/tools/send-message.ts`。

### 15.3 保持不变的安全边界

以下状态必须保持不变：

- `nextDeletionCandidate=null`。
- `deleteAllowed=false`。
- `physicalDeleteApproved=false`。
- `wouldDelete=false`。
- 所有 candidate 的 `deleteAllowed=false`。

081G-1 不能被解释成 081H/后续删除授权。

## 16. FEAT-081H channel onboarding removed stub 物理删除（2026-05-25）

081H 只处理 081G 摘线后留下的 CLI removed/fail-closed stub。

本轮删除范围仅限：

- `packages/cli/src/index.ts#channel-setup-onboarding-stub`。
- `haro channel onboarding <id>` removed alias 注册。
- `LEGACY_CHANNEL_ONBOARDING_REMOVED` 报告 helper。
- 对应的 removed-stub 测试断言。

本轮没有删除或修改：

- `packages/channel`。
- `packages/channel-feishu`。
- `packages/channel-telegram`。
- Feishu / Telegram 生产消息能力。
- MCP `packages/mcp-tools/src/tools/send-message.ts`。
- provider、memory、skills、Web/API、scenario-router、agent/runtime/services。
- AgentDock host。

### 16.1 当前 CLI 行为

`haro channel setup <id>` 和 `haro channel onboarding <id>` 不再注册为 channel 子命令。

因此它们不会调用旧 `channel.setup(...)`，也不会写 channel config。

`haro channel list`、`haro channel doctor` 等非 onboarding 路径继续保留。

### 16.2 guard 状态

`channel-layer` 继续保留 gateway 的 FEAT-081E 删除记录，并新增 FEAT-081H 删除记录：

- `physicalRemovals[]=packages/cli/src/gateway.ts:FEAT-081E`。
- `physicalRemovals[]=packages/cli/src/index.ts#channel-setup-onboarding-stub:FEAT-081H`。

当前 report 必须保持：

- `planning.stage=FEAT-081H`。
- `planning.lastCompletedStage=FEAT-081H`。
- `planning.nextDeletionCandidate=null`。
- `planning.nextReviewCandidate=null`。
- `deleteAllowed=false`。
- `physicalDeleteApproved=false`。
- `wouldDelete=false`。
- `summary.deleteAllowedCount=0`。

`verifiedAbsent` 必须证明以下残留缺席：

- `LEGACY_CHANNEL_ONBOARDING_REMOVED`。
- `renderRemovedOnboarding`。
- `channel onboarding` alias 注册。
- 旧 `channel.setup(...)` 调用。
- 旧 channel config 写入路径。

### 16.3 回滚方式

如需恢复 removed stub，可 revert FEAT-081H commit。

回滚后必须重新运行：

```bash
pnpm -F @haro/cli build
pnpm -F @haro/cli test -- test/cli.test.ts test/legacy-removal-guard.test.ts
pnpm test:legacy
pnpm test:sidecar
```

### 16.4 后续规则

081H 不能推广成 channel package 或生产消息能力删除批准。

如后续要继续 legacy 删除，必须重新排序并单项评审。

## 17. FEAT-081I 模块级退役边界与下一候选（2026-05-26）

081I 不删除任何源码、目录、package 或测试文件。

本轮只把用户最新边界固化到 guard/report 和本文档：哪些能力由 AgentDock 或共享能力接管，哪些 Haro legacy 面可以进入后续单项评审，哪些必须暂缓。

### 17.1 模块级边界

1. channel / 消息
   - Haro 只保留 MCP `send_message` 这类对外工具。
   - 真实 Feishu / Telegram / channel 管理由 AgentDock 提供。
   - Haro 自有 channel package、旧 CLI、旧配置链路可以进入退役候选。
   - 禁止影响 MCP `send_message`、AgentDock 生产消息和真实 IM 投递链路。

2. provider
   - provider 由 AgentDock / ModelHub 提供。
   - Haro 自带 `provider-codex`、provider bootstrap/onboarding 进入退役候选。
   - 删除前必须先证明 AgentDock provider bridge 已覆盖后续 LLM draft/provider 需求。

3. memory
   - memory 统一走共享 `aria-memory-vault`。
   - Haro 自有 MemoryFabric 进入退役候选。
   - 删除前必须特别验证真实 `~/.haro` 数据、aria-memory vault 和 AgentDock memory 不受影响。

4. run / router / runtime / scenario-router
   - 本轮 deferred。
   - 先删其它项。
   - 等 AgentDock 定时任务能稳定触发 Haro 提案生成后再评估。
   - 判断条件必须同时满足：AgentDock 定时任务 -> Haro 生成提案 -> 创建待审请求 -> Review Board 可审，并证明不依赖旧 `haro run/chat/team/scenario`。
   - 081I 不得把该项列为下一删除候选。

5. skills
   - skills 由 AgentDock 提供。
   - Haro 旧 skills marketplace / legacy skills 进入退役候选。
   - 删除前必须保留或迁移必要 eat/shit 兼容语义。

6. Web / API
   - Haro Web/API 只保留 Review Board / 审批看板。
   - 看板外旧 dashboard/API 进入退役候选。
   - 不允许包级删除 `packages/web` 或 `packages/web-api`；只能逐路由评审非 Review Board surface。

### 17.2 guard 当前表达

`legacy-removal guard --dry-run --json` 在 081I 后应表达：

- `planning.stage=FEAT-081I`。
- `planning.lastCompletedStage=FEAT-081I`。
- `planning.lastUpdatedBy=FEAT-081I`。
- `planning.moduleRetirementBoundaries[]` 记录以上 6 类模块边界。
- `planning.deferredCandidateIds` 包含 `agent-runtime-router`，表示第 4 项暂缓。
- `planning.nextDeletionCandidate` 可指向下一项删除评审候选，但仍只是候选，不是删除授权。
- `planning.nextReviewCandidate.notApproval=true`。
- `deleteAllowed=false`。
- `physicalDeleteApproved=false`。
- `wouldDelete=false`。
- `summary.deleteAllowedCount=0`。
- 所有 candidate 的 `deleteAllowed=false`。

081I 本身不是删除批准。

### 17.3 下一项可执行删除评审候选

下一项评审候选选为：

- candidate：`channel-layer`。
- scope：`channel-layer / Haro-owned channel packages + CLI registry review`。

选择原因：

- 用户已明确真实 channel/消息由 AgentDock 提供。
- 081G 已摘线 `haro channel setup/onboarding` 默认路径。
- 081H 已删除 setup/onboarding removed stub。
- channel-layer 是剩余候选中最接近已摘线状态的一项。

但这仍然只是“下一单项评审候选”，不是删除授权。

下一阶段若要继续，必须先证明：

- MCP `packages/mcp-tools/src/tools/send-message.ts` 不受影响。
- AgentDock 生产消息能力不受影响。
- Feishu / Telegram 真实 IM 投递链路不受影响。
- 删除范围不扩大到 provider、memory、skills、Web/API、scenario-router、AgentDock。
- 有明确影响面、回滚方案和验证命令。

### 17.4 继续禁止和暂缓

继续禁止：

- 删除 MCP `send_message`。
- 删除或破坏 AgentDock 生产消息能力。
- 删除真实 `~/.haro` 数据或 aria-memory vault。
- 删除 Review Board / 审批看板。
- 把 081I 当作批量删除批准。

继续暂缓：

- `agent-runtime-router` / run / router / runtime / scenario-router。
- 暂缓原因是 AgentDock 定时任务到 Haro 提案生成的生产链路还需要继续稳定验证。

### 17.5 验收方式

081I 的验收只证明 guard/docs/tests 边界正确：

```bash
git diff --check
pnpm -F @haro/cli build
pnpm -F @haro/cli test -- test/legacy-removal-guard.test.ts
pnpm test:legacy
pnpm test:sidecar
```

081I 不要求、也不允许物理删除任何新文件。

## 18. FEAT-081J channel-layer 第一块真实代码删除（2026-05-26）

081J 开始真实删代码，但只处理 channel-layer 中已经与主链路摘开的旧 Haro-owned 管理面。

本轮删除范围：

- `haro channel enable <id>` / `disable <id>` / `remove <id>` 旧 config 管理命令。
- `packages/cli/src/index.ts` 中对应的 channel config 写入/删除 helper。
- `haro channel ...` 命令触发 disabled Feishu/Telegram adapter 自动加载的旧 registry 行为。
- `@haro/channel` 的 `ChannelSetupResult` 与 `ManagedChannel.setup` 旧 onboarding contract。
- `packages/channel-feishu`、`packages/channel-telegram` 中仅用于旧 onboarding 的 `setup(...)` 方法和 prompt 读取 helper。
- 相关旧测试断言。

本轮保留范围：

- MCP `packages/mcp-tools/src/tools/send-message.ts`。
- `@haro/channel` 的 `ChannelRegistry`、`MessageChannel`、`OutboundMessage` 等 send_message 仍需的类型/运行时。
- `packages/channel-feishu` / `packages/channel-telegram` 的 `start`、`send`、`doctor` 和真实消息处理代码。
- AgentDock 生产消息能力。
- 真实 Feishu / Telegram 投递链路。
- run / router / runtime / scenario-router（第 4 项仍 deferred）。
- provider、memory、skills、Web/API。

### 18.1 只读盘点结论

channel-layer 当前分为三类：

1. MCP `send_message` 仍依赖的部分
   - `packages/mcp-tools/src/tools/send-message.ts`。
   - `packages/mcp-tools/src/types.ts` 中的 `ChannelRegistry` dependency。
   - `packages/channel/src/registry.ts`、`packages/channel/src/protocol.ts` 中的 registry/message 类型。
   - 这些本轮不删。

2. 生产消息或 adapter runtime 仍可能使用的部分
   - `packages/channel-feishu/src/feishu-channel.ts` 的 `start/send/doctor`。
   - `packages/channel-telegram/src/telegram-channel.ts` 的 `start/send/doctor`。
   - 这些本轮不删。

3. 只服务旧 Haro channel 管理/setup/onboarding 的部分
   - CLI `enable/disable/remove` config mutation。
   - disabled adapter autoload for `haro channel ...`。
   - adapter `setup(...)` onboarding methods。
   - 这些是 081J 删除对象。

### 18.2 guard 当前表达

081J 后 guard/report 必须表达：

- `planning.stage=FEAT-081J`。
- `planning.lastCompletedStage=FEAT-081J`。
- `physicalRemovals[]` 包含：
  - `packages/cli/src/index.ts#channel-config-management-commands:FEAT-081J`。
  - `packages/channel*/src#setup-contract:FEAT-081J`。
- `verifiedAbsent` 证明以下内容缺席：
  - `.command('enable')`。
  - `.command('disable')`。
  - `.command('remove')`。
  - `updateChannelConfig`。
  - `removeChannelConfig`。
  - `firstArg === 'channel'` disabled adapter autoload。
  - `ChannelSetupResult`。
  - `ManagedChannel.setup`。
  - Feishu / Telegram adapter `setup(...)`。

安全字段继续保持：

- `deleteAllowed=false`。
- `physicalDeleteApproved=false`。
- `wouldDelete=false`。
- `summary.deleteAllowedCount=0`。

### 18.3 下一步候选

下一项仍是 channel-layer，但范围已经变窄：

- 先替换 `@haro/channel` 在 MCP `send_message` / `mcp-tools` 类型中的依赖。
- 再评审是否删除剩余 `packages/channel*`。

这不是删除授权。

下一阶段必须继续保护：

- MCP `send_message`。
- AgentDock 生产消息能力。
- 真实 Feishu / Telegram 投递链路。

### 18.4 回滚方式

如需恢复 081J 删除内容，可 revert FEAT-081J commit。注意：FEAT-081L 之后 `packages/channel*` 已删除；只有完整恢复 channel packages 后，下列 081J 当时的 channel package build 命令才适用。

回滚后必须重新运行：

```bash
pnpm -F @haro/cli build
pnpm -F @haro/channel build
pnpm -F @haro/channel-feishu build
pnpm -F @haro/channel-telegram build
pnpm -F @haro/mcp-tools test -- test/tools/send-message.test.ts
pnpm test:legacy
pnpm test:sidecar
```

## 19. FEAT-081K mcp-tools 脱离 Haro channel registry（2026-05-26）

结论：本阶段完成 `packages/mcp-tools` 对 Haro channel registry/types 的前置解绑，但不删除 MCP `send_message` 工具，也不删除 `packages/channel*`。

### 19.1 选择的外部消息契约

只读复核 AgentDock 后，本阶段采用 AgentDock 已存在的 IPC 消息契约：

- `agent-dock/bin/agentdock-tool send-message` 会向 `${HAPPYCLAW_WORKSPACE_IPC}/messages` 写入 `{ type: "message", chatJid, text, targetChannel, urgent, replyToMsgId, groupFolder, timestamp }`。
- `container/agent-runner-core/src/plugins/messaging.ts` 的 `send_message` 工具使用同一类 workspace IPC `messages` 文件。
- AgentDock host 的 `src/im-manager.ts` / `src/index.ts` 继续负责真实 IM 投递；Haro 本阶段不修改 AgentDock。

因此 Haro MCP `send_message` 只负责调用 AgentDock-facing messaging gateway；真实 Feishu/Telegram/Web 发送仍由 AgentDock 生产链路完成。

### 19.2 已替换/删除的依赖

- `packages/mcp-tools/package.json` 移除 `@haro/channel` dependency。
- `packages/mcp-tools/tsconfig.json` 移除 `@haro/channel` path/reference。
- `ToolDependencies.channels: ChannelRegistry` 改为可选 `ToolDependencies.messaging: AgentDockMessageGateway`。
- `send_message` 不再 `ctx.deps.channels.getEntry(...).channel.send(...)`，改为 `ctx.deps.messaging.sendMessage(...)`。
- `mcp-tools` tests/helper 不再构造 `ChannelRegistry` / `ManagedChannel` / `OutboundMessage` fake，改为 fake AgentDock messaging gateway。
- `server-entry` 不再创建空 `ChannelRegistry`；缺少 AgentDock IPC env 时 fail-closed。
- `haro mcp` embedded wiring 不再传 `app.channelRegistry` 给 mcp-tools；只在 AgentDock IPC env 存在时传 messaging gateway。

### 19.3 兼容字段与新行为

`send_message` 保留旧 MCP 入参别名：

- `channelId` 仍可用，映射为 AgentDock `channel`。
- `content` 仍可用，映射为 AgentDock `text`。
- `sessionId` 只作为兼容输出 `channelSessionId`，不再用于 Haro channel registry 路由。

同时支持 AgentDock 风格：

- `channel`：例如 `feishu:oc_xxx`、`telegram:...`、`web:...`。
- `text`：发送文本。
- `urgent`、`reply_to_message_id` / `replyToMessageId`。

安全行为：

- cross-channel permission gate 仍保留。
- `attachments` 仍 fail-closed，不静默丢弃。
- 未配置 AgentDock messaging gateway 时返回 `TARGET_NOT_FOUND`，不回退 Haro channel registry。
- AgentDock gateway 写入失败时返回 `INTERNAL_ERROR`。

### 19.4 保留范围

- 保留 MCP `send_message` 工具本身。
- 保留 AgentDock 生产消息能力与真实 Feishu/Telegram 投递链路。
- FEAT-081L 后不再保留 `packages/channel*`；它们已与 CLI `haro channel list/doctor`、enabled adapter runtime 一起删除。
- 第 4 项 run/router/runtime/scenario-router 仍为 deferred，不因 081K/081L 获得删除资格。

### 19.5 下一步候选

FEAT-081K 的下一候选已由 FEAT-081L 完成处理。channel-layer 当前没有下一项删除授权；如果继续减法，必须重新排序其它模块并单项评审。

081K/081L 均不是泛化删除批准。guard 仍必须保持：`deleteAllowedCount=0`、`physicalDeleteApproved=false`、`wouldDelete=false`。


## 20. FEAT-081L channel-layer packages 与 list/doctor 收口（2026-05-26）

结论：本阶段真实删除 Haro-owned channel 剩余面，但严格保护 MCP `send_message` 与 AgentDock 生产消息链路。

### 20.1 删除内容

- 删除 `packages/channel`、`packages/channel-feishu`、`packages/channel-telegram` 三个 Haro-owned channel package。
- 删除 `packages/cli/src/channel.ts` 旧 package re-export；CLI REPL 所需的本地 `CliChannel` 被收敛到 `packages/cli/src/cli-channel.ts`，不再依赖 channel registry。
- 移除 `haro channel list` / `haro channel doctor` 注册、enabled adapter autoload、diagnostics channel stage、CLI package dependencies 与 tsconfig/root references。
- 更新 root `test:legacy`，不再运行已删除 channel package tests。

### 20.2 保留与保护

- 保留 `packages/mcp-tools/src/tools/send-message.ts` 工具名、schema、安全语义；底层继续走 AgentDock IPC messages contract。
- 不修改 AgentDock host、AgentDock IM manager、真实 Feishu/Telegram/IM 投递链路。
- 不触碰真实 `~/.haro/evolution`、真实 `~/.haro` 数据、aria-memory-vault。
- 不触碰 provider/memory/skills/Web/API，也不触碰第 4 项 run/router/runtime/scenario-router；第 4 项仍 deferred，等待 AgentDock 定时任务 -> Haro 生成提案 -> Review Board 可审链路稳定后再评估。

### 20.3 验收与 guard 状态

必须验证：

```bash
git diff --check
pnpm -F @haro/cli build
pnpm -F @haro/mcp-tools build
pnpm -F @haro/mcp-tools test -- test/tools/send-message.test.ts
pnpm -F @haro/cli test -- test/legacy-removal-guard.test.ts
pnpm test:sidecar
pnpm test:legacy
```

guard 在 081L 主删除阶段应保持：`stage=FEAT-081L`、`deleteAllowedCount=0`、`physicalDeleteApproved=false`、`wouldDelete=false`、`verifiedAbsentFailedCount=0`；`nextDeletionCandidate=null`，channel-layer 只记录已完成删除，不构成其它模块删除批准。

### 20.4 FEAT-081L fail-closed hotfix（2026-05-26）

081L 之后补充 hotfix：

- haro-side：`03c35cb`
- haro：`c3ae19b`

目的：退役后的 `haro channel ...` 命令必须 `exit!=0` fail-closed，不允许因为 channel subcommand 不再注册而落入默认 REPL / handler。该 hotfix 只修退役命令行为，不恢复任何 Haro-owned channel package，不修改 MCP `send_message`，不修改 AgentDock 生产消息链路。

## 21. FEAT-081M evidence refresh（2026-05-26）

081M 不做物理删除，只做 docs/guard 清理和 AgentDock takeover evidence 盘点。新增/更新证据文档：

- `docs/planning/agentdock-takeover-evidence.md`

081M 后 guard 口径：

- `planning.stage=FEAT-081M`。
- `planning.lastCompletedStage=FEAT-081L`。
- `planning.lastUpdatedBy=FEAT-081M`。
- `nextDeletionCandidate=null`。
- `nextReviewCandidate=null`。
- `deleteAllowedCount=0`。
- `physicalDeleteApproved=false`。
- `wouldDelete=false`。
- 所有 item 的 `deleteAllowed=false`。
- provider/memory/skills/web/runtime 只记录 blocker 和替代证据缺口，不表达物理删除批准。

081M ranking 结论：当前不应进入任何新的物理删除。剩余候选缺少“窄面 + AgentDock 替代证据齐全”的条件：

1. `provider-codex`：081M 当时认为 setup/onboarding 只能先评审；081N 用户产品决策已改为接受外部 codex CLI/auth 作为前置，因此本轮只退役 `haro provider setup ...`，不删除 provider runtime。
2. `memory-fabric`：真实 `~/.haro` 数据、aria-memory-vault、MCP `memory_query` / `memory_remember` 默认注册仍是 blocker。
3. `skills-marketplace`：`haro skills install/enable/disable`、`SkillsManager`、eat/shit 兼容资产仍是 blocker。
4. `web-dashboard-non-review`：非 review dashboard 已基本自然收口为 Review Board + auth/bootstrap；继续 freeze/allowlist，不做物理删除。
5. `agent-runtime-router`：继续 deferred；等 AgentDock 定时任务 -> Haro 提案 -> approval request -> Review Board 可审并证明不依赖旧 `haro run/chat/team/scenario` 后再评。

081M 明确未做：不修改 provider/memory/skills/runtime/Web/MCP 业务代码；不删除文件；不触碰真实 `~/.haro/evolution`、真实 `~/.haro` 或 aria-memory-vault；不 approve/apply/rollback/confirm。

## 22. FEAT-081N provider setup/onboarding 摘线（2026-05-26）

用户最新产品决策：Haro 新产品定位不再需要等价 `haro provider setup codex` 功能；AgentDock 已支持 Codex runner，产品可接受外部 codex CLI/auth 作为前置。

本阶段只处理窄面：

- `haro provider setup ...` 注册入口在 081N 当时保留为 retired/fail-closed，避免落入 commander unknown、REPL 或默认 handler。
- 081R 后该 retired 子命令 stub 已删除；当前 `haro provider setup ...` 由 provider command unknown-command fail-closed，新产品使用 AgentDock Codex runner / 外部 `codex login` 前置。
- 不再调用 `runCodexAuthWizard`、`writeProviderConfig`、`writeProviderEnvFile`、`runProviderDoctor` 等 setup 写入/检查流程。
- 保留 `haro provider list`、`doctor`、`models`、`select`、`env`。
- 不修改 `packages/provider-codex/**`、`createCodexProvider`、`readLocalCodexAuth`、provider runtime、diagnostics provider stage、run/chat/LLM provider path。

081N guard 口径：

- `planning.stage=FEAT-081N`。
- `planning.lastCompletedStage=FEAT-081N`。
- `planning.lastUpdatedBy=FEAT-081N`。
- `provider-codex` 仍是 `blocked`，`deleteAllowed=false`。
- `deletionCandidateAllowed=false`、`physicalDeleteApproved=false`、`wouldDelete=false`、`deleteAllowedCount=0` 保持不变。
- 可记录 scoped `pilotUnbind=packages/cli/src/index.ts#provider-setup-onboarding-command`，但不得把整个 `packages/provider-codex` 标成 done。

081N 后续风险记录：`provider-codex-wizard.ts` 可能成为 setup-only 历史文件，diagnostics remediation 中仍有 provider setup 文案；这些事项不能在 081N 扩大处理。FEAT-081O 已单独评审并处理该最小清理面。

## 23. FEAT-081O provider setup-only wizard 清理（2026-05-26）

081O 的只读盘点结论：

- `provider-codex-wizard.ts` 相关符号（`runCodexAuthWizard` / `runProviderSetupWizard` / `runChatGptLogin` / `summarizeAuth`）已无 CLI/runtime 业务入口。
- 剩余引用只来自该文件自身、旧 wizard 单元测试、planning/guard/docs 历史说明与旧 Phase spec。
- `packages/provider-codex/**`、`createCodexProvider`、`readLocalCodexAuth`、provider doctor/list/models/select/env、diagnostics provider stage 与 run/chat/LLM provider path 仍需保护。

本阶段完成的最小安全代码清理：

- 物理删除 `packages/cli/src/provider-codex-wizard.ts`。
- 删除只服务该 wizard 的 `packages/cli/test/provider-codex-wizard.test.ts`，并从 `packages/cli/package.json` `test:legacy` 移除该测试入口。
- 081O 当时仍保留 `haro provider setup ...` retired/fail-closed stub；081R 后该 stub 已删除。
- 将 provider doctor/models/diagnostics 中仍指向 `haro provider setup codex` 的 remediation 改为 `OPENAI_API_KEY`、外部 `codex login --device-auth` 与 `haro provider doctor codex` 口径。

081O guard 口径：

- `planning.stage=FEAT-081O`。
- `planning.lastCompletedStage=FEAT-081O`。
- `planning.lastUpdatedBy=FEAT-081O`。
- `provider-codex` 仍是 `blocked`，`deleteAllowed=false`，`stillReferenced=true`。
- `deleteAllowedCount=0`、`physicalDeleteApproved=false`、`wouldDelete=false` 保持不变。
- 仅记录 scoped physical removal：`packages/cli/src/provider-codex-wizard.ts` removed by FEAT-081O；不得把整个 `packages/provider-codex` 标成 done。

后续风险：provider runtime、diagnostics provider stage 与 run/chat/LLM path 仍有业务引用；若继续 provider 减法，必须单独证明 runtime 无引用且有 AgentDock/ModelHub 替代证据。

## 24. FEAT-081P provider setup env-file writer 清理（2026-05-26）

081P 的只读盘点结论：

- `writeProviderEnvFile` / `ProviderEnvFileWriteResult` 已无 CLI/runtime 业务入口；081N 后 `haro provider setup --write-env-file` 已 retired/fail-closed，不再调用该 writer。
- `ProviderEnvFileSummary`、`readProviderEnvFileSummary`、`resolveProviderEnvFile`、`ProviderSecretSummary.envFile` 仍服务 `runProviderDoctor`、`haro provider env` 与 diagnostics provider stage 的只读 summary，必须保留。
- `writeProviderConfig` / `parseProviderScope` 仍服务 `haro provider select`，必须保留。

本阶段完成的最小安全代码清理：

- 删除 `packages/cli/src/provider-onboarding.ts#writeProviderEnvFile`。
- 删除 `ProviderEnvFileWriteResult`。
- 删除随 writer 变 dead 的 `renameSync` / `chmodSync` import 和 env-file merge/quote helper。
- 081P 当时仍保留 `haro provider setup ...` retired/fail-closed stub；081R 后该 stub 已删除。继续保留 `provider env` 只读 summary、`provider select` 与 provider runtime。

081P guard 口径：

- `planning.stage=FEAT-081P`。
- `planning.lastCompletedStage=FEAT-081P`。
- `planning.lastUpdatedBy=FEAT-081P`。
- scoped removal 只记录 `packages/cli/src/provider-onboarding.ts#writeProviderEnvFile`。
- `provider-codex` 仍是 `blocked`，`deleteAllowed=false`，`stillReferenced=true`。
- `deleteAllowedCount=0`、`physicalDeleteApproved=false`、`wouldDelete=false`、`nextDeletionCandidate=null`、`nextReviewCandidate=null` 保持不变。

后续风险：provider runtime、diagnostics provider stage、run/chat/LLM path、provider doctor/list/models/select/env 仍有业务引用；不得把 081P 解读为 provider runtime/package 删除批准。

## 25. FEAT-081Q guard physicalRemovals schema 收口（2026-05-26）

081Q 只清理 legacy-removal guard 内部历史 schema，不做 runtime 删除，不放宽任何 candidate 状态。

本轮统一内容：

- 删除 guard definition 中的 singleton `physicalRemoval?` 字段。
- 将 `agent-runtime-router` 的 FEAT-081D `packages/core/src/team-orchestrator.ts` 记录迁移到 `physicalRemovals[]`。
- 将 `channel-layer` 的 FEAT-081E `packages/cli/src/gateway.ts` 记录迁移到 `physicalRemovals[]`。
- `completedPhysicalRemovals` report builder 只读取 `item.physicalRemovals ?? []`。
- 人读输出只打印 `physicalRemovals=`，不再打印 `physicalRemoval=`。

明确不变：

- 不修改 `packages/cli/src/index.ts` 的 gateway removed runtime payload；其中的 `physicalRemoval` 是 CLI runtime/API contract，不是 guard schema。
- 不修改 provider runtime、channel/MCP send_message、memory、skills、Web、runtime/scenario-router 或 AgentDock host。
- `completedPhysicalRemovals` 的历史记录不丢失：FEAT-081D、FEAT-081E、FEAT-081H、FEAT-081J、FEAT-081L、FEAT-081O、FEAT-081P 记录仍在。FEAT-081R 追加 provider setup retired stub scoped removal。
- Guard 继续 fail-closed：`deleteAllowedCount=0`、`wouldDelete=false`、`physicalDeleteApproved=false`、`nextDeletionCandidate=null`、`nextReviewCandidate=null`。


## 26. FEAT-081R provider setup retired stub 删除（2026-05-26）

081R 只处理 provider setup/onboarding 子面的最后一个 CLI surface，不扩大到 provider runtime。

只读盘点结论：

- `packages/cli/src/index.ts` 中仅剩 081N 后保留的 provider setup retired command registration/stub。
- `runCodexAuthWizard`、旧 `provider-codex-wizard.ts`、旧 `writeProviderEnvFile` writer 已分别在 081N/081O/081P 后从业务入口摘线或删除。
- `haro provider list/doctor/models/select/env` 仍共享 provider runtime/helper，必须保留。

本阶段完成的最小安全代码清理：

- 删除 `packages/cli/src/index.ts#provider-setup-retired-stub`。
- `haro provider setup ...` 不再注册为子命令；调用会由 provider command unknown-command fail-closed，exit 非 0，不写 `HARO_HOME/config.yaml` 或 provider env file，不进入 REPL/default handler。
- 保留 `packages/provider-codex/**`、`createCodexProvider`、`readLocalCodexAuth`、provider list/doctor/models/select/env、diagnostics provider stage 与 run/chat/LLM provider path。

081R guard 口径：

- `planning.stage=FEAT-081R`。
- `planning.lastCompletedStage=FEAT-081R`。
- `planning.lastUpdatedBy=FEAT-081R`。
- scoped removal 只记录 `packages/cli/src/index.ts#provider-setup-retired-stub`。
- `provider-codex` 仍是 `blocked`，`deleteAllowed=false`，`stillReferenced=true`。
- `deleteAllowedCount=0`、`physicalDeleteApproved=false`、`wouldDelete=false`、`nextDeletionCandidate=null`、`nextReviewCandidate=null` 保持不变。

后续风险：provider runtime、diagnostics provider stage、run/chat/LLM path、provider doctor/list/models/select/env 仍有业务引用；不得把 081R 解读为 provider runtime/package 删除批准。


## 27. FEAT-081S TeamOrchestrator removed-result 兼容 payload 删除（2026-05-27）

081S 按用户选择 A 只解除 `agent-runtime-router` 的一个窄面 defer 边界：处理 TeamOrchestrator 已删除后遗留的 CLI removed-result 兼容入口。

本阶段完成的最小安全代码清理：

- 删除 `packages/cli/src/index.ts#legacy-team-orchestrator-removed-result`。
- 删除 `legacyTeamOrchestratorRemovedResult(...)` 函数与 `legacy_team_orchestrator_removed` 专用返回 payload。
- team-mode 命中但无 skill `directOutput` 时走普通 single-agent runner/fallback；`HARO_ENABLE_LEGACY_TEAM_ORCHESTRATOR=1` 不会恢复 TeamOrchestrator。

明确不变：

- 不删除、不修改 `packages/core/src/scenario-router.ts`、runtime、run/chat/LLM provider path。
- 不恢复 TeamOrchestrator，不新增依赖，不修改 AgentDock host、MCP send_message/channel/memory、provider/memory/skills/Web。
- `agent-runtime-router` 仍 `deleteAllowed=false`，`stillReferenced=true`，不得变成 next-safe candidate。

081S guard 口径：

- `planning.stage=FEAT-081S`。
- `planning.lastCompletedStage=FEAT-081S`。
- `planning.lastUpdatedBy=FEAT-081S`。
- scoped removal 只记录 `packages/cli/src/index.ts#legacy-team-orchestrator-removed-result`。
- `deleteAllowedCount=0`、`wouldDelete=false`、`physicalDeleteApproved=false`、`nextDeletionCandidate=null`、`nextReviewCandidate=null` 保持不变。

后续风险：普通 single-agent fallback 仍依赖 provider runtime 与 runner；scenario-router/runtime 是否继续退役必须另起单项评审，不得由 081S 推导。


## 28. FEAT-081T / B-1 Web/API 非 review surface schema closure（2026-05-27）

081T/B-1 只做 guard/tests/docs schema closure，不做任何 Web/API runtime 删除。

只读枚举结论：

- `packages/web` / `packages/web-api` 的非 review dashboard/API surface 当前为空。
- Haro Web/API 当前只保留 Review Board、approval request/decision/conversation 相关能力，以及 auth/bootstrap、`/api/health`、SPA fallback、404 fail-closed 与共享基础设施。
- `packages/web` 与 `packages/web-api` 包级能力仍在保护范围；081T 不修改 runtime/test/e2e，也不批准后续包级删除。

081T guard 口径：

- `planning.stage=FEAT-081T`。
- `planning.lastCompletedStage=FEAT-081T`。
- `planning.lastUpdatedBy=FEAT-081T`。
- `web-dashboard-non-review.candidatePriority.status=done`，其中 done 仅表示 Review Board allowlist 与非 review 路由枚举闭环；`state=freeze` 继续表示 Web/API 保持冻结/保护。
- `web-dashboard-non-review` 从 `blockedCandidateIds` 移除，但 `deleteAllowed=false`，`stillReferenced=true`，`candidatePriority.forbiddenScope` 仍包含 `packages/web`、`packages/web-api`、approval review board routes。
- `LEGACY_MODULE_RETIREMENT_BOUNDARIES.web-api.deletionCandidateAllowed=false` 保持不变。
- B-1 没有物理删除，不新增 `physicalRemovals`，`completedPhysicalRemovals` 保持 13；FEAT-081S TeamOrchestrator removed-result 记录仍归属 `removedBy=FEAT-081S`。
- `deleteAllowedCount=0`、`wouldDelete=false`、`physicalDeleteApproved=false`、`nextDeletionCandidate=null`、`nextReviewCandidate=null` 保持不变。

后续风险：Review Board/auth/bootstrap/health/fallback/infrastructure 是 Haro sidecar 人审链路基础设施；不得从 081T 推导 `packages/web` / `packages/web-api` runtime 或包级删除批准。未来如出现新的非 review Web/API surface，必须逐路由单项评审。


## 29. FEAT-081U / C-1 `haro run --legacy-memory` CLI opt-in 删除（2026-05-28）

081U/C-1 只处理 memory-fabric 的最小安全切片：删除 `haro run --legacy-memory` 用户 opt-in 与仅服务该 opt-in 的 CLI-side MemoryFabric wiring。它不是 MemoryFabric runtime、真实数据、MCP memory tool 或 `haro memory` 子命令删除批准。

只读盘点结论：

- `packages/cli/src/index.ts` 仍有 `run --legacy-memory` flag，以及 `legacyRunMemory`、`getLegacyMemoryFabric`、`createLegacyMemoryFabric`、`resolveLegacyMemoryRoots`、`createCliMemoryWrapupHook` 等 CLI wiring。
- `packages/core/src/index.ts` 仍导出 `createMemoryFabric`；`packages/core/src/memory/**`、`packages/core/src/services/memory.ts` 仍是 protected runtime。
- `packages/cli/src/commands/memory.ts` 仍注册 `haro memory` 子命令。
- `packages/mcp-tools/src/index.ts`、`packages/mcp-tools/src/tools/memory-query.ts`、`memory-remember.ts` 仍提供 MCP `memory_query` / `memory_remember` 默认 registry/工具。
- 真实 `~/.haro`、`~/.haro/evolution` 与 aria-memory-vault 不属于本阶段可读写/迁移/删除范围。

本阶段完成的最小安全代码清理：

- 删除 `packages/cli/src/index.ts#--legacy-memory-opt-in`。
- 删除 CLI-side legacy MemoryFabric factory/path resolver/wrapup hook wiring。
- 删除 `haro run` 上的 legacy memory 用户选项；`haro run --legacy-memory ...` 现在由 commander unknown option fail-closed，exit 非 0，不创建 `memory/` 目录。
- 普通 `haro run` 继续不创建 Haro-owned `memory/` 目录，也不注入 `<memory-context>`。
- 保留内部 `ExecutionOptions.noMemory` 字段及内部调用语义；review conversation 等内部路径仍可传 `noMemory: true`。

明确不变：

- 不修改 `packages/core/src/memory/**`、`packages/core/src/services/memory.ts`、`packages/cli/src/commands/memory.ts`、`packages/mcp-tools/**`。
- 不读写、迁移、删除真实 `~/.haro*` 或 aria-memory-vault。
- 不修改 AgentDock host、provider、skills、Web/Web API、runtime/scenario-router、run/chat/LLM provider path。

081U guard 口径：

- `planning.stage=FEAT-081U`。
- `planning.lastCompletedStage=FEAT-081U`。
- `planning.lastUpdatedBy=FEAT-081U`。
- `memory-fabric.physicalRemovals[]` 新增 `packages/cli/src/index.ts#--legacy-memory-opt-in`，`removedBy=FEAT-081U`。
- `completedPhysicalRemovals=14`。
- `memory-fabric` 仍 `candidatePriority.status=blocked`，`deleteAllowed=false`，`stillReferenced=true`。
- `LEGACY_MODULE_RETIREMENT_BOUNDARIES.memory.deletionCandidateAllowed=false` 保持不变。
- `deleteAllowedCount=0`、`wouldDelete=false`、`physicalDeleteApproved=false`、`nextDeletionCandidate=null`、`nextReviewCandidate=null` 保持不变。

后续风险：MCP memory 默认 registry、core MemoryFabric runtime、真实 `~/.haro` 数据和 aria-memory-vault owner 边界仍未解除。后续如继续 memory 减法，必须先完成数据/owner/MCP tool 边界证明；不得从 081U 推导 memory runtime、memory CLI 或 MCP memory tool 删除批准。

## 30. FEAT-081V / D-1 `marketplace:<name>` skills install placeholder 退役（2026-05-28）

081V/D-1 只处理 skills-marketplace 的最小安全切片：退役 `marketplace:<name>` 占位 install surface，让旧 Phase 0 placeholder 不再落入“尚未接入下载”的模糊错误。它不是 `packages/skills`、`SkillsManager`、local/git install、eat/shit、sync-runtime、prepareTask 或 AgentDock skills 的删除批准。

只读盘点结论：

- `packages/skills/src/manager.ts` 中 `SkillsManager.install(source)` 仍是 `haro skills install` 的核心入口。
- `source.startsWith('marketplace:')` 仅提供旧 Phase 0 placeholder 文案，没有实际 marketplace 下载实现。
- `installFromPath(source)`、`installFromGit(source)`、`looksLikeGitUrl(source)` 仍服务 local path / git URL 安装，必须保留。
- `runEat`、`runShit`、`syncRuntimeSkills` 与 `prepareTask` 仍在 `packages/skills` 内承担 eat/shit 兼容资产、runtime sync 与 skill matching 语义，必须保留。
- 本阶段不修改 AgentDock host、MCP/channel/memory/provider/Web/runtime/scenario-router/run/chat/LLM provider path，也不触碰真实 `~/.haro*` 或 aria-memory-vault。

本阶段完成的最小安全代码清理：

- 将 `marketplace:<name>` install 分支从旧 `Phase 0 仅保留 marketplace:<name> 命令框架，尚未接入实际 marketplace 下载` 改为明确 retired/fail-closed 文案。
- 文案指向 AgentDock skills 作为 marketplace distribution owner，或要求用户显式安装 local/git skill。
- 保留显式 `marketplace:` 分支，防止落入 local path 底层错误。
- 增加 manager/CLI 测试：`marketplace:review` fail-closed，local path install 仍成功。

明确不变：

- 不删除 `packages/skills` 包，不删除或重构 `SkillsManager`。
- 不删除/修改 local path install、git install、eat/shit 预装技能资产、sync-runtime、prepareTask。
- 不修改 `haro skills list/info/enable/disable/uninstall`、`haro skill <id>`、AgentDock skills 或 sidecar 主链路。
- 不修改 MCP/channel/memory/provider/Web/runtime/scenario-router/run/chat/LLM provider path。
- 不读写、迁移、删除真实 `~/.haro*` 或 aria-memory-vault。

081V guard 口径：

- `planning.stage=FEAT-081V`。
- `planning.lastCompletedStage=FEAT-081V`。
- `planning.lastUpdatedBy=FEAT-081V`。
- `skills-marketplace.physicalRemovals[]` 新增 `packages/skills/src/manager.ts#marketplace-install-placeholder`，`removedBy=FEAT-081V`。
- `completedPhysicalRemovals=15`。
- `skills-marketplace` 仍 `state=freeze`、`candidatePriority.status=defer`、`deleteAllowed=false`、`stillReferenced=true`。
- `LEGACY_MODULE_RETIREMENT_BOUNDARIES.skills.deletionCandidateAllowed=false` 保持不变。
- `deleteAllowedCount=0`、`wouldDelete=false`、`physicalDeleteApproved=false`、`nextDeletionCandidate=null`、`nextReviewCandidate=null` 保持不变。

后续风险：AgentDock skills owner、Haro local/git install 用户入口、eat/shit 兼容资产、sync-runtime 与 prepareTask 的边界仍未完全拆清。后续如继续 skills 减法，必须先做单项评审并证明不影响 production path；不得从 081V 推导 `packages/skills` 或 `SkillsManager` 删除批准。
