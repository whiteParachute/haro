---
id: FEAT-034
title: 流式 UX 升级（thinking / tool timeline / GFM）
status: draft
phase: phase-1.5
owner: whiteParachute
created: 2026-05-01
updated: 2026-05-01
related:
  - ../phase-1/FEAT-016-web-dashboard-agent-interaction.md
  - ../phase-1/FEAT-018-web-dashboard-orchestration-observability.md
  - ../phase-1/FEAT-025-web-dashboard-runtime-monitoring.md
  - ../phase-1.5/FEAT-031-web-channel.md
  - ../phase-1.5/FEAT-032-mcp-tool-layer.md
  - ../../docs/architecture/overview.md
  - ../../docs/planning/redesign-2026-05-01.md
---

# 流式 UX 升级（thinking / tool timeline / GFM）

## 1. Context / 背景

Haro Phase 1 Web Dashboard 的 ChatPage 已经能流式显示 agent 输出，但**只展示了"主消息流"**，把 agent 工作过程的几个高价值信号丢掉了：

- **Extended Thinking**：Codex / Claude 输出的"思考"段被丢弃或不分类，用户看不到 agent 怎么推理的
- **Tool 调用全过程**：当前只显示工具结果，看不到 tool name / 参数 / 耗时 / 嵌套层级 / Hook 状态（PreToolUse/PostToolUse）
- **Markdown 渲染**：表格、代码块语法高亮、图片预览（lightbox）等 GFM 能力残缺

happyclaw 在这一层做得很完整：thinking 折叠面板 + 工具调用 timeline（最近 30 个调用快查）+ Hook 执行状态 + GFM 完整渲染。Haro Phase 1.5 自用底座补完必须把这一层补到日用够用的水平，否则 owner 用 Web Dashboard 时会感觉信息密度低、调试链路断。

## 2. Goals / 目标

- G1: ChatPage 主消息流之外，新增 **Thinking 折叠面板**，按消息粒度展示扩展思考内容。
- G2: 新增 **Tool Call Timeline**：当前 session 最近 N 个工具调用（默认 30），含 name / 参数摘要 / 耗时 / 嵌套层级 / Hook 状态。
- G3: Markdown 渲染升级到 GFM 完整：表格、代码块（syntax highlighting）、图片 lightbox、链接预览、列表 / 引用嵌套。
- G4: 流式 SSE / WS 事件协议显式区分 12 类 StreamEvent（thinking_delta / tool_call_start / tool_call_end / hook_pre / hook_post / message_delta / ...），不再用一个混沌的 text stream。
- G5: 该升级必须同时惠及 Web Channel（FEAT-031）和 Web Dashboard 既有 ChatPage 的两个使用面。
- G6: 性能：1000 条消息 / 100 个工具调用的 session，前端渲染主流程 P95 < 200ms（virtualized list / pagination）。

## 3. Non-Goals / 不做的事

- 不实现 PWA / 离线模式 / 移动端专属适配（自用单机不需要）。
- 不实现自定义主题 / 模板系统（owner 不要花在这上面）。
- 不引入富文本编辑器；输入框仍是 plain textarea + Markdown 提示。
- 不实现实时 collaborative editing（无多用户同时编辑同一 session 的需求）。
- 不引入新的渲染框架；继续用 React 19 + 既有 Tailwind + shadcn/ui。

## 4. Requirements / 需求项

- R1: 流式事件协议必须显式枚举 StreamEvent 类型至少 12 类：`message_delta` / `message_done` / `thinking_delta` / `thinking_done` / `tool_call_start` / `tool_call_end` / `hook_pre` / `hook_post` / `tool_call_error` / `usage_update` / `error` / `session_status`。
- R2: 后端（agent runtime → web-api）必须按 R1 输出结构化事件，不允许把 thinking 与 message 混入同一 text 流。
- R3: 前端 Chat 组件必须按事件类型分轨渲染：主消息流 + thinking 折叠面板 + tool timeline。
- R4: Thinking 面板默认折叠；展开后按 message 粒度对齐，可独立滚动；character-by-character 推送时无明显闪烁。
- R5: Tool Call Timeline 必须支持嵌套展示（agent 调用工具 A，A 内部又调用 B）；至少 3 层嵌套；超出层级折叠。
- R6: Hook 状态展示：PreToolUse 显示 → 等待 → PostToolUse 完成 / 失败；状态色用 shadcn/ui 既有 token，不引入新色板。
- R7: GFM 渲染至少覆盖：表格（含对齐）、行内 / 块代码（自动语言识别 + 高亮）、图片（点击 lightbox）、有序 / 无序列表（嵌套）、引用块、horizontal rule、删除线、任务列表 checkbox。
- R8: 代码块必须支持复制按钮、行号、语言标签；超过 50 行自动折叠。
- R9: 1000 条消息 session 用 virtualized list 渲染，向上滚动按页加载历史，不阻塞主线程超过 50ms。
- R10: Web Channel（FEAT-031）的 history 加载与 streaming 推送共享同一套渲染管线。

## 5. Design / 设计要点

