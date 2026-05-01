---
id: FEAT-031
title: Web Channel（浏览器作为 IM 渠道）
status: draft
phase: phase-1.5
owner: whiteParachute
created: 2026-05-01
updated: 2026-05-01
related:
  - ../phase-0/FEAT-008-channel-abstraction-and-feishu.md
  - ../phase-0/FEAT-009-telegram-channel.md
  - ../phase-1/FEAT-016-web-dashboard-agent-interaction.md
  - ../phase-1.5/FEAT-038-web-api-decoupling.md
  - ../channel-protocol.md
  - ../../docs/architecture/overview.md
  - ../../docs/channels.md
  - ../../docs/planning/redesign-2026-05-01.md
---

# Web Channel（浏览器作为 IM 渠道）

## 1. Context / 背景

Haro Phase 1 已经交付 CLI / 飞书 / Telegram 三个 channel adapter，以及 Web Dashboard 的 Agent 交互页（FEAT-016）。但 Web Dashboard 当前是**管理面**（看 session、改配置、查 logs），它的 Chat 页面调用的是 Web API 内部的 runtime spawn 路径，**没有走 Channel 抽象层**——这意味着浏览器端"和 Agent 聊天"这个最自然的入口和飞书/Telegram 不是同等公民，没有 Channel 抽象层赋予的会话生命周期、ID 映射、富文本渲染、文件传输等能力。

happyclaw / AgentDock 已经把 Web 端聊天抽象为四 channel 之一（飞书/Telegram/QQ/Web），所有消息都走 `send_message` MCP 工具显式路由。Haro 需要在保持 Channel 抽象层不动核心模块的前提下，新增 Web Channel adapter，让浏览器对话与其他 IM 渠道使用同一套会话语义。

这是 Phase 1.5 自用底座补完的第一块，也是 FEAT-032 MCP 工具层的前置（`send_message` 工具需要 Web Channel 作为可路由目标）。

## 2. Goals / 目标

- G1: 新增 `packages/channel-web/` 作为 Channel 抽象层下的第四个 adapter，与飞书/Telegram 同等公民。
- G2: Web Dashboard Chat 页面的所有消息收发统一走 Web Channel，不再绕过 Channel 抽象层。
- G3: Web Channel 必须支持文件上传/下载（图片预览、文档传输），路径遍历防护与系统路径黑名单复用 happyclaw 验证过的策略。
- G4: 历史会话浏览：Web Channel 保留消息历史，支持按 session 列表、按时间范围检索，Dashboard 端提供历史浏览 UI。
- G5: 与 FEAT-019 Channel & Agent Management Dashboard 集成：可在 Web 上启用/禁用 Web Channel、查看健康状态。
- G6: 复用 Phase 1 Web Dashboard 的 WebSocket 通道传输消息流，不引入新的传输协议。

## 3. Non-Goals / 不做的事

- 不实现移动端 PWA / 离线模式（owner 自用单机不需要，happyclaw 这部分能力暂不复制）。
- 不实现 Web 终端（xterm.js + node-pty），延后到后续阶段视情况启动。
- 不实现群聊语义；Web Channel 是单用户多 session 形态，每个 session 是 1:1 对话。
- 不为 Web Channel 单独实现 OAuth / Bot 接入；身份 = Web Dashboard 已登录用户（FEAT-028）。
- 不引入 SSE / WebTransport；继续使用现有 WS。
- 不在 Web Channel 内重做 Markdown 渲染基础设施，复用 FEAT-034 的流式 UX 升级成果。

## 4. Requirements / 需求项

