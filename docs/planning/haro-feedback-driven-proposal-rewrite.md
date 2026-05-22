# Haro feedback-driven proposal rewrite 设计

## 0. 结论

10C 要补的是 Haro 自进化闭环里最关键的加法：

```text
用户 request-changes
  -> Haro 读取原 proposal / approval-request / validation / decision
  -> Haro 结构化用户修改意见
  -> Haro 判断能否改写
  -> Haro 生成修订版 proposal
  -> Haro 重新 validate
  -> Haro 重新提交 approval-request
```

这不是 self-heal residual duplicates。

- FEAT-069 / FEAT-072 已经能阻止“无反馈上下文的重复提案”，并让新提案引用上一轮意见。
- FEAT-075 处理历史残留重复 pending。
- 10C 要解决未来主链路：**Haro 必须真的按用户意见改写 proposal，而不是只把用户意见贴到 metadata 里重新提交。**

本设计只定义 contract、状态机、验证方式和后续切片。
不实现代码。
不触碰真实 `~/.haro/evolution`。
不自动 approve / apply / rollback。
不重启服务。

## 1. 当前 artifact 现状

### 1.1 已有 contract

| artifact | 现状 | 证据 | 10C 判断 |
| --- | --- | --- | --- |
| `proposal` | `EvolutionProposalSchema` 已包含 `status`、`changeSet`、`testPlan`、`rollbackPlan`、`feedbackContext`、`feedbackSemanticFingerprint` | `packages/agentdock-contract/src/proposal.ts` | 保留；需要补更完整 revision metadata |
| `approval-request` | 审批单包含 why/how/benefit/scope/test/risk/rollback 和 `decisionOptions=['approve','reject','request-changes']` | `packages/agentdock-contract/src/approval-request.ts` | 保留；重提时生成新的 approval-request |
| `approval-decision` | `request-changes` 决策必须带 `direction` | `packages/agentdock-contract/src/approval-request.ts` | 作为 rewrite 的输入源 |
| `validation` | 已有风险、测试、rollback、policy audit、applyEligible/blockingReasons | `packages/agentdock-contract/src/validation.ts` | 修订 proposal 必须重新 validate |
| `application/snapshot/rollback` | L0/L1 apply 需要 snapshot / rollback；L2/L3 禁止 direct apply | `packages/agentdock-contract/src/application.ts`、`packages/agentdock-contract/src/patch-branch.ts` | rewrite 不直接触发 apply，只保证后续 gate 有材料 |
| `blocked-proposal-event` | 当前只有 `AWAITING_FEEDBACK_INCORPORATION` | `packages/agentdock-contract/src/blocked-proposal-event.ts` | 需要扩展或新增 revision manualCheck 事件 |
| `feedback-events` | post-apply feedback 已有运行记录路径 | `packages/cli/src/commands/agentdock-sidecar.ts` | 执行反馈不是本轮 rewrite 输入主源，但后续可转 proposal |

### 1.2 已有行为

当前主链路已有这些保护：

1. `request-changes` / `reject` 后，同 target 等价内容会被 `haro propose --auto-dry-run` 拦截。
2. 若新 proposal 与上一轮内容不同，Haro 会附加 `feedbackContext`。
3. `validate` 会阻止同 target 但缺失或引用过期 `feedbackContext` 的 proposal。
4. `apply` 遇到 request-changes 会阻断，并把原 proposal 同步为 `superseded`。
5. `self-heal duplicates --confirm` 可显式处理历史残留重复，但不会自动 approve/apply/rollback。

### 1.3 当前缺口

当前能力还不够，原因是：

- `feedbackContext` 只证明“引用过上一轮意见”，不证明“已经按意见修改”。
- 没有结构化的用户意见分类。
- 没有 rewrite plan artifact。
- 没有 revision chain：无法完整回答“新 proposal 修订自谁、改了哪里、哪些意见未吸收”。
- no-op gate 只能防等价重复，不能系统证明“这次修改是实质修改”。
- review board 无法清楚展示修订原因、吸收情况和未吸收原因。

## 2. 设计目标

10C 后续实现要达成：

