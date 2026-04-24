---
id: FEAT-019
title: Web Dashboard — Channel & Agent Management（通道与Agent管理）
status: approved
phase: phase-1
owner: whiteParachute
created: 2026-04-23
updated: 2026-04-24
related:
  - ../README.md#前端与-dashboard-开发规范
  - ./FEAT-015-web-dashboard-foundation.md
  - ./FEAT-016-web-dashboard-agent-interaction.md
  - ./FEAT-017-web-dashboard-system-management.md
  - ../channel-protocol.md
  - ../../docs/modules/channel-layer.md
  - ../../docs/modules/agent-runtime.md
---

# Web Dashboard — Channel & Agent Management（通道与Agent管理）

## 1. Context / 背景

FEAT-015~018 已完成 Dashboard 的基础框架、Agent 交互、系统管理和编排观测。但在与 CLI 命令的对照审查中发现，以下已交付的后端能力尚未有对应的前端页面：

- **Channel 管理**：CLI 提供 `haro channel list/enable/disable/remove/doctor/setup`；FEAT-017 只保留 Status/Settings 中通过 `/status`/`/doctor`/config sources 展示的只读摘要与基础健康分组，本 FEAT 独占 `/api/v1/channels*` contract，并承接所有操作性 Channel 管理与独立 ChannelPage
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

- R1: `GET /api/v1/channels` 返回所有已注册 channel 的 `ChannelSummary` 列表（id、enabled、source、capabilities、health、lastCheckedAt、configSource）。这是唯一的独立 Channel 列表 contract；FEAT-017 只消费 `/status`/`/doctor` 内嵌摘要，不定义本路径。
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

- R11: `GET /api/v1/agents` 返回所有 Agent 摘要列表（id、name、summary、defaultProvider、defaultModel），与 FEAT-016 R5 Agent selector 合约一致；不返回 `description` 或单 Agent `type`。
- R12: `GET /api/v1/agents/:id` 返回指定 Agent 的结构化详情对象（id、name、summary、systemPrompt、tools、defaultProvider、defaultModel），与 FEAT-016 详情端点一致；不返回 `description` 或单 Agent `type`。
- R12a: `GET /api/v1/agents/:id/yaml` 返回 `application/json`：`{ id: string; yaml: string; updatedAt?: string }`，供 AgentEditorPage 的 YAML 编辑器读取；不直接返回 `text/plain`，避免前端 API client 出现第二套响应解析路径。
- R13: `PUT /api/v1/agents/:id/yaml` 更新 Agent YAML，body 为严格 `{ yaml: string }`；YAML 内 `id` 必须等于 route param `:id`，否则返回 400 `id-mismatch`；校验通过后写入 `~/.haro/agents/{id}.yaml`。
- R14: `POST /api/v1/agents` 创建新 Agent YAML，body 为严格 `{ yaml: string }`；从 YAML 中读取 `id`，校验 id 格式与目标文件名一致，校验通过后写入 `~/.haro/agents/{id}.yaml`；若文件已存在返回 409。
- R15: `DELETE /api/v1/agents/:id` 删除指定 Agent YAML 文件。
- R16: `POST /api/v1/agents/:id/validate` 校验 Agent YAML 内容，body 为严格 `{ yaml: string }`；YAML 内 `id` 必须等于 route param `:id`。作为编辑器实时校验端点，它对 schema/unknown-field/id-mismatch/conflict/yaml-parse 等校验失败统一返回 HTTP 200 + `AgentValidationResponse { ok: false, issues }`；仅认证失败/方法错误等非校验类错误使用对应 HTTP error。

## 5. Design / 设计要点

### 5.1 新增后端文件

```
packages/cli/src/web/routes/
├── channels.ts     # 操作性 Channel 管理 REST（承接 FEAT-017 移出的 mutation 能力）
├── gateway.ts      # Gateway 控制 REST（新增）
└── agents.ts       # Agent CRUD REST（扩展 FEAT-016 R5，保留列表/详情 read-model，YAML 读写走 /yaml 端点）
```

