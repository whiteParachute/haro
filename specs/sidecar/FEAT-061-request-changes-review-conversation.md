# FEAT-061 request-changes 对话式修改面板

## 1. 背景

Haro Web 审批页已有 approve / reject / request-changes 三种人审动作。当前 request-changes 只是浏览器 `prompt` 小输入框，用户只能写一行 direction，不能补充大段上下文，也不能和 Haro 继续追问、争论和收敛修改方向。

用户反馈：要求修改提案的弹窗输入框太小，不要用这种输入框形式，应提供类似 agent 对话框的承载，让用户输入大段文字，并与 agent 多轮 argue。

## 2. 目标

- 仅重设计 request-changes 路径，approve / reject 维持现状。
- 用侧滑全屏对话面板替代小输入框。
- 支持大段 Markdown 文本、消息历史、流式回复、滚动到底部。
- 对话原文持久化为独立 artifact。
- 最终提交 request-changes 时，只把摘要写入 approval-decision.direction。
- Agent 只帮助用户澄清修改意见，不能替用户做 approve / reject / apply / rollback。

## 3. 非目标

- 不改 AgentDock、scheduler、ModelHub 配置或 aria-memory。
- 不接入 daily workflow、cron 或自动触发。
- 不让对话直接修改 proposal、validation、approval-request。
- 不新增外部模型供应商或依赖。
- 不改变 approve / reject 的交互和写入语义。

## 4. UX 草图

采用右侧全屏侧滑面板，避免小弹窗限制输入空间。本次按 `web-artifacts-builder` 的复杂 React artifact 工作方式落地在现有 Haro Web 页面中，不额外生成独立 artifact，不新增前端依赖。

```text
┌──────────────────────────────────────────────────────────┐
│ 和 Haro 讨论要怎么改                 [风险] [范围] [关闭] │
├──────────────────┬───────────────────────────────────────┤
│ 提案范围          │ 消息列表                              │
│ 为什么改          │ 你：大段修改意见，可 Markdown          │
│ 怎么改            │ Haro：流式回复，追问或整理方向         │
│ 历史对话数量      │ ... 自动滚动到底部                     │
├──────────────────┴───────────────────────────────────────┤
│ 大文本输入区                                              │
│ [发送给 Haro] [提交要求修改]                              │
└──────────────────────────────────────────────────────────┘
```

交互规则：

1. 点击“要求修改”打开对话面板。
2. 面板加载该 approval-request 最近一次对话；没有则创建新对话。
3. 用户可输入大段 Markdown，点击“发送给 Haro”。
4. Web API 通过 Haro runtime hook 调用 Haro 自身 provider/modelhub 链路，流式返回回复。
5. 用户确认方向后点击“提交要求修改”。
6. Web API 写 approval-decision，decision=request-changes。
7. `direction` 写入对话摘要和 artifact URI，不写完整长对话。

回退开关：构建时设置 `VITE_HARO_LEGACY_REQUEST_CHANGES_PROMPT=1`，前端回到旧 prompt 输入框。生产切换该开关后需要重新 build 并重启 `haro-web.service`。

## 5. 数据模型

新增 artifact 目录：

```text
~/.haro/evolution/approval-conversations/<approvalRequestId>/<conversationId>.json
```

记录结构：

```ts
interface ApprovalConversationRecord {
  id: string;
  associatedApprovalRequestId: string;
  proposalId: string;
  validationId: string;
  messages: ApprovalConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

interface ApprovalConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  metadata?: {
    provider?: string;
    model?: string;
    sessionId?: string;
  };
}
```

写入边界：该 artifact 只记录讨论过程，不改 approval-request / proposal / validation。最终 decision 仍由现有 approval-decision 机制写入。

## 6. Web API

新增只读 / 写入 API：

- `GET /api/v1/approval-requests/:id/conversations`
  - 权限：`read-only`
  - 列出该 approval-request 的对话。
- `POST /api/v1/approval-requests/:id/conversations`
  - 权限：`config-write`
  - 创建新对话。
- `GET /api/v1/approval-requests/:id/conversations/:conversationId`
  - 权限：`read-only`
  - 读取单个对话。
- `POST /api/v1/approval-requests/:id/conversations/:conversationId/messages`
  - 权限：`config-write`
  - 追加用户消息。
- `POST /api/v1/approval-requests/:id/conversations/:conversationId/agent-reply`
  - 权限：`config-write`
  - Server-Sent Events 流式返回 Haro 回复，并把最终 assistant 消息写入对话 artifact。
- `POST /api/v1/approval-requests/:id/decision`
  - 扩展 request-changes body，允许 `conversationId`。
  - 如果存在 `conversationId`，由后端生成 direction 摘要。

## 7. Agent 接入选择

选择：Web runtime hook 包装 Haro AgentRunner。

理由：

- 符合“必须用 Haro 自己的 modelhub/provider 链路”。
- 不需要新增外部模型，也不需要把普通讨论派到 workspace delegation。
- MCP tool 更适合 AgentDock 调用 Haro，不适合 Haro Web 内部同步对话。
- workspace dispatch 成本高，延迟和状态管理都超过 request-changes 讨论场景。

实现方式：CLI 启动 Haro Web 时注入 `reviewConversationReply` hook。hook 注册一个临时无工具 agent `haro-review-conversation`，复用当前默认 provider/model，`noMemory=true`，`continueLatestSession=false`。这保证对话不写 Haro 业务 memory，不携带写入工具，也不会延续无关历史上下文。

## 8. 安全与边界

- Agent 回复只作为讨论内容保存。
- Agent 不能写 approval-decision。
- 用户必须点击“提交要求修改”才会写决策。
- Agent prompt 明确禁止 approve / reject / apply / rollback。
- API 不暴露 secret，不保存 provider token。
- 如果 Agent hook 未配置，agent-reply 返回 503；用户仍可写对话并提交 direction。

## 9. 测试与验收

自动测试：

1. conversation CRUD：创建对话、追加用户消息、读取对话。
2. agent reply：mock Haro runtime hook，验证 SSE delta / done、assistant 消息持久化。
3. request-changes + conversationId：写入 approval-decision.direction，包含对话摘要和 artifact URI。
4. request-changes 不带 direction 且不带 conversationId 时仍返回 400。

手动验收：

1. 打开 Haro Web，选择 pending 提案，点击“要求修改”。
2. 面板能输入多行 Markdown，并保留换行。
3. 点击“发送给 Haro”后看到流式回复，列表自动滚到底部。
4. 关闭再打开能看到之前消息。
5. 点击“提交要求修改”后，提案进入已退回/要求修改状态。
6. approval-decision.direction 只含摘要和 artifact URI，完整原文保存在 approval-conversations。
7. approve / reject 仍走旧按钮，不受影响。

## 10. 回滚方案

首选回滚：设置 `VITE_HARO_LEGACY_REQUEST_CHANGES_PROMPT=1` 重新 build Haro Web，然后重启 `haro-web.service`。这会恢复旧 prompt 输入框。

代码回滚：撤回 FEAT-061 相关 commits。已写入的 approval-conversations artifact 可保留，不会被旧流程读取，也不会影响 approve / reject / apply。