1. 用户点 `request-changes` 后，Haro 能找到对应的原 proposal、approval request、validation 和 decision。
2. Haro 把用户自由文本 direction 结构化成 rewrite requirements。
3. Haro 能判断是否可以自动生成修订 proposal。
4. 能改写时，生成新的 proposal，并写清 revision metadata。
5. 新 proposal 必须重新 validate，再生成新的 approval-request。
6. 不能改写或不确定时，只写 manualCheck / blocked 结果，不自动动真实数据。
7. 如果新 proposal 只是 metadata 变了、内容没变，必须阻止重新提交。
8. 不自动 approve、apply、rollback。
9. 不让 Haro 自建 runner、memory 或 workspace 执行器。

## 3. 输入与输出

### 3.1 输入

一次 rewrite 的最小输入：

| 输入 | 必需 | 说明 |
| --- | --- | --- |
| `approval-decision` | 是 | `decision=request-changes`，必须有 `direction` |
| `approval-request` | 是 | 原审批单，人类看到的上下文 |
| `proposal` | 是 | 原 proposal，含 target、changeSet、test/rollback |
| `validation` | 建议必需 | 原 validation，帮助判断风险和阻断点 |
| `approval-conversation` | 可选 | 若用户在 review board 里多轮讨论，作为补充语境 |
| `blocked-proposal-event` | 可选 | 若来自重复拦截，需要保留重复证据 |
| `observation/frontier refs` | 可选 | 如果用户要求补证据，需要从原 evidence refs 追溯 |

### 3.2 输出

rewrite 可以产生三类结果。

#### A. `revised-proposal`

生成新的 proposal。

要求：

- 新 `proposal.id` 与旧 proposal 不同。
- `targetKind` 可以相同，但 `changeSet`、evidence、test plan、rollback plan 或 scope 必须至少一项有实质变化。
- 保留旧 proposal 和 decision 的引用。
- 写入 `feedbackContext` 兼容字段。
- 写入新增 `revisionMetadata`。
- 状态从 `proposed` / `dry-run` 开始，再走 `validate` 和 `approval-request`。

#### B. `manual-check`

不生成新 proposal，只要求人工判断。

典型情况：

- 用户意见太模糊。
- 用户要求超出 Haro 边界。
- 用户要求删除真实数据或自动 approve/apply。
- 原 proposal / decision / validation 缺失。
- 无法证明修订不是 no-op。
- 需要 AgentDock workspace 执行但没有 L2/L3 dispatch contract。

#### C. `blocked-revision`

明确阻断，并写 blocked/manualCheck artifact。

典型情况：

- 用户意见和安全策略冲突。
- 用户要求绕过人审或跳过 rollback。
- 新 proposal 与旧 proposal 等价。
- 当前 target 已有更新的 request-changes decision，输入已过期。

## 4. Revision metadata contract

### 4.1 兼容策略

不破坏现有 artifact：

- `feedbackContext` 保留，继续作为轻量 gating 字段。
- 新增 `revisionMetadata` 作为 proposal 上的可选字段。
- 旧 proposal 没有 `revisionMetadata` 仍可 parse。
- 新 revision 详细信息也可同步写入独立 `feedback-revision` artifact，便于 Web/API 查询。

推荐后续拆成两个 contract：

1. `ProposalRevisionMetadataSchema`：挂在 `EvolutionProposalSchema.revisionMetadata?`。
2. `FeedbackRevisionRecordSchema`：落盘在 `evolution/feedback-revisions/*.json`。

### 4.2 `revisionMetadata` 字段

建议字段：

```ts
type ProposalRevisionMetadata = {
  revisionId: string;
  rootProposalId: string; // revision 链最初的 proposal id
  revisionOfProposalId: string; // 当前 revision 的直接 parent proposal id
  revisionDepth: number;
  sourceApprovalRequestId: string;
  sourceDecisionId: string;
  sourceDecisionDirection: string;
  sourceConversationRefs: string[];
  rewritePlanRef?: Ref; // 指向 FeedbackRevisionRecord 或 rewrite plan artifact
  supersedesProposalIds: string[];
  supersedesBlockedEventIds: string[];
  resubmissionReason: string;
  incorporatedFeedback: FeedbackRequirementResolution[];
  unresolvedFeedback: FeedbackRequirementResolution[];
  noOpCheck: RevisionNoOpCheck;
  createdAt: string;
};
```

`FeedbackRequirementResolution`：