- R1: 新建 `packages/channel-web/`，实现 `WebChannel` 类满足 `MessageChannel` 接口，capabilities 至少声明 `streaming: true, attachments: true, history: true, group: false`。
- R2: Web Channel 必须复用 `~/.haro/channels/web/` 目录结构，包含 `state.json`（channel 元数据）和 `sessions.sqlite`（消息历史）。
- R3: Web Channel session ID 必须与 Web Dashboard 用户的 chat session 映射，复用 FEAT-021 Memory Fabric session 维度，不引入第二套 ID 体系。
- R4: 消息发送接口 `webChannel.send({ sessionId, content, attachments })` 必须能被 FEAT-032 `send_message` MCP 工具调用，与飞书/Telegram 等价。
- R5: 文件上传必须通过 `POST /api/v1/channels/web/upload`（FEAT-038 web-api 路由），单文件上限继承 happyclaw 验证过的默认值（图片 10MB / 文档 30MB / 总单 session 50MB），路径遍历防护与系统路径黑名单（`.ssh`、`.gnupg`）必须实现。
- R6: 文件下载必须通过 `GET /api/v1/channels/web/files/:id`，权限校验复用 FEAT-028 RBAC，禁止跨 session 访问他人文件。
- R7: 历史浏览 API：`GET /api/v1/channels/web/sessions/:id/messages?before=<ts>&limit=<n>`，分页基于游标（不基于 offset），返回结构化 NDJSON-friendly 格式。
- R8: Dashboard Chat 页改为 Web Channel 客户端，所有 send / receive / upload / history 操作均通过 `/api/v1/channels/web/*` 路由，不绕开 Channel 抽象层。
- R9: Web Channel 必须接入 FEAT-019 Gateway 控制：`haro gateway start` 启用所有 enabled channels 时 Web Channel 也起来；但与外部 IM 不同，Web Channel 的"启动"是注册到 ChannelRegistry，并不开监听端口（端口由 web-api 提供）。
- R10: 必须满足设计原则"非核心组件皆可插拔"：Web Channel 卸载（`haro channel disable web`）后，Dashboard 退化为只读模式（看 session / logs，不能新发消息），不影响 CLI、飞书、Telegram。

## 5. Design / 设计要点

### 5.1 包结构与依赖

```
packages/channel-web/
├── src/
│   ├── index.ts                 # WebChannel 类导出
│   ├── channel.ts               # MessageChannel 实现
│   ├── persistence/
│   │   ├── messages.ts          # sessions.sqlite 读写
│   │   └── files.ts             # 上传文件元数据
│   ├── upload.ts                # 文件上传守门：大小、类型、路径
│   └── stream.ts                # WS event payload 序列化
└── package.json
```

依赖：`@haro/channel`（协议层）、`@haro/core`（Memory Fabric session 维度）、`better-sqlite3`、`mime-types`。

### 5.2 与 web-api 的集成

`@haro/web-api`（FEAT-038）注册 `/api/v1/channels/web/*` 路由族，路由内部委托给 `WebChannel` 实例：

```
POST   /api/v1/channels/web/sessions            创建新 session
GET    /api/v1/channels/web/sessions             列出 sessions
GET    /api/v1/channels/web/sessions/:id         session 详情
DELETE /api/v1/channels/web/sessions/:id
GET    /api/v1/channels/web/sessions/:id/messages?before=<ts>&limit=<n>
POST   /api/v1/channels/web/sessions/:id/messages  发送消息（也可通过 send_message MCP 工具）
POST   /api/v1/channels/web/upload               上传附件
GET    /api/v1/channels/web/files/:id            下载附件（带 RBAC）
WS     /api/v1/channels/web/sessions/:id/stream  实时事件流
```

### 5.3 消息历史持久化

`sessions.sqlite` schema（草案）：

