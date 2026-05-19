# FEAT-054: Propose 阶段消费 MCP 审计策略

## 背景

2026-05-19 的诊断确认：`agentdock:haro-sidecar-mcp-audit-policy` 已经通过 gated apply 落到
`$HARO_HOME/assets/current/mcp-tool-config/`，但 `haro propose` 只会生成这类 policy 提案，尚未读取已落盘的 current policy。
这会让 policy 成为孤儿配置，无法约束后续 candidate proposal。

## 目标

- `propose` 在写入 candidate 之前加载 current MCP 审计策略。
- 对 candidate 生成 `policyAudit` 评估结果，说明 policy 是否被读取、是否命中默认工具、gated write、审批要求和审计清单。
- policy 判定为 `blocked-by-policy` 时跳过该 candidate，并在 propose 结果中计入 `skippedProposalCount`。

## 范围

- 仅改 `propose` 阶段。
- 不改 `validate`、approval、apply、rollback。
- 不改 Haro Web 前端。
- 不改 AgentDock、scheduler、ModelHub、aria-memory 或业务记忆。

## 设计

1. `loadCurrentMcpAuditPolicy()` 从 `$HARO_HOME/assets/current/mcp-tool-config/<base64-asset-id>.json` 读取：
   - `defaultTools`
   - `gatedWriteTools`
   - `approvalRequirements`
   - `auditChecklist`
2. `evaluateCandidateAgainstPolicy()` 输出 `McpAuditPolicyEvaluation`：
   - `allow-actionable-proposal`
   - `blocked-by-policy`
   - `not-applicable`
3. `ProposeResult.policyAudit` 汇总本轮评估：
   - `policyId` / `policyContentHash` / `policyPath`
   - `evaluatedCandidateCount`
   - `blockedCount` / `allowedCount` / `notApplicableCount`
   - `evaluations[]`

## 兼容行为

- policy 不存在：保持原 propose 行为，只输出 warn。
- policy JSON 损坏：保持原 propose 行为，只输出 error。
- dry-run 占位提案不做 policy gate；只约束 actionable candidate。

## 验收标准

- policy 存在且 candidate 合规：生成 proposal，`policyAudit.decision=allow-actionable-proposal`。
- policy 存在且 candidate 不合规：跳过 proposal，`skippedProposalCount=1`。
- policy 不存在：仍生成原 candidate，stderr 有 warn。
- policy 损坏：仍生成原 candidate，stderr 有 error。
- typecheck、lint、build、runner-contracts test、相关单元测试通过。
- 通过 MCP `haro_run_daily_workflow` 验证至少一条 candidate 有非空 `policyAudit.evaluations[]`。