```ts
type FeedbackRequirementResolution = {
  id: string;
  category:
    | 'scope-reduction'
    | 'evidence-required'
    | 'risk-rollback-change'
    | 'duplicate-merge'
    | 'readability'
    | 'implementation-detail'
    | 'needs-more-info'
    | 'out-of-scope'
    | 'policy-blocked';
  userText: string;
  normalizedRequirement: string;
  disposition:
    | 'incorporated'
    | 'partially-incorporated'
    | 'not-applicable'
    | 'deferred'
    | 'blocked'
    | 'needs-human';
  proposalChangeRefs: Ref[];
  evidenceRefs: Ref[];
  explanation: string;
};
```

`rootProposalId` 指 revision 链的最初 proposal。
`revisionOfProposalId` 指当前 revision 的直接 parent。
两者不同，用来区分整条链和相邻版本。

`RevisionNoOpCheck`：

```ts
type RevisionNoOpCheck = {
  verdict: 'substantive-change' | 'no-op' | 'manual-check';
  priorProposalContentHashes: string[];
  revisedProposalContentHashes: string[];
  priorSemanticFingerprint?: string;
  revisedSemanticFingerprint?: string;
  revisionDepth: number;
  changedFields: Array<
    | 'title'
    | 'description'
    | 'changeSet'
    | 'contentRef'
    | 'contentHash'
    | 'sourceObservationRefs'
    | 'testPlan'
    | 'rollbackPlan'
    | 'riskLevel'
    | 'scope'
    | 'evidenceRefs'
  >;
  reason: string;
};
```

`title` 和 `description` 表示 readability / 文案类修改。
它们不是实质执行变更。
如果只改这两项，FEAT-076C 仍要做 no-op 检查。

### 4.3 `feedback-revision` artifact

独立 artifact 用于审计 rewrite 过程，不一定进入 proposal schema 主体。

建议路径：

```text
evolution/feedback-revisions/revision_<hash>.json
```

建议字段：

```ts
type FeedbackRevisionRecord = {
  id: string;
  status:
    | 'planned'
    | 'revised'
    | 'blocked'
    | 'manual-check'
    | 'superseded';
  sourceProposalId: string;
  sourceApprovalRequestId: string;
  sourceDecisionId: string;
  revisedProposalId?: string;
  revisedValidationId?: string;
  revisedApprovalRequestId?: string;
  parsedRequirements: FeedbackRequirementResolution[];
  rewriteActions: Array<{
    action:
      | 'narrow-scope'
      | 'add-evidence'
      | 'change-risk-or-rollback'
      | 'merge-duplicate'
      | 'rewrite-description'
      | 'ask-for-more-info'
      | 'block';
    summary: string;
    targetRefs: Ref[];
  }>;
  noOpCheck: RevisionNoOpCheck;
  blockingReasons: string[];
  createdAt: string;
  updatedAt: string;
};
```

## 5. End-to-end 流程

### 5.1 Intake

触发方式建议：

```bash
haro revise feedback --pending
haro revise feedback --decision-id <approval_decision_id>
haro revise feedback --dry-run --decision-id <approval_decision_id>
```

规则：

1. 只处理 `decision=request-changes`。
2. 必须找到原 approval request、proposal、validation。
3. 如果原 proposal 已有更新 revision 并且仍 pending，则跳过，避免重复修订。
4. 如果原 decision 不是该 target 的最新 request-changes，则 manualCheck。
5. 如果 approval conversation 在 decision `createdAt` 之后仍有新条目，应先纳入补充语境；若新条目改变了用户意图或和 direction 冲突，则 manualCheck。
6. 同一 `rootProposalId` 的 revision depth 超过上限后必须 manualCheck，默认建议上限为 3。FEAT-076A 只表达字段和默认阈值常量，不在 schema 层硬拒绝超限记录。planner/runtime 在 FEAT-076B/C 执行该阈值。
7. 默认先 dry-run；真实写入必须显式 `--confirm` 或纳入后续 gated workflow。

### 5.2 Direction parsing

把 `approval-decision.direction` 和 conversation 解析成 requirements。

分类规则：

第一版必须覆盖最小安全子集：`scope-reduction`、`evidence-required`、`risk-rollback-change`、`needs-more-info`、`out-of-scope`、`policy-blocked`。
`duplicate-merge`、`readability`、`implementation-detail` 可作为 FEAT-076B 后续增强；如果第一版无法稳定识别，就进入 manualCheck。

