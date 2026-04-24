---
id: FEAT-019
title: Web Dashboard — Channel & Agent Management（通道与Agent管理）
status: approved
phase: phase-1
owner: whiteParachute
created: 2026-04-23
updated: 2026-04-23
related:
  - ../README.md#前端与-dashboard-开发规范
  - ./FEAT-015-web-dashboard-foundation.md
  - ./FEAT-016-web-dashboard-agent-interaction.md
  - ./FEAT-017-web-dashboard-system-management.md
  - ../../docs/modules/channel-protocol.md
  - ../../docs/modules/agent-runtime.md
---

# Web Dashboard — Channel & Agent Management（通道与Agent管理）

## 1. Context / 背景

FEAT-015~018 已完成 Dashboard 的基础框架、Agent 交互、系统管理和编排观测。但在与 CLI 命令的对照审查中发现，以下已交付的后端能力尚未有对应的前端页面：

- **Channel 管理**：CLI 提供 `haro channel list/enable/disable/remove/doctor/setup`，但 Dashboard 仅在 Settings 中展示了 Channel API，没有独立的 Channel 管理页面
- **Gateway 控制**：CLI 提供 `haro gateway start/stop/status/doctor`，MonitorPage 仅有状态指示器，缺少完整的控制面板
- **Agent 配置 CRUD**：CLI 通过 `haro setup` 管理 Agent YAML，Dashboard 中仅有 `defaultAgent` 选择器，缺少 Agent 的创建、编辑、删除能力

本 FEAT 作为 Dashboard 系列的**补充单元**，补全上述遗漏的管理能力，使 Dashboard 覆盖 CLI 的全部运维操作。

## 2. Goals / 目标

- G1: 实现 ChannelPage，支持列出、启用、禁用、移除 channel，以及运行 channel doctor/setup
- G2: 实现 GatewayPage，支持查看 Gateway 状态、启动、停止、运行 doctor
- G3: 实现 AgentEditorPage，支持 Agent YAML 的创建、编辑、删除和验证
- G4: 后端扩展 Channels 和 Gateway 领域的 REST API，新增 Agent CRUD API
- G5: Agent 编辑器提供 YAML 语法校验（复用 FEAT-004 的 Zod schema）

## 3. Non-Goals / 不做的事

- 不新增 channel 类型或 gateway 实现（纯前端呈现层）
- 不修改 `ChannelRegistry` 或 `Gateway` 的核心逻辑
- 不实现 Setup/Onboarding 向导（可延后到 FEAT-020）
- 不提供 Agent 模板市场（仅支持手动编辑 YAML）

## 4. Requirements / 需求项

### Channels 管理

- R1: `GET /api/v1/channels` 返回所有已注册 channel 的列表（id、enabled、source、capabilities）。
- R2: `POST /api/v1/channels/:id/enable` 启用指定 channel。
- R3: `POST /api/v1/channels/:id/disable` 禁用指定 channel。
- R4: `DELETE /api/v1/channels/:id` 移除指定 channel。
- R5: `GET /api/v1/channels/:id/doctor` 返回 channel 健康检查报告。
- R6: `POST /api/v1/channels/:id/setup` 运行 channel setup 流程。

### Gateway 控制

- R7: `GET /api/v1/gateway` 返回 Gateway 当前状态（running/stopped、PID、启动时间、已连接 channel 数）。
- R8: `POST /api/v1/gateway/start` 启动 Gateway 守护进程。
- R9: `POST /api/v1/gateway/stop` 停止 Gateway 守护进程。
- R10: `GET /api/v1/gateway/doctor` 返回 Gateway 健康检查报告。
- R17: `GET /api/v1/gateway/logs` 返回 Gateway 最近 N 条日志（默认 100 条，支持 `?lines=` 参数和 `?since=` 时间戳过滤）。

### Agent 管理

