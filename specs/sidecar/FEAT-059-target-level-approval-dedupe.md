# FEAT-059 target-level approval dedupe

## 背景

2026-05-20 daily workflow 生成了新的 `runner-profile` 审批请求，但 2026-05-19 已有同 target 的 pending 请求。两条请求标题、level、targetKind 和 targetRef.id 相同，只有 contentHash 因新增 observation evidence 改变。

根因是 approval-request dedupe key 包含 `contentHash`。runner-profile、schedule-config 这类提案会随每日错误样本重算内容，导致同 target pending 仍绕过去重。

## 目标

在同 target 仍未决策时，不再生成新的 pending approval-request，也不在 propose 阶段覆盖或刷新同 target 的 active proposal。

## 决策

1. dedupe key 改为 `{ level, targetKind, targetRef.kind, targetRef.id }`，去掉 contentHash、riskLevel、uri。
2. 只拦截未决策目标：已有 approval-decision 的 proposal 不参与 dedupe。
3. propose 阶段发现同 target 已有 `proposed` 或 `validated` 且未决策 proposal 时，直接 noop，不追加 evidence，不覆盖 proposal-content。
4. 选择 noop 而不是 append evidence，是为了不改变用户正在审批的内容和 contentHash；新证据可在旧请求被 approve/reject/request-changes 后重新生成。

## 范围

覆盖 approval-request 阶段和 propose 阶段的同 target 幂等保护。

不覆盖：自动 reject/supersede 既有 pending；不修改 Haro Web；不改 AgentDock、scheduler、ModelHub、aria-memory。

## 回滚方式

如误拦截，回滚本提交即可恢复旧 contentHash 级 dedupe。已存在的 approval-request/proposal artifact 不需要迁移。

## 验收

1. 同 target、不同 contentHash、已有 undecided approval-request 时跳过新请求；
2. 不同 target 继续生成请求；
3. 旧请求已有 reject decision 后允许新请求；
4. 旧请求已有 approve decision 后允许新请求；
5. propose 阶段同 target active proposal 存在时不覆盖、不写新 proposal；
6. lint、build、test、MCP workflow smoke 通过。
