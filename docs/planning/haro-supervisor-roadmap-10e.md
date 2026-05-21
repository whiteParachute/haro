# Haro 10E supervisor 路线图

> 日期：2026-05-21
>
> 来源：owner 原始 0-10 流程中的 **10E：supervisor 汇总**。
> 本文汇总 10A-D 的已完成结论，给出下一步执行顺序、风险、验收方式和需要 owner 确认的动作。
>
> 本文不是删除批准，不是实现批准，不触发真实 `~/.haro/evolution/` 写入，不重启服务，不 approve/apply/rollback，不 push。

## 0. 总结论

当前 Haro 主线应从“减法盘点 + 边界复核 + feedback rewrite 设计”进入 **FEAT-076A-D**。

下一步不是继续扩 self-heal，也不是物理删除旧 runtime/workbench 代码。

正确顺序是：

```text
10E 路线图确认
  -> FEAT-076A revision metadata / feedback-revision contract
  -> FEAT-076B feedback rewrite dry-run planner
  -> FEAT-076C anti no-op rewrite gate + validation blockers
  -> FEAT-076D review board revision flow
  -> 再考虑 self-heal daily dry-run summary、旧模块物理删除、L2/L3 workspace dispatch contract
```

一句话判断：

- **先补 feedback-driven rewrite 主链路。**
- **self-heal 保持 on-demand 工具，不扩大自动写。**
- **旧 Haro workbench/runtime 继续 freeze/deprecate，物理删除另走删除批准。**
- **Haro 只做 self-evolution artifact owner，不接管 AgentDock runtime。**

## 1. 10A-D 当前状态

| 编号 | 任务 | 当前状态 | 主要产物 | 10E 判断 |
| --- | --- | --- | --- | --- |
| 10A | Haro 减法盘点 | 已完成第一轮 | `haro-sidecar-subtraction-and-feedback-loop.md`、legacy banner、legacy warning、test split、删除候选评审 | 可作为 freeze/deprecate 基线；不是删除批准 |
| 10B | AgentDock 边界复核 | 已完成，并做异构复核 | `haro-agentdock-boundary-review.md` | 确认 AgentDock 已承接平台控制面；Haro 保留 evolution 内核 |
| 10C | feedback-driven rewrite 设计 | 已完成，并修复 Opus review P1 | `haro-feedback-driven-proposal-rewrite.md` | 进入 FEAT-076A-D 的直接依据 |
| 10D | self-heal duplicates 设计 | 设计已完成，on-demand dry-run/confirm 已超过设计要求 | FEAT-075 相关 spec / CLI / tests | 暂停扩张；后续只做 daily dry-run summary，不做 auto-confirm |
| 10E | supervisor 汇总 | 本文 | `haro-supervisor-roadmap-10e.md` | 完成后等待 owner 确认，再进入 FEAT-076A |

## 2. 当前权威文档

| 文档 | 用途 | 后续使用方式 |
| --- | --- | --- |
| `docs/planning/haro-sidecar-subtraction-and-feedback-loop.md` | 10A 减法盘点与闭环共识 | 物理删除前查状态、风险、验证要求 |
| `docs/planning/haro-legacy-remove-candidate-review.md` | 删除候选评审框架 | 删除 PR 的前置条件和 negative scope |
| `docs/planning/haro-agentdock-boundary-review.md` | 10B AgentDock/Haro 边界证据 | 判断旧 Haro 能力是否已被 AgentDock 承接 |
| `docs/planning/haro-feedback-driven-proposal-rewrite.md` | 10C feedback rewrite 设计 | FEAT-076A-D 的设计输入 |
| `docs/planning/haro-supervisor-status-and-agentdock-boundary.md` | supervisor 状态表 | 历史状态跟踪，后续可由本文替代为路线图入口 |
| `docs/planning/haro-supervisor-roadmap-10e.md` | 10E 正式路线图 | 下一阶段执行顺序和确认边界 |

## 3. 先删/冻哪些

### 3.1 已经可以 freeze / deprecate 的方向

这些方向不再加功能，只保留安全、迁移、测试兼容所需的最小维护：

| 方向 | 状态 | 原因 | 删除前置 |
| --- | --- | --- | --- |
| Haro-owned workbench/runtime/control-plane | deprecate | AgentDock 已承接 session/workspace/runner/runtime | CLI run/chat 旧路径解绑，core exports 清理，legacy tests 归档 |
| Haro 通用 Web Dashboard | deprecate | Haro Web 只保留 review board | 列出 review board 必需 endpoint allowlist，再删旧 dashboard |
| Haro-owned channel / Feishu / Telegram / Web channel | deprecate/freeze | IM 由 AgentDock 管 | 移除 mcp-tools legacy channel 依赖和 CLI channel 入口 |
| Haro provider / Codex provider / ChatGPT auth onboarding | deprecate | runner/model/provider auth 由 AgentDock/ModelHub 管 | 移除 CLI provider wizard 与 provider-codex package 依赖 |
| Haro MemoryFabric / memory skills | deprecate | memory 由 AgentDock/aria-memory 管 | 移除 legacy memory tools 或桥接到 AgentDock memory MCP |
| team-orchestrator / scenario-router | freeze | 多 agent/workspace dispatch 由 AgentDock 管 | 先解绑 `packages/core/src/index.ts` barrel exports 与 CLI 旧路径 |
| 通用 skills subsystem / marketplace | freeze/deprecate | 不再是 Haro 主线 | 确认 sidecar MCP 不依赖 skills package |

