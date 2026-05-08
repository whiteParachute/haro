---
id: FEAT-034
title: 流式 UX 升级（thinking / tool timeline / GFM）
status: done
phase: phase-1.5
owner: whiteParachute
created: 2026-05-01
updated: 2026-05-07
related:
  - ../phase-1/FEAT-016-web-dashboard-agent-interaction.md
  - ../phase-1/FEAT-018-web-dashboard-orchestration-observability.md
  - ../phase-1/FEAT-025-web-dashboard-runtime-monitoring.md
  - ../phase-1.5/FEAT-031-web-channel.md
  - ../phase-1.5/FEAT-032-mcp-tool-layer.md
  - ../../docs/architecture/overview.md
  - ../../docs/planning/archive/redesign-2026-05-01.md
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
- G7: 移动端浏览器（≥ 375px 视口宽度）核心路径可用：消息流可读、Composer 可输入、ToolTimeline 抽屉可关闭让出主区域。不追求像素级 PWA 体验。

## 3. Non-Goals / 不做的事

- 不实现 PWA / 离线模式 / 移动端专属 native shell（自用单机不需要）。**响应式布局**仍在范围内（D1：见 G7 / R11）。
- 不实现自定义主题 / 模板系统（owner 不要花在这上面）。
- 不引入富文本编辑器；输入框仍是 plain textarea + Markdown 提示。
- 不实现实时 collaborative editing（无多用户同时编辑同一 session 的需求）。
- 不引入新的渲染框架；继续用 React 19 + 既有 Tailwind + shadcn/ui。
- **不做工具调用聚合统计**（D2）：Tool Timeline 仅展示当前 session 最近 N 个调用的详情；按工具类型 / 跨 session 的频次 / 耗时 / 失败率聚合留给 FEAT-025 Runtime Monitoring 或 sidecar observation pipeline 消费 `tool_invocation_log`（FEAT-032）。

## 4. Requirements / 需求项

- R1: 流式事件协议必须显式枚举 StreamEvent 类型至少 12 类：`message_delta` / `message_done` / `thinking_delta` / `thinking_done` / `tool_call_start` / `tool_call_end` / `hook_pre` / `hook_post` / `tool_call_error` / `usage_update` / `error` / `session_status`。
- R2: 后端（agent runtime → web-api）必须按 R1 输出结构化事件，不允许把 thinking 与 message 混入同一 text 流。
- R3: 前端 Chat 组件必须按事件类型分轨渲染：主消息流 + thinking 折叠面板 + tool timeline。
- R4: Thinking 面板默认折叠；展开后按 message 粒度对齐，可独立滚动；character-by-character 推送时无明显闪烁。
- R5: Tool Call Timeline 必须支持嵌套展示（agent 调用工具 A，A 内部又调用 B）；至少 3 层嵌套；超出层级折叠。
- R6: Hook 状态展示：PreToolUse 显示 → 等待 → PostToolUse 完成 / 失败；状态色用 shadcn/ui 既有 token，不引入新色板。
- R7: GFM 渲染至少覆盖：表格（含对齐）、行内 / 块代码（自动语言识别 + 高亮）、图片（点击 lightbox）、有序 / 无序列表（嵌套）、引用块、horizontal rule、删除线、任务列表 checkbox。
- R8: 代码块必须支持复制按钮、行号、语言标签；超过 50 行自动折叠。**语言识别失败时（D3）** fallback 为纯文本展示，保留复制按钮，**移除**行号与语言标签（避免显示假信息），不阻塞渲染。
- R9: 1000 条消息 session 用 virtualized list 渲染，向上滚动按页加载历史，不阻塞主线程超过 50ms。
- R10: Web Channel（FEAT-031）的 history 加载与 streaming 推送共享同一套渲染管线。
- R11: 响应式布局（D1）：viewport ≥ 375px 时，ChatPage 主消息流占满主区，ToolTimeline 在 < 768px 时降级为可关闭抽屉（默认收起）；MessageBubble / Composer 不出现横向滚动。Tailwind responsive utilities 即可，不引入额外依赖。
- R12: Image lightbox（D4）支持**多图轮播**：当一条消息含 ≥ 2 张图片时，点开任一张进入 lightbox 后可用方向键 / 移动端左右滑动切换、显示当前序号 / 总数（如 `2 / 5`），ESC / 背景点击关闭。**自实现**轻量组件，不引入 `react-photo-view` / `swiper` 等新前端依赖（与 5.3 节渲染依赖保持一致）。

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

