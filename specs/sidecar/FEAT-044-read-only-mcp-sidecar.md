---
id: FEAT-044
title: Read-only Haro MCP Sidecar
status: in-progress
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

## 3. Non-Goals / 不做的事

- 不实现 `haro_apply`。
- 不实现 `haro_rollback`。
- 不要求 AgentDock 改造 MCP runtime。
- 不直接发送 IM 或 Web 消息。
- 不读取 AgentDock 内部 `src/*`。

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

## 5. Design / 设计要点

MCP 注册示例：

```json
{
  "id": "haro",
  "command": "haro",
  "args": ["mcp"],
  "env": {
    "HARO_AGENTDOCK_BASE_URL": "http://127.0.0.1:3000",
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

- `haro_observe` 先接入 FEAT-043 `FakeAgentDockSource`，用于锁定外部 MCP server 形态与 schema；真实 AgentDock API / event export 接入后替换 source，不改变 tool contract。
- `haro_propose` 第一版只生成 rule-based dry-run proposal，不调用 agent，不写 apply/application event。
- `haro_validate` 只返回 advisory `ValidationReport`，`applyEligible=false`，不修改 proposal change set。
- `haro_asset_query` 先通过只读 adapter 查询现有 Evolution Asset Registry，并映射成 FEAT-043 `AssetEvent` summary；FEAT-046 再迁移到 sidecar asset registry adapter。
- MCP audit 同时保留历史 SQLite `tool_invocation_log` 行，并写 `~/.haro/logs/mcp-invocations.jsonl`；JSONL 只保存参数 hash，不保存原始参数。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定 AgentDock MCP server 配置，当运行 `haro mcp` 时，AgentDock 能列出 4 个 read-only tools。（对应 R1/R2/R7）
- AC2: 给定 fake observation source，当调用 `haro_observe` 时，返回结果通过 FEAT-043 schema。（对应 R3）
- AC3: 给定 observation refs，当调用 `haro_propose` 时，只生成 dry-run proposal，不产生 application event。（对应 R4/R7）
- AC4: 给定 proposal id，当调用 `haro_validate` 时，返回 validation report，且不修改 proposal change set。（对应 R5）
- AC5: 给定 `tools/list`，不应出现 `haro_apply` 或 `haro_rollback`。（对应 R7）
- AC6: 给定任一 tool 调用失败，应写 audit log，并返回结构化错误。（对应 R8/R9）

## 7. Test Plan / 测试计划

- 单元测试：tool schema 与 error mapping。
- 集成测试：stdio MCP `tools/list` / `tools/call`。
- 集成测试：fake source observe → propose → validate。
- 手动验证：在 AgentDock 外部 MCP server 配置中注册 `haro mcp`。

## 8. Decisions / 决策记录

- D1: 第一版 `haro_propose` 只做 rule-based dry-run proposal，不引入 agent generation。
- D2: MCP audit JSONL 只记录参数 hash，避免 AgentDock session / user payload 泄露到 Haro 日志。
- D3: `haro_asset_query` 第一版读取现有 Evolution Asset Registry 并输出 FEAT-043 `AssetEvent` summary；sidecar registry adapter 留给 FEAT-046。

## 9. Changelog / 变更记录

- 2026-05-08: Codex — 开始落地 `haro mcp` 只读 sidecar：新增 4 个 read-only tools、JSONL audit、fake-source observe/propose/validate/asset query 测试。
- 2026-05-08: Haro — 初稿。
