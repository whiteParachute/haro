---
id: FEAT-018
title: Web Dashboard — Orchestration Debugger（编排调试）
status: approved
phase: phase-1
owner: whiteParachute
created: 2026-04-23
updated: 2026-04-26
related:
  - ../design-principles.md
  - ../multi-agent-design-constraints.md
  - ../team-orchestration-protocol.md
  - ./FEAT-014-team-orchestrator.md
  - ./FEAT-015-web-dashboard-foundation.md
  - ./FEAT-023-permission-token-budget-guard.md
  - ../../docs/modules/team-orchestrator.md
---

# Web Dashboard — Orchestration Debugger（编排调试）

## 1. Context / 背景

FEAT-013/014 已完成 Scenario Router 和 Team Orchestrator：复杂任务可以进入 fork-and-merge team workflow，并在 fork、leaf terminal、merge 阶段写入 checkpoint。Phase 1 下一步最需要的 Dashboard 能力，不是一次性把 Memory、Skills、Logs、Provider、Monitor 全做完，而是先解决多 Agent 编排的核心可观测问题：

- 当前 workflow 跑到哪个 node？
- 哪个 branch / Agent 卡住了？
- 最近 checkpoint 里保存了什么状态？
- branch 是否已经被 merge 消费，恢复时会不会重复执行？
- 阻断原因是 timeout、validator、工具失败、预算还是权限？

2026-04-25 owner 决策：原 FEAT-018 范围过大，需要拆分。本 spec 收窄为 **Orchestration Debugger**。原 Knowledge/Skills 管理拆到 FEAT-024；Logs/Provider/Monitor 拆到 FEAT-025。

## 2. Goals / 目标

- G1: 实现 DispatchPage，展示 Team workflow 的 fork-and-merge 拓扑。
- G2: 展示 workflow checkpoint 时间线、branch ledger、merge envelope。
- G3: 提供 stalled branch 诊断，定位卡住的 branch、attempt、lastError 和 leaf session。
- G4: 展示只读 checkpoint debug drawer，方便恢复/幂等问题排查。
- G5: 读取 FEAT-023 的预算/权限摘要，解释 workflow 是否需要人类介入。

## 3. Non-Goals / 不做的事

- 不实现 KnowledgePage / Memory 搜索与写入；拆到 FEAT-024。
- 不实现 SkillsPage；拆到 FEAT-024。
- 不实现 LogsPage、InvokeAgentPage、MonitorPage；拆到 FEAT-025。
- 不实现 Evolution Loop 可视化；属于 Phase 2。
- 不修改 TeamOrchestrator 核心执行逻辑。
- 不提供 workflow 暂停、重跑、跳过 branch、修改策略等写操作；Phase 1 只读调试。
- 不在本 FEAT 内实现权限/预算策略本身；只读取 FEAT-023 的 read model。

## 4. Requirements / 需求项

- R1: REST API 覆盖 Workflows 领域：`GET /api/v1/workflows`、`GET /api/v1/workflows/:id`、`GET /api/v1/workflows/:id/checkpoints`。
- R2: Workflow list 必须返回 summary：workflowId、executionMode、orchestrationMode、templateId、status、createdAt、updatedAt、currentNodeId、blockedReason。
- R3: Workflow detail 必须返回 branch ledger、merge envelope、leafSessionRefs、rawContextRefs 和最近 checkpoint ref。
- R4: Checkpoints API 必须按时间顺序返回 checkpoint metadata，并支持查看单个 checkpoint 的完整 JSON。
- R5: DispatchPage 必须准确展示 fork-and-merge 拓扑，禁止渲染为串行 chain 布局。
- R6: DispatchPage 必须能标识 stalled branch，展示 branchId、memberKey、status、attempt、startedAt、lastEventAt、lastError、leafSessionRef、outputRef、consumedByMerge。
- R7: CheckpointTimeline 必须支持只读 debug drawer，明确区分 rawContextRefs、branch ledger、merge envelope、budget/permission summary。
- R8: 页面必须突出“需要人类介入”的 workflow，但只能提供跳转到详情页的只读入口；不得直接执行 approve/continue/stop。
- R9: FEAT-018 不得定义 `/api/v1/memory*`、`/api/v1/skills*` 或 `/api/v1/providers*` contract。

## 5. Design / 设计要点

### 5.1 新增后端文件

```
packages/cli/src/web/routes/
└── workflows.ts    # Workflow checkpoint/debug REST
```

推荐 detail read model：

