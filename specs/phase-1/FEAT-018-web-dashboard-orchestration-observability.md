---
id: FEAT-018
title: Web Dashboard — Orchestration & Observability（编排与可观测性）
status: approved
phase: phase-1
owner: whiteParachute
created: 2026-04-23
updated: 2026-04-23
related:
  - ../design-principles.md
  - ../multi-agent-design-constraints.md
  - ../team-orchestration-protocol.md
  - ./FEAT-015-web-dashboard-foundation.md
  - ./FEAT-014-team-orchestrator.md
  - ../../docs/modules/team-orchestrator.md
---

# Web Dashboard — Orchestration & Observability（编排与可观测性）

## 1. Context / 背景

FEAT-015/016/017 已完成 Dashboard 的基础框架、Agent 交互和系统管理。本 FEAT 实现**编排与可观测性页面**——这是 Dashboard 的高级功能层，面向需要深度洞察 Team 协作流程、知识库状态和系统运行细节的用户。

核心场景：
- 查看 Team Orchestrator 的工作流执行图（fork-and-merge 拓扑）
- 浏览和搜索 Memory Fabric 的知识库
- 管理 Skills 的生命周期
- 查看 Session events 和 Provider fallback 日志
- 监控 Provider 调用统计和实时执行状态

## 2. Goals / 目标

- G1: 实现 DispatchPage，可视化展示 Team Orchestrator 的工作流图（fork-and-merge 拓扑）
- G2: 实现 KnowledgePage，支持 Memory Fabric 的搜索、浏览和写入
- G3: 实现 SkillsPage，支持 Skills 的安装、启用、禁用、卸载
- G4: 实现 LogsPage，支持 Session events 和 Provider fallback log 的查询
- G5: 实现 InvokeAgentPage，展示 Provider 调用统计
- G6: 实现 MonitorPage，实时监控活跃 session 和系统资源
- G7: 后端提供 Workflows、Memory、Skills、Providers 四大领域的 REST API

## 3. Non-Goals / 不做的事

- 不实现 Chat、Sessions 等 Agent 交互页面（属于 FEAT-016）
- 不实现 Status、Settings 等系统管理页面（属于 FEAT-017）
- 不实现 Evolution Loop 可视化（属于 Phase 2）
- 不修改 TeamOrchestrator 核心执行逻辑
- 不直接操作 Memory Fabric 文件系统（必须通过 API）

## 4. Requirements / 需求项

- R1: REST API 覆盖 Workflows 领域：`GET /api/v1/workflows`、`GET /api/v1/workflows/:id`、`GET /api/v1/workflows/:id/checkpoints`。
- R2: REST API 覆盖 Memory 领域：
  - `GET /api/v1/memory/query`：按 scope / agentId / 关键词搜索 Memory 条目。
  - `POST /api/v1/memory/write`：写入 Memory 条目。**仅允许写入 `shared/` 和当前 Agent 的 `agents/{agentId}/` scope；`platform/` scope 禁止通过 API 写入。** 写入时必须提供 `source` 字段用于幂等键生成。
  - `GET /api/v1/memory/stats`：返回 Memory Fabric 统计（条目数、scope 分布、最近写入时间）。
  - `POST /api/v1/memory/maintenance`：触发 Memory 维护任务（如归档旧条目），异步执行，返回 taskId。
- R3: REST API 覆盖 Skills 领域：`GET /api/v1/skills`、`GET /api/v1/skills/:id`、`POST /api/v1/skills/:id/enable`、`POST /api/v1/skills/:id/disable`、`POST /api/v1/skills/install`、`DELETE /api/v1/skills/:id`。
- R4: REST API 覆盖 Providers 领域：`GET /api/v1/providers`（列表 + 健康状态）。
- R5: DispatchPage 必须准确展示 Team workflow 的 fork-and-merge 拓扑，禁止渲染为串行 chain 布局（多 Agent 约束②）。
- R6: DispatchPage 展示 workflow checkpoint 时间线、branch ledger 状态、merge envelope 详情。
- R7: KnowledgePage 支持按 scope（platform/agent/shared）、agentId、关键词搜索 Memory 条目。
- R8: SkillsPage 展示每个 skill 的 id、source、enabled 状态、安装时间，支持 enable/disable 切换。
- R9: LogsPage 支持按 sessionId、时间范围、事件类型筛选 session_events；支持查看 provider_fallback_log。
- R10: InvokeAgentPage 展示各 provider 的调用次数、成功率、平均延迟、fallback 次数。
- R11: MonitorPage 订阅 WebSocket `system.status` 和 `session.update` 频道，实时展示活跃 session 列表和系统指标。

## 5. Design / 设计要点

### 5.1 新增后端文件

```
packages/cli/src/web/routes/
├── workflows.ts    # Workflow checkpoint REST
├── memory.ts       # Memory Fabric REST
├── skills.ts       # Skills 管理 REST
└── providers.ts    # Provider 列表 + 健康 REST
```

### 5.2 新增前端文件

```
packages/web/src/
├── pages/
│   ├── DispatchPage.tsx
│   ├── KnowledgePage.tsx
│   ├── SkillsPage.tsx
│   ├── LogsPage.tsx
│   ├── InvokeAgentPage.tsx
│   └── MonitorPage.tsx
└── components/
    ├── dispatch/
    │   ├── WorkflowGraph.tsx
    │   ├── CheckpointTimeline.tsx
    │   └── BranchLedgerTable.tsx
    ├── knowledge/
    │   ├── MemorySearch.tsx
    │   └── MemoryResultCard.tsx
    ├── skills/
    │   ├── SkillCard.tsx
    │   └── SkillInstallDialog.tsx
    ├── logs/
    │   ├── EventFilterBar.tsx
    │   └── EventTable.tsx
    └── monitor/
        ├── LiveSessionMonitor.tsx
        └── GatewayStatusIndicator.tsx
```

