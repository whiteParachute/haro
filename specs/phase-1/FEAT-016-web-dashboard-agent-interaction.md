---
id: FEAT-016
title: Web Dashboard — Agent Interaction（Agent 交互）
status: in-progress
phase: phase-1
owner: whiteParachute
created: 2026-04-23
updated: 2026-04-24
related:
  - ../design-principles.md
  - ../multi-agent-design-constraints.md
  - ./FEAT-015-web-dashboard-foundation.md
  - ./FEAT-013-scenario-router.md
  - ./FEAT-014-team-orchestrator.md
  - ../../docs/modules/agent-runtime.md
---

# Web Dashboard — Agent Interaction（Agent 交互）

## 1. Context / 背景

FEAT-015 已完成 Dashboard 基础框架（前端包 + Hono 后端 + `haro web` 命令 + 占位首页）。本 FEAT 在框架之上实现**Agent 交互层**——这是 Dashboard 的核心用户场景，替代 CLI REPL 的交互体验。

Agent 交互层需要解决的关键问题：
- 用户如何通过浏览器与 Agent 进行对话式交互
- Agent 事件流（text delta、tool_call、tool_result、result、error）如何实时推送到前端
- Session 历史如何分页展示和详情回溯

## 2. Goals / 目标

- G1: 实现 ChatPage，支持发送消息、接收流式 Agent 事件、展示完整对话历史
- G2: 实现 WebSocket 服务，支持 Agent 执行事件的实时双向推送
- G3: 实现 SessionsPage 和 SessionDetailPage，支持分页浏览和事件时间线回溯
- G4: 后端提供 Agents 和 Sessions 两大领域的 REST API
- G5: 遵循 P5（Progressive Disclosure）原则——列表默认精简、事件按需展开

## 3. Non-Goals / 不做的事

- 不实现 Status、Settings 等系统管理页面（属于 FEAT-017）
- 不实现 Team Orchestrator 可视化（属于 FEAT-018）
- 不实现 Memory / Skills / Provider 相关 API（属于 FEAT-018）
- 不修改 AgentRunner 核心执行逻辑
- 不引入新的 leaf executor

## 4. Requirements / 需求项

- R1: WebSocket 端点 `/ws` 支持 `authenticate`、`chat.start`、`chat.message`、`chat.cancel`、`subscribe` 客户端消息。
- R2: WebSocket 服务端推送 `authenticated`、`event.stream`、`event.result`、`event.error`、`session.update` 消息类型。
- R3: Agent 执行流必须通过 WebSocket 实时推送；不允许前端轮询获取执行状态。
- R4: WebSocket 连接断开后自动重连，重连间隔指数退避（1s → 2s → 4s ... 最大 30s）。
- R5: REST API 覆盖 Agents 领域：
  - `GET /api/v1/agents`：返回 Agent 摘要列表（`id`, `name`, `summary`, `defaultProvider`, `defaultModel`）。`summary` 为只读 read-model 字段，由 `systemPrompt` 派生，不是 YAML/`AgentConfig` 字段。
  - `GET /api/v1/agents/:id`：返回指定 Agent 的结构化详情（`id`, `name`, `summary`, `systemPrompt`, `tools`, `defaultProvider`, `defaultModel`）。**完整 YAML 原文与写入端点见 FEAT-019。**
  - `POST /api/v1/agents/:id/run`：触发一次新的 Agent 执行，返回 `sessionId`，后续事件通过 WebSocket 推送。
  - `POST /api/v1/agents/:id/chat`：基于已有 session 发送后续消息（非首次启动场景），返回 `sessionId`，事件仍通过 WebSocket 推送。
- R6: REST API 覆盖 Sessions 领域：`GET /api/v1/sessions`（分页）、`GET /api/v1/sessions/:id`、`GET /api/v1/sessions/:id/events`、`DELETE /api/v1/sessions/:id`。
- R7: ChatPage 支持 Agent 选择器、Provider/Model 选择器、slash 命令（`/new`、`/retry`、`/agent`、`/model`）。
- R8: SessionDetailPage 展示完整事件时间线：text delta 折叠为消息、tool_call/tool_result 默认收起详细参数。
- R9: SessionsPage 默认仅展示 id、状态、时间、摘要，支持分页和即时筛选。
- R10: Chat 页面加载时只拉取最近 N 条消息，历史消息通过滚动加载或"加载更多"触发。

