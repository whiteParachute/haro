---
id: FEAT-005
title: 单 Agent 执行循环（选择规则 + Runner + 事件流 + 跨 session 状态）
status: draft
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-18
related:
  - ../provider-selection.md
  - ../provider-protocol.md
  - ../../docs/modules/agent-runtime.md
  - ./FEAT-003-codex-provider.md
  - ./FEAT-004-minimal-agent-definition.md
  - ../../roadmap/phases.md#p0-5单-agent-执行循环
---

# 单 Agent 执行循环

## 1. Context / 背景

Phase 0 的核心业务路径：接收一个任务 → 选 Provider/Model → 调用 → 回写结果。本 spec 串联 FEAT-001（骨架）、FEAT-003（Provider）、FEAT-004（Agent 定义），产出 Haro 第一个端到端可跑的执行链路。不涉及多 Agent、Team、Scenario Router（推迟到 Phase 1）。

## 2. Goals / 目标

- G1: 实现 `AgentRunner.run(task, agentId)` 主循环，返回最终结果（同步 API 也暴露事件流）
- G2: Provider/Model 通过选择规则引擎动态决定（静态规则，不含重评估）
- G3: 失败时按 fallback 列表自动切换 provider/model
- G4: Session 数据写入 SQLite；Agent 跨 session 状态文件正确维护

## 3. Non-Goals / 不做的事

- 不做多 Agent 协作、Team Orchestration（Phase 1）
- 不做 Scenario Router 动态编排（Phase 1）
- 不做 Provider 动态重评估（Phase 2）
- 不做 Session 的流式展示（交给 CLI FEAT-006 处理展示）

## 4. Requirements / 需求项

- R1: 选择规则引擎加载：按 [provider-selection](../provider-selection.md) 的优先级读取 Agent 硬绑定 > 项目级 > 全局 > 内置 4 条默认规则
- R2: `AgentRunner.run(task, agentId)` 按顺序执行：加载 Agent → 选规则 → 创建 session 记录 → 调用 `provider.query()` → 消费事件 → 写 session_events → 返回 result
- R3: 每个 AgentEvent 写入 `session_events` 表（event_type + event_data JSON）
- R4: Fallback 触发条件按 [provider-selection](../provider-selection.md#fallback-触发条件) 表；触发时写 `provider_fallback_log`；Fallback 失败继续下一个候选；全部失败返回 `AgentErrorEvent`
- R5: 跨 session 状态文件位于 `~/.haro/agents/{id}/state.json`，结构含四类信息（taskContext / executionHistory / keyDecisions / pendingWork）；每次 run 结束追加 executionHistory 一条
- R6: Session 结束后触发 `memory-wrapup` skill（FEAT-010 交付）；本 spec 只预留 hook 点，skill 未就绪时 log debug 跳过
- R7: Runner 不得直接 import 具体 Provider 实现，只通过 `ProviderRegistry.get(id)` 获取（对齐可插拔原则）
- R8: 核心选择代码中不得出现 `providerId === '某具体 provider'` 之类特判；一切差异通过 `provider.capabilities()` 查询解决

## 5. Design / 设计要点

**主循环伪代码**

```typescript
async function run(task: string, agentId: string): Promise<RunResult> {
  const agent = agentRegistry.get(agentId)
  const rules = loadSelectionRules()
  const session = await createSession(agentId)

  for (const { provider, model } of rulesEngine.candidates(task, agent, rules)) {
    try {
      const events: AgentEvent[] = []
      for await (const ev of providerRegistry.get(provider).query({
        prompt: task,
        systemPrompt: agent.systemPrompt,
        tools: agent.tools,
        model,
        sessionContext: loadSessionContext(session.id, provider),
      })) {
        events.push(ev)
        await writeSessionEvent(session.id, ev)
      }
      await finalizeSession(session.id, 'completed', events)
      await updateAgentState(agentId, events)
      await triggerMemoryWrapupHook(session, agentId)  // R6
      return { session, events }
    } catch (err) {
      await logFallback(session.id, provider, model, err)
      if (!isFallbackable(err)) break
    }
  }
  await finalizeSession(session.id, 'failed')
  return { session, events: [/* error */] }
}
```

**sessionContext 映射**

- Claude: 暂不维护显式 resume（SDK 自管）；Phase 0 每次 run 为独立 session
- Codex: 查最近一条 `session_events.responseId` 透传为 `previousResponseId`

**Agent state.json 更新**

每次 run 末尾追加：

```json
{
  "sessionId": "sess_xxx",
  "timestamp": "2026-04-18T...",
  "action": "<task 的 intent，Phase 0 直接用 task 前 40 字符>",
  "outcome": "completed | failed"
}
```

`taskContext` / `keyDecisions` / `pendingWork` 在 Phase 0 保持为空对象，Phase 1 逐步接入。

## 6. Acceptance Criteria / 验收标准

- AC1: `AgentRunner.run("列出当前目录下的 TypeScript 文件", "haro-assistant")` 返回包含文件列表的 result event（对应 R1~R3）
- AC2: 故意断网后运行，Provider healthCheck 失败触发 fallback；`provider_fallback_log` 表新增一行；若 fallback 也失败，返回 `AgentErrorEvent` 且进程不崩（对应 R4）
- AC3: 运行完一个 session 后，`sessions` 表有一行 `status = completed`，`session_events` 有 ≥ 2 行（对应 R3）
- AC4: 运行完后 `~/.haro/agents/haro-assistant/state.json` 的 `executionHistory` 新增一条（对应 R5）
- AC5: 在仅有 Codex Provider 可用的环境，代码类任务仍成功（选规则命中 `code-generation`）（对应 R1）
- AC6: 运行 `grep -rE "providerId\s*===|provider\.id\s*===" packages/core` 返回 0 行（对应 R8）
- AC7: 未接入 memory-wrapup skill 时运行正常，log 出现 `memory-wrapup hook skipped`（对应 R6）

## 7. Test Plan / 测试计划

- 单元测试：
  - `rules-engine.test.ts` — 规则匹配、优先级、fallback 列表生成
  - `runner.test.ts` — 主循环各分支（成功、fallback、全失败）— 使用 mock Provider
  - `state-updater.test.ts` — state.json 追加逻辑
  - `session-writer.test.ts` — session_events 写入
- 集成测试：
  - `e2e.test.ts` — 真实 Provider（`@live` 标）跑一个 task 完整走一遍（AC1、AC3、AC4）
  - `fallback.test.ts` — 用 mock Provider 注入失败（AC2）
- 手动验证：
  - AC5 需双 Provider 环境
  - AC6 grep 清零

## 8. Open Questions / 待定问题

- Q1: Task intent 提取（用于 state.action）Phase 0 用前 40 字符是否可接受？精细化推迟
- Q2: Codex 的 `previousResponseId` 在 Haro session 跨进程如何恢复？建议写入 `sessions.context_ref` 字段
- Q3: 「Fallback 失败后是否写记忆」— 建议不写（避免污染），仅 log
- Q4: Runner 是否需要支持超时（per-session）？Phase 0 可以简化为环境变量 `HARO_TASK_TIMEOUT_MS`

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