| 类别 | 示例 | 期望动作 |
| --- | --- | --- |
| `scope-reduction` | “别改这么多，只先做 dry-run” | 缩小 changeSet / 降低 level |
| `evidence-required` | “证据不足，先证明这个问题存在” | 增加 observation/frontier/test evidence |
| `risk-rollback-change` | “回滚方案不清楚” | 修改 rollbackPlan / manualChecks |
| `duplicate-merge` | “这和上个提案重复” | supersede / merge / self-heal reference |
| `readability` | “看不懂，重新说人话” | 改 approval request/proposal 描述，但不能只改文案骗过 no-op gate |
| `implementation-detail` | “要说明谁来执行、怎么验收” | 补 how/test/owner/patch plan |
| `needs-more-info` | “先问我确认 X” | manualCheck，不生成 proposal |
| `out-of-scope` | “让 Haro 接管 runner” | blocked，说明边界 |
| `policy-blocked` | “不用审批直接执行” | blocked |

### 5.3 Rewrite planning

rewrite planner 根据 requirements 决定动作。

决策输出：

| planner verdict | 行为 |
| --- | --- |
| `can-rewrite` | 生成 revised proposal |
| `manual-check` | 写 feedback revision record，不生成 proposal |
| `blocked` | 写 blocked/manualCheck event，不生成 proposal |
| `merge-duplicate` | 引用 prior proposal / blocked event，必要时 supersede 当前 proposal |
| `needs-more-info` | 生成给用户的澄清问题，不生成 proposal |

### 5.4 Revised proposal generation

生成新 proposal 时必须满足：

1. `sourceObservationRefs` 至少包含原 evidence refs，若用户要求补证据则追加新 refs。
2. `changeSet` 必须反映实质变更。
3. `testPlan.manualChecks` 必须包含“本轮是否吸收 request-changes”的检查项。
4. `rollbackPlan` 必须按用户意见更新，尤其是风险/回滚类反馈。
5. `feedbackContext` 必须引用最新 request-changes decision。
6. `revisionMetadata` 必须写明吸收/未吸收情况。
7. description lint 继续执行；用户原文可以保留，不应被 machine-generated lint blocker 误伤。

原 artifact lifecycle：

| artifact | request-changes 后 | revised proposal 写入后 | 说明 |
| --- | --- | --- | --- |
| 原 proposal | 可由 decision sync 标记为 `superseded` | 保持 `superseded` | 不能重新 apply 原 proposal |
| 原 approval-request | 保持历史 pending artifact，不覆盖 | 由新的 approval-request 替代人审入口 | 当前 schema 只有 `pending`，不要伪造 closed 状态 |
| 原 approval-decision | 保持原始用户决策 | 被 revision metadata 引用 | 不改用户原文 |
| 新 proposal | 新 id，进入 `proposed` 或 `dry-run` | 继续 validate | 必须带 `feedbackContext` 与 `revisionMetadata` |
| 新 approval-request | 不在 proposal 写入时直接生成 | validate 通过后生成 | 避免未验证 proposal 进入人审 |

### 5.5 Validation

修订 proposal 必须重新 validate。

新增 validation blocking reasons：

- `REVISION_METADATA_REQUIRED`：有 request-changes 历史但缺 revision metadata。
- `REVISION_NO_OP`：no-op gate 判定没有实质变化。
- `UNRESOLVED_FEEDBACK`：存在必须解决但未解决的反馈项。
- `STALE_FEEDBACK_DECISION`：引用的 decision 不是 target 最新 request-changes。
- `FEEDBACK_REWRITE_MANUAL_CHECK_REQUIRED`：direction 无法结构化或需要用户补充。

### 5.6 Approval request regeneration

新的 approval request 必须让用户 30 秒看懂：

- 这是第几次修订。
- 上次用户说了什么。
- 本次改了什么。
- 哪些意见已吸收。
- 哪些没吸收，为什么。
- 为什么这次不是重复提交。
- 需要用户 approve / reject / request-changes 的具体判断点。

## 6. 防止“换汤不换药”

### 6.1 基本原则

以下变化不算实质修改：

- 只新增 `feedbackContext`。
- 只新增 `revisionMetadata`。
- 只改 title / wording，但用户要求不是 readability。
- 只重排 JSON 字段。
- 只生成新的 id / timestamp。
- 只把旧 evidence refs 原样复制。

至少需要以下一种实质变化：