- R11: `GET /api/v1/agents` 返回所有 Agent 摘要列表（id、name、type、description、defaultProvider、defaultModel），保持为 FEAT-016 R5 Agent selector 合约的超集。
- R12: `GET /api/v1/agents/:id` 返回指定 Agent 的结构化详情对象（id、name、type、description、systemPrompt、tools、defaultProvider、defaultModel 等字段），与 FEAT-016 详情端点一致。
- R12a: `GET /api/v1/agents/:id/yaml` 返回指定 Agent 的完整 YAML 原始文本，供 AgentEditorPage 的 YAML 编辑器读取。
- R13: `PUT /api/v1/agents/:id` 更新 Agent YAML，写入 `~/.haro/agents/{id}.yaml`。
- R14: `POST /api/v1/agents` 创建新 Agent YAML，校验通过后写入文件。
- R15: `DELETE /api/v1/agents/:id` 删除指定 Agent YAML 文件。
- R16: `POST /api/v1/agents/:id/validate` 校验 Agent YAML 内容，返回 Zod 校验结果（通过或字段级错误）。

## 5. Design / 设计要点

### 5.1 新增后端文件

```
packages/cli/src/web/routes/
├── channels.ts     # Channel 管理 REST（扩展 FEAT-017）
├── gateway.ts      # Gateway 控制 REST（新增）
└── agents.ts       # Agent CRUD REST（扩展 FEAT-016 R5，保留列表/详情结构化合约，另设 YAML 原文端点）
```

**Agent CRUD 边界：**
- `GET /api/v1/agents` 调用 `AgentRegistry.list()`，返回 id、name、type、description、defaultProvider、defaultModel 摘要字段
- `GET /api/v1/agents/:id` 返回 Agent 结构化详情对象，供 FEAT-016 ChatPage/agent selector 等消费者使用
- `GET /api/v1/agents/:id/yaml` 读取 `~/.haro/agents/{id}.yaml` 原始文本，供 YAML 编辑器使用
- `PUT /api/v1/agents/:id` 写入前通过 `AgentConfigSchema` Zod 校验，校验失败返回 400 + 字段级错误
- `POST /api/v1/agents` 分配 id、写入文件、触发 `AgentRegistry.reload()`
- `DELETE /api/v1/agents/:id` 删除文件、触发 reload；禁止删除正在使用的 defaultAgent

### 5.2 新增前端文件

```
packages/web/src/
├── pages/
│   ├── ChannelPage.tsx
│   ├── GatewayPage.tsx
│   └── AgentEditorPage.tsx
└── components/
    ├── channel/
    │   ├── ChannelCard.tsx
    │   └── ChannelDoctorDialog.tsx
    ├── gateway/
    │   ├── GatewayStatusCard.tsx
    │   └── GatewayControlPanel.tsx
    └── agent/
        ├── AgentList.tsx
        ├── AgentYamlEditor.tsx
        └── AgentValidationPanel.tsx
```

### 5.3 ChannelPage 设计

**Channel 卡片列表：**
每个 channel 一张卡片，展示：
- id、source（preinstalled/user）、enabled 状态开关
- capabilities：streaming、richText、attachments、threading
- 操作按钮：Enable / Disable / Remove / Doctor / Setup

**状态流转：**
- disabled → enable → enabled
- enabled → disable → disabled
- 任何状态 → remove → 从列表移除

### 5.4 GatewayPage 设计

**状态面板：**
- 大状态指示器：Running（绿）/ Stopped（灰）
- 元数据：PID、启动时间、已连接 channel 数
- 操作按钮：Start / Stop / Doctor

**日志流：**
- 实时展示 Gateway 日志（通过 `GET /api/v1/gateway/logs` 轮询，WebSocket 实时推送延后到 Phase 2）

### 5.5 AgentEditorPage 设计

**双栏布局：**
- 左侧：Agent 列表（可新建、删除）
- 右侧：YAML 编辑器（新建/编辑时显示）