```typescript
interface WorkflowDebugSummary {
  workflowId: string;
  status: 'running' | 'merge-ready' | 'merged' | 'failed' | 'cancelled' | 'timed-out' | 'blocked';
  executionMode: 'single-agent' | 'team';
  orchestrationMode?: 'parallel' | 'debate' | 'pipeline' | 'hub-spoke';
  workflowTemplateId: string;
  currentNodeId: string;
  latestCheckpointRef?: string;
  stalledBranches: Array<{
    branchId: string;
    memberKey: string;
    status: string;
    attempt: number;
    startedAt?: string;
    lastEventAt?: string;
    lastError?: string;
    leafSessionRef?: { sessionId: string; continuationRef?: string; providerResponseId?: string };
    outputRef?: string;
    consumedByMerge: boolean;
  }>;
  blockedReason?: 'permission' | 'budget' | 'validator' | 'tool-failure' | 'timeout' | 'unknown';
  budgetState?: { budgetId: string; usedTokens: number; limitTokens: number; state: 'ok' | 'near-limit' | 'exceeded' };
  permissionState?: { requiredClass?: string; state: 'allowed' | 'needs-approval' | 'denied' };
}
```

### 5.2 新增前端文件

```
packages/web/src/
├── pages/
│   └── DispatchPage.tsx
└── components/dispatch/
    ├── WorkflowGraph.tsx
    ├── CheckpointTimeline.tsx
    ├── BranchLedgerTable.tsx
    └── CheckpointDebugDrawer.tsx
```

### 5.3 Workflow 图布局

图必须呈现 fork-and-merge：

```text
          ┌── branch A ──┐
  fork ──┼── branch B ──┼── merge
          └── branch C ──┘
```

- branch 节点平行排列，不得暗示 branch-to-branch handoff。
- merge 节点位于所有 branch 下游同一汇聚点。
- 节点颜色按状态区分：pending、running、completed、failed、timed-out、merge-consumed。
- stalled branch 使用状态标记和 tooltip，但不提供重跑按钮。

### 5.4 Debug drawer

Debug drawer 展示原始 checkpoint JSON，至少分区：

- `rawContextRefs`
- `sceneDescriptor` / `routingDecision`
- `branchState.branches`
- `branchState.merge`
- `leafSessionRefs`
- `budgetState` / `permissionState`（若存在）

## 6. Acceptance Criteria / 验收标准

- AC1: 给定 team workflow，DispatchPage 应以 fork-and-merge 拓扑展示 branch 和 merge，不形成 chain 布局。（对应 R5）
- AC2: 给定 workflow detail，页面应展示 checkpoint 时间线、branch ledger、merge envelope 和 leafSessionRefs。（对应 R3-R4、R7）
- AC3: 给定含 stalled branch 的 workflow，页面应突出该 branch，并展示 branch ledger、leafSessionRef、lastError 和最近 checkpoint 时间。（对应 R6）
- AC4: 给定因预算或权限阻断的 workflow，页面应标记为需要人类介入，并展示阻断原因；不得直接执行 approve/continue/stop。（对应 R8）
- AC5: 给定 checkpoint，Debug drawer 应展示完整结构化 JSON，并区分 rawContextRefs、branch ledger、merge envelope、budget/permission summary。（对应 R7）
- AC6: FEAT-018 实现 diff 中不得新增 Memory、Skills 或 Providers REST contract。（对应 R9）

## 7. Test Plan / 测试计划

- 后端 API 测试：workflow list/detail/checkpoints read model，stalled branch、blocked reason、checkpoint JSON。
- 前端组件测试：WorkflowGraph fork-and-merge 布局、BranchLedgerTable、CheckpointDebugDrawer。
- 约束测试：FEAT-018 不注册 `/api/v1/memory*`、`/api/v1/skills*`、`/api/v1/providers*`。
- E2E smoke：打开 DispatchPage，选择含 branch ledger 的 workflow，查看 checkpoint debug drawer。

## 8. Open Questions / 待定问题

全部已关闭。2026-04-25 决策：FEAT-018 拆分，当前 spec 只做 Orchestration Debugger；Knowledge/Skills 和 Logs/Provider/Monitor 分别进入 FEAT-024、FEAT-025。

## 9. Changelog / 变更记录

- 2026-04-23: whiteParachute — 初稿 draft
  - 从原 FEAT-015 大 spec 中拆分出 Orchestration & Observability 子 FEAT。
  - 聚焦 Dispatch、Knowledge、Skills、Logs、InvokeAgent、Monitor 六大页面。
- 2026-04-23: review fix — R2 补充 Memory 写入 scope 限制（禁止写入 platform/）；Open Questions 清零（workflow 只读、系统资源 placeholder）。
- 2026-04-25: roadmap adjustment — 参考 LangGraph / CrewAI 增加 orchestration debugger、stalled branch、checkpoint debug drawer、budget/permission 摘要；因新增 Requirement，status 从 approved 回退为 draft。
- 2026-04-25: owner split — 按 owner 指示拆分 FEAT-018；本 spec 收窄为 Orchestration Debugger，Knowledge/Skills 拆到 FEAT-024，Logs/Provider/Monitor 拆到 FEAT-025。
- 2026-04-26: owner approved — whiteParachute 确认 Open Questions 已解决，status: draft → approved；下一步可按当前 Orchestration Debugger 范围进入实现。