```sql
CREATE TABLE web_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,         -- user / assistant / system / tool
  content TEXT NOT NULL,       -- JSON-encoded structured content
  attachments TEXT,            -- JSON array of file refs
  created_at INTEGER NOT NULL,
  metadata TEXT
);
CREATE INDEX idx_web_messages_session_time ON web_messages(session_id, created_at);

CREATE TABLE web_files (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime_type TEXT,
  storage_path TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

文件实际存储在 `~/.haro/channels/web/files/<session-id>/<file-id>-<original-name>`，0600 权限。

### 5.4 与 Memory Fabric 的关系

Web Channel session 是 Memory Fabric `session` scope 的承载者。Memory 写入仍走 Memory Fabric API，不在 Web Channel 内部重复存档；但 Web Channel 的 `web_messages` 表保留**消息原文**，用于历史浏览，不与 Memory Fabric 的 `index.md` / `knowledge/` 抢占职责。

### 5.5 Dashboard Chat 改造

`packages/web/src/pages/ChatPage.tsx` 与 `components/chat/*` 改造为 Web Channel 客户端：
- send：`POST /api/v1/channels/web/sessions/:id/messages`
- stream：连 `WS /api/v1/channels/web/sessions/:id/stream`
- history：进入 ChatPage 时拉 `GET .../messages?limit=50`，向上滚动加载更多
- attachments：用 `POST .../upload` 拿到 file id 后，作为 message attachments 字段一并 send

## 6. Acceptance Criteria / 验收标准

- AC1: 新建 session 后通过 Dashboard Chat 发送消息，消息持久化到 `web_messages`，并能在重启服务后正确加载（对应 R2、R3、R7、R8）。
- AC2: 上传 10MB 图片成功，9MB 文档成功；上传 11MB 图片或 31MB 文档被拒绝，错误码与文案符合 happyclaw 一致策略（对应 R5）。
- AC3: 通过 `haro channel disable web` 禁用后，Dashboard Chat 进入只读模式，仍能查看历史 session，但发送按钮不可用，提示"Web Channel 已禁用"（对应 R10）。
- AC4: FEAT-032 `send_message` MCP 工具可路由到 Web Channel session，agent 在 IM 端的回复通过 Web Channel 出现在 Dashboard（对应 R4）。
- AC5: 路径遍历测试：上传文件名为 `../../etc/passwd` 必须被拒绝；文件名为 `.ssh/id_rsa` 必须被拒绝；正常文件名通过（对应 R5）。
- AC6: 历史分页：100 条消息按 50 一页加载，第二页正确返回 51-100 且不重复（对应 R7）。

## 7. Test Plan / 测试计划

- 单元测试：`WebChannel.send` / `loadHistory` / `validateUpload` / `pathSafety` 基于 better-sqlite3 in-memory + 临时目录 fixture。
- 集成测试：起 web-api 服务，模拟 Dashboard 发消息 → DB 写入 → WS 推送 → 历史读取 → Memory Fabric session 写入对账。
- E2E：基于 Playwright 跑 Dashboard Chat 完整流程（发文本 / 发图 / 发文档 / 看历史 / disable channel 后只读）。
- 安全测试：路径遍历 / 系统目录 / 跨 session 访问 / 超大文件 / 错误 mime；至少 8 个 negative case。
- 回归：FEAT-016 Web Dashboard Chat 既有功能、FEAT-019 Channel 管理 UI、FEAT-021 Memory Fabric session scope。

## 8. Open Questions / 待定问题

- Q1: 文件存储后端是否需要支持 S3/OSS adapter？当前用本地文件系统；自用单机够用，但 Phase 2.0 后若涉及多设备访问可能要重审。
- Q2: 群聊语义是否真的不要？Dashboard 是否要支持"主 chat + 旁路 chat"分屏？倾向不要，避免范围扩散。
- Q3: 文件加密是否要做？happyclaw 用 AES-256-GCM 加密 config，但文件内容是否加密未明确。倾向 Phase 1.5 不加密，仅靠目录权限 + RBAC，由 Open Question 留给 Phase 2.0+ 评估。
- Q4: 历史检索是否要 FTS5？Memory Fabric 已有 FTS5；Web Channel 历史搜索是否走 Memory Fabric 还是另起一个 FTS5 表？倾向走 Memory Fabric，Web Channel 自身只做时间序游标分页。

## 9. Changelog / 变更记录

- 2026-05-01: whiteParachute — 初稿（Phase 1.5 自用底座补完批次 1）
