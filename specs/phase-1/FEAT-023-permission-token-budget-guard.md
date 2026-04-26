---
id: FEAT-023
title: Permission & Token Budget Guard（权限与预算护栏）
status: done
phase: phase-1
owner: whiteParachute
created: 2026-04-25
updated: 2026-04-26
related:
  - ../phase-1/FEAT-013-scenario-router.md
  - ../phase-1/FEAT-014-team-orchestrator.md
  - ../phase-1/FEAT-018-web-dashboard-orchestration-observability.md
  - ../design-principles.md
  - ../multi-agent-design-constraints.md
  - ../../docs/architecture/overview.md
  - ../../docs/data-directory.md
---

# Permission & Token Budget Guard（权限与预算护栏）

## 1. Context / 背景

FEAT-013/014 已让 Haro 可以把复杂任务路由到 team workflow 并行执行。多 Agent 并行带来两个生产风险：

- **权限风险**：多个 leaf branch 同时执行时，如果没有操作分级，可能把读文件、写文件、执行命令、外部网络、删除/归档、凭据访问等风险混为一谈。
- **成本风险**：并行 branch、retry、merge、critic 都会放大 token 消耗；如果没有 workflow 预算，用户无法提前判断一次任务是否值得继续。

本 spec 借鉴 Mercury Agent 的显式权限审批和 Token 预算系统，在 Phase 1 建立 MVP 护栏。目标是先给 Haro 的 Router、Team Orchestrator、CLI/Web 可观测面提供统一的 permission/budget contract，不追求完整企业 IAM。

## 2. Goals / 目标

- G1: 定义操作权限分级，把 Haro 内部动作映射到可审计 operation class。
- G2: 定义 token/cost budget，在 workflow、branch、agent 三层统计使用量。
- G3: 在 Router/Team Orchestrator 执行前和执行中提供 fail-fast / near-limit / exceeded 判断。
- G4: 所有需要审批、被拒绝、预算超限的动作必须写 audit log。
- G5: FEAT-018 Dashboard 能读取预算和权限摘要，定位 workflow 卡住原因。
- G6: Phase 1 默认策略保守，避免阻断现有低风险本地开发路径。

## 3. Non-Goals / 不做的事

- 不实现企业级 RBAC、SSO 或多租户权限系统。
- 不接入真实支付账单；Phase 1 只统计 token 和估算成本。
- 不修改 Codex/OpenAI provider 的底层计费方式。
- 不替用户自动批准高风险动作。
- 不在 FEAT-023 内实现 Dashboard 页面，只提供 read model/API 给 FEAT-018。
- 不覆盖 GitHub/CI/CD 生产发布审批；生产发布归后续独立 spec。

## 4. Requirements / 需求项

- R1: 系统必须定义 operation class，至少包含 `read-local`、`write-local`、`execute-local`、`network`、`external-service`、`archive`、`delete`、`credential`、`budget-increase`。
- R2: 每个 operation class 必须有默认 policy：`allow`、`dry-run-only`、`needs-approval`、`deny`。
- R3: 默认策略必须允许低风险 `read-local`，对 `delete`、`credential` 默认 `deny`，对 `archive` 和 `budget-increase` 默认 `needs-approval`。
- R4: Router 产出 workflow 时必须带预算估计字段，至少包含 estimatedBranches、estimatedTokens、budgetId。
- R5: Team Orchestrator 必须把 budget 分配到 branch attempt，并在 retry/merge 前检查剩余额度。
- R6: Budget ledger 必须记录 workflowId、branchId、agentId、provider、model、inputTokens、outputTokens、estimatedCost、createdAt。
- R7: 当预算达到 near-limit 阈值时，系统应标记 workflow `needs-human-intervention` 或等价状态；当预算超过硬上限时，必须阻断新增 branch/retry。
- R8: 所有 denied、needs-approval、budget near-limit、budget exceeded 事件必须写 `operation_audit_log`。
- R9: CLI 和 Web API 必须能读取当前 workflow 的 permission/budget summary。
- R10: `haro run` / CLI 低风险单 Agent 路径在默认预算内不得要求额外确认。
- R11: 对多 Agent workflow，预算统计必须汇总所有 branch，不得只统计 merge 或主 branch。
- R12: Permission guard 不得取代 `shit` 的 dry-run-first / confirm-high 机制；二者叠加时应取更严格策略。

## 5. Design / 设计要点

### 5.1 Operation class

```typescript
type OperationClass =
  | 'read-local'
  | 'write-local'
  | 'execute-local'
  | 'network'
  | 'external-service'
  | 'archive'
  | 'delete'
  | 'credential'
  | 'budget-increase';

type OperationPolicy = 'allow' | 'dry-run-only' | 'needs-approval' | 'deny';

interface PermissionDecision {
  operationClass: OperationClass;
  policy: OperationPolicy;
  reason?: string;
  approvalRef?: string;
}
```

Default policy：

| Operation | Default | 说明 |
|-----------|---------|------|
| read-local | allow | 读取仓库/本地配置 |
| write-local | allow | workspace 内普通写入；受 sandbox/git dirty 约束 |
| execute-local | allow | 测试、lint、构建等本地命令 |
| network | needs-approval | 外部请求或下载 |
| external-service | needs-approval | 飞书、邮件、GitHub 等外部服务写操作 |
| archive | needs-approval | shit archive、channel remove archive |
| delete | deny | 直接删除默认禁止 |
| credential | deny | 凭据读取/导出默认禁止 |
| budget-increase | needs-approval | 提高预算必须记录 |

### 5.2 Budget model

