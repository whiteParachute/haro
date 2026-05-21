# FEAT-075 自愈重复提案与反馈驱动重写

## 状态

- 状态：draft
- 日期：2026-05-21
- 范围：Haro sidecar propose / daily workflow / approval artifact
- 编号说明：FEAT-074 已用于 lint source-aware severity
- 本 spec 不实现代码

## 1. 背景

用户希望 Haro 自己具备修正能力。
不是由 Haroway 手工改数据。

当前问题有两类。

第一类是残留重复提案。
FEAT-069 已能挡住新重复。
但它上线前生成的重复项还在待审区。
Haro 需要能自检并清理。

第二类是反馈没有被真正吸收。
FEAT-072 只把反馈写进上下文。
它不能改变提案结构。
用户看到的仍可能是同一类元策略。

## 2. 真实样例

| 对象 | 说明 |
| --- | --- |
| `approval_request_3e1346f0` | 用户已要求修改 |
| `proposal_2f3bf421` | runner-profile 旧提案 |
| `approval_decision_de3fed7` | 用户修改意见 |
| `approval_request_798b8b81` | FEAT-069 前残留重复项 |
| `proposal_86357913` | 与旧提案同 target |

用户反馈核心如下。

- 没说清 Haro 到底出了什么错。
- 没说清这次要新增哪条规则。
- 提案像元策略。
- 不像一个可执行改动。

本 spec 用这组数据做验收样例。

## 3. 目标

1. Haro 能自动发现残留重复提案。
2. Haro 能安全退回等价复制项。
3. Haro 能把修改意见转成结构化要求。
4. Haro 能据此重写新提案结构。
5. 重写失败时，Haro 不强行生成提案。
6. 所有结果仍需用户人审。

## 4. 非目标

- 不让 Haro 自动 approve。
- 不让 Haro 自动 apply。
- 不让 Haro 自动 rollback。
- 不改 AgentDock runtime。
- 不改 AgentDock scheduler。
- 不写 aria-memory-vault。
- 不清理非等价的新提案。
- 不把用户反馈直接改写掉。

## 5. 术语

| 术语 | 解释 |
| --- | --- |
| pending approval-request | 待用户处理的审批请求 |
| target | 提案要修改的 Haro 资产 |
| contentHash | 本次改动内容的指纹 |
| 语义指纹 | 标题、摘要和策略的稳定摘要 |
| feedbackContext | FEAT-072 写入的上次意见上下文 |
| blocked event | Haro 拦截提案后的审计记录 |

## 6. 能力 1：残留重复提案自愈

### 6.1 用户故事

作为审批人，
我不想再看到等价重复提案。

作为 Haro，
我应该能发现历史残留项。
发现后写清为什么退回。

### 6.2 触发入口

首版支持三个入口形态。

1. `haro self-heal duplicates --dry-run`
2. `haro self-heal duplicates --confirm`
3. daily workflow 的自检阶段

CLI 必须 fail-closed。
`--dry-run` 与 `--confirm` 必须二选一。
不传或同时传都应拒绝执行。

默认 daily 只 dry-run。
真正自动写入仍需要显式配置开启。
手动 `--confirm` 只处理 dry-run 能命中的确定性候选。

### 6.3 输入

读取这些目录。

- `evolution/approval-requests/`
- `evolution/approval-decisions/`
- `evolution/proposals/`
- `evolution/proposal-content/`

只扫描 latest-decision 视角下的 pending。
已 approve 或 applied 的不处理。

### 6.4 判定规则

候选项必须同时满足。

1. 当前 approval-request 仍未决。
2. 同 target 有旧 decision。
3. 旧 decision 是 `request-changes` 或 `reject`。
4. 新旧 proposal 等价。
5. 新 proposal 缺少有效反馈吸收。

等价判断有两道。
命中任意一道即可。

| 判断 | 规则 |
| --- | --- |
| 内容等价 | 所有 `changeSet[*].contentHash` 都存在，排序后集合相同 |
| 语义等价 | `title + summary + policy.defaultHandling` 指纹相同 |

contentHash 必须完整覆盖整个 `changeSet`。
如果当前或历史 proposal 只有部分 change 缺 hash，
即使过滤后剩余 hash 看起来相同，
也必须进入 manual check，不能自动命中或 confirm。

### 6.5 时间窗

首版需要保守。

自动清理只处理两类数据。

1. 生成时间早于 FEAT-069 上线时间。
2. 生成时间晚于 FEAT-069，但缺 `feedbackContext`。

FEAT-069 上线时间来自配置。
默认读取当前代码写死的 commit 日期。
后续可改为配置文件。

### 6.6 输出

dry-run 只输出候选和 `plannedActions`，不写文件。

confirm 命中后写三类 artifact。

1. `approval-decision`
2. proposal status 更新为 `superseded`
3. `blocked-proposal-events/blocked_*.json`

decision 字段如下。

| 字段 | 值 |
| --- | --- |
| `decision` | `reject` |
| `reviewer.source` | `haro-self-heal` |
| `direction` | 写明等价旧提案和旧 decision |

