---
id: FEAT-044
title: Read-only Haro MCP Sidecar
status: implemented
phase: sidecar
owner: whiteParachute
created: 2026-05-08
updated: 2026-05-08
related:
  - FEAT-043-agentdock-contract-skeleton.md
  - ../../docs/planning/agentdock-kernel-sidecar-architecture.md
  - ../phase-1.5/FEAT-032-mcp-tool-layer.md
---

# Read-only Haro MCP Sidecar

## 1. Context / 背景

Haro 接入 AgentDock 的主动交互面是外部 MCP server。AgentDock 已支持外部 MCP server 注册，Haro 应作为普通 MCP server 被 AgentDock 加载，而不是嵌入 AgentDock runtime。

第一版 MCP sidecar 只读，目标是让 AgentDock agent 能显式观察、提案、验证和查询资产，不允许直接 apply。

## 2. Goals / 目标

- G1: 实现 `haro mcp` stdio server，可被 AgentDock 作为外部 MCP server 注册。
- G2: 暴露 read-only tools：`haro_observe`、`haro_propose`、`haro_validate`、`haro_asset_query`。
- G3: 工具输入输出全部使用 FEAT-043 contract schema。
- G4: 所有工具调用写 Haro 自有 audit log，不写 AgentDock DB。
- G5: `haro mcp` sidecar 启动不得创建 Haro-owned MemoryFabric 或 `$HARO_HOME/memory`。

## 3. Non-Goals / 不做的事

- 不实现 `haro_apply`。
- 不实现 `haro_rollback`。
- 不要求 AgentDock 改造 MCP runtime。
- 不直接发送 IM 或 Web 消息。
- 不读取 AgentDock 内部 `src/*`。
- 不暴露历史 `memory_query` / `memory_remember` / `send_message` 等 AgentDock-owned 能力。

## 4. Requirements / 需求项

- R1: CLI 增加 `haro mcp` 命令，启动 stdio MCP server。
- R2: MCP server 必须支持 `tools/list` 和 `tools/call`。
- R3: `haro_observe` 接受 `{ connectionId?, since?, limit? }`，返回 `ObservationBatch` 或 observation refs。
- R4: `haro_propose` 接受 `{ observationRefs?, mode: 'dry-run' }`，返回 `EvolutionProposal`，默认不 apply。
- R5: `haro_validate` 接受 `{ proposalId }`，返回 `ValidationReport`。
- R6: `haro_asset_query` 接受 `{ kind?, status?, query?, limit? }`，返回 asset event summary。
- R7: 首批 tools 权限全部 read-only；任何 write/apply 类 tool 不出现在 `tools/list`。
- R8: 所有调用写入 `~/.haro/logs/mcp-invocations.jsonl`，参数原文可按敏感字段脱敏或只落 hash。
- R9: 工具失败返回结构化错误：`code`、`message`、`retryable`、`remediation?`。
- R10: sidecar registry 省略旧 `ToolDependencies.memory`，历史 memory tools 只有显式提供 MemoryFabric 依赖时才可用。

## 5. Design / 设计要点

MCP 注册示例：

```json
{
  "id": "haro",
  "command": "haro",
  "args": ["mcp"],
  "env": {
    "HARO_AGENTDOCK_BASE_URL": "http://127.0.0.1:3000",
    "HARO_AGENTDOCK_AUTH_HEADER": "Bearer ...",
    "HARO_HOME": "/path/to/.haro"
  },
  "enabled": true
}
```

工具执行链：

```text
AgentDock agent
  -> MCP tools/call
  -> haro mcp
  -> contract schema validate
  -> read observation / proposal / validation / asset store
  -> write Haro audit log
  -> return structured result
```

首版实现决策：

