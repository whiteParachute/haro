# Haro sidecar 减法盘点与反馈闭环共识

## 0. 结论

Haro 的终极目标已经收口。

Haro 是 AgentDock 的 self-evolution sidecar。
它不是独立 workbench。
也不是第二套 runtime。

Haro 的价值是：

1. 观察 AgentDock 和 Haro 自身信号。
2. 生成可执行 proposal。
3. 让用户人审。
4. 按修改意见重写 proposal。
5. 重新提交用户决策。
6. 审批通过后受控执行。
7. 把执行结果反馈到下一轮。

因此，下一阶段先做减法。
先盘点哪些历史方向不再发展。
再按闭环补必要能力。
本轮不删除代码。

## 1. 完整闭环

Haro 的目标闭环如下。

```text
observe
  -> propose
  -> validate
  -> review
  -> request-changes
  -> rewrite
  -> resubmit
  -> approve
  -> apply
  -> feedback
```

每一步的含义如下。

| 步骤 | 说明 | Haro 责任 |
| --- | --- | --- |
| observe | 观察 AgentDock 使用和 Haro 自身健康 | 读取信号，写 observation |
| propose | 生成具体改动提案 | 写 proposal 和内容文件 |
| validate | 检查风险和回滚方案 | 写 validation |
| review | 用户查看和决策 | 提供 review board 数据 |
| request-changes | 用户要求修改 | 保存 decision 和对话 |
| rewrite | Haro 吸收意见后重写 | 生成修订版 proposal |
| resubmit | 再次提交用户决策 | 写新的 approval request |
| approve | 用户批准 | 写 approval decision |
| apply | 受控执行 | 走 gate、snapshot、rollback |
| feedback | 汇报执行结果 | 写 application 事件和反馈 |

关键点：

- request-changes 不是终点。
- Haro 必须修订 proposal。
- 修订后要重新提交用户。
- 不能只记录反馈。
- 不能自动 approve。
- apply 和 rollback 必须走 gate。

## 2. AgentDock 与 Haro 边界

### 2.1 AgentDock 负责

AgentDock 继续负责主工作台能力。

| 范围 | 说明 |
| --- | --- |
| session | 会话生命周期和上下文 |
| runner | 任务运行和模型调用 |
| workspace | 工作区选择和执行环境 |
| IM | 飞书、Web、其它消息通道 |
| scheduler | 定时任务和触发器 |
| memory | aria-memory-vault 和记忆写入 |
| 多 agent 执行 | workspace 内 agent 分工与回传 |

Haro 不接管这些能力。
Haro 只通过 contract 使用它们。

### 2.2 Haro 负责

Haro 只维护自进化 artifact。

| 范围 | 说明 |
| --- | --- |
| proposal | 改动提案 |
| validation | 风险、测试和回滚检查 |
| approval decision | 用户或系统的审批记录 |
| application | 已执行变更记录 |
| rollback | 回滚材料和事件 |
| feedback revision | 修改意见和修订链 |
| blocked event | 被 Haro 拦截的提案记录 |

Haro Web 只做 review board。
它不是通用控制台。

Haro 不拥有 memory。
Haro 不改 aria-memory-vault。
如需记忆能力，必须通过 AgentDock。

## 3. 不再发展的历史方向

以下方向进入停止发展状态。
它们可以暂时保留兼容。
但不再投入新能力。

| 历史方向 | 当前判断 | 后续动作 |
| --- | --- | --- |
| Haro-owned workbench | 与 AgentDock 重叠 | deprecate |
| Haro runtime/control-plane | 与 AgentDock runner 重叠 | deprecate |
| 通用 Web Dashboard | 只保留 review board | deprecate |
| Haro-owned channel layer | IM 由 AgentDock 管 | deprecate |
| Feishu/Telegram/Web channel | 仅保留兼容测试 | freeze |
| provider/Codex provider | 模型接入由 AgentDock 管 | deprecate |
| ChatGPT auth onboarding | 不属于 sidecar 主链路 | remove-candidate |
| MemoryFabric/memory skills | memory 由 AgentDock 管 | deprecate |
| team-orchestrator | 多 agent 由 AgentDock 管 | deprecate |
| scenario-router | 路由由 AgentDock/workspace 管 | deprecate |
| 通用 skills subsystem | 只保留 sidecar 必需 skill | deprecate |
| skills marketplace | 不再作为 Haro 主方向 | remove-candidate |

## 4. 减法盘点规则

每个对象使用 4 个状态。