blocked event 使用 FEAT-069 结构。
reason 为 `AWAITING_FEEDBACK_INCORPORATION`。

JSON 输出契约：

- `result.dryRun` 是 boolean。
- `result.confirmed` 是 boolean。
- dry-run candidate 只返回 `plannedActions`。
- confirm candidate 只返回 `actualActions`。
- `plannedActions` 与 `actualActions` 必须互斥。

### 6.7 不确定处理

以下情况不自动 reject。

- target 无法解析。
- 旧 proposal 缺失。
- contentHash 缺失或仅部分覆盖。
- policy.defaultHandling 缺失。
- 指纹只能部分匹配。

处理方式：

- 写 self-heal report。
- 在 daily summary 计数。
- 给 approval-request 增加 manualCheck。
- 提醒用户人工复核。

### 6.8 观测指标

daily summary 新增字段。

| 字段 | 含义 |
| --- | --- |
| `selfHealedDuplicateCount` | 自动清理数量 |
| `selfHealDryRunCount` | dry-run 命中数量 |
| `selfHealSkippedCount` | 不确定跳过数量 |
| `selfHealEventIds` | 写入的 blocked event |

CLI 输出必须列出 request id。
不能只输出数量。

### 6.9 回滚

自愈写入是可撤销的。

回滚步骤：

1. 删除对应 self-heal decision。
2. 恢复 proposal 原 status。
3. 保留 blocked event 作为审计。

首版不自动回滚。
supervisor 可手工恢复。

## 7. 能力 2：反馈驱动重写

### 7.1 用户故事

作为审批人，
我希望 Haro 听懂修改意见。

如果我说“这不是可执行提案”，
下一版应改变提案结构。

### 7.2 触发条件

proposer 发现同 target 最新 decision 是 `request-changes`。
此时进入 feedback rewrite。

如果 FEAT-069 已判定等价，
仍优先 blocked。
不会写 proposal。

### 7.3 解析 direction

首版采用规则解析。
LLM 解析作为后续增强。

| 方案 | 优点 | 缺点 | 首版结论 |
| --- | --- | --- | --- |
| 关键词规则 | 稳定，可测试 | 覆盖有限 | 采用 |
| LLM 解析 | 能理解复杂语义 | 成本和风险高 | 后续 FEAT-073 |
| Web 结构化填写 | 用户输入更准 | 改 UI 成本高 | 后续可选 |

规则解析输出 `FeedbackRewriteIntent`。

```ts
type FeedbackRewriteIntent = {
  category: 'not-actionable' | 'unclear-evidence' | 'too-generic' | 'wrong-scope';
  requiredEvidence: string[];
  requiredChangeShape: string[];
  rejectGenericPolicy: boolean;
  sourceDecisionId: string;
}
```

### 7.4 本案例解析结果

对 `approval_decision_de3fed7`，
应解析为：

```json
{
  "category": "not-actionable",
  "requiredEvidence": [
    "具体错误类别",
    "样本数量",
    "detailsRef 或 turn id"
  ],
  "requiredChangeShape": [
    "单一 target",
    "单一具体字段",
    "before / after 对比",
    "具体回滚动作"
  ],
  "rejectGenericPolicy": true
}
```

### 7.5 重写决策

解析后进入两条路径。

| 路径 | 条件 | 结果 |
| --- | --- | --- |
| 窄化为具体 patch | 有稳定错误类别 | 生成新 proposal |
| 证据不足 archive | 没有稳定类别 | 写 skipped summary |

稳定错误类别要求：

- 同 code。
- 同 message 或同错误模板。
- 至少 2 条样本，或 1 条高影响样本。
- 至少 1 个 detailsRef。

如果不满足，
不得生成元策略 v3。

### 7.6 新 proposal 结构

重写后的 proposal 必须包含这些字段。

| 字段 | 要求 |
| --- | --- |
| title | 写清具体错误类型 |
| changeSet | 只包含一个具体改动 |
| targetRef | 指向具体 Haro asset |
| summary | 写清新增字段 |
| proposal-content | 包含 before / after |
| feedbackContext | 指向原 decision |
| testPlan | 有具体测试命令 |
| rollbackPlan | 有具体撤销动作 |

`proposal-content` 必须包含：

```ts
before: string;
after: string;
evidence: {
  code: string;
  message: string;
  sampleCount: number;
  detailsRefs: string[];
};
```

### 7.7 防止元策略 v3

validate 增加 blocker。

名称：`GENERIC_POLICY_REWRITE`。

触发条件：

- 没有 detailsRef。
- 没有 before / after。
- changeSet 只写通用原则。
- policy.defaultHandling 仍是主要内容。
- summary 没有具体字段名。

命中后：

- 写 validation artifact。
- `applyEligible=false`。
- 不生成 approval-request。
- 写 blocked event。

### 7.8 rewrite 失败

如果 direction 无法解析，
或证据不足，
不生成新 proposal。

输出：

```json
{
  "status": "blocked",
  "reason": "AWAITING_FEEDBACK_INCORPORATION",
  "subReason": "INSUFFICIENT_ACTIONABLE_EVIDENCE"
}
```

