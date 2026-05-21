# FEAT-069 proposer feedback-aware dedupe

## 1. 背景

2026-05-20 用户对 runner-profile 提案提出 `request-changes`，核心反馈是：提案没有解释清楚 Haro 到底出了什么错、旧提案哪里没讲清、为什么这符合“可执行提案”的定义。

2026-05-21 daily workflow 又生成同 target、同标题、同 summary、同 `policy.defaultHandling` 的 runner-profile 提案。新提案只因为 observation batch 和 raw error 证据变化导致 `contentHash` 不同，仍没有吸收用户反馈。

现有 propose 流程只读取 observation、frontier signal、mcp-audit-policy 和 active target dedupe，不读取 `approval-decisions/` 或 `approval-conversations/`。当旧提案被 `request-changes` 或 `reject` 后，active target 空出，deterministic proposer 会再次生成等价内容。

## 2. 目标

- 在 propose 写盘前增加反馈感知挡板。
- 同 target 最近一次人审是 `request-changes` 或 `reject` 时，比较新候选与旧提案是否等价。
- 等价时不写 proposal、不生成 approval request，改写 blocked proposal event。
- CLI / MCP daily workflow 透出 `skippedAwaitingFeedbackCount`，让 supervisor 能看到本轮被挡数量。

## 3. 非目标

- 不实现 feedbackContext 注入。
- 不实现 LLM proposer 重写。
- 不读取或改写 approval-conversations。
- 不改 approval-decision schema。
- 不改 validate、apply、rollback、Haro Web UI、AgentDock 或 aria-memory。
- 不特判任何生产 approval-request 或 proposal id。

## 4. 挡板语义

### 4.1 查找最近反馈

propose 生成候选后、写盘前：

1. 按 candidate 的 level、targetKind、targetRef 集合计算 target key。
2. 扫描 `evolution/approval-decisions/`。
3. 找到同 target key 的最新 decision。
4. 只有最新 decision 是 `request-changes` 或 `reject` 时才进入等价判断。
5. 如果最新 decision 是 `approve`，不阻断。它代表该 target 已落地或允许迭代。

### 4.2 等价判断

两道判断 OR：

1. 严格内容哈希：`changeSet[*].contentHash` 排序后完全相同。
2. 语义指纹：`sha256(title || summary || JSON.stringify(policy.defaultHandling.sort()))` 完全相同。

第二道用于挡住“证据增加导致 contentHash 改变，但提案本身仍是同一套说法”的重复提案。

### 4.3 blocked event

命中挡板时写入：

```text
evolution/blocked-proposal-events/blocked_*.json
```

核心字段：

- `status=blocked`
- `reason=AWAITING_FEEDBACK_INCORPORATION`
- `candidateProposalId`
- `priorDecisionId`
- `priorProposalId`
- `priorDirection`
- `targetRef` / `targetRefs`
- `contentHash` / `contentHashes`
- `semanticFingerprint`

## 5. CLI / daily workflow 输出

`haro propose --auto-dry-run` 新增：

- `skippedAwaitingFeedbackCount`
- `awaitingFeedbackEvents`
- `awaitingFeedbackEventPaths`
- `awaitingFeedbackBlocks`

`haro_run_daily_workflow` 的 propose step 和 summary 透出 `skippedAwaitingFeedbackCount`。

## 6. 验收标准

- 同 target，上一条 `request-changes`，新旧 `contentHash` 相同：blocked。
- 同 target，上一条 `reject`，新旧 `contentHash` 不同但语义指纹相同：blocked。
- 同 target，上一条 `request-changes`，内容哈希和语义指纹都不同：正常写盘。
- 同 target，上一条 `approve`：不挡。
- blocked 时不写 proposal artifact，不写 proposal-content，不发 approval request。
- blocked 时写 blocked-proposal-event，stderr 给出最多 120 字的 direction 摘要。

## 7. 回滚方式

- 回滚本 FEAT commit 即可恢复原 propose 行为。
- 已写入的 `blocked-proposal-events` 是审计 artifact，不参与 apply，可保留。
- 新增的 `feedbackSemanticFingerprint` 是 proposal 可选元数据；旧 reader 可忽略。

## 8. 后续工作

- B：把 prior `direction` 和对话摘要作为 feedbackContext 注入 proposer，让下一版候选真正吸收修改意见。
- C：引入 LLM proposer，在 deterministic lane 无法吸收反馈时生成“普通人能看懂”的改写版本。

