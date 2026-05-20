# FEAT-065 validate 阶段消费 mcp-audit-policy

## 1. 背景

FEAT-054 已让 `haro propose` 在生成 actionable proposal 前读取 current `mcp-audit-policy`，并对 candidate 输出 `policyAudit`。但 `haro validate` 仍只看 proposal 自身的风险、rollback、content gate 条件，不读取该 policy。

这会导致 policy 只在 propose 侧生效。若 proposal 是旧版本生成、手工写入、或未来有新的 proposer lane 绕过 propose 侧检查，validate 仍可能放过不满足 policy 的 proposal。

## 2. 目标

- `haro validate --pending` 对每个被验证的 proposal 读取 current `mcp-audit-policy`。
- 复用 FEAT-054 的 `evaluateCandidateAgainstPolicy()`，不复制第二套规则。
- validation JSON 持久化 proposal 级 `policyAudit` 结果。
- CLI JSON / daily workflow validate step 输出本轮 policyAudit 汇总。
- policy missing / parse-error 时不阻断 validate，保持现有可用性。

## 3. blocked-by-policy 语义

选择语义 (a)：validate 仍写出 validation 文件，但标记为 blocked。

具体规则：

- `policyAudit.decision=blocked-by-policy` 时：
  - validation 写入 `policyAudit`；
  - `riskVerdict=blocked`；
  - `applyEligible=false`；
  - `blockingReasons` 追加 `mcp-audit-policy 阻断：<reason>`；
  - proposal 不会被标记为 `validated`。
- approval-request 阶段沿用现有 actionable gate，看到 blocked validation 后跳过。

选择理由：

- 保留审计 trail，能说明 validate 为什么拦截。
- 不让 proposal 卡在“没有 validation 文件”的不透明状态。
- 不改变 approval-request/apply gate 的安全边界。
- 未来可在 Haro Web 生命周期里展示 blocked validation，而不是只靠 stderr。

## 4. 数据模型

在 `ValidationReport` 增加可选字段：

```ts
interface ValidationPolicyAudit {
  policyId: string;
  policyContentHash: string;
  candidateProposalId?: string;
  candidateTargetKind?: string;
  defaultToolsHit: boolean;
  gatedWriteHit: boolean;
  approvalRequirementsHit: boolean;
  auditChecklistHit: boolean;
  decision: 'allow-actionable-proposal' | 'blocked-by-policy' | 'not-applicable';
  reason: string;
  blocked: boolean;
}
```

policy missing / parse-error 时，validation 文件不写 proposal 级 `policyAudit`，但 CLI result 的汇总字段会显示 `status=missing` 或 `status=parse-error`。

## 5. 范围

包含：

- `haro validate --pending`；
- daily workflow 的 validate step summary；
- validation contract schema；
- CLI unit tests；
- roadmap 编号修复。

不包含：

- 不改 propose 已有 policyAudit 语义；
- 不改 MCP server；
- 不改 Haro Web；
- 不改 apply / rollback；
- 不限制 Haro MCP tool 调用，那个后续由 FEAT-066 分段完成；
- 不改 AgentDock / aria-memory / current policy 文件内容。

## 6. 验收标准

1. policy loaded + not-applicable proposal：validate 通过，validation 持久化 `policyAudit.decision=not-applicable`。
2. policy loaded + blocked proposal：validate 写 validation，`riskVerdict=blocked`、`applyEligible=false`、`policyAudit.blocked=true`。
3. policy missing：validate 不阻断，CLI summary 显示 `policyAudit.status=missing`。
4. 已存在 validation 文件重跑：不重复写 validation，保持幂等。
5. `pnpm lint` / `pnpm build` / `pnpm test` / `pnpm smoke` / `git diff --check` 通过。

## 7. 回滚方式

代码回滚即可撤销 validate 侧 policy 消费。已生成的 validation 文件中若带 `policyAudit` 字段，旧 schema 不读取该字段时需要同步回滚 contract；若要手动回滚数据，可删除对应 validation 文件后重新运行旧版 `haro validate --pending`。