```typescript
interface WorkflowBudget {
  budgetId: string;
  workflowId: string;
  limitTokens: number;
  softLimitRatio: number;
  usedInputTokens: number;
  usedOutputTokens: number;
  estimatedCost?: number;
  state: 'ok' | 'near-limit' | 'exceeded';
}

interface TokenBudgetLedgerEntry {
  id: string;
  budgetId: string;
  workflowId: string;
  branchId?: string;
  agentId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost?: number;
  createdAt: string;
}
```

### 5.3 Runtime integration

Execution flow：

```text
Router estimates budget
  -> Team Orchestrator allocates branch budget
  -> leaf execution records token usage
  -> retry/merge checks remaining budget
  -> near-limit/exceeded writes audit event
  -> FEAT-018 reads summary for debug UI
```

Policy flow：

```text
operation request
  -> classify operation
  -> resolve default/project/user policy
  -> allow / dry-run-only / needs-approval / deny
  -> write audit log for non-allow decisions
```

### 5.4 Closed design decisions

- D1: Phase 1 默认 hard limit 采用固定 token 数配置；provider/model 成本估算只作为可选展示字段，不作为阻断依据。
- D2: `write-local` 必须区分 workspace 内写入和 `~/.haro/` 状态写入。两者在默认本地开发策略下可为 `allow`，但 audit/classification 中必须保留目标范围，workspace 外写入不得被泛化为普通 workspace 写入。
- D3: approval 的 Phase 1 最小形式为显式 CLI/config 确认加 audit log；完整 Web human checkpoint / 审批队列留给 FEAT-028 或后续独立 spec。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定每种 operation class，当调用 policy resolver 时，应返回默认 policy，且 delete/credential 为 deny。（对应 R1-R3）
- AC2: 给定一个 team workflow，当 Router 创建 workflow 时，应包含 budgetId 和 token 估计。（对应 R4）
- AC3: 给定多个 branch 执行完成，当查询 budget ledger 时，应看到所有 branch 的 token 汇总，而非仅主 session。（对应 R5-R6、R11）
- AC4: 给定预算超过 soft limit，当继续 retry 或新增 branch 时，应标记 near-limit 并写 audit log。（对应 R7-R8）
- AC5: 给定预算超过 hard limit，当新增 branch/retry 时，应被阻断，并在 FEAT-018 summary 中显示 budget exceeded。（对应 R7、R9）
- AC6: 给定默认单 Agent `haro run`，当在默认预算内执行本地低风险任务时，不应要求额外审批。（对应 R10）
- AC7: 给定 `shit` high-risk archive，当未确认时，Permission Guard 不得把它降级为 allow；最终策略必须仍需要确认。（对应 R12）
- AC8: 给定 external-service 写操作，当 policy 为 needs-approval 时，应写 audit log 且不执行实际写操作。（对应 R2、R8）

## 7. Test Plan / 测试计划

- 单元测试：operation classifier、policy resolver、budget state transition。
- Team integration：parallel/debate workflow 多 branch token 汇总、retry 前预算检查。
- CLI regression：普通 `haro run` 不被误阻断。
- shit regression：dry-run-first、confirm-high 与 Permission Guard 叠加。
- API/read model：FEAT-018 能读取 permission/budget summary。

## 8. Open Questions / 待定问题

全部已关闭：

- ~~Q1: Phase 1 默认 hard limit 应按 token 数固定值配置，还是按 provider/model 估算成本配置？~~ **决策：固定 token hard limit。** provider/model 成本估算只作为可选展示字段，不作为 Phase 1 阻断依据。
- ~~Q2: `write-local` 是否需要区分 workspace 内写入和 `~/.haro/` 状态写入？~~ **决策：需要区分。** workspace 内写入与 `~/.haro/` 状态写入在 classification/audit 中保留不同目标范围，workspace 外写入不得被静默当作普通 workspace 写入。
- ~~Q3: approval 记录的最小形式是 CLI prompt、config flag，还是只写 audit log 等待 Phase 2 human checkpoint？~~ **决策：显式 CLI/config 确认 + audit log。** Web human checkpoint / 审批队列后续再做。

## 9. Changelog / 变更记录

- 2026-04-25: Codex — 初稿，定义操作权限分级、Token budget ledger、audit log 和 Team Orchestrator 集成边界。
- 2026-04-26: whiteParachute — approved
  - Q1 → Phase 1 使用固定 token hard limit；成本估算只做展示，不作为阻断。
  - Q2 → `write-local` 区分 workspace 写入和 `~/.haro/` 状态写入，并在 audit/classification 中保留目标范围。
  - Q3 → approval 最小形式为显式 CLI/config 确认 + audit log；Web 审批流留给 FEAT-028 或后续 spec。
- 2026-04-26: Codex — done
  - 核心交付：新增 PermissionBudgetStore / operation classifier / policy resolver；SQLite 增加 `operation_audit_log`、`workflow_budgets`、`token_budget_ledger`；Router 产出 budget estimate；Team Orchestrator 在 branch/retry/merge 处执行 soft/hard token guard；CLI 外部 channel 写操作与 `shit` archive 接入 Permission Guard；Web 暴露只读 `/api/v1/guard/workflows` read model。
  - 验证命令：`pnpm -F @haro/core test`、`pnpm -F @haro/cli test`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm smoke` 全部通过。
  - 独立 review：native verifier 复核 PASS；早期 review 提出的 runtime Permission Guard wiring 与多目标 `write-local` scope 问题已修复。
  - Commit: 29e3f6566c192790256b9e35540c5cfb59f02429
  - Not-tested: 未连接真实 Feishu/Telegram 外部发送审批链路，只通过 fake channel harness 验证未批准时 audit + no-send；真实 provider billing/cost 不是 Phase 1 阻断依据。