**YAML 编辑器：**
- 使用 CodeMirror 6（`@codemirror/lang-yaml`），不引入 Monaco（bundle 体积过大）
- 编辑现有 Agent 时，通过 `GET /api/v1/agents/:id/yaml` 读取原始 YAML 文本；`GET /api/v1/agents/:id` 保留为结构化详情数据，不作为 YAML 文本来源
- 实时语法高亮（YAML）
- 底部状态栏：校验状态（通过/错误数）
- 保存前自动触发 `POST /api/v1/agents/:id/validate`
- 保存时走后端 YAML 写入能力（可由 `PUT/PATCH /api/v1/agents/:id/yaml` 或既有 `PUT /api/v1/agents/:id` 承载，具体实现决定），AgentEditorPage 只依赖 YAML 编辑态读取/写回与校验流程

**校验面板：**
- 展示 Zod 校验错误：字段路径、错误消息、建议值
- 通过时展示 "✓ YAML 格式有效"

**新建 Agent 模板：**
```yaml
id: my-agent
name: My Agent
systemPrompt: |
  You are a helpful assistant.
tools: []
defaultProvider: codex
defaultModel: gpt-5
```

## 6. Acceptance Criteria / 验收标准

- AC1: ChannelPage 列出所有 channel，可切换 enable/disable，操作后立即反映在列表中。
- AC2: ChannelPage 可执行 Remove 操作，移除后 channel 从列表消失。
- AC3: ChannelPage 可运行 Doctor，展示健康检查报告。
- AC4: GatewayPage 正确展示当前状态（running/stopped），Start/Stop 按钮状态与当前状态联动。
- AC5: GatewayPage 可运行 Doctor，展示 Gateway 健康检查报告。
- AC6: AgentEditorPage 可创建新 Agent，YAML 编辑器提供语法高亮和实时校验。
- AC7: AgentEditorPage 可编辑现有 Agent，保存前自动校验，校验失败阻止保存并展示错误字段。
- AC8: AgentEditorPage 可删除 Agent，删除前确认对话框，禁止删除正在使用的 defaultAgent。
- AC9: Agent YAML 更新后，`AgentRegistry` 自动 reload，新配置对后续 Chat 请求立即生效。

## 7. Test Plan / 测试计划

- 后端：Agent CRUD 测试（创建/读取/更新/删除/校验）、Gateway 控制测试
- 前端：AgentYamlEditor 渲染和校验交互测试、ChannelCard 状态切换测试
- E2E：创建 Agent → 编辑 YAML → 校验通过 → 保存 → 在 Chat 页面选择新 Agent 发送消息

## 8. Open Questions / 待定问题

- ~~Q1: Agent YAML 编辑器是否需要在保存后自动触发 `memoryFabric.wrapupSession()` 或相关 Agent 状态刷新？~~ **决策：否。** 保存后仅触发 `AgentRegistry.reload()`，使新配置立即生效。`wrapupSession()` 是 channel session 结束时的兜底机制，与 Agent 配置编辑无关。
- ~~Q2: Gateway 日志流是轮询还是扩展 WebSocket 协议新增 `gateway.log` 事件类型？~~ **决策：Phase 1 使用轮询。** `GET /api/v1/gateway/logs` 每 3 秒轮询一次，WebSocket 实时推送延后到 Phase 2（与 FEAT-016 的 `system.status` 通道统一扩展）。

## 9. Changelog / 变更记录

- 2026-04-23: whiteParachute — 初稿 draft
  - 补全 Dashboard 遗漏能力：Channel 管理、Gateway 控制、Agent 配置 CRUD
  - 明确 Agent CRUD 边界：Zod 校验、文件读写、Registry reload
- 2026-04-23: review fix — 补充 R17 Gateway 日志端点；5.1 明确 agents.ts 是 FEAT-016 的扩展；YAML 编辑器明确首选 CodeMirror 6；Open Questions 清零（不触发 wrapupSession、日志轮询）