| 状态 | 含义 |
| --- | --- |
| keep | 闭环必需，继续维护 |
| freeze | 暂保留，不继续发展 |
| deprecate | 加 legacy 或 deprecated 标记 |
| remove-candidate | 可删除候选，需先验证 |

删除前必须满足两条。

1. sidecar 主链路测试通过。
2. 没有 AgentDock 接入依赖。


Otherway 边界复核后补充 5 条安全规则。

1. 删除不是第一步。
2. 必须先列 `still_imported_by`。
3. 必须先把 sidecar 引用切到 AgentDock 等价能力，或显式下线入口。
4. 必须跑 build / test / smoke 后，才允许从 freeze 进入 remove-candidate。
5. `freeze` 不是 `delete`。freeze 表示停止扩展并移出主路径；delete 必须另有删除批准和回滚方案。

inventory 建议额外记录以下字段。

| 字段 | 说明 |
| --- | --- |
| still_imported_by | 真实 grep 结果，含文件和行号 |
| blocking_dependencies | 删除前必须先完成的解绑或替换动作 |
| replacement | AgentDock 等价能力或 Haro sidecar 新入口 |
| delete_method | legacy 标记、移入 archive、保留只读、或删除 |
| related_spec | 关联 FEAT / roadmap / archive 文档 |

sidecar 主链路指：

```text
observe -> propose -> validate -> review -> rewrite -> approve -> apply -> feedback
```

## 5. Haro subtraction inventory 初版

### 5.1 packages

| 对象 | 状态 | 理由 | risk | verification |
| --- | --- | --- | --- | --- |
| `packages/agentdock-contract` | keep | 定义 observation、proposal、validation contract | 破坏会导致 daily workflow 失效 | `pnpm -F @haro/agentdock-contract test` |
| `packages/mcp-tools` | keep | 暴露 Haro MCP tools | 破坏 AgentDock 调用 Haro | `pnpm -F @haro/mcp-tools test` |
| `packages/cli` sidecar 命令 | keep | observe/propose/validate/apply 主入口 | 破坏 CLI 和 MCP workflow | `pnpm -F @haro/cli test -- test/agentdock-sidecar-cli.test.ts` |
| `packages/web` review board | keep | 用户审批 proposal 的页面 | 破坏用户人审入口 | `pnpm -F @haro/web build` |
| `packages/web-api` approval API | keep | 提供 approval request 和 decision API | 破坏 review board | `pnpm -F @haro/web-api test` |
| `packages/core` asset/paths/config | keep | 仍被 sidecar 存储和配置复用 | 误删会破坏 HARO_HOME | `pnpm -F @haro/core test -- evolution` |
| `packages/core` runner/session/team/memory | deprecate | 属于旧 workbench/runtime | 误删会影响旧测试和 CLI | 先加 legacy 标记，后分批删 |
| `packages/channel` | deprecate | Haro 不再拥有 channel layer | 旧 CLI channel 可能依赖 | 跑 channel tests 后标记 legacy |
| `packages/channel-feishu` | freeze | 飞书由 AgentDock 负责 | 老集成可能仍被测试引用 | 保留测试，不新增能力 |
| `packages/channel-telegram` | freeze | Telegram 不在 sidecar 主线 | 删除会影响历史测试 | 标记冻结，不再扩展 |
| `packages/provider-codex` | deprecate | provider 由 AgentDock 管 | 删除会影响 chat/run 旧能力 | 先断开新入口，再删 |
| `packages/skills` | deprecate | 通用 skills marketplace 不再发展 | eat/shit 历史路径可能依赖 | 只保留 sidecar 需要项 |

### 5.2 CLI 命令

