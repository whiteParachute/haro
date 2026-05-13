---
id: FEAT-048
title: Frontier Intelligence Intake
status: draft
phase: sidecar
owner: whiteParachute
created: 2026-05-09
updated: 2026-05-13
related:
  - FEAT-043-agentdock-contract-skeleton.md
  - FEAT-045-scheduled-sidecar-cli.md
  - FEAT-046-sidecar-asset-registry-adapter.md
  - ../../docs/architecture/sidecar-operating-model.md
---

# Frontier Intelligence Intake

## 1. Context / 背景

Haro 的 self-evolution 不只来自 AgentDock 内部运行数据。用户要求 Haro 作为 AgentDock sidecar，持续从 X、YouTube、论文、开源仓库、官方文档、benchmark 等前沿信息源获取 agent 演进方向，并结合 AgentDock / Haro 自身组件使用情况，对 runner、web 端、消息端、记忆、自身功能等目标域提出自优化建议。

该能力必须仍然遵守 sidecar 边界：Haro 通过 AgentDock 定时任务或 MCP/skills 编排触发 intake；外部信息只能作为带来源的 evidence；任何改动必须先生成 proposal、通过 validation、获得审批，再进入 gated apply 或 patch branch。

## 2. Goals / 目标

- G1: 定义外部前沿情报的 source 类型、归一化 schema 和存储位置。
- G2: 提供可被 AgentDock script task 调用的无交互 intake 命令。
- G3: 将外部情报与 AgentDock/Haro 内部 observations 关联，用于 proposal 生成。
- G4: 为每条外部情报保留 source ref、发布时间/版本、抓取时间、摘要、置信度和适用目标域。
- G5: 确保外部情报不会绕过 validation / approval / rollback gate 直接触发 apply。

## 3. Non-Goals / 不做的事

- 不抓取私有、付费墙、违反来源条款或需要未授权凭据的内容。
- 不把单条社交媒体观点直接当作事实或直接应用到代码/配置。
- 不在第一版实现全自动研究 Agent 或长期浏览器会话。
- 不绕过 AgentDock channel 做审批或用户汇报。
- 不直接修改 AgentDock kernel 主分支。

## 4. Requirements / 需求项

- R1: 支持 source types：`x-post`、`youtube-video`、`paper`、`repo-release`、`official-doc`、`blog-post`、`benchmark-report`。
- R2: 每条 `FrontierSignal` 必须包含 `id`、`sourceType`、`sourceRef`、`title`、`publishedAt?`、`collectedAt`、`summary`、`claims[]`、`targetDomains[]`、`confidence`、`rawRef?`、`status`。
- R3: `targetDomains` 至少支持：`runner`、`web`、`message-channel`、`memory`、`mcp-tools`、`scheduler`、`skills`、`haro-sidecar`、`agentdock-kernel`。
- R4: intake 输出写入 `~/.haro/evolution/frontier-signals/` 或作为 `ObservationBatch` 的外部 signal refs；不得写 AgentDock DB。
- R5: 支持由 AgentDock scheduler/script task 周期执行，例如 `haro intake frontier --source-config <file> --since last --json`。
- R6: 支持 dedupe、cursor 和 TTL：重复来源不重复写入，过期/被证伪的 signal 可标记 `superseded` / `rejected`。
- R7: proposal 生成必须能同时引用内部 observation refs 与 frontier signal refs。
- R8: 外部情报驱动的 proposal 默认不得高于 `dry-run`；进入 apply 仍需 validation、snapshot/rollback 和用户审批。

## 5. Design / 设计要点

建议命令面：

```bash
haro intake frontier --source-config ~/.haro/frontier-sources.json --since last --json
haro propose --auto-dry-run --include-frontier
```

建议数据流：

```text
AgentDock scheduler
  -> script task
  -> haro intake frontier --since last
  -> Haro reads configured public sources / approved APIs
  -> Haro writes FrontierSignal records
  -> haro propose --auto-dry-run consumes internal observations + frontier signals
  -> haro validate --pending
  -> AgentDock channel presents proposal for approval
```