- `haro_observe` 默认在 `HARO_AGENTDOCK_BASE_URL` 存在时通过 AgentDock HTTP API 只读采集 `/api/health`、`/api/status`、`/api/sessions`、session messages/turns 和 `/api/tasks`，映射为 FEAT-043 `ObservationBatch`；需要鉴权时读取 `HARO_AGENTDOCK_AUTH_HEADER`，并拒绝非 http(s) 或携带 userinfo 的 baseUrl，避免凭据出现在 `rawRefs` / `metadata`；未配置 baseUrl 或显式 `HARO_AGENTDOCK_SOURCE=fake` 时回退 `FakeAgentDockSource`，用于离线 contract 测试。
- `haro_propose` 第一版只生成 rule-based dry-run proposal，不调用 agent，不写 apply/application event。
- `haro_validate` 只返回 advisory `ValidationReport`，`applyEligible=false`，不修改 proposal change set。
- `haro_asset_query` 首版曾通过只读 adapter 查询现有 Evolution Asset Registry；FEAT-046 第一段后已迁移为读取 `~/.haro/assets` sidecar asset registry，并返回 FEAT-043 `AssetEvent` summary。
- MCP audit 同时保留历史 SQLite `tool_invocation_log` 行，并写 `~/.haro/logs/mcp-invocations.jsonl`；JSONL 只保存参数 hash，不保存原始参数。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定 AgentDock MCP server 配置，当运行 `haro mcp` 时，AgentDock 能列出 4 个 read-only tools。（对应 R1/R2/R7）
- AC2: 给定 fake observation source，当调用 `haro_observe` 时，返回结果通过 FEAT-043 schema。（对应 R3）
- AC2.1: 给定 `HARO_AGENTDOCK_BASE_URL` 指向可访问 AgentDock API，当调用 `haro_observe` 时，应返回 `source=agentdock-http` 的 schema-valid `ObservationBatch`，且不 import AgentDock 内部模块。（对应 R3/R10）
- AC3: 给定 observation refs，当调用 `haro_propose` 时，只生成 dry-run proposal，不产生 application event。（对应 R4/R7）
- AC4: 给定 proposal id，当调用 `haro_validate` 时，返回 validation report，且不修改 proposal change set。（对应 R5）
- AC5: 给定 `tools/list`，不应出现 `haro_apply`、`haro_rollback`、`memory_query`、`memory_remember` 或 `send_message`。（对应 R7/R10）
- AC6: 给定任一 tool 调用失败，应写 audit log，并返回结构化错误。（对应 R8/R9）
- AC7: 给定干净 `HARO_HOME`，运行 `haro mcp` 后不应创建 `$HARO_HOME/memory`。（对应 G5/R10）

## 7. Test Plan / 测试计划

- 单元测试：tool schema 与 error mapping。
- 集成测试：stdio MCP `tools/list` / `tools/call`。
- CLI 入口测试：`bin/haro.js mcp` 在干净 `HARO_HOME` 只列出 4 个 sidecar tools，且不创建 `memory/`。
- 集成测试：fake source observe → propose → validate。
- 单元测试：HTTP AgentDock source 使用 fake fetch 覆盖 sessions/messages/turns/tasks 映射、500 字符 excerpt 截断、since 过滤和 schema 校验。
- 手动验证：在 AgentDock 外部 MCP server 配置中注册 `haro mcp`，配置 `HARO_AGENTDOCK_BASE_URL` 后调用 `haro_observe`，确认返回真实 AgentDock sessions/messages 而不是 fake fixture。

## 8. Decisions / 决策记录

- D1: 第一版 `haro_propose` 只做 rule-based dry-run proposal，不引入 agent generation。
- D2: MCP audit JSONL 只记录参数 hash，避免 AgentDock session / user payload 泄露到 Haro 日志。
- D3: `haro_asset_query` 第一版读取现有 Evolution Asset Registry 并输出 FEAT-043 `AssetEvent` summary；2026-05-14 起由 FEAT-046 接管，读取 `~/.haro/assets` sidecar registry manifests/events。
- D4: AgentDock 真实 observation source 只走 AgentDock HTTP API 契约，不读取、不 import AgentDock repo 内部源码；如果 API 不可达，应按 401/403、404、网络/5xx/JSON 失败分类返回结构化错误，而不是静默写入 Haro memory 或切换到 AgentDock 内部文件。

## 9. Changelog / 变更记录

- 2026-05-14: Haro — `haro_asset_query` 迁移到 FEAT-046 sidecar asset registry adapter，读取 `~/.haro/assets` manifests/events，不再查询旧 core EvolutionAssetRegistry。
- 2026-05-08: Codex — 完成 `haro mcp` 只读 sidecar 首版：新增 4 个 read-only tools、JSONL audit、fake-source observe/propose/validate/asset query 测试；sidecar registry 不暴露历史 memory/send_message tools，启动路径不创建 Haro-owned MemoryFabric 或 `$HARO_HOME/memory`。
- 2026-05-08: Codex — 修复 `tools/call` wire result：`content` 改为 MCP 标准 content block 数组，结构化 payload 进入 `structuredContent`，避免 AgentDock/Codex MCP client 报 `Unexpected response type`。
- 2026-05-08: Codex — `haro_observe` 接入真实 AgentDock HTTP observation source：配置 `HARO_AGENTDOCK_BASE_URL` 时采集 health/status/sessions/messages/turns/tasks 并返回 `source=agentdock-http`；未配置或 `HARO_AGENTDOCK_SOURCE=fake` 时保留 fake fixture fallback；错误码、limit、cursor、baseUrl 凭据边界已补回归。
- 2026-05-08: Haro — 初稿。
