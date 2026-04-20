---
id: FEAT-005
title: 单 Agent 执行循环（选择规则 + Runner + 事件流 + 跨 session 状态）
status: done
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-20
related:
  - ../provider-selection.md
  - ../provider-protocol.md
  - ../../docs/modules/agent-runtime.md
  - ./FEAT-003-codex-provider.md
  - ./FEAT-004-minimal-agent-definition.md
  - ./FEAT-007-memory-fabric-independent.md
  - ../../roadmap/phases.md#p0-5单-agent-执行循环
---

# 单 Agent 执行循环

## 1. Context / 背景

Phase 0 的核心业务路径：接收一个任务 → 选 Provider/Model → 调用 → 回写结果。本 spec 串联 FEAT-001（骨架）、FEAT-003（Provider）、FEAT-004（Agent 定义）、FEAT-007（Memory Fabric），产出 Haro 第一个端到端可跑的执行链路。不涉及多 Agent、Team、Scenario Router（推迟到 Phase 1）。

## 2. Goals / 目标

- G1: 实现 `AgentRunner.run(task, agentId)` 主循环，返回最终结果（同步 API 也暴露事件流）
- G2: Provider/Model 通过选择规则引擎动态决定（静态规则，不含重评估）
- G3: 失败时按 fallback 列表自动切换 provider/model
- G4: Session 数据写入 SQLite；Agent 跨 session 状态文件正确维护；Codex 的 continuation 状态可跨进程恢复

## 3. Non-Goals / 不做的事

- 不做多 Agent 协作、Team Orchestration（Phase 1）
- 不做 Scenario Router 动态编排（Phase 1）
- 不做 Provider 动态重评估（Phase 2）
- 不做 UI 级流式渲染（交给 CLI / Channel 层处理）

## 4. Requirements / 需求项