建议 source config：

```json
{
  "sources": [
    { "type": "paper", "query": "agent memory tool use planning evaluation", "cadence": "daily" },
    { "type": "repo-release", "repo": "modelcontextprotocol/specification", "cadence": "daily" },
    { "type": "official-doc", "url": "https://modelcontextprotocol.io/", "cadence": "weekly" }
  ]
}
```

第一版可以先由人工/AgentDock skill 生成 source config；Haro 只负责读取、归一化、去重和作为 proposal evidence 使用。

当前已落地的第一段 source config 形态是 curated signal 输入，而不是 Haro 直接抓外部源：

```json
{
  "signals": [
    {
      "id": "frontier-signal-001",
      "sourceType": "official-doc",
      "sourceRef": {
        "id": "mcp-changelog-2026-05-08",
        "kind": "official-doc",
        "uri": "https://modelcontextprotocol.io/changelog"
      },
      "title": "MCP tool capability update",
      "publishedAt": "2026-05-08T10:00:00.000Z",
      "collectedAt": "2026-05-08T12:00:00.000Z",
      "summary": "A curated frontier signal relevant to Haro sidecar MCP tool configuration.",
      "claims": ["Tool metadata can improve agent orchestration safety."],
      "targetDomains": ["mcp-tools", "haro-sidecar"],
      "confidence": "high",
      "status": "active"
    }
  ]
}
```

`haro intake frontier --source-config <file> --since last --json` 会校验 `FrontierSignal` schema，按 `sourceType + sourceRef` 去重，写入 `~/.haro/evolution/frontier-signals/`，并维护 `frontier-intake` cursor。损坏的既有 signal JSON 会在 stderr warning 和 JSON 输出中显式暴露。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定一个 public source fixture，当执行 `haro intake frontier --json` 时，应写入 schema-valid `FrontierSignal`。（对应 R1/R2/R4）
- AC2: 给定重复 source ref，当重复执行 intake 时，不应生成重复 signal。（对应 R6）
- AC3: 给定内部 observation 与 frontier signal，当执行 `haro propose --include-frontier` 时，proposal 应同时引用两类 evidence refs。（对应 R7）
- AC4: 给定由 frontier signal 触发的 proposal，默认只生成 dry-run proposal，不产生 application event。（对应 R8）
- AC5: 给定缺少 sourceRef 或 summary 的 signal，应被 schema 拒绝。（对应 R2）
- AC6: 给定过期或被人工拒绝的 signal，后续 proposal 不应继续把它当作 active evidence。（对应 R6）

## 7. Test Plan / 测试计划

- 单元测试：`FrontierSignal` schema parse / reject。
- 单元测试：source ref dedupe、cursor 和 TTL。
- 集成测试：fixture source → frontier signal → proposal evidence refs。
- CLI 测试：`--json` 输出、错误码、stderr。
- 手动验证：由 AgentDock script task 周期执行 intake，不影响普通 AgentDock session。

## 8. Open Questions / 待定问题

- Q1: 第一版外部 source 通过官方 API/RSS/search provider，还是由 AgentDock skill 先生成 curated source config？
- Q2: X / YouTube 的访问凭据和 quota 由 AgentDock 管理，还是 Haro 只接受导出的 public refs？
- Q3: `FrontierSignal` 是并入 `ObservationBatch`，还是单独目录并由 proposal 阶段 join？
- Q4: 对“最新 agent 演进方向”的时效窗口默认是 7 天、30 天还是按 source 类型配置？

## 9. Changelog / 变更记录

- 2026-05-13: Haro — 第一段实现：`FrontierSignal` contract schema、curated source-config intake、dedupe/cursor、status/doctor frontier signal 计数；尚未实现 `propose --include-frontier`。
- 2026-05-09: Haro — 初稿，补齐外部前沿情报 intake 在 sidecar 闭环中的位置。
