# FEAT-074 lint 按 source 分级

## 状态

- 状态：已实现
- 日期：2026-05-21
- 范围：readability lint / CLI lint descriptions / Web decision lint metadata
- 前置：FEAT-068 readability lint follow-up

## 背景

FEAT-068 把可读性 lint 接入 proposal、validation 和 approval decision。它能防止机器生成的提案继续输出裸术语和长句。

实际运行后发现一个误伤：用户在 Haro Web 写的 `request-changes` 原文也被按机器文案处理。用户长句表达真实反馈时，会被判为 blocker。这会污染 lint 指标，也会误导后续按 blocker 数判断系统健康度的逻辑。

用户原文是证据，不是 Haro 生成文案。它应该被保留，不应该被系统强制改写。

## 目标

1. 给 lint issue 增加来源分类。
2. 人类来源文本命中规则时只记为 info。
3. machine / mixed 来源保持原有 warning / blocker 语义。
4. CLI 和 MCP 结果能看到 infoCount 与 sourceCounts。
5. Web 写 approval decision 时，用户 direction 不再把 artifact 推成 blocker。

## Source 分类

| source | 含义 | 处理方式 |
| --- | --- | --- |
| machine | Haro 自动生成字段 | 维持 FEAT-068 原规则 |
| human | 用户或审批人原文 | 降级为 info，不计 warning/blocker |
| mixed-or-unknown | 无法判断来源 | 保守按非 human 处理 |

当前落地映射：

- proposal：machine
- validation：machine
- approval-request：machine
- approval-decision.direction：human
- approval-conversation role=user 或 author.type=human：human
- approval-conversation role=assistant：machine
- 未带来源的未来字段：mixed-or-unknown

## Contract 变更

`DescriptionLintIssue` 新增：

```ts
source: 'machine' | 'human' | 'mixed-or-unknown'
```

`DescriptionLintReport` 新增：

```ts
infoCount: number
```

兼容策略：

- 旧 artifact 没有 `source` 时，schema 默认 `mixed-or-unknown`。
- 旧 report 没有 `infoCount` 时，schema 默认 `0`。
- `status` 仍只有 `pass` / `warning` / `blocker`。

## Severity 规则

- human source：所有规则命中均为 `info`。
- machine source：沿用原有 warning / blocker。
- mixed-or-unknown：沿用原有 warning / blocker。

`status` 只看 warning/blocker：

- blockerCount > 0：blocker
- warningCount > 0：warning
- 否则：pass

`issueCount` 保留全部 issue，包括 info。这样详细列表仍能观察用户原文问题，但不会污染阻断指标。

## CLI / MCP 输出

`haro lint descriptions [--fix-dry-run]` 新增：

- `infoCount`
- `sourceCounts`
- artifact 级 `infoCount`

`--fix-dry-run` 不给 human source 生成修复建议。用户原文不改写。

MCP `haro_lint_descriptions` 走同一结果对象，自动暴露新增字段，旧调用方可继续只读原字段。

## Web decision 路径

Web 写 `approval-decision.direction` 时仍调用 `lintApprovalDecisionDescription`。

变化是 lint 函数会把该字段标为 human source。长句或裸术语只进入 info，不再让 decision 的 `descriptionLint.status` 变成 blocker。

## 历史扫描基线

根据 supervisor 给出的改造前基线：

- 改造前：13 violations / 79 warnings / 1 blocker
- blocker 来源：用户 request-changes 原文

改造后在当前 `~/.haro` 上执行：

```bash
haro lint descriptions --fix-dry-run --json
```

结果：

- scannedArtifactCount：17
- corruptArtifactCount：0
- violationArtifactCount：12
- warningCount：79
- blockerCount：0
- infoCount：1
- sourceCounts：machine=79，human=1
- info-only artifact：`approval-decision/approval_decision_de3fed7a05661baa64a9561b`

结论：用户原文从 blocker 降为 info，机器生成 warning 保持不变。

## 验收标准

- approval-decision.direction 单句超过 35 字时，issue severity=info，source=human，report status=pass。
- approval-conversation 用户消息单句超过 35 字时，issue severity=info，source=human，report status=pass。
- proposal.title 长句仍是 machine warning。
- proposal.testPlan.manualChecks 自动追加项仍按 machine 处理。
- CLI 输出包含 infoCount 和 sourceCounts。
- Web decision response 中的 descriptionLint 不再因用户 direction 变成 blocker。

## 回滚方式

- 回滚代码即可恢复 FEAT-068 旧行为。
- 已写入 artifact 的 `descriptionLint.infoCount` 和 `issues[*].source` 是向后兼容扩展。
- 不需要数据迁移。

## 非目标

- 不批量改写历史 proposal / validation 文案。
- 不修改 Web UI 展示。
- 不改 apply / rollback。
- 不改变 FEAT-069 / FEAT-072 的 proposer 行为。
- 不实现 FEAT-073 LLM proposer。