同时在 daily summary 写：

```json
{
  "runnerProfileSkipped": "insufficient-evidence"
}
```

## 8. 与既有 FEAT 的关系

| FEAT | 关系 |
| --- | --- |
| FEAT-053 | Web 仍只做人审入口 |
| FEAT-068 | rewrite 后继续跑描述 lint |
| FEAT-069 | 等价重复先被挡住 |
| FEAT-072 | feedbackContext 仍保留 |
| FEAT-073 | LLM proposer 后续增强 |
| FEAT-074 | 用户原文不再污染 blocker |

去重顺序如下。

1. active pending target dedupe。
2. FEAT-069 等价挡板。
3. FEAT-075 self-heal duplicates。
4. FEAT-075 feedback rewrite。
5. FEAT-068 readability lint。
6. validate apply gate。

## 9. 数据模型

### 9.1 SelfHealDecisionMetadata

```ts
type SelfHealDecisionMetadata = {
  source: 'haro-self-heal';
  matchedPriorDecisionId: string;
  matchedPriorProposalId: string;
  matchType: 'contentHash' | 'semanticFingerprint';
  dryRun: boolean;
  confirmedBySelfHeal?: boolean;
}

type SelfHealCandidateAction =
  | {
      dryRun: true;
      plannedActions: {
        wouldReject: true;
        wouldSupersede: true;
        wouldWriteBlockedEvent: true;
      };
    }
  | {
      dryRun: false;
      actualActions: {
        rejected: true;
        superseded: true;
        wroteBlockedEvent: true;
        proposalStatus: 'superseded';
        decisionId: string;
        blockedEventId: string;
      };
    };
```

该字段可以放在 decision metadata。
如果 schema 暂不支持，
首版写入 `direction` 文本。

### 9.2 FeedbackRewriteIntent

见 7.3。

### 9.3 Blocked event 扩展

保留 FEAT-069 字段。
新增可选字段：

```ts
subReason?: 'INSUFFICIENT_ACTIONABLE_EVIDENCE' | 'GENERIC_POLICY_REWRITE';
feedbackIntent?: FeedbackRewriteIntent;
```

## 10. 测试与验收

### 10.1 self-heal 测试

- 旧 decision 是 `request-changes`。
- 新 pending 与旧 proposal contentHash 相同。
- 结果写 reject decision。
- self-heal decision 的 `descriptionLint.blockerCount` 为 0。
- proposal 状态变 `superseded`。
- 写 blocked event。
- `--confirm --json` 返回 `actualActions`，且 id 与落盘文件一致。
- 重复 `--confirm` 不重复写 decision / blocked event。

- contentHash 不同。
- 语义指纹相同。
- 结果仍 self-heal。

- 新 proposal 非等价。
- 不自动 reject。
- 只写 manualCheck。

- proposal 已 approve。
- 不处理。

### 10.2 feedback rewrite 测试

- direction 命中 `not-actionable`。
- observations 有 ModelHub 600 秒超时。
- 新 proposal 只改一个字段。
- approval-request 写清样本 turn id。

- direction 命中 `not-actionable`。
- observations 无稳定错误类别。
- 不生成 proposal。
- 写 skipped summary。

- rewrite 后缺 detailsRef。
- validate blocked。

- rewrite 后仍是 generic policy。
- validate blocked。

### 10.3 本案例验收

对真实样例应满足：

1. `approval_request_798b8b81` 可被 dry-run 命中。
2. dry-run 说明它等价于 `proposal_2f3bf421`。
3. `approval_decision_de3fed7` 被识别为反馈源。
4. rewrite 不再生成 runner 错误元策略。
5. 如果证据足够，输出 ModelHub timeout patch。
6. 如果证据不足，输出 skipped summary。

## 11. 可观测性

daily summary 必须展示：

- self-heal 命中数量。
- self-heal 写入数量。
- rewrite 触发数量。
- rewrite 成功数量。
- rewrite blocked 数量。
- skipped reason 分布。

Haro Web 后续可展示这些事件。
但本 FEAT 不改 UI。

## 12. 回滚

代码回滚后，
Haro 不再自动 self-heal。

已写入的 reject decision 是审计记录。
如需撤销，
supervisor 手工删除该 decision。
然后把 proposal status 改回原值。

blocked event 不参与 apply。
可以保留。

## 13. 风险

| 风险 | 处理 |
| --- | --- |
| 误判重复 | 默认 dry-run，confirm 才写 |
| 误退非等价提案 | 需要双重证据或人工复核 |
| direction 解析错误 | 解析失败直接 blocked |
| LLM 不稳定 | 首版不用 LLM |
| 用户看不到原因 | daily summary 输出 request id 和 prior id |

## 14. 开放问题

1. FEAT-069 上线时间从哪里读取。
2. self-heal 是否允许 daily 自动 confirm。
3. Web 是否需要显示 self-heal 事件。
4. LLM proposer 是否并入 FEAT-073。
5. self-heal decision 是否需要新 metadata 字段。