- `changeSet[*].contentHash` 或 `contentRef` 变化。
- `changeSet[*].summary` 和对应 content 变化。
- 新增或替换 evidence refs，且能对应用户“补证据”要求。
- `testPlan` / `rollbackPlan` 按用户意见变化。
- 风险等级或 apply 策略按用户意见变化。
- L2/L3 proposal 生成新的 patch branch plan / execution plan。
- duplicate merge 明确替代旧 proposal，并更新 supersedes 关系。

### 6.2 判定算法

no-op gate 建议按顺序执行：

1. **target 检查**：targetKind + targetRef 是否一致。
2. **contentHash 检查**：如果所有 changeSet 都有 contentHash，比较旧/新 hash set。
3. **partial hash 检查**：任一 change 缺 contentHash，则进入 manualCheck，不用过滤后的 hash 误判。
4. **semantic fingerprint 检查**：比较旧/新 `feedbackSemanticFingerprint`。
5. **evidence delta 检查**：新 evidence 是否真的新增或替换。
6. **plan delta 检查**：testPlan / rollbackPlan / riskLevel 是否回应用户要求。
7. **metadata-only 拦截**：如果唯一变化来自 feedback/revision metadata，则 `REVISION_NO_OP`。

### 6.3 可读性例外

如果用户明确要求“看不懂 / 重新说人话”，允许主要修改文案。
但仍需满足：

- approval request 的 why/how/benefit/scope/risk/test 结构要明显更清楚。
- `revisionMetadata.incorporatedFeedback` 要把 readability 要求标成 `incorporated`。
- no-op gate 的 `changedFields` 可包含 `evidenceRefs` 或 approval-request description fields。
- 不能把纯文案修改误标成可 apply 的代码/配置变更。

## 7. 与 FEAT-069 / FEAT-072 / FEAT-075 的关系

| 能力 | 已解决 | 10C 继续补 |
| --- | --- | --- |
| FEAT-069 | 阻止未吸收反馈的重复提案 | 把“阻止”升级为“能生成修订提案” |
| FEAT-072 | 新 proposal 显式引用上一轮意见 | 证明每条意见如何吸收或为何未吸收 |
| FEAT-075 | 处理历史残留重复 pending | 不再扩 auto-confirm；只复用重复识别和 manualCheck 思路 |
| 10C | 未实现 | 完成 feedback rewrite 的正式 contract 和后续实现切片 |

## 8. L0/L1 与 L2/L3 边界

### 8.1 L0/L1

L0/L1 修订 proposal 可以由 Haro 生成具体 sidecar-local changeSet。
但仍必须：

- 重新 validate。
- 重新 approval-request。
- 用户 approve 后才 apply。
- apply 前走 snapshot / rollback gate。

### 8.2 L2/L3

L2/L3 不能由 Haro 直接改代码。
正确路径：

1. Haro 根据用户意见生成 patch plan / execution plan。
2. 用户 approve。
3. AgentDock 根据计划派 workspace worker。
4. worker 实现、测试、提交。
5. supervisor 复核。
6. Haro 记录 application / feedback。

10C 不实现 workspace dispatch contract。
只要求 revision proposal 能明确：

- 为什么需要 L2/L3。
- 预期交给哪个执行面。
- 测试和回滚怎么验收。
- Haro 自己不会自建 runner。

## 9. CLI / Web / API 后续切片

推荐拆分为 4 个后续 FEAT。

### FEAT-076A：revision metadata contract

改动范围：

- `packages/agentdock-contract/src/proposal.ts`
- 新增 `packages/agentdock-contract/src/feedback-revision.ts`
- contract tests

验收：

- 旧 proposal 能 parse。
- 新 proposal 可携带 `revisionMetadata`。
- `FeedbackRevisionRecordSchema` 能表达 revised/manualCheck/blocked。

落地记录（2026-05-21）：

- `EvolutionProposalSchema.revisionMetadata?` 已加入 contract。
- `feedback-revision.ts` 已导出 revision metadata、no-op check 和 feedback revision record。
- 默认 revision depth 上限常量为 3。
- 该常量是 planner/runtime 默认阈值，不是 schema-level 硬约束。
- 本阶段只落 schema 和测试，不实现 rewrite planner。
- FEAT-076B 开工前建议跑 `pnpm test:sidecar`。

### FEAT-076B：feedback rewrite planner

改动范围：