- R1: 选择规则引擎加载：按 [provider-selection](../provider-selection.md) 的优先级读取 Agent 硬绑定 > 项目级 > 全局 > 内置默认规则；若规则未 pin `model`，则在运行时调用 `provider.listModels()` 按 `modelSelection` 实时解析
- R2: `AgentRunner.run(task, agentId)` 按顺序执行：加载 Agent → 选择 provider/model → 创建 session 记录 → 读取 continuation context → 调用 `provider.query()` → 消费事件 → 写 `session_events` → 写 terminal 状态
- R3: 每个 `AgentEvent` 写入 `session_events` 表（`event_type` + `event_data JSON`）；终态必须有可重放的 `result` 或 `error` 事件
- R4: Fallback 触发条件按 [provider-selection](../provider-selection.md#fallback-触发条件)；触发时写 `provider_fallback_log`；Fallback 失败继续下一个候选；全部失败返回 `AgentErrorEvent`
- R5: 跨 session 状态文件位于 `~/.haro/agents/{id}/state.json`，结构含四类信息（`taskContext / executionHistory / keyDecisions / pendingWork`）；`executionHistory` 在 Phase 0 记录 `sessionId / timestamp / taskPreview / outcome`，**不做 task intent 推断**
- R6: Session 成功结束后触发 `memory-wrapup` hook（FEAT-010 交付）；skill 未就绪时 log debug 跳过。若 session 以全部 fallback 失败收尾，则**不**写记忆
- R7: Runner 不得直接 import 具体 Provider 实现，只通过 `ProviderRegistry.get(id)` 获取（对齐可插拔原则）
- R8: 核心选择代码中不得出现 `providerId === '某具体 provider'` 之类特判；一切差异通过 `provider.capabilities()` / `provider.listModels()` 查询解决
- R9: `sessions` 表新增 `context_ref TEXT NULL` 字段，存 provider-specific continuation state（Phase 0 先用于 Codex `previousResponseId`）；恢复时 Runner 只读当前 session 的 `context_ref` 与最近成功 session 的 terminal `result.responseId`
- R10: Runner 支持 per-session 超时；Phase 0 先由 `HARO_TASK_TIMEOUT_MS`（环境变量）和配置项 `runtime.taskTimeoutMs` 二选一覆盖，默认 10 分钟

## 5. Design / 设计要点

**主循环伪代码**

```typescript
async function run(task: string, agentId: string): Promise<RunResult> {
  const agent = agentRegistry.get(agentId)
  const candidate = await selectionEngine.resolve(task, agent)
  const session = await createSession({ agentId, provider: candidate.provider, model: candidate.model })

  for (const next of candidate.withFallbacks()) {
    try {
      const provider = providerRegistry.get(next.provider)
      const sessionContext = await loadSessionContext(session.id, next.provider)
      for await (const ev of provider.query({
        prompt: task,
        systemPrompt: agent.systemPrompt,
        tools: agent.tools,
        model: next.model,
        sessionContext,
      })) {
        await writeSessionEvent(session.id, ev)
        await updateContinuationRef(session.id, ev)
      }
      await finalizeSession(session.id, 'completed')
      await updateAgentState(agentId, task)
      await triggerMemoryWrapupHook(session.id, agentId)
      return await loadRunResult(session.id)
    } catch (err) {
      await logFallback(session.id, next, err)
      if (!isFallbackable(err)) break
    }
  }

  await finalizeSession(session.id, 'failed')
  return errorResult(session.id)
}
```

**Continuation 恢复**

- Claude 类 provider：Phase 0 可为空实现；`context_ref` 预留
- Codex：`context_ref = { "previousResponseId": "..." }`
- 恢复优先级：`sessions.context_ref` > 最近成功 `result.responseId` > 无 continuation

**超时**

- 超时由 Runner 层实现，不下沉到 Provider 特判
- 超时时写 `AgentErrorEvent { code: 'timeout', retryable: true }`

**失败与记忆边界**

- 发生 provider 级失败并 fallback：仅记日志，不写记忆
- 全部 provider 都失败：session 失败、无 wrapup、无 state 级 key decision 沉淀

## 6. Acceptance Criteria / 验收标准

- AC1: `AgentRunner.run("列出当前目录下的 TypeScript 文件", "haro-assistant")` 返回包含文件列表的 `result` 事件（对应 R1~R3）
- AC2: mock 一个 provider 首次 `rate_limit`、第二次成功；`provider_fallback_log` 新增一行且 session 最终成功（对应 R4）
- AC3: 运行完一个 session 后，`sessions` 表有一行 `status = completed`，`session_events` 有 ≥ 2 行（对应 R3）
- AC4: 运行完后 `~/.haro/agents/haro-assistant/state.json` 的 `executionHistory` 新增一条，包含 `taskPreview` 而非模糊 intent（对应 R5）
- AC5: Codex 连跑两轮，第二轮能从 `sessions.context_ref` 或上一轮 `responseId` 恢复 continuation（对应 R9）
- AC6: 设置 `HARO_TASK_TIMEOUT_MS=1` 并运行一个阻塞 provider，session 以 timeout 收尾且进程不崩（对应 R10）
- AC7: 未接入 `memory-wrapup` skill 时运行正常，log 出现 `memory-wrapup hook skipped`；全部 fallback 失败时不写记忆（对应 R6）
- AC8: 运行 `grep -rE "providerId\s*===|provider\.id\s*===" packages/core` 返回 0 行（对应 R8）

## 7. Test Plan / 测试计划

- 单元测试：
  - `rules-engine.test.ts` — 规则匹配、优先级、live model 解析
  - `runner.test.ts` — 成功、fallback、全失败、timeout
  - `state-updater.test.ts` — `taskPreview` 追加逻辑
  - `session-writer.test.ts` — `session_events` / `context_ref` 写入
- 集成测试：
  - `runner.e2e.test.ts` — 真实 provider 完整跑一轮（AC1、AC3、AC4）
  - `fallback.e2e.test.ts` — mock provider 注入失败（AC2）
  - `continuation.e2e.test.ts` — 跨进程 continuation 恢复（AC5）
- 手动验证：
  - AC8 grep 清零

## 8. Open Questions / 待定问题

全部已关闭（见 Changelog 2026-04-19 决策条）。

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
- 2026-04-19: whiteParachute — 关闭 Open Questions → approved
  - Q1 → Phase 0 不做 task intent 提取；state 只记录 `taskPreview`（前 120 字符，保留原文片段）
  - Q2 → continuation 状态统一落 `sessions.context_ref`；Codex 的 `previousResponseId` 走该字段
  - Q3 → 全部 fallback 失败后不写记忆，仅写日志与终态 error
  - Q4 → Runner 层支持统一超时，Phase 0 先用 `HARO_TASK_TIMEOUT_MS` / `runtime.taskTimeoutMs`
- 2026-04-20: whiteParachute — done
  - `packages/core/src/runtime/{runner,selection,types,index}.ts` 打通 FEAT-005 的 Runner / 规则解析 / 公共导出面；`@haro/core` 新增 runtime 导出，供 FEAT-006 复用
  - 新增 `selection-engine.test.ts`、`runner.test.ts`、`provider-id-hardcode-guard.test.ts`，覆盖规则优先级、fallback、continuation、timeout、state.json、SQLite 事件写入与 AC8 grep
  - `docs/modules/agent-runtime.md` 与 `docs/reviews/phase-0-audit-2026-04-19.md` 同步更新，明确 FEAT-005 已交付、FEAT-006 仍为下一个缺口