## 5. Design / 设计要点

### 5.1 WebSocket 协议

**客户端 → 服务端：**
```typescript
type ClientMessage =
  | { type: 'authenticate'; token: string }
  | { type: 'chat.start'; agentId: string; provider?: string; model?: string }
  | { type: 'chat.message'; sessionId: string; content: string }
  | { type: 'chat.cancel'; sessionId: string }
  | { type: 'subscribe'; channel: 'system' | 'sessions' | 'gateway' };
```

**服务端 → 客户端：**
```typescript
type ServerMessage =
  | { type: 'authenticated'; ok: boolean }
  | { type: 'event.stream'; sessionId: string; event: AgentEvent }
  | { type: 'event.result'; sessionId: string; result: RunAgentResult }
  | { type: 'event.error'; sessionId: string; error: string }
  | { type: 'session.update'; sessionId: string; status: string }
  | { type: 'system.status'; metrics: SystemMetrics };

type SystemMetrics = {
  activeSessions: number;
  dbConnections: number;
  gatewayConnected: boolean;
  uptimeSeconds: number;
};
```

**流式执行机制：**
服务端调用 `app.runner.run()`，通过 `onEvent` 回调将每个 `AgentEvent` 实时推送到 WebSocket。`WebSocketManager` 维护 `sessionId -> Set<WS>` 映射，支持多客户端同时观察同一 session。

**Observability（P7）：**
所有 WebSocket 事件通过 `createLogger()` 记录：`eventType`、`sessionId`、`clientCount`。

### 5.2 新增后端文件

```
packages/cli/src/web/
├── websocket/
│   ├── manager.ts    # WS 连接管理 + 重连逻辑
│   ├── streamer.ts   # Agent 事件流推送
│   └── types.ts      # WS 消息类型定义
└── routes/
    ├── agents.ts     # Agent 执行 REST
    └── sessions.ts   # Session CRUD + events
```

### 5.3 新增前端文件

```
packages/web/src/
├── api/
│   └── ws.ts            # WebSocket manager（含自动重连）
├── stores/
│   ├── chat.ts          # Chat 状态管理
│   └── sessions.ts      # Sessions 状态管理
├── pages/
│   ├── ChatPage.tsx
│   ├── SessionsPage.tsx
│   └── SessionDetailPage.tsx
└── components/
    └── chat/
        ├── ChatContainer.tsx
        ├── MessageBubble.tsx
        ├── ChatInput.tsx
        └── StreamingText.tsx
```


### 5.4 Progressive Disclosure（P5 落地）

- **Sessions 列表**：默认展示 `sessionId`、`agentId`、`status`、`createdAt` 四列，其余字段点击展开
- **事件时间线**：连续的 text delta 事件默认折叠为一条消息；tool_call / tool_result 默认收起 JSON 参数，点击展开
- **Chat 上下文**：加载时只拉取最近 20 条消息，历史消息通过滚动触发无限加载


### 5.5 Agent REST read-model 合约（与 FEAT-004/019 对齐）

FEAT-016 的 Agents REST 端点只服务 ChatPage 的 Agent 选择与运行入口，不负责 YAML CRUD。它暴露的是从 `AgentRegistry`/`AgentConfig` 投影出的**只读 read-model**：

```typescript
type AgentSummary = {
  id: string;
  name: string;
  summary: string; // derived, readonly
  defaultProvider?: string;
  defaultModel?: string;
};

type AgentDetail = AgentSummary & {
  systemPrompt: string;
  tools?: readonly string[];
};
```

`summary` 派生规则：取 `systemPrompt` 去首尾空白后的第一段非空文本，压缩连续空白，最多 160 字符；为空时回退为 `name`。该字段仅用于展示，不写回 YAML，不参与 `AgentConfig` Zod schema。API 不返回也不接受 `description` 或单 Agent `type` 字段，避免与 FEAT-004 `.strict()` schema 形成 Web-only 扩展。