- CLI dry-run command：`haro revise feedback --dry-run`
- direction parser
- rewrite planner
- temp `HARO_HOME` tests

验收：

- 能把 request-changes direction 分类。
- 能输出 can-rewrite/manual-check/blocked。
- 默认只读。

落地记录（2026-05-21）：

- `haro revise feedback --dry-run --decision-id <id>` 已支持。
- 第一版 parser 覆盖安全最小子集。
- 输出 can-rewrite/manual-check/blocked/needs-more-info。
- 不写 proposal、feedback-revision 或 approval-request。
- Path A dry-run 里的 prior/revised hashes 只是规划占位。
- 它们不代表已经生成 revised proposal。
- FEAT-076C 负责 no-op gate 与 validation blockers。

### FEAT-076C：anti no-op rewrite gate

改动范围：

- no-op detector
- validation blocking reasons
- proposal generation gate

落地记录（2026-05-21）：

- dry-run planner 已输出 `noOpCheck`。
- validation 已写入 revision blockers。
- 覆盖 metadata-only、partial hash、readability-only。
- 本阶段仍不写 revised proposal。

验收：

- 只改 metadata 的 revision 被阻止。
- contentHash / semantic fingerprint 等价被阻止。
- partial contentHash 进入 manualCheck。
- readability-only feedback 有独立可控例外。

### FEAT-076D：review board rewrite flow

改动范围：

- approval request UI / Web API
- revision chain 展示
- approval conversation 引用

验收：

- 用户能看到“上次意见 / 本次修改 / 未解决项”。
- 新 approval-request 不会和旧 request 混淆。
- 用户仍只能 approve / reject / request-changes，不自动 approve。

落地记录（2026-05-21）：

- Web API 返回只读 `revision` 视图。
- revision 视图包含 root、parent、source decision。
- review board 展示上次意见、本次修改、未解决项。
- 被修订替代的旧请求会显示替代标签。
- 本阶段不生成 revised proposal。

## 10. 测试计划

### 10.1 Contract tests

必须覆盖：

- 旧 proposal 无 `revisionMetadata` 仍 parse。
- 新 proposal 有 `revisionMetadata` 能 parse。
- `FeedbackRevisionRecord` 的 `revised/manual-check/blocked` 状态。
- `request-changes` decision 无 direction 仍被 schema 拦截。

### 10.2 CLI tests

使用临时 `HARO_HOME`。

覆盖：

- `haro revise feedback --dry-run` 不写任何 artifact。
- `haro revise feedback --confirm` 只在 can-rewrite 时写 revision/proposal。
- direction 分类：缩范围、补证据、风险回滚、重复合并、需要更多信息、越界。
- no-op proposal 被拦截。
- partial contentHash 进入 manualCheck。
- stale decision 不处理。
- 已存在 newer revision 不重复写。

### 10.3 Validation tests

覆盖：

- 缺 revision metadata 阻断。
- stale feedbackContext 阻断。
- `REVISION_NO_OP` 阻断。
- 有 unresolved mandatory feedback 时阻断。
- 正常 revised proposal 可 validate。

### 10.4 Web/API tests

覆盖：

- review board 展示 revision chain。
- approval request API 返回 revision summary。
- request-changes conversation refs 能被引用。
- 新旧 approval request 不混淆。

### 10.5 Smoke tests

只用临时目录：

```bash
HARO_HOME=$(mktemp -d) pnpm -F @haro/cli test -- test/agentdock-sidecar-cli.test.ts
```

不得在测试中读写真实 `~/.haro/evolution`。

### 10.6 FEAT-077D operator preflight

生产执行前必须先跑 dry-run。

推荐命令：

```bash
haro revise feedback --dry-run --pending --json
```

dry-run 输出 `operatorPreflight`。

它列出：

- `safeToConfirmCount`：可确认数量。
- `unsafeCount`：不可确认数量。
- `safeDecisionIds`：可确认决策。
- `unsafeDecisionIds`：需人工处理的决策。
- `confirmCommands`：可复制的单条命令。
- `confirmCommandRecords`：带 source 的命令。
- `dryRunCommandRecords`：复查用 dry-run 命令。
- `batchConfirmSafe`：是否适合批量确认。
- `batchConfirmCommand`：仅全安全时出现。
- `scope=operator-preflight`：只约束预检命令。
- `currentRunMode=dry-run`：当前只是只读预检。

mixed batch 时不要直接批量确认。