### 5.1 StreamEvent 协议

```ts
type StreamEvent =
  | { kind: 'message_delta'; messageId: string; delta: string }
  | { kind: 'message_done'; messageId: string; finalContent: string }
  | { kind: 'thinking_delta'; messageId: string; delta: string }
  | { kind: 'thinking_done'; messageId: string; finalContent: string }
  | { kind: 'tool_call_start'; callId: string; parentCallId?: string; tool: string; paramsSummary: string }
  | { kind: 'tool_call_end'; callId: string; status: 'success' | 'error'; durationMs: number; resultSummary?: string; errorCode?: string }
  | { kind: 'tool_call_error'; callId: string; errorCode: string; message: string; retryable: boolean }
  | { kind: 'hook_pre'; callId: string; hook: string; status: 'pending' | 'allowed' | 'blocked' }
  | { kind: 'hook_post'; callId: string; hook: string; status: 'success' | 'error' }
  | { kind: 'usage_update'; sessionId: string; tokens: { input: number; output: number; total: number } }
  | { kind: 'session_status'; sessionId: string; status: 'idle' | 'running' | 'completed' | 'errored' }
  | { kind: 'error'; code: string; message: string; recoverable: boolean };
```

### 5.2 前端组件结构

```
ChatPage
  ├─ MessageStream (virtualized)
  │    └─ MessageBubble
  │         ├─ MarkdownRenderer (GFM)
  │         ├─ ThinkingPanel (折叠)
  │         └─ AttachmentList (image lightbox / file links)
  ├─ ToolTimeline (右侧抽屉)
  │    └─ ToolCallItem (递归嵌套)
  │         ├─ HookBadge (pre / post)
  │         ├─ ParamsSummary
  │         └─ DurationBadge
  └─ ComposerArea
```

### 5.3 渲染依赖

- `react-markdown` + `remark-gfm` + `rehype-highlight`（语言高亮，使用 `highlight.js` 全量包过大 → 按需注册常用语言）
- `react-window` 做 virtualized list；自实现 image lightbox（避免引入 react-photo-view 等大依赖）
- 折叠 / 展开使用 shadcn/ui `Collapsible` 组件

### 5.4 后端事件源改造

- `packages/provider-codex` 需要解析 Codex SDK 的 reasoning / message / tool 段，按 R1 协议输出
- `agent-runtime` 中的 hook 执行点（PreToolUse / PostToolUse）必须发 `hook_pre` / `hook_post` 事件
- web-api 路由 `/api/v1/sessions/:id/stream` 把事件直传 WS，不再做内容裁剪

## 6. Acceptance Criteria / 验收标准

- AC1: 一次包含 thinking 的对话，ChatPage 主流只显示 message，不再混入 reasoning；thinking 在折叠面板里完整可读（对应 R2、R3、R4）。
- AC2: agent 一次调用工具 A，A 调用 B，B 调用 C，timeline 显示三层嵌套并正确折叠（对应 R5）。
- AC3: agent 触发 PreToolUse hook 后阻塞 0.5s 才放行，timeline 显示 "pending → allowed" 状态变更（对应 R6）。
- AC4: 一段含表格 / 代码块 / 图片的 Markdown，渲染后表格对齐、代码块高亮、图片点击弹 lightbox（对应 R7、R8）。
- AC5: 1000 条历史消息 session 加载完成总耗时 < 1s，初始渲染 P95 < 200ms（对应 R9）。
- AC6: Web Channel session 进入后历史与 ChatPage 体验一致，无渲染差异（对应 R10）。
- AC7: 后端事件协议 12 类 StreamEvent 单测覆盖 ≥ 95%（对应 R1）。

## 7. Test Plan / 测试计划

- 单元测试：StreamEvent type guard / Markdown 渲染快照（每类 GFM 元素一份） / virtualized list 滚动行为。
- 集成测试：模拟 12 类事件序列 → 前端渲染输出对账；hook 状态机迁移；嵌套工具树展开 / 折叠。
- 性能：1000 条消息 + 100 工具调用的 session，CPU profile + 渲染时长基线（写入 perf-budget.json）。
- 视觉回归：Playwright 截图对比 8 个典型场景（plain msg / thinking / tool / nested tool / hook / table / code / image）。
- 兼容性：Chrome / Safari / Firefox 最新两个版本。

## 8. Open Questions / 待定问题

- Q1: 移动端浏览器是否完全不优化？倾向是，但 Tailwind 默认 responsive class 不会成本太高，可顺手保留。
- Q2: Tool timeline 是否需要按工具类型聚合统计（"今天调用 send_message 30 次"）？倾向 Phase 1.5 不做，留给 FEAT-025 Runtime Monitoring 或 Phase 2.0 Self-Monitor。
- Q3: 代码块语言识别失败时 fallback？倾向纯文本展示 + 保留复制按钮。
- Q4: Image lightbox 是否需要支持多图轮播？倾向单图够用，避免引入新依赖。

## 9. Changelog / 变更记录

- 2026-05-01: whiteParachute — 初稿（Phase 1.5 自用底座补完批次 1）