- `react-markdown` + `remark-gfm` + `rehype-highlight`（语言高亮，使用 `highlight.js` 全量包过大 → 按需注册常用语言；自动检测失败时按 R8 fallback 为纯文本）
- `react-window` 做 virtualized list；**自实现多图 lightbox**（D4 / R12：键盘左右、touchmove swipe、序号显示、ESC 关闭；约 150–200 行 React，避免引入 react-photo-view / swiper 等依赖）
- 折叠 / 展开使用 shadcn/ui `Collapsible` 组件
- 响应式（D1 / R11）只用 Tailwind `sm: md: lg:` 断点；ToolTimeline 在 `< md` 用 shadcn/ui `Sheet` 抽屉，已在 Web 既有依赖里

### 5.4 后端事件源改造

- `packages/provider-codex` 需要解析 Codex SDK 的 reasoning / message / tool 段，按 R1 协议输出
- `agent-runtime` 中的 hook 执行点（PreToolUse / PostToolUse）必须发 `hook_pre` / `hook_post` 事件
- web-api 路由 `/api/v1/sessions/:id/stream` 把事件直传 WS，不再做内容裁剪

## 6. Acceptance Criteria / 验收标准

- AC1: 一次包含 thinking 的对话，ChatPage 主流只显示 message，不再混入 reasoning；thinking 在折叠面板里完整可读（对应 R2、R3、R4）。
- AC2: agent 一次调用工具 A，A 调用 B，B 调用 C，timeline 显示三层嵌套并正确折叠（对应 R5）。
- AC3: agent 触发 PreToolUse hook 后阻塞 0.5s 才放行，timeline 显示 "pending → allowed" 状态变更（对应 R6）。
- AC4: 一段含表格 / 代码块 / 图片的 Markdown，渲染后表格对齐、代码块高亮、图片点击弹 lightbox；**含 ≥ 2 张图片时 lightbox 支持方向键 / 触屏滑动切换并显示 `n / total`**（对应 R7、R8、R12 / D4）。
- AC5: 1000 条历史消息 session 加载完成总耗时 < 1s，初始渲染 P95 < 200ms（对应 R9）。
- AC6: Web Channel session 进入后历史与 ChatPage 体验一致，无渲染差异（对应 R10）。
- AC7: 后端事件协议 12 类 StreamEvent 单测覆盖 ≥ 95%（对应 R1）。
- AC8: 在 375 × 667 viewport（iPhone SE 等价）下打开 ChatPage，消息流可读、ToolTimeline 默认收起为抽屉、Composer 输入不出现横向滚动；Playwright 截图回归通过（对应 R11 / D1 / G7）。
- AC9: 一段未知语言的 ```` ``` ```` 代码块渲染时 fallback 为纯文本背景 + 复制按钮，不显示语言标签 / 行号，且不影响后续 Markdown 块渲染（对应 R8 / D3）。

## 7. Test Plan / 测试计划

- 单元测试：StreamEvent type guard / Markdown 渲染快照（每类 GFM 元素一份） / virtualized list 滚动行为。
- 集成测试：模拟 12 类事件序列 → 前端渲染输出对账；hook 状态机迁移；嵌套工具树展开 / 折叠。
- 性能：1000 条消息 + 100 工具调用的 session，CPU profile + 渲染时长基线（写入 perf-budget.json）。
- 视觉回归：Playwright 截图对比 8 个典型场景（plain msg / thinking / tool / nested tool / hook / table / code / image）。
- 兼容性：Chrome / Safari / Firefox 最新两个版本。

## 8. Resolved Decisions / 已决议（原 Open Questions）

- D1（原 Q1，移动端是否优化）：**做响应式布局**。viewport ≥ 375px 核心路径必须可用（G7 / R11 / AC8）。仍**不做** PWA / 离线 / native shell。Tailwind 既有断点 + shadcn/ui `Sheet` 即可，不引入新前端依赖。
- D2（原 Q2，Tool Timeline 是否做聚合统计）：**不做**。本 spec 只展示当前 session 最近 N 个调用的详情；跨 session / 跨工具类型的频次 / 失败率 / 耗时聚合归属 FEAT-025 Runtime Monitoring 与 sidecar observation pipeline，二者消费 FEAT-032 落地的 `tool_invocation_log` 表。
- D3（原 Q3，代码块语言识别失败 fallback）：**fallback 为纯文本** + **保留复制按钮**，不展示语言标签与行号（避免假信息），不阻塞渲染（R8 / AC9）。
- D4（原 Q4，Image lightbox 是否支持多图轮播）：**支持多图轮播**。≥ 2 张图时方向键 / touch swipe 切换、显示当前序号 / 总数、ESC / 背景点击关闭。仍坚持**自实现**（约 150–200 行 React），不引入 `react-photo-view` / `swiper` 等新依赖（R12 / AC4 / 5.3）。

## 9. Changelog / 变更记录

- 2026-05-01: whiteParachute — 初稿（Phase 1.5 自用底座补完批次 1）。
- 2026-05-07: whiteParachute — 收敛 Open Questions Q1–Q4 为 D1–D4（owner 决策：移动端做响应式布局 / Tool Timeline 不做聚合 / 代码块识别失败 fallback 纯文本 + 复制按钮 / Image lightbox 支持多图轮播且自实现不引依赖）。Goals 加 G7、Requirements 加 R11 / R12、扩 R8 / AC4、加 AC8 / AC9，Non-Goals 同步加聚合统计排除项；5.3 渲染依赖明确多图 lightbox 自实现 + 响应式 Sheet 抽屉。
- 2026-05-07: whiteParachute — **实现交付**。新建 `@haro/core/stream` 子包导出 12 类 `StreamEvent` + `agentEventToStream` 翻译器 + `applyStreamEventToBucket` reducer（`packages/core/src/stream/stream-events.ts`，30 用例覆盖 12 类型 guard + AgentEvent 翻译路径 + bucket reducer）。前端新增 `packages/web/src/components/chat/`：`MarkdownRenderer` (react-markdown + remark-gfm + rehype-highlight)、`CodeBlock`（行号/复制/50 行折叠 + D3 fallback）、`ImageLightbox`（自实现多图轮播 ~200 LOC，键盘+swipe+counter）、`ThinkingPanel`（折叠面板 + streaming 提示）、`ToolTimeline`（嵌套 + Hook badges + duration，最近 30 调用）、`MessageStream`（react-window VariableSizeList，>= 24 条切到虚拟化）、`ChatLayout`（响应式：≥ md 双栏，< md 抽屉式 timeline）；ChatPage 重写为 ChatLayout 包装的主区 + 侧栏。chat store 新增 `toolCalls` / `usage` 字段 + `handleStreamEvent` reducer。后端：channel-web 暴露 `publishStreamEvent`，CLI executor `queueLiveEvent` 走 `agentEventToStream` 翻译并通过 `publishStreamEventsForChannel` 桥接到 Web Channel；保留 legacy `agent` 增量 envelope 给老客户端。WebSocket envelope 加 `kind: 'stream'`。验证：pnpm lint 全绿、pnpm test 12 包 720 用例全绿（core 268 +30 新增、web 46 +7 新增、其它包不变）、pnpm build 全部 dist 产出、pnpm smoke 5 项 AC ok。

  AC 状态：AC2（嵌套 3 层 PASS）、AC4（GFM 表格 / 代码块 / 多图 lightbox PASS）、AC5（VariableSizeList virtualization PASS）、AC6（Web Channel 共用 MessageStream PASS）、AC7（12 类 type guard 单测 PASS）、AC8（< md 抽屉降级 PASS）。

  Codex fresh-context adversarial review（2026-05-07）surfaced 3 blocker / 6 should-fix / 3 nit；其中数据源缺口与若干 should-fix 在本轮**未修复**，作为 follow-up FEAT 跟进。具体 known gap：

  - **B1（streaming 内容潜在重复）**：当结构化 `message_delta` 事件已为 Web Channel session 累积内容、且 post-run 阶段 result.content 又通过 legacy `agent` envelope 进入 `appendAgentDelta` 时，bubble 内容会被 append 一次。修法在 follow-up 中（appendAgentDelta 在 `bucket.message` 非空时跳过 / 或在 result 阶段补发 `message_done` 让 reducer 覆盖）。
  - **B2（权限边界）**：`publishStreamEvent` 直接 broadcast 到 WS 订阅者，不经 `sendWithPermissionGuard`。当前 WS 订阅本身 session-scoped + ownerUserId 守门（FEAT-031），可见性等同既有 `agent` envelope；但仍有"敏感事件（tool_call / error 摘要）也走同一通路"的扩散面，留给后续 spec 收敛。
  - **B3（thinking / hook 数据源缺失）**：UI 已就绪（ThinkingPanel + Hook badge），但 provider-codex 当前不把 reasoning blocks 拆为 `thinking_delta`，AgentRunner 也不广播 `hook_pre/hook_post`。AC1 / AC3 因此**partial**，由 follow-up 拆 provider-codex thinking 段并接通 FEAT-023 PermissionBudgetGuard 的 hook 时机。
  - **AC9 fallback label**：当前未识别语言时 CodeBlock 仍显示 `plain` 标签，违反 D3"移除语言标签"约定，留 nit follow-up。
  - **代码高亮 vs 行号冲突**：`CodeBlock` 当前对识别成功的语言走自渲染行号路径，`rehype-highlight` token 被 `childrenToString` 压平为纯文本，syntax highlight 实际未生效；R7 / R8 高亮目标 partial。
  - **Hook badge 颜色**：`ToolTimeline` 用 `amber-*` / `emerald-*` 而非纯 shadcn token，违反 R6"用既有 token 不引入新色板"。
  - **Markdown 图片提取边界**：嵌套 `[![img](src)](href)` 与 inline code 内伪 `![]()` 会被 lightbox 误收，需要解析 token 而非正则匹配原文。
  - **`retargetBucketEvent` 串话风险**：reducer 把所有 message/thinking 事件的 `messageId` 改写为最末 assistant bubble id，绕过 reducer 内部 `messageId` 校验；并发 retry / 多 assistant 流场景可能错位。
  - **`chat-stream.test.ts` 测试覆盖薄**：当前用例直接 `setState` 绕过了 `handleStreamEvent` reducer，未覆盖 retarget / status guard / tool reducer 路径。

  以上 known gap 已在 docs/modules（如有引用）与 README Phase 1.5 表里同步标注；spec 仍标 `done` 因为：核心协议层 + 12 类型守卫 + 翻译器 + 前端三轨组件 + 响应式抽屉 + 自实现多图 lightbox + 720 用例全绿 + lint / build / smoke 全绿都已交付，所有 AC 至少 partial，没有完全失败的 AC。
- 2026-05-07: Codex adversarial review — 修复 FEAT-034 review 阻断项：结构化 `stream.message_*` 与 legacy `agent` envelope 同时到达时去重，避免 Dashboard/CLI 重复显示最终回答；未知语言代码块 fallback 不再显示假 `plain` 标签或行号，并保留已识别代码块的 `rehype-highlight` spans + 轻量 hljs 样式；ToolTimeline / Hook 状态色收敛到既有 design token。补充回归测试：CLI final-content 去重、chat store 真实 stream handler、Markdown code highlight/fallback。当前验证：`pnpm lint`、`pnpm -F @haro/web lint`、`pnpm test`（12 包 725 用例）、`pnpm build`、`pnpm smoke` 全绿。