### 5.3 DispatchPage — Workflow 可视化（多 Agent 约束② UI 保障）

**图表库约束（Q4 结论）：**
图表库必须原生支持或可通过配置表达 hub-spoke / fork-and-merge 拓扑。候选方案：
- **React Flow**：节点-边模型，可自定义 layout 算法实现 fork-and-merge
- **Mermaid**：原生支持 graph TD（top-down）布局，可表达 fork-and-merge
- **D3**：完全自定义，但开发成本高

**推荐**：React Flow，因其 React 原生集成、可交互节点、支持自定义节点组件（展示 branch status、merge envelope 等）。

**布局要求：**
```
          ┌── branch A ──┐
  fork ──┼── branch B ──┼── merge
          └── branch C ──┘
```
- 所有 branch 节点必须平行排列，不得有任何串行 handoff 的视觉暗示
- merge 节点必须位于所有 branch 节点的下游同一水平线
- 节点颜色按状态区分：pending（灰）、running（蓝）、completed（绿）、failed（红）

### 5.4 KnowledgePage — Memory Fabric 浏览器

**搜索界面：**
- 搜索框 + scope 选择器（platform / agent / shared）
- 结果按 relevance 排序，展示 summary、source、timestamp
- 点击展开完整内容

**写入界面：**
- scope 选择 + agentId 选择 + topic 输入 + content 文本域
- 调用 `POST /api/v1/memory/write`

### 5.5 SkillsPage — Skills 生命周期管理

**列表展示：**
- 每个 skill 卡片展示：id、source、enabled 状态、安装时间、描述摘要
- 支持 enable/disable 即时切换（无需刷新页面）
- 支持从 git URL 安装（调用 `POST /api/v1/skills/install`）

### 5.6 LogsPage — 日志查询器

**Session Events 查询：**
- 筛选条件：sessionId、时间范围、事件类型（text/tool_call/tool_result/result/error）
- 结果以时间线形式展示，支持 JSON 格式化

**Provider Fallback Log：**
- 展示 fallback 事件：原始 provider、fallback provider、原因、时间

### 5.7 InvokeAgentPage — Provider 统计

**统计卡片：**
| 指标 | 数据来源 |
|------|----------|
| 总调用次数 | SQLite `session_events` 中 result 事件计数 |
| 成功率 | 成功 result / 总调用 |
| 平均延迟 | 各 provider 的响应时间统计 |
| Fallback 次数 | `provider_fallback_log` 表计数 |

### 5.8 MonitorPage — 实时监控

**WebSocket 订阅：**
- `subscribe` → `system.status`：系统级指标（DB 连接数、活跃 session 数）
- `subscribe` → `session.update`：session 状态变更通知

**展示内容：**
- 活跃 session 列表（实时更新）
- Gateway 连接状态指示器
- 系统资源指标（CPU/内存 placeholder，后续可扩展）

## 6. Acceptance Criteria / 验收标准

- AC1: DispatchPage 正确展示 Team workflow 的 fork-and-merge 拓扑，branch 节点平行排列，merge 节点在下游同一水平线。
- AC2: DispatchPage 展示 workflow checkpoint 时间线，点击 branch 可查看 ledger 详情。
- AC3: KnowledgePage 可按 scope 和关键词搜索 Memory，结果按 relevance 排序。
- AC4: SkillsPage 可即时 enable/disable skill，安装新 skill 后列表自动刷新。
- AC5: LogsPage 可按 sessionId 和事件类型筛选，展示格式化的事件时间线。
- AC6: InvokeAgentPage 展示各 provider 的调用次数、成功率、平均延迟统计。
- AC7: MonitorPage 实时展示活跃 session 列表，WebSocket 断开后恢复时自动重订阅。

## 7. Test Plan / 测试计划

- Workflow 图测试：验证 React Flow 渲染的节点位置符合 fork-and-merge 拓扑（不形成 chain）
- Memory 搜索测试：验证查询参数正确传递，结果格式符合预期
- Skills 管理测试：enable/disable 切换、安装流程
- E2E：完整流程 "搜索 Memory → 查看 workflow 图 → 检查 provider 统计"

## 8. Open Questions / 待定问题

- ~~Q1: Team workflow 图是否支持交互式操作（如点击 branch 重新执行）？还是仅只读展示？~~ **决策：Phase 1 仅只读展示。** 交互式操作（如重新执行 branch）属于 Phase 2 的 orchestration 增强，当前 FEAT 聚焦可视化呈现。
- ~~Q2: MonitorPage 的系统资源指标（CPU/内存）是否通过 Node.js `process` API 获取，还是仅展示 placeholder？~~ **决策：Phase 1 仅展示 placeholder 卡片。** 系统资源监控需要引入 `os` / `process` 模块做周期性采样，属于独立增强，延后到 Phase 2。

## 9. Changelog / 变更记录

- 2026-04-23: whiteParachute — 初稿 draft
  - 从原 FEAT-015 大 spec 中拆分出 Orchestration & Observability 子 FEAT
  - 聚焦 Dispatch、Knowledge、Skills、Logs、InvokeAgent、Monitor 六大页面
  - 明确 workflow 图可视化必须遵守 fork-and-merge 拓扑约束（多 Agent 约束②）
- 2026-04-23: review fix — R2 补充 Memory 写入 scope 限制（禁止写入 platform/）；Open Questions 清零（workflow 只读、系统资源 placeholder）