### 3.2 近期不要物理删除的内容

以下内容必须保留：

- `packages/agentdock-contract` 中 proposal / validation / approval / application / rollback / blocked / asset / patch-branch contract。
- Haro sidecar MCP observe/propose/validate/approval-request/snapshot/apply/rollback/daily/lint/self-heal 入口。
- Haro Web review board 与 approval conversation。
- `~/.haro/evolution` 真实数据与 schema 兼容。
- feedback/revision 相关字段和后续新增 artifact。

## 4. 再补哪些

### 4.1 第一优先级：FEAT-076 feedback-driven rewrite

这是下一阶段主线。

| 切片 | 目标 | 主要文件/范围 | 验收 |
| --- | --- | --- | --- |
| FEAT-076A | revision metadata / feedback-revision contract | `packages/agentdock-contract/src/proposal.ts`、新增 `feedback-revision.ts`、contract tests | 旧 proposal 兼容；新 proposal 带 `revisionMetadata`；revision depth 字段和默认阈值可表达；feedback revision record 可 parse |
| FEAT-076B | feedback rewrite dry-run planner | CLI `haro revise feedback --dry-run`、direction parser、rewrite planner | 默认只读；可分类 request-changes；可输出 can-rewrite/manual-check/blocked；不写真实数据 |
| FEAT-076C | anti no-op gate + validation blockers | no-op detector、validation blocking reasons、CLI tests | metadata-only revision 被阻止；contentHash/fingerprint 等价被阻止；partial hash manualCheck；stale feedback 阻断 |
| FEAT-076D | review board revision flow | Web API / Web review board / approval conversation | 用户能看到上次意见、本次修改、未解决项；新旧 approval request 不混淆 |

### 4.2 第二优先级：self-heal daily dry-run summary

FEAT-075 on-demand 已经可用。
下一步只允许做 dry-run summary：

- daily/on-demand 扫描 pending duplicates；
- 汇总 candidates / skipped / manualCheck；
- 不写 decision；
- 不改 proposal status；
- 不写 blocked event；
- 不 auto-confirm。

做它的前提：FEAT-076A 至少完成，避免 self-heal summary 和 revision metadata 分叉。

### 4.3 第三优先级：执行闭环

等 feedback rewrite 主链路稳定后，再补执行闭环：

| 方向 | 目标 | 边界 |
| --- | --- | --- |
| L0/L1 apply hardening | approve 后受控 apply，snapshot/rollback/application 记录完整 | 不自动 approve；真实 apply 前仍需用户明确批准或已有 approval decision |
| L2/L3 workspace dispatch contract | Haro 生成 patch/execution plan，AgentDock 派 workspace worker | Haro 不自建 runner；只记录 plan/application/feedback |
| post-apply feedback 状态机 | applied/failed/blocked/skipped 都能反馈到飞书/Web/artifact | 不把反馈写入 memory；必要时通过 AgentDock memory API 引用 |

## 5. 风险表

| 风险 | 触发点 | 影响 | 缓解 |
| --- | --- | --- | --- |
| request-changes 无限修订 | 用户反复要求改，Haro 反复生成 revision | revision 链失控，review board 噪音增加 | FEAT-076A 表达 `revisionDepth` 和默认阈值；FEAT-076B/C 在 planner/runtime 中执行，默认超过 3 进入 manualCheck |
| 换汤不换药 | 新 proposal 只改 metadata 或文案 | 用户看到重复审批，闭环无效 | FEAT-076C no-op gate；metadata-only 拦截；partial hash manualCheck |
| 误删旧模块 | 只看 AgentDock 已承接，就删除 Haro legacy package | CLI/MCP/tests 或真实用户脚本断裂 | 删除前按 10A/10B blocker 表逐项解绑、测试、明确批准 |
| self-heal 自动写真实数据 | daily 误接 confirm | 真实 pending proposal 被误 reject/supersede | 只允许 daily dry-run summary；confirm 保持显式手动命令 |
| Haro 越界接管 runtime | L2/L3 方案让 Haro 自己派 runner | 与 AgentDock 边界冲突 | Haro 只产出 execution plan；AgentDock workspace 执行 |
| 真实 `~/.haro/evolution` 被测试污染 | 测试/调试没设临时 `HARO_HOME` | 生产 artifact 被污染 | 所有测试使用 temp HARO_HOME；真实数据操作前必须 owner 确认 |
| Web review board 信息过载 | revision metadata 全量展示 | 用户 30 秒看不懂 | 默认摘要；详情 progressive disclosure |
| 旧 approval-request 状态语义不清 | schema 只有 `pending`，新 request 生成后旧 request 仍存在 | review board 可能混淆 | FEAT-076D 必须按 proposal status/revision chain 展示“已被修订替代” |