**Agent CRUD 边界：**
- `GET /api/v1/agents` 调用 `AgentRegistry.list()`，返回 `AgentSummary`：id、name、summary、defaultProvider、defaultModel。`summary` 从 `systemPrompt` 派生，规则同 FEAT-016 §5.5
- `GET /api/v1/agents/:id` 返回 `AgentDetail`：id、name、summary、systemPrompt、tools、defaultProvider、defaultModel，供 FEAT-016 ChatPage/agent selector 等消费者使用
- `GET /api/v1/agents/:id/yaml` 读取 `~/.haro/agents/{id}.yaml`，返回 `AgentYamlResponse` JSON，不直接返回 `text/plain`
- `PUT /api/v1/agents/:id/yaml` / `POST /api/v1/agents` / `POST /api/v1/agents/:id/validate` 的 JSON envelope 使用 `.strict()` request schema，只接受 `{ yaml: string }`；YAML 内容再通过 FEAT-004 `parseAgentConfig` / `agentConfigSchema.strict()` 校验
- `PUT /api/v1/agents/:id/yaml` 与 `POST /api/v1/agents/:id/validate` 必须额外检查 YAML 内 `id === :id`；`POST /api/v1/agents` 必须用 YAML 内 `id` 作为文件名并拒绝重复文件，避免 Web 层生成另一套命名规则
- 写入类端点不得接受或写入 `description`、`summary`、单 Agent `type`；若 YAML 中出现这些字段，按 FEAT-004 unknown-field 错误返回 400，错误格式沿用 `buildUnknownFieldMessage()`
- `DELETE /api/v1/agents/:id` 删除文件、触发 reload；禁止删除正在使用的 defaultAgent

```typescript
type AgentYamlResponse = {
  id: string;
  yaml: string;
  updatedAt?: string;
};

type AgentValidationIssue = {
  path: string;
  message: string;
  code?: 'schema' | 'unknown-field' | 'id-mismatch' | 'yaml-parse' | 'conflict';
};

type AgentValidationResponse =
  | { ok: true; id: string; issues: [] }
  | { ok: false; id?: string; issues: AgentValidationIssue[] };
```

HTTP status 策略：`POST /api/v1/agents/:id/validate` 是编辑器实时校验端点，schema/unknown-field/id-mismatch/conflict/yaml-parse 等校验失败统一返回 HTTP 200 + `AgentValidationResponse { ok: false, issues }`，便于前端持续展示校验面板；保存/创建端点在相同校验失败时返回 400（重复文件为 409），payload 使用同一 `issues[]` 结构。

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
每个 channel 一张卡片，展示 `ChannelSummary`：
- id、source（preinstalled/user）、enabled 状态开关、health、lastCheckedAt、configSource
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
- 保存时走后端 YAML 写入能力：编辑既有 Agent 使用 `PUT /api/v1/agents/:id/yaml`，新建使用 `POST /api/v1/agents`，AgentEditorPage 只依赖 YAML 编辑态读取/写回与校验流程

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
- AC10: Agent 列表/详情 API 只返回 `summary` read-model，不返回 `description` 或单 Agent `type`；包含 `description`、`summary` 或 `type` 的 YAML 创建/更新请求返回 400，校验请求返回 200 + `AgentValidationResponse { ok: false }`，二者均复用 FEAT-004 unknown-field 错误格式。
- AC12: `GET /api/v1/agents/:id/yaml` 返回 `AgentYamlResponse` JSON；`PUT /api/v1/agents/:id/yaml` 在 YAML `id !== :id` 时返回 400 + `id-mismatch` issue；`POST /api/v1/agents/:id/validate` 在 YAML `id !== :id` 时返回 200 + `AgentValidationResponse { ok: false, issues: [{ code: 'id-mismatch' }] }`；validate 成功/失败均返回固定 `AgentValidationResponse`。
- AC11: FEAT-019 是唯一拥有独立 `/api/v1/channels*` contract 的 spec；FEAT-017 中不再存在的 enable/disable/setup/remove 操作在本 FEAT 的 ChannelPage/API 中完整可用，Status/Settings 只读入口与 ChannelPage/API contract 不重复。

## 7. Test Plan / 测试计划

- 后端：Agent CRUD 测试（创建/读取/更新/删除/校验、`description`/`summary`/`type` unknown-field 拒绝、route `:id` 与 YAML `id` mismatch、保存端点 400 vs validate 端点 200+ok=false、`AgentYamlResponse`/`AgentValidationResponse` payload、read-model 派生 summary）、Gateway 控制测试、Channel 操作 API 测试
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

- 2026-04-24: review fix — Breaking: 解决 B2/W1，Agent API 与 FEAT-016 对齐为 `summary` read-model，删除 `description`/单 Agent `type` 字段；YAML CRUD 统一使用 `{ yaml }` envelope + FEAT-004 strict schema，明确 unknown-field、id/path mismatch、`AgentYamlResponse`/`AgentValidationResponse` 策略；validate 端点统一 200 + `ok=false`，保存/创建端点使用 400/409；FEAT-019 独占 `/api/v1/channels*` contract，承接 FEAT-017 移出的操作性 ChannelPage/API、Gateway 控制与 Agent YAML CRUD；修正 channel protocol 相关链接。按 `specs/README.md` 的 approved 合约变更规则，status 回退为 draft，待 owner 重新批准。
- 2026-04-24: owner re-approved — whiteParachute 批准 B2/W1 合约修订，status: draft → approved。