| 命令组 | 状态 | 理由 | risk | verification |
| --- | --- | --- | --- | --- |
| `connect agent-dock` | keep | 注册 AgentDock connection | 破坏观察入口 | sidecar CLI test |
| `observe` | keep | 生成 observation | 破坏 daily workflow | fake + HTTP source test |
| `intake frontier` | keep | 拉取外部一手信号 | 提案信号会变窄 | frontier source test |
| `propose` | keep | 生成 proposal | 破坏主链路 | agentdock-sidecar CLI test |
| `validate` | keep | 风险和 gate 检查 | 破坏 apply 安全 | validation test |
| `approval-request` | keep | 生成待审请求 | 用户无法 review | approval workflow test |
| `lint descriptions` | keep | 保证提案可读 | 可读性回退 | readability lint test |
| `cleanup --rejected` | keep | 清理已退回提案 | 页面污染增加 | cleanup test |
| `snapshot/apply/rollback` | keep | L0/L1 受控执行 | approve 后无法落地 | apply/rollback tests |
| `patch-branch` | freeze | L2/L3 仍是规划骨架 | 提前删会阻断后续执行器 | 保留到 FEAT-057 |
| `web` | keep | 启动 review board | 用户无法审批 | web health smoke |
| `mcp` | keep | AgentDock 调用 Haro | 主集成面失效 | mcp-tools e2e |
| `doctor/status` | keep | 诊断 sidecar 状态 | 排障能力下降 | CLI output test |
| `chat/run` | deprecate | 属于旧 Haro workbench | 老用户命令可能失效 | 加 legacy 提示 |
| `session/agent/workflow` | deprecate | 属于旧 runtime 管理 | 旧测试可能依赖 | 分批迁移测试 |
| `cron` | freeze | scheduler 由 AgentDock 管 | 老定时任务可能存在 | 保留读和迁移提示 |
| `memory` | deprecate | memory 由 AgentDock 管 | 旧 memory tests 失败 | 加迁移说明 |
| `skill/eat/shit` 通用能力 | deprecate | marketplace 不再发展 | 资产历史可能依赖 | 只保留 Haro asset 迁移路径 |
| `provider/setup/user/config gateway` | freeze | 多数属于旧 onboarding/control plane | 直接删会影响本地 auth | 先标 legacy，后拆分 |

### 5.3 Web 页面与 API

| 对象 | 状态 | 理由 | risk | verification |
| --- | --- | --- | --- | --- |
| ApprovalRequestsPage | keep | review board 主页面 | 用户无法审批 | Web smoke |
| approval requests API | keep | 提供列表、决策、生命周期 | 页面无数据 | web-api approval tests |
| approval conversations API | keep | 支持 request-changes 多轮讨论 | 反馈无法沉淀 | conversation CRUD test |
| health API | keep | 部署和 smoke 需要 | 无法判断服务健康 | `curl /api/health` |
| LoginPage / auth API | keep | 本地 review board 需要身份 | 页面无法安全使用 | auth smoke |
| BootstrapPage | freeze | 只保留首次本地登录 | 误删影响首次访问 | 手动 smoke |
| runtime API | deprecate | 不再承载 Haro runtime 控制 | 旧页面可能引用 | 查引用后再删 |
| 通用 dashboard 页面 | remove-candidate | 不符合 review board 定位 | 误删前需确认无入口 | Playwright smoke |
| channel 管理 UI | remove-candidate | channel 由 AgentDock 管 | 若残留入口会误导用户 | 全局搜索路由 |
| provider onboarding UI | remove-candidate | provider 由 AgentDock 管 | 老用户可能找不到入口 | 文档迁移说明 |

### 5.4 docs / specs

| 对象 | 状态 | 理由 | risk | verification |
| --- | --- | --- | --- | --- |
| `docs/architecture/sidecar-operating-model.md` | keep | 当前定位基线 | 删除会丢失共识 | link check |
| `docs/planning/agentdock-kernel-sidecar-architecture.md` | keep | 解释 AgentDock/Haro 边界 | 会回到旧定位争议 | link check |
| `specs/sidecar/*` | keep | 当前 sidecar 主线 | 会丢失 FEAT 历史 | spec index check |
| `ROADMAP-haro-self-evolution-end-to-end.md` | keep | 端到端路线图 | 后续 FEAT 无上下文 | markdown check |
| `docs/modules/mcp-tools.md` | keep | MCP 是主集成面 | AgentDock 接入不清 | link check |
| `docs/modules/web-dashboard.md` | deprecate | 旧通用 dashboard 方向 | 直接删会断链接 | 标注 legacy |
| `docs/modules/channel-layer.md` | deprecate | channel 不由 Haro 管 | 旧 docs 引用 | 标注 legacy |
| `docs/modules/team-orchestrator.md` | deprecate | 多 agent 由 AgentDock 管 | 旧 specs 引用 | 标注 legacy |
| `docs/modules/scenario-router.md` | deprecate | 不再是主能力 | 旧 phase specs 引用 | 标注 legacy |
| `docs/modules/skills-system.md` | deprecate | 通用 marketplace 停止发展 | asset 迁移需说明 | 标注 legacy |
| `docs/architecture/provider-layer.md` | deprecate | provider 由 AgentDock 管 | 老安装文档引用 | 标注 legacy |
| `specs/phase-0/*` | freeze | 历史基线 | 删除会破坏历史追溯 | 归档不删除 |
| `specs/phase-1/*` | deprecate | 旧 workbench 方向 | 直接删会丢决策记录 | 加 deprecated banner |
| `specs/phase-1.5/*` | deprecate | 多数为旧 parity 工作 | 部分 MCP/scheduler 可参考 | 拆分后归档 |
| provider/channel/memory specs | deprecate | 不再主推 | 老链接风险 | 链接迁移表 |