## 6. 验收方式

### 6.1 每个 FEAT 的最低验证

| 类别 | 命令 / 检查 |
| --- | --- |
| 格式 | `git diff --check HEAD~1..HEAD` |
| contract | `pnpm -F @haro/agentdock-contract test` |
| CLI sidecar | `pnpm -F @haro/cli test -- test/agentdock-sidecar-cli.test.ts` |
| self-heal/revision CLI | 针对新增测试文件执行 `pnpm -F @haro/cli test -- <test-file>` |
| sidecar 主链路 | `pnpm test:sidecar` |
| legacy 影响 | 涉及旧入口/删除时跑 `pnpm test:legacy` |
| Web API | `pnpm -F @haro/web-api test` |
| Web UI | `pnpm -F @haro/web build` |
| 数据安全 | 测试必须使用临时 `HARO_HOME`；检查真实 `~/.haro/evolution` 未变 |

### 6.2 删除 PR 额外验证

删除旧 provider/channel/memory/runtime/team 前，必须额外提供：

1. `rg` 影响面列表；
2. `packages/core/src/index.ts` export 解绑证据；
3. CLI legacy 入口迁移或隐藏说明；
4. mcp-tools sidecar registry 与 legacy default registry 区分；
5. `pnpm-workspace.yaml`、package `main`/`exports`、dist/publish surface 清理；
6. 回滚方案；
7. owner 或 supervisor 明确删除批准。

## 7. 必须 owner 确认的动作

以下动作不能由 agent 自行推进：

1. 物理删除 package、核心模块或 Web/API 路由。
2. 改真实 `~/.haro/evolution` 数据。
3. 运行任何会写真实 approval-decision / proposal status / application / rollback 的命令。
4. 自动 approve、自动 apply、自动 rollback。
5. 默认开启 daily self-heal confirm。
6. 重启 `happyclaw.service`。
7. push 当前 ahead commits 到远端。
8. 将 Haro 接入 AgentDock 内部 `src/*` 或让 AgentDock import Haro。
9. 引入新外部依赖。

以下动作按既有规则可做，但必须汇报：

- Haro Web 代码/config/dist 改动后重启 `haro-web.service`，并检查 health 与 `HARO_HOME`。
- 只读 review、临时 HARO_HOME 测试、Markdown planning/spec 修改。
- 在用户明确授权下临时 raw `send_workspace_message` 派异构 review。

## 8. Supervisor 执行规则

后续 Codexway 作为 supervisor 时按以下口径执行：

1. 先判断任务属于减法、加法、复核、执行、排障哪一类。
2. 任务未明确授权跨 workspace 时，优先本地完成；若需要 review，再说明 dispatch 环境与授权状态。
3. reviewer 必须尽量异构 runner/model；不要再用两个等价 runner/model 当“独立复核”。
4. worker 回执先镜像原始结论，再由 supervisor 汇总结论、影响、证据、是否可合入、是否要重启、是否遗漏。
5. review pass 不是自动进入下一阶段的许可；下一阶段必须来自本文路线图或 owner 新指令。
6. 如果 supervisor-orchestrator 的 `dispatch_worker` 缺 env，不绕过 guard；只有 owner 明确临时授权时才 raw `send_workspace_message`。
7. 完成每个 bounded stage 后停住，等待 owner 对下一阶段确认。

## 9. 当前立即下一步

10E 完成后，建议 owner 确认是否启动：

```text
FEAT-076A：revision metadata / feedback-revision contract
```

FEAT-076A 的目标：

- 补 `ProposalRevisionMetadata`；
- 新增 `FeedbackRevisionRecord`；
- 保持旧 proposal 兼容；
- 表达 `revisionDepth` 和默认阈值常量；
- 加 contract tests；
- 不实现 rewrite planner；
- 默认阈值不是 schema-level 硬约束；
- FEAT-076B 开工前建议跑 `pnpm test:sidecar`；
- 不动真实 `~/.haro/evolution`。

FEAT-076A/076B 落地后，下一步应进入 FEAT-076C。
不要跳到 Web 改造、auto-confirm 或物理删除。

如果 owner 暂不启动 FEAT-076C，则不应继续扩 self-heal 或删除旧模块。

## 10. 10E 完成定义

本文落地后，10E 视为完成，条件是：

- 两仓都有同一份路线图文档；
- 文档明确 A-D 状态、执行顺序、风险、验收、确认边界；
- 未改代码；
- 未触碰真实数据；
- 未重启；
- 未 push；
- `git diff --check HEAD~1..HEAD` 通过；
- supervisor 向 owner 汇报并停住。
