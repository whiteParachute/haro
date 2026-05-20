# FEAT-068 readability lint follow-up

## 1. 背景

FEAT-052 已经把 approval-request 的人读字段改成中文模板，并增加了三类可读性规则：

1. 术语裸词不能直接展示给审批人；
2. `whyChange` / `howChange` / `expectedBenefits` / `regressionRisks` / `rollbackPlan` 不能串板块；
3. 审批页句子应尽量控制在 35 字以内。

后续提案链路继续扩展后，可读性风险已经不只存在于 approval-request。proposal、validation、reject/request-changes direction 也会被 supervisor 或用户直接看到。FEAT-068 负责把 FEAT-052 的规则沉到共享检查层，并把违规结果接入 propose / validate 的软门。

## 2. 目标

- 扩展可读性 lint 覆盖面：proposal、validation、approval-request、approval-decision。
- 提供手动入口：`haro lint descriptions [--fix-dry-run]` 和 MCP `haro_lint_descriptions`。
- propose 阶段写入 `proposal.descriptionLint`，并在 `policyAudit.descriptionLint` 中聚合。
- validate 阶段写入 `validation.descriptionLint`，并把结果同步到 `validation.policyAudit.descriptionLint`。
- blocker 级违规让 `applyEligible=false`；warning 级只标注，不阻断 artifact 写入。
- 全量历史扫描只输出报告，不修改业务字段。

## 3. 非目标

- 不自动改写历史 artifact。
- 不改变既有描述模板字段名或字段顺序。
- 不改 Haro Web UI。
- 不改 AgentDock、scheduler、ModelHub、aria-memory 或 aria-memory-vault。
- 不新增外部依赖。

## 4. 规则范围

### 4.1 术语裸词

沿用 FEAT-052 术语表：

| 裸词 | 建议表达 |
| --- | --- |
| `frontier signal` | 外部一手情报 |
| `observation batch` | 本轮 Haro 自检快照 |
| `proposal-content` | 本次改动的具体内容文件 |
| `contentHash` | 内容指纹 |
| `gated-write` | 必须人审通过才允许使用的写入类工具 |
| `mcp-tool-config asset` | Haro 自己维护的 MCP 工具配置文件 |

### 4.2 板块串味

- `whyChange` 只写问题和不改的代价。
- `howChange` 只写对象和可见变化。
- `expectedBenefits` 只写正向收益。
- `regressionRisks` 只写坏结果、感知方和恢复窗口。
- `rollbackPlan.strategy` 只写人怎么撤。

### 4.3 句长

- 审批人直接阅读的字段继续按 35 字检查。
- proposal 内部字段也检查，但默认作为 warning。
- proposal title 出现术语裸词时升级为 blocker。

## 5. Artifact 覆盖

| Artifact | 检查字段 | 违规级别 |
| --- | --- | --- |
| proposal | title、changeSet.summary、manualChecks、regressionRisks、rollbackPlan.strategy | warning 为主；title 裸词为 blocker |
| validation | blockingReasons、requiredTests | warning |
| approval-request | title、whyChange、howChange、expectedBenefits、regressionRisks、rollbackPlan、reviewerInstruction | blocker |
| approval-decision | direction | blocker |

## 6. Soft gate 语义

- propose：无论是否违规，仍写 proposal；同时写入 `proposal.descriptionLint`。
- propose policyAudit：聚合本轮 candidate 的 `descriptionLint`，便于 MCP / CLI 调用方看到。
- validate：仍写 validation，保留审计链路。
- validate blocker：如果 proposal 或 validation 描述存在 blocker，`riskVerdict=blocked`，`applyEligible=false`。
- validate warning：只写入 `descriptionLint`，不影响 `applyEligible`。

这个语义避免因为文案问题丢失证据，同时阻止明显不可读的提案进入 apply。

## 7. CLI / MCP 入口

### 7.1 CLI

```bash
haro lint descriptions --json
haro lint descriptions --fix-dry-run --json
```

`--fix-dry-run` 只输出建议，不写回任何 artifact。

### 7.2 MCP

新增只读工具：`haro_lint_descriptions`。

输入：

```json
{ "fixDryRun": true }
```

输出与 CLI JSON 一致，用于 supervisor 或 AgentDock 侧直接调用。

## 8. 全量历史扫描结果

执行时间：2026-05-20。

命令：

```bash
node packages/cli/bin/haro.js lint descriptions --fix-dry-run --json
```

扫描对象：当前 `~/.haro/evolution/` 下 proposal、validation、approval-request、approval-decision。

| 指标 | 数量 |
| --- | ---: |
| scannedArtifactCount | 14 |
| corruptArtifactCount | 0 |
| violationArtifactCount | 11 |
| warningCount | 68 |
| blockerCount | 1 |
| issueCount | 69 |

命中规则：

| ruleId | 数量 |
| --- | ---: |
| sentence-length | 61 |
| naked-term | 8 |

典型样本：

| kind | id | status | 典型问题 |
| --- | --- | --- | --- |
| proposal | `proposal_2dd0c643be02de08fa8de67e` | warning | proposal title 句子超过 35 字 |
| proposal | `proposal_c601092b6766d9ef4ca30baa` | warning | changeSet summary 含 `gated-write` 裸词 |
| approval-decision | `approval_decision_de3fed7a05661baa64a9561b` | blocker | direction 句子超过 35 字 |

本轮没有修改这些历史 artifact。后续如要清理，只能通过单独 FEAT 做人工确认或 dry-run rewrite。

## 9. 验收标准

- `haro lint descriptions --fix-dry-run --json` 可扫描全量历史 artifact，不写文件。
- MCP `haro_lint_descriptions` 只读可调用。
- 新 proposal 自动带 `descriptionLint`。
- 新 validation 自动带 `descriptionLint`。
- blocker 级可读性违规会让 validation `applyEligible=false`。
- warning 级可读性违规不阻断 artifact 写入。
- 单测覆盖 lint rule、全量扫描 smoke、propose/validate gate smoke。

## 10. 回滚方式

- 回滚代码 commit 即可恢复 FEAT-068 前行为。
- 已写入的新 `descriptionLint` 字段是可选元数据；旧 reader 会忽略。
- 不需要迁移或删除历史 artifact。
