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
- provider、channel、memory、runtime 暂不删除。
- 先做 bridge 和 export 解绑。
- 最后才考虑物理删除 package。

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
| still_imported_by | `packages/cli/src/index.ts` 默认 provider 注册；provider onboarding；`@haro/provider-codex` package tests |
| replacement | AgentDock 统一 provider / ModelHub；Haro 只通过 sidecar contract 读取运行结果 |
| blocking_dependencies | AgentDock provider bridge 明确；CLI `provider setup` 迁移提示稳定；移除默认 provider 注册 |
| risk_if_removed | `haro run/chat`、旧 provider doctor、旧 setup 测试失败；部分 legacy tests 失效 |
| rollback_plan | git revert 删除 PR；恢复 package 与 workspace dependency |
| required_verification | `pnpm test:sidecar`；`pnpm -F @haro/provider-codex test`；`pnpm -F @haro/cli test:legacy` |
| decision | 保持 deprecate，不删除；先由 AgentDock 承接 provider 能力 |

### 3.2 packages/channel / channel-feishu / channel-telegram

| 字段 | 内容 |
| --- | --- |
| current_state | deprecate |
| still_imported_by | `packages/cli/src/channel.ts`；`haro channel`；gateway；channel package tests |
| replacement | AgentDock IM / channel layer；Haro 只接收 sidecar observation 与 approval feedback |
| blocking_dependencies | AgentDock channel contract 明确；旧 `haro channel setup` 入口降级；gateway 移除依赖 |
| risk_if_removed | Feishu/Telegram 旧入口不可用；gateway doctor/list 测试失败 |
| rollback_plan | git revert；恢复 packages 与 workspace dependencies |
| required_verification | `pnpm test:sidecar`；`pnpm -F @haro/channel test`；`pnpm -F @haro/channel-feishu test`；`pnpm -F @haro/channel-telegram test`；`pnpm -F @haro/cli test:legacy` |
| decision | 保持 deprecate，不删除；先确认 AgentDock 已完全承接 IM |

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
| current_state | remove-candidate |
| still_imported_by | core barrel exports；team-orchestrator tests；旧 orchestration docs/specs |
| replacement | AgentDock 多 agent / workspace orchestration；Haro 只选择 proposal 对应 workspace |
| blocking_dependencies | 确认无 sidecar 主链路 import；移除 barrel export；更新 legacy tests 分类 |
| risk_if_removed | 旧 team workflow 无法使用；历史 specs 无法直接复现 |
| rollback_plan | git revert；恢复单文件与 export |
| required_verification | `pnpm test:sidecar`；`pnpm -F @haro/core test:legacy -- test/team-orchestrator.test.ts` |
| decision | 可进入删除评审，但必须先做 export 解绑并获批 |

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