未知字段策略：FEAT-016 不提供 Agent 配置写入；任何运行/聊天 request body 的未知字段按该端点自己的 Zod request schema `.strict()` 拒绝。Agent YAML 的未知字段处理以 FEAT-004/FEAT-019 为准。

## 6. Acceptance Criteria / 验收标准

- AC1: Chat 页面可发送消息，通过 WebSocket 实时接收 Agent 事件流（text delta、tool_call、tool_result），最终收到 result 或 error。
- AC2: Sessions 页面可分页列出所有 sessions，支持按状态/Agent/时间范围筛选。
- AC3: 点击 Session 可进入 SessionDetail，查看完整事件时间线，text delta 折叠显示，tool 事件可展开。
- AC4: WebSocket 断开后 1s 自动重连，成功后恢复未完成的 session 观察。
- AC5: `POST /api/v1/agents/:id/run` 返回 sessionId，后续事件通过 WebSocket 推送。
- AC6: `DELETE /api/v1/sessions/:id` 正确删除 session 及其事件。
- AC7: 后端所有 REST 端点返回正确的 HTTP 状态码和 JSON 结构；认证失败返回 401。
- AC8: `GET /api/v1/agents` 与 `GET /api/v1/agents/:id` 返回 `summary` read-model 字段，且不返回 `description`/单 Agent `type`；`summary` 与 `systemPrompt` 派生规则一致。

## 7. Test Plan / 测试计划

- WebSocket 集成测试：启动测试服务器，用 `ws` 客户端验证消息协议和重连逻辑
- Agent 流式测试：模拟 `AgentRunner.run()`，验证事件按序推送
- 前端组件测试：ChatContainer、MessageBubble、StreamingText 的渲染和交互
- E2E：Playwright 覆盖 "发送消息 → 接收流式回复 → 查看 session 历史" 完整流程

## 8. Open Questions / 待定问题

- ~~Q1: Chat 页面的 Agent 选择器是否需要在 localStorage 中持久化用户最近选择的 Agent/Provider/Model 组合？~~ **决策：是。** 持久化最近选择的 `agentId` + `providerId` + `modelId`，key 为 `haro:lastChatConfig`，下次打开 ChatPage 自动恢复。
- ~~Q2: Session 事件时间线中，tool_result 的 JSON 输出是否需要格式化/语法高亮？~~ **决策：是。** tool_result 的 JSON 输出使用 `react-json-view-lite` 做折叠/格式化展示，不引入 Monaco/CodeMirror（太重）。

## 9. Changelog / 变更记录

- 2026-04-23: whiteParachute — 初稿 draft
  - 从原 FEAT-015 大 spec 中拆分出 Agent Interaction 子 FEAT
  - 聚焦 Chat、Sessions、WebSocket 流式协议、Agent/Sessions REST API
- 2026-04-23: review fix — 补充 `system.status` 消息类型；R5 明确 Agent API 返回摘要格式并澄清 `chat` 端点语义；Open Questions 清零（localStorage 持久化选是、JSON 格式化选是）

- 2026-04-24: review fix — Breaking: 解决 B2，FEAT-016 Agents API 改为只读 `AgentSummary`/`AgentDetail` read-model；删除 `description`/单 Agent `type` 合约，新增 `summary` 派生规则与 unknown-field 边界，完整 YAML CRUD 交给 FEAT-019。按 `specs/README.md` 的 approved 合约变更规则，status 回退为 draft，待 owner 重新批准。
- 2026-04-24: owner re-approved — whiteParachute 批准 B2 合约修订，status: draft → approved。
- 2026-04-24: implementation — FEAT-016 进入实现态（status: approved → in-progress）。落地 Agents/Sessions REST read-model、WebSocket `/ws` 协议、Chat/Sessions 前端页面与 AC1-AC8 测试覆盖；保持 AgentRunner 核心语义不变，Dashboard 仅作为产品交互层。