应先处理 unsafe reason。

或只复制 per-decision command。

真实写入仍需显式授权。

本阶段禁止自动对真实 `~/.haro/evolution` confirm。

禁止自动 `eval` 或 `exec` 输出命令。

命令只供人工复制复核。

self-heal duplicates 当前是批量确认粒度。

feedback rewrite 当前是 per-decision 粒度。

执行 confirm 前必须重新 dry-run。

### 10.7 FEAT-078A daily/on-demand summary

daily workflow 追加只读预检摘要。

它聚合两类信息：

- self-heal duplicates dry-run。
- feedback rewrite operator preflight。

on-demand 可运行：

```bash
haro operator-preflight --dry-run --json
```

human 输出使用：

```bash
haro operator-preflight --dry-run --human
```

输出必须包含：

- 可确认数量。
- 需人工数量。
- blocked / skipped 数量。
- 可复制 confirm 命令。
- `requiresExplicitConfirm=true`。
- `wouldWrite=false`。
- `confirmCommandRecords` 带来源。
- `dryRunCommandRecords` 用于复查。
- `scope=operator-preflight`。
- `currentRunMode=dry-run`。

该命令只读。

它不写真实 `~/.haro/evolution`。

它不 approve、apply 或 rollback。

注意：daily workflow 仍可能写已有的 observe/propose/validate/approval-request artifacts。

`requiresExplicitConfirm` 只约束 operator preflight 推荐命令。

它表示不会自动 confirm self-heal 或 feedback rewrite。

不要把 `operatorConfirmCommands` 自动 eval/exec。

### 10.8 FEAT-078C MCP operator preflight

MCP 新增只读工具。

工具名：`haro_operator_preflight`。

它返回同一份 operator preflight contract。

输出保留这些字段：

- `status`。
- `dryRun=true`。
- `wouldWrite=false`。
- `requiresExplicitConfirm=true`。
- `scope=operator-preflight`。
- `currentRunMode=dry-run`。
- `duplicateSelfHeal`。
- `feedbackRewrite`。
- `confirmCommandRecords`。
- `dryRunCommandRecords`。

该 MCP 工具只读。

它不执行 confirm 命令。

它不 approve、apply 或 rollback。

它不应被上层自动 eval/exec。

上层调用方只能展示命令。

执行前仍需人工重新 dry-run。

## 11. Negative scope

10C 和后续 FEAT-076 系列不得做这些事：

- 不自动 approve。
- 不自动 apply。
- 不自动 rollback。
- 不写真实 `~/.haro/evolution`，除非用户对具体命令显式确认。
- 不重启 `haro-web.service` 或 `happyclaw.service`。
- 不 push。
- 不让 Haro 接管 AgentDock runner / workspace / session / IM / scheduler / memory。
- 不改 aria-memory vault。
- 不把 `request-changes` 当成失败终点；它应进入 revision flow。
- 不让 metadata-only change 通过 no-op gate。
- 不允许同一 root proposal 无限 revision；超过 revision-depth 上限后必须 manualCheck。

## 12. Open questions

1. `revisionMetadata` 是否直接放进 `EvolutionProposalSchema`，还是只保留 `feedbackContext` + 独立 `FeedbackRevisionRecord`？本设计建议两者都保留：proposal 上存摘要，独立 artifact 存过程。
2. direction parser 第一版是否完全规则化，还是允许 LLM 辅助分类？建议第一版规则化 + manualCheck；LLM 只能作为后续增强。
3. readability-only request 是否允许生成 revised proposal？建议允许，但必须走专门路径，且不得被误认为内容配置变更。
4. `blocked-proposal-event` 是否扩展 reason enum，还是新增 `feedback-revision` 的 blocked 状态即可？建议先新增 `feedback-revision`，避免把 blocked event 扩成泛用状态机。
5. Web review board 是否需要显示完整 parsed requirements，还是只显示用户摘要与吸收状态？建议默认摘要，详情 progressive disclosure。

## 13. 下一步

本设计完成后，下一步不是继续扩 self-heal。

推荐顺序：

1. FEAT-076A：contract / artifact schema。
2. FEAT-076B：dry-run rewrite planner。
3. FEAT-076C：no-op gate + validation blocking。
4. FEAT-076D：review board revision flow。

完成 FEAT-076A-D 后，再进入 10E：把 10A-D 合成正式路线图。
