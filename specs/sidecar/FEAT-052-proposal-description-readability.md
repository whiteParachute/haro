---
id: FEAT-052
title: Proposal Description Readability
status: implemented
phase: sidecar
owner: Haroway
created: 2026-05-19
updated: 2026-05-19
related:
  - FEAT-050-approval-request-workflow.md
  - FEAT-051-agentdock-workspace-daily-workflow.md
  - FEAT-045-scheduled-sidecar-cli.md
---

# Proposal Description Readability

## 1. Context / 背景

Haro 已经可以把外部一手情报和 AgentDock 自检结果转换为真实可审批 proposal，但当前 approval request 仍大量暴露 Haro/MCP 内部术语，例如 `frontier signal`、`proposal-content`、`contentHash`、`gated-write`、`mcp-tool-config`。审批人读完后仍不知道：到底改了什么、改完审批页或 Haro 行为会有什么变化、不改会有什么风险。

启动阶段所有自动提案都必须人审，因此 approval request 的首要用户不是实现者，而是负责判断“要不要允许 Haro 继续”的普通审批人。描述必须在 30 秒内说明清楚为什么改、怎么改、收益、风险和怎么撤销。

## 2. Goals / 目标

- G1: 所有 proposer lane 生成的 approval request 共享一套可读性模板，而不是每条 lane 各写各的技术描述。
- G2: `title / whyChange / howChange / expectedBenefits / regressionRisks / rollbackPlan.strategy / reviewerInstruction` 必须使用审批人能理解的语言。
- G3: 保留必要 asset id、proposal id、evidence refs 和 contentHash，但必须配普通话注释，不允许裸露术语。
- G4: 已存在 pending approval request 可以只重写人读字段，保持 proposal/validation/evidence/contentHash/status 不变。
- G5: 如果证据不足以写出人话 whyChange，提案应留在 blocked dry-run，不得编造收益或降低风险。
- G6: 每个展示板块只承担一个职责，范围/边界声明统一放入 `scope` 字段。

## 3. Non-Goals / 不做的事

- 不改变 proposal / validation / approval decision 的核心状态机。
- 不改 AgentDock 代码、不改 AgentDock scheduler、不改 aria-memory-vault。
- 不自动 approve / reject / apply / rollback。
- 不把技术证据删除；只把给审批人看的字段翻译成人话。
- 不在本 spec 中实现飞书交互审批 bridge。

## 4. Requirements / 需求项

- R1: `ApprovalRequestRecord` 的人读字段必须通过共享格式化层生成，覆盖 MCP 工具配置、runner-profile、schedule-config、generic/dry-run 等所有 proposal 类型。
- R2: `title` 必须结论先行，包含“做什么 + 影响范围”。
- R3: `whyChange` 必须用 1–3 句说明“现在的问题 / 风险 / 为什么必须改”，不能只列证据 id。
- R4: `howChange` 每一步必须说明“改哪个文件或资产 + 改完后用户/审批人/Haro 会看到什么变化”。
- R5: `expectedBenefits` 必须用审批体验或业务效果语言；如必须出现技术术语，必须在同句解释。
- R6: `regressionRisks` 必须说明“最坏情况 / 谁先感知 / 多久能恢复”。
- R7: `rollbackPlan.strategy` 必须说明人怎么撤，包含可执行命令或审批页操作名。
- R8: `reviewerInstruction` 必须保留 approve / reject / request-changes，并提示“如果看不懂为什么改，直接 request-changes 要求重写描述”。
- R9: 术语表必须强制替换或括号注释：
  - `frontier signal` → “外部一手情报（如 GitHub Changelog 等）”。
  - `observation batch` → “本轮 Haro 自检快照”。
  - `proposal-content / contentHash` → “本次改动的具体内容文件 + 内容指纹”。
  - `gated-write tool` → “默认关闭、必须人审通过才允许使用的写入类工具（如 haro_apply / haro_rollback）”。
  - `mcp-tool-config asset` → “Haro 自己维护的 MCP 工具配置文件”。
  - `L0/L1` 首次出现必须加注：`L0=只动 Haro 自己的配置，不改 AgentDock 代码` / `L1=只动 Haro 自己的运行策略资产，不改 AgentDock 代码`。