### 5.5 tests / legacy 兼容层

| 对象 | 状态 | 理由 | risk | verification |
| --- | --- | --- | --- | --- |
| `agentdock-contract` tests | keep | 保护 sidecar contract | 主链路失效 | package test |
| `agentdock-sidecar-cli.test.ts` | keep | 保护 observe/propose/validate | daily workflow 失效 | targeted CLI test |
| `mcp-tools` sidecar tests | keep | 保护 MCP tool contract | AgentDock 调用失败 | package test |
| `web-api` approval tests | keep | 保护 review board API | 用户无法决策 | package test |
| `web` smoke/e2e | keep | 保护 review board 可用 | 页面不可用 | build + smoke |
| readability lint tests | keep | 保护 proposal 可读性 | 用户看不懂提案 | lint tests |
| provider-codex tests | deprecate | provider 不由 Haro 管 | 直接删会影响 old CLI | 标 legacy 后迁移 |
| channel tests | freeze | channel 层停止发展 | 老消息路径失效 | 只跑不扩展 |
| memory-fabric tests | deprecate | memory 不属于 Haro | 旧 core 依赖复杂 | 先隔离 package |
| team-orchestrator tests | deprecate | 多 agent 不由 Haro 管 | 删除可能影响 core barrel | 拆出 legacy suite |
| scenario-router tests | deprecate | 旧路由方向 | 删除前需查引用 | legacy suite |
| skills marketplace tests | deprecate | 通用 marketplace 停止发展 | eat/shit 历史行为 | 保留 asset 迁移测试 |
| live provider tests | remove-candidate | 不稳定且非 sidecar 主链路 | CI 噪音 | 先禁用或移入 manual |


### 5.6 删除前阻断项（Otherway 边界复核补充）

以下不是本轮要立即处理的代码任务。
它们是后续真正物理减法前必须写进 inventory 的 blocker。

| 对象 | 现状证据 | 阻断原因 | 删除前动作 | verification |
| --- | --- | --- | --- | --- |
| Haro MemoryFabric | `packages/mcp-tools/src/types.ts` 仍引用 `MemoryFabric`；`memory-query` / `memory-remember` 仍有历史 MemoryFabric 分支 | 直接删 `packages/core/src/memory/*` 会让 sidecar MCP 编译失败 | 先把 memory tools 改为 AgentDock memory MCP / aria-memory bridge，或从 tool registry 摘掉 | `pnpm -F @haro/mcp-tools test` + typecheck |
| `provider-codex` / cron | `services/cron.ts`、`cli/commands/cron.ts` 可能仍是 dry-run / diagnostics fallback | 无法确认 daily / propose dry-run 是否还依赖旧 provider | 先确认 AgentDock daily intake 已完全承接，再把 cron/provider 入口标 legacy | CLI cron/propose smoke |
| channel packages | CLI 仍可能注册 channel 解析逻辑 | 直接删会导致 `feishu:` / `cli:` 旧入口解析失败 | 先把 CLI channel 解析降级为纯字符串，dispatch 交给 AgentDock | CLI smoke + channel legacy tests |
| permission budget | `cli/commands/budget.ts` 仍 import `permission-budget.ts` | 直接删会破坏 CLI build | 先下线 budget CLI，或改成指向 MCP audit / permission | CLI build / targeted test |
| Web / Web API | `haro-web.service` 是 approval review board 唯一 UI | 包级删除会让用户无法审批 | 只按路由/页面粒度 deprecate 通用 dashboard，保留 approval review board | web build + `/api/health` + approval API smoke |
| core barrel export | `packages/core/src/index.ts` 仍可能 re-export `scenario-router` / `team-orchestrator` / `permission-budget` / services | 文件删除后下游 import 会失败 | 先清理 re-export，再删实现 | workspace typecheck |
| legacy specs / tests | phase-1 / phase-1.5 仍引用旧 runtime/agent/channel/provider | 删除代码前测试和文档会误导或失败 | 先加 deprecated banner，拆分 legacy suite | markdown link check + targeted tests |

## 6. 第一阶段减法执行顺序

本轮只盘点。
后续建议分 4 步。

### 6.1 标记 legacy

先加文档标记。
不删文件。

对象：

- provider layer docs。
- channel layer docs。
- memory docs。
- team-orchestrator docs。
- scenario-router docs。
- old Web Dashboard specs。

