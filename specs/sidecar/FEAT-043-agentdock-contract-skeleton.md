---
id: FEAT-043
title: AgentDock Contract Skeleton
status: in-progress
phase: sidecar
owner: whiteParachute
created: 2026-05-08
updated: 2026-05-08
related:
  - ../../docs/planning/agentdock-kernel-sidecar-architecture.md
  - ../../docs/architecture/overview.md
  - ../../roadmap/phases.md
---

# AgentDock Contract Skeleton

## 1. Context / 背景

Haro 已切换为 AgentDock self-evolution sidecar。后续所有能力都依赖 Haro 对 AgentDock 的稳定 contract，而不是读取 AgentDock 内部 `src/*`。

第一步必须先建立 contract skeleton：connection、capability、observation、proposal、validation、asset event 的 schema 与测试夹具。没有 contract skeleton，后续 MCP server、scheduled CLI、gated apply 都会直接耦合 AgentDock 内部实现。

## 2. Goals / 目标

- G1: 新增 sidecar contract 模块，承载 Haro 与 AgentDock 的稳定数据契约。
- G2: 定义最小可用 schema，覆盖连接、观测、提案、验证和资产事件。
- G3: 提供 fake AgentDock source，用于 Haro 单测和 contract regression。
- G4: 明确禁止 Haro import AgentDock 内部源码。

## 3. Non-Goals / 不做的事

- 不实现真实 AgentDock API client。
- 不实现 MCP server。
- 不写 AgentDock DB。
- 不修改 AgentDock 仓库。
- 不开放 apply 能力。

## 4. Requirements / 需求项

- R1: 新增 `@haro/agentdock-contract` 或等价内部模块，导出所有 sidecar contract 类型和 schema。
- R2: `AgentDockConnection` 必须包含 `id`、`baseUrl`、`authRef?`、`capabilityVersion?`、`observationSources`、`createdAt`、`updatedAt`。
- R3: `AgentDockCapability` 必须描述 MCP、scheduler、skills、event export、filesystem contract 的可用性和版本。
- R4: `ObservationBatch` 必须能表达 sessions、turns、tool calls、scheduled task runs、AgentDock memory activity refs、runner errors、usage records；Haro 不定义自有 memory write/read schema。后续 FEAT-048 可通过外部 `FrontierSignal` refs 扩展 proposal evidence，不把外部情报伪装成 AgentDock memory。
- R5: `EvolutionProposal` 必须包含 proposal id、source observation refs、target kind、risk level、change set、test plan、rollback plan、status。
- R6: `ValidationReport` 必须包含 proposal id、risk verdict、required tests、rollback readiness、apply eligibility、blocking reasons。
- R7: `AssetEvent` 必须包含 stable asset id、kind、version、source ref、content ref、content hash、status、event type、rollback metadata。
- R8: 提供 fake AgentDock source，能产出固定 observation fixture，供 contract tests 使用。
- R9: 增加静态 guard：Haro contract 代码不得 import `/agent-dock/src/*` 或 `agent-dock/dist/*`。

## 5. Design / 设计要点

建议结构：

```text
packages/agentdock-contract/
  src/
    connection.ts
    capability.ts
    observation.ts
    proposal.ts
    validation.ts
    asset-event.ts
    fake-source.ts
    index.ts
  test/
    schema.test.ts
    fake-source.test.ts
    no-agentdock-internal-import.test.ts
```

schema 可使用现有 Zod 依赖，不新增第三方包。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定 fake AgentDock source，当生成 observation batch 时，应通过 `ObservationBatch` schema 校验。（对应 R4/R8）
- AC2: 给定缺失 rollback plan 的 proposal，当校验 `EvolutionProposal` 时，应返回结构化 schema error。（对应 R5）
- AC3: 给定 validation report 中 `applyEligible=true` 但 `rollbackReady=false`，schema 或 validator 应拒绝。（对应 R6）
- AC4: 给定 contract package 代码，当执行 import guard 测试时，不应发现 AgentDock 内部源码 import。（对应 R9）
- AC5: 给定 asset event fixture，当 content hash 为空时，应校验失败。（对应 R7）

## 7. Test Plan / 测试计划

- 单元测试：schema parse / reject 分支。
- 单元测试：fake source 固定 fixture。
- 静态测试：import guard。
- 回归风险：schema 过度收窄导致后续 AgentDock 观测源难适配；第一版保持字段最小但可扩展。

## 8. Open Questions / 待定问题

- Q1: contract package 是否独立为 `packages/agentdock-contract`，还是先放在 `packages/core/src/agentdock-contract`？
  - D1: 第一版独立为 `packages/agentdock-contract`，避免污染 `@haro/core` 旧 workbench surface。
- Q2: capability version 由 AgentDock API 暴露，还是 Haro capability probe 推断？
  - D2: 第一版 schema 同时支持 `capabilityVersion` 和 probe 结果；真实来源留到 AgentDock adapter 实现时决定。
- Q3: observation batch 第一版是否需要包含原始 message body，还是只存摘要和文件引用？
  - D3: 第一版 contract 支持 `contentExcerpt` + `contentRef`，不强制内嵌完整 message body，避免过早固化隐私与存储策略。

## 9. Changelog / 变更记录

- 2026-05-09: Haro — 澄清外部 frontier intelligence 通过 FEAT-048 signal refs 扩展 evidence，不进入 Haro-owned memory。
- 2026-05-08: Haro — 切到 in-progress；采用独立 `packages/agentdock-contract`，补 schema / fake source / import guard 实现。
- 2026-05-08: Haro — 初稿。