- R10: 现有 pending approval request 的人读字段必须可重写，并写入 `descriptionRewrittenAt`，但不得改 evidence/contentHash/validation/status。
- R11: `whyChange / howChange / expectedBenefits / regressionRisks / rollbackPlan.strategy` 必须单一职责：
  - `whyChange` 只写问题和不改的代价。
  - `howChange` 只写改动对象和可见变化。
  - `expectedBenefits` 只写正向收益，不写“不会修改 X”。
  - `regressionRisks` 只写坏结果、谁先感知和恢复窗口，不写恢复命令。
  - `rollbackPlan.strategy` 只写撤回操作，不重申范围边界。
- R12: 中文行文必须短句优先；测试中每句不得超过 35 字，命令和 id 先脱敏后计数。

## 5. Design / 设计要点

### 5.1 共享可读性层

在 approval-request 生成器中新增共享描述构建层：

1. 先从 proposal / validation / changeSet 推导 `ReadableProposalContext`：影响范围、目标资产、人话目标、用户可见变化、Haro 行为变化、证据摘要、回滚步骤。
2. 所有 lane 共用 `createReadableApprovalDescription(context)` 生成 title、whyChange、howChange、expectedBenefits、regressionRisks、rollbackPlan.strategy、reviewerInstruction。
3. 术语翻译在共享层完成，避免某条 lane 里漏掉裸术语。
4. generic dry-run 如无法给出具体改动内容，仍应被 approval gate 阻止，不进入 pending。
5. `scope` 独立承载范围和边界声明，避免污染 why/how/benefit/risk/rollback。

### 5.2 pending 描述重写

新增 sidecar-local 工具函数/CLI 内部流程，对 pending approval request 执行只改人读字段的重写：

- 读取 request 对应 proposal 和 validation。
- 重新生成人读字段。
- 保留 id、proposalId、validationId、status、sourceRef、validationRef、evidenceRefs、createdAt。
- 写入 `descriptionRewrittenAt` 和新的 `updatedAt`。

### 5.3 可读性 lint

测试层提供 `assertReadableApprovalRequest(record)`：

- 禁止出现术语表裸词。
- 禁止板块串味：why 不写证据，benefits 不写负向边界，risks 不写命令，rollback 不写范围声明。
- 每句中文说明不超过 35 字；命令和长 id 脱敏后再计数。
- whyChange 至少包含一句中文解释，不能只是 id / ref。
- howChange 每条必须包含“用户会看到 / 审批人会看到 / Haro 会”的视角说明之一。
- regressionRisks 必须包含最坏情况和恢复方式。
- rollbackPlan.strategy 必须包含 `haro rollback`、审批页操作名或明确人工步骤。

## 6. Acceptance Criteria / 验收标准

- AC1: 新生成的 MCP audit approval request 标题为结论先行，审批人能看懂影响范围。（对应 R2）
- AC2: runner-profile 和 schedule-config approval request 也使用同一模板，不裸露内部术语。（对应 R1、R9）
- AC3: 测试能捕捉裸 `frontier signal` / `contentHash` / `gated-write` / `mcp-tool-config asset` 等术语。（对应 R9）
- AC4: whyChange / howChange / benefits / risks / rollback 均通过可读性 lint。（对应 R3–R8）
- AC5: 现有 4 条 pending approval request 被重写描述后仍保持 pending，proposal/validation/evidence/contentHash 不变，并新增 `descriptionRewrittenAt`。（对应 R10）
- AC6: 手动运行一次 `haro_run_daily_workflow` 后，不 auto approve/apply/rollback，输出的新 request 或既有 request 可由审批人复核是否看得懂。
- AC7: 现有 4 条 pending request 第二轮重写后，pending 数量仍为 4，且 `scope` 承载边界声明。

## 7. Test Plan / 测试计划

- 单元测试覆盖：approval request 可读性格式化层、术语替换、各 targetKind 的 title/why/how/benefit/risk/rollback。
- 集成测试覆盖：MCP audit / runner-profile / schedule-config proposal → validate → approval-request 全流程。
- 回归测试覆盖：已 pending request 的描述重写只改人读字段和 `descriptionRewrittenAt`，不改 evidence/contentHash/validation/status。
- 手动验证：重写 4 条 pending approval request 后，在 Haro Web 或 JSON 中确认审批人能 30 秒读懂。

## 8. Open Questions / 待定问题

- 已决：`descriptionRewrittenAt` 已进入 approval request contract schema，作为可选字段供 Web/API 展示与回归测试使用。

## 9. Changelog / 变更记录

- 2026-05-19: Haroway — 初稿并完成实现，所有审批描述改为共享可读模板，并支持 pending 描述重写。
- 2026-05-19: Haroway — 第二轮收口板块单一职责，新增 `scope` 字段，并把短句中文写入 lint。