验收：

- 链接不坏。
- 读者能看到“停止发展”。

### 6.2 收窄公开入口

CLI 和 Web 增加 legacy 提示。
不移除命令。

对象：

- `haro chat/run`。
- `haro memory`。
- provider onboarding。
- channel setup。

验收：

- sidecar CLI test 通过。
- legacy 命令仍能输出迁移提示。

### 6.3 拆分 legacy test suite

不要求旧测试随主链路阻塞。

对象：

- provider live tests。
- memory-fabric tests。
- team-orchestrator tests。
- channel integration tests。

验收：

- sidecar 主链路 CI 独立。
- legacy suite 可手动运行。

### 6.4 删除候选评审

只有在 3 步完成后，
才评审 remove-candidate。

删除前必须有：

- 影响面列表。
- 回滚方案。
- sidecar 主链路验证。
- 用户或 supervisor 明确批准。


### 6.5 负范围：减法过程明确不要动

以下内容不属于 Haro subtraction 的修改范围。
即使做物理减法，也不能顺手清理。

- `~/.aria-memory/` 和 aria-memory vault 全部内容。
- `~/.haro/evolution/` 真实数据，包括 applications、approval decisions、approval requests、blocked proposal events、frontier signals、proposals、proposal content、rollbacks、snapshots、validations、observations、cursors、locks、archived。
- `~/.haro/` 其它运行数据，包括 agents、archive、channels、config.yaml、data、haro.db*、memory、skills、agentdock-connections.json。
- 当前 pending approval request、blocked-proposal-events 和 approval conversations。
- AgentDock `src/*` 内部模块。Haro 不能 import AgentDock 内部实现，减法 inventory 也不修改 AgentDock 代码。
- `haro-web.service` 与 `HARO_HOME=/home/heyucong.bebop/.haro` 绑定。
- ModelHub runner env、AgentDock service env、`~/.codex/`、`~/.claude/` provider 缓存。

### 6.6 AgentDock 侧待补 contract（不在 Haro 仓库内实现）

Otherway 复核认为有 3 个 AgentDock 侧承接点需要单独排期。
这些是后续加法候选，不是本轮 Haro 文档任务要实现的代码。

| contract / bridge | 目的 | 备注 |
| --- | --- | --- |
| sidecar memory tool ↔ AgentDock memory MCP bridge | 让 Haro `memory-query` / `memory-remember` 不再依赖旧 MemoryFabric | 由 AgentDock/Selfway 承接，Haro 只调整 tool 边界 |
| approval lifecycle event 广播 | supervisor workspace 被动收到 pending / approved / rejected / applied / rolled-back 事件 | 可暂缓，不阻塞减法 |
| frontier source 查询边界 | 长期让 Haro frontier intake 从 AgentDock 外部信号 MCP 读取 | 不是当前减法 blocker |

## 7. 下一阶段加法

本轮不实现以下能力。
只列出后续方向。

| 能力 | 目标 | 依赖 |
| --- | --- | --- |
| feedback-driven proposal rewrite | 按 request-changes 重写 proposal | FEAT-075 |
| revision metadata | 串起 revisionOf、supersedes、resubmissionReason | rewrite 设计 |
| feedbackContext 增强 | 记录如何吸收用户意见 | FEAT-072 |
| feedbackIncorporation | 明确哪些意见已处理 | rewrite 设计 |
| unresolvedFeedback | 标记未处理意见 | review board |
| self-heal residual duplicates | 清理 FEAT-069 前残留重复项 | FEAT-075 |
| L2/L3 workspace execution contract | 定义由哪个 workspace 执行代码改动 | FEAT-049 现有 patch-branch 骨架；FEAT-056/057 承接 workspace assignment / executor |
| execution feedback 状态机 | apply 后自动反馈成功、失败和阻断 | FEAT-058/070 |

## 8. 本轮验证方式

本轮只改文档。
不跑全量测试。

最低验证：

```bash
git diff --check
```

后续真正删除代码前，
必须跑 sidecar 主链路验证。

建议命令：

```bash
pnpm -F @haro/agentdock-contract test
pnpm -F @haro/mcp-tools test
pnpm -F @haro/cli test -- test/agentdock-sidecar-cli.test.ts
pnpm -F @haro/web-api test -- test/web-approval-requests.test.ts
pnpm -F @haro/web build
```

## 9. 本文结论

Haro 的方向不是扩成平台。
而是缩成 AgentDock 的自进化 sidecar。

第一阶段不要删代码。
先把旧方向标出来。
再把 sidecar 主链路保护住。
最后才做物理删除。
