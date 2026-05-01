---
id: FEAT-042
title: Pattern Miner（模式归纳）
status: draft
phase: phase-2.5
owner: whiteParachute
created: 2026-05-01
updated: 2026-05-01
related:
  - ../phase-1/FEAT-021-memory-fabric-v1.md
  - ../phase-1/FEAT-022-evolution-asset-registry.md
  - ../phase-2.0/FEAT-036-industry-intel.md
  - ../phase-2.0/FEAT-040-self-monitor.md
  - ../phase-2.0/FEAT-041-auto-eat-shit-trigger.md
  - ../phase-2.5/FEAT-037-evolution-proposal.md
  - ../evolution-engine-protocol.md
  - ../../docs/architecture/overview.md
  - ../../docs/planning/redesign-2026-05-01.md
---

# Pattern Miner（模式归纳）

## 1. Context / 背景

Phase 2.0 让平台"看见"自己（Self-Monitor）和外部世界（Industry Intel），并能基于阈值触发 dry-run（FEAT-041）。但阈值触发只能识别**显性事件**——一个指标越线、一类失败堆积。真正有价值的"为什么"——比如"工具 X 的失败率上升 + 同期 Anthropic 发布了 X 弃用公告" 这种**跨数据源的因果模式**——阈值规则无法抓到。

Pattern Miner 是 Haro 进化层第三个驱动源（Agent 自判断）的核心：周期性把 Self-Monitor 多个特征视图 + Industry Intel 最近条目 + Memory Fabric 高频访问 三类信号串起来，归纳成"模式"，作为 Evolution Proposal（FEAT-037）的输入。

**关键设计**：Pattern Miner 不替代 owner 决策——它**只产出"假设"**，每个假设带证据链 + 置信度，owner 在 Dashboard 决定是否 approve。

## 2. Goals / 目标

- G1: 新增 `PatternMiner` 服务，定期跑 mining pass，输出结构化 `Pattern[]`。
- G2: 至少实现 4 类模式：`failure-cascade`（失败连锁）/ `external-deprecation`（外部弃用提示）/ `low-utility-asset`（低利用率资产）/ `latency-regression`（延迟回归）。
- G3: 每个模式必须含完整证据链：触发数据快照、跨源关联、置信度评分、推荐改动方向。
- G4: 与 FEAT-037 桥接：高置信度模式自动转 proposal；低置信度仅写 `pattern_log` 待累积。
- G5: 支持 owner 反馈环路：Dashboard 上对模式 mark "useful / not useful" 后，下次 mining 调整该类模式权重。
- G6: 与 FEAT-040 / 041 / 036 数据源解耦：通过稳定 query API 读取，不直接 SQL。

## 3. Non-Goals / 不做的事

- 不引入机器学习训练；用启发式 + 简单统计 + 规则模板。
- 不调用 LLM 做模式总结（Phase 3.0+ 评估）；本 spec 内挖掘逻辑全部 deterministic。
- 不做实时挖掘；周期性批处理（默认每 12 小时）。
- 不允许 Pattern Miner 直接执行任何变更；只产出建议。
- 不做跨实例联邦挖掘；自用单机即可。
- 不引入 graph database；关系挖掘用 SQLite + in-memory adjacency。

## 4. Requirements / 需求项

- R1: 新建 `packages/core/src/pattern-miner/`，含 `service.ts` / `patterns/<id>.ts` / `evidence.ts` / `confidence.ts` / `proposal-bridge.ts`。
- R2: Pattern Miner 注册为 FEAT-033 scheduled task：默认 cron `0 */12 * * *`（每 12 小时一次）；可通过 `evolution.patternMiner.cron` 覆盖。
- R3: 至少实现 4 个模式 detector：
    - **failure-cascade**：同一 session 在 60 分钟内触发同一 errorCode ≥ 5 次，或不同 session 24h 内 ≥ 30 次
    - **external-deprecation**：Industry Intel 24h 内入库标题命中 deprecation 关键词（deprecated / sunset / EOL / removed），且 Self-Monitor 显示该工具 / API 仍被高频调用
    - **low-utility-asset**：Evolution Asset Registry 中 `kind in (skill, prompt, routing-rule)` 且最近 30 天 hit_count = 0，但 size > 阈值
    - **latency-regression**：Self-Monitor `tool_latency_p95` 7 天滑动 vs 上 7 天滑动 增幅 > 50%
- R4: 每个 detector 必须实现 `Detector.run()` 返回 `Pattern[]`；Pattern 结构定义如 §5.2。
- R5: 置信度评分 `confidence ∈ [0, 1]`：基于证据数量 / 数据时效 / 跨源关联性的简单加权；阈值 ≥ 0.7 转 proposal，0.4 ~ 0.7 仅 log，< 0.4 丢弃。
- R6: `pattern_log` 表持久化所有挖掘结果；新模式去重通过 `evidence_signature` hash。
- R7: 每个模式可独立禁用 `evolution.patternMiner.detectors.<id>.enabled: false`。
- R8: owner 反馈：Dashboard 上对模式 mark "useful / not useful" 写 `pattern_feedback` 表；下次 mining 时该 detector 的 `feedbackAdjust` 因子 ±10%（累积区间 `[0.5, 1.5]`，下限防 detector 永久失效，上限不直接产出 confidence > 1，最终 confidence 仍由 §5.4 终钳到 `[0, 1]`）。
- R9: CLI 命令族：`haro pattern list` / `pattern show <id>` / `pattern run --detector <id>`（强制立即跑一次）/ `pattern feedback <id> useful|not-useful`。
- R10: 全局禁用 `evolution.patternMiner.enabled: false` 立即生效。

## 5. Design / 设计要点

### 5.1 数据流

```
patternMiner.runMiningPass()
  ├─ for each enabled detector:
  │     ├─ detector.run()  → Pattern[]
  │     ├─ for each pattern:
  │     │     ├─ confidence.score(pattern)
  │     │     ├─ if score >= 0.7:
  │     │     │     ├─ dedup against pattern_log (evidence_signature)
  │     │     │     ├─ write pattern_log
  │     │     │     └─ proposal-bridge.create(pattern)  → FEAT-037
  │     │     ├─ elif score >= 0.4:
  │     │     │     └─ write pattern_log only
  │     │     └─ else: drop
  └─ summary log
```

### 5.2 Pattern 结构

```ts
interface Pattern {
  id: string;
  detectorId: string;
  kind: 'failure-cascade' | 'external-deprecation' | 'low-utility-asset' | 'latency-regression' | string;
  title: string;
  description: string;
  evidence: {
    selfMonitor?: { featureView: string; range: string; data: unknown }[];
    industryIntel?: { entryId: string; relevance: number }[];
    memoryFabric?: { memoryId: string; reason: string }[];
    assetRegistry?: { assetId: string; metrics: unknown }[];
  };
  evidenceSignature: string;         // hash of evidence for dedup
  confidence: number;                 // 0-1
  recommendedDirection: string;       // human-readable suggestion
  detectedAt: number;
  status: 'logged' | 'promoted' | 'rejected' | 'superseded';
}
```

### 5.3 Detector 模板示例（external-deprecation）

```ts
async function externalDeprecationDetector({ monitor, intel, fabric }): Promise<Pattern[]> {
  const recent = await intel.queryRecent({ scope: 'industry-intel', sinceHours: 24 });
  const deprecations = recent.filter(e =>
    /deprecat|sunset|EOL|removed|breaking change/i.test(e.title + ' ' + e.summary)
  );
  const patterns: Pattern[] = [];
  for (const dep of deprecations) {
    const tools = extractToolMentions(dep);
    for (const tool of tools) {
      const usage = await monitor.featureView('tool_invocation_freq', {
        range: '7d', filter: { tool }
      });
      if (usage.totalCalls > 50) {
        patterns.push({
          id: ...,
          kind: 'external-deprecation',
          title: `${tool} 被外部公告标记 deprecated，仍在高频使用`,
          evidence: { industryIntel: [...], selfMonitor: [...] },
          recommendedDirection: `调研 ${tool} 替代方案，规划迁移`,
          confidence: scoreCrossSource(...),
          ...
        });
      }
    }
  }
  return patterns;
}
```

### 5.4 confidence 评分

```ts
function score(pattern: Pattern): number {
  // 1) 证据强度（基础分）
  const evidenceCount = countEvidenceItems(pattern.evidence);
  const base = Math.min(1.0, 0.3 + evidenceCount * 0.05);

  // 2) 跨源加分
  const crossSourceBonus = countEvidenceSources(pattern.evidence) >= 2 ? 0.2 : 0;

  // 3) 时效衰减 ∈ (0, 1]
  const recencyFactor = recencyScore(pattern.detectedAt);

  // 4) 反馈权重 ∈ [0.5, 1.5]（来自 R8，含 floor 防 detector 失效）
  const feedbackAdjust = await getFeedbackWeight(pattern.detectorId);

  const raw = (base + crossSourceBonus) * recencyFactor * feedbackAdjust;

  // 5) 终钳到 [0, 1]，确保 R5 阈值与 UI 合约成立
  return Math.max(0, Math.min(1.0, raw));
}
```

**钳制约定**：
- `feedbackAdjust` 是评分**前**的权重因子，按 R8 在 `[0.5, 1.5]` 之间累积；它的设计目的是让 detector 在持续 not-useful 后衰减、持续 useful 后增益，但**不允许直接突破上限**。
- 最终 `confidence` 必须 ∈ `[0, 1]`，UI 合约（threshold 0.7 / 0.4）和 FEAT-037 评估器都依赖这个不变量。
- 终钳放在最外层而不是分布在 `base + crossSourceBonus` 内部，是为了让"高置信度模式 + 强反馈"仍然能稳定锚定到 1.0，而不是因为内部钳制让 feedback 失去拉抬作用。

### 5.5 与 FEAT-037 桥接

仅高置信度（≥0.7）模式转 proposal。proposal 字段填充约定：

```ts
const proposal: EvolutionProposal = {
  id: ...,
  kind: 'pattern-driven',
  source: {
    kind: 'pattern-miner',
    sourceId: pattern.id,
    detectorId: pattern.detectorId,
    patternId: pattern.id,
  },
  title: pattern.title,
  evidence: pattern.evidence,             // 直接复制
  suggestedChanges: [{ kind: 'free-form', text: pattern.recommendedDirection }],
  ...
};
```

`source.detectorId` 必须填充：FEAT-037 R10 仅在 `source.kind === 'pattern-miner'` 时调用 `patternMiner.recordFeedback(detectorId, decision)`，缺字段会导致反馈环失效。`recommendedDirection` 作为 proposal 的"建议改动"初版，owner 可在 Dashboard 编辑后再 approve。

## 6. Acceptance Criteria / 验收标准

- AC1: 模拟一个 errorCode 在 1 小时内触发 6 次的 session，跑 `haro pattern run --detector failure-cascade` 输出至少 1 个 Pattern 且 confidence ≥ 0.7（对应 R3、R4、R5）。
- AC2: Industry Intel 入一条标题含 "deprecated" + 提到 `tool-X`，同时 Self-Monitor 显示 `tool-X` 7 天调用 100 次，跑 detector 输出 external-deprecation pattern 且 confidence ≥ 0.7（对应 R3、R5）。
- AC3: 高置信度 pattern 自动出现在 FEAT-037 proposal 队列；中置信度只在 `pattern_log` 中（对应 R5、R6）。
- AC4: 同一 evidence_signature 第二次挖掘不重复写 pattern_log（对应 R6）。
- AC5: owner 对一个 pattern mark "not useful" 后，下次相同 detector 类似 evidence 的 confidence 下降 10%（对应 R8）。
- AC6: 单 detector 禁用后跑 mining，其他 detector 仍输出 patterns（对应 R7）。
- AC7: 全局禁用后跑 cron，pattern_log 无新条目，proposal 队列无新增（对应 R10）。

## 7. Test Plan / 测试计划

- 单元测试：每个 detector 边界用例（空数据 / 临界阈值 / 多命中 / 跨源 / 单源）；confidence 评分对称性。
- 集成测试：构造完整 Self-Monitor + Industry Intel + Memory Fabric fixture，跑 mining pass，断言 pattern_log + proposal 队列输出。
- 反馈环：mark useful/not-useful 后第二次 mining 同一 detector 的 confidence 偏移测试。
- 性能：1 年使用历史规模下 mining pass 总耗时 < 60s。
- 回归：FEAT-022 / 040 / 036 / 037 既有路径无 schema 影响。

## 8. Open Questions / 待定问题

- Q1: 反馈权重是否会引入 detector 失效（连续 not-useful 后被压到 0）？已在 R8 / §5.4 决定：`feedbackAdjust` 区间 `[0.5, 1.5]`，下限 0.5 防永久失效；上限 1.5 仅是评分前因子，最终 confidence 由 §5.4 终钳到 `[0, 1]`。本问题视为已关闭。
- Q2: 模式之间是否有 supersede 关系？例如新 pattern 是旧 pattern 的细化，旧的应自动 superseded？倾向首版不实现，留给 Phase 3.0+ 评估。
- Q3: Pattern 是否要有"过期"概念？例如 30 天未被 Promote 自动归档？倾向引入 30 天 TTL，未 promote 标 expired。
- Q4: 是否允许并行跑多个 detector？倾向串行（避免数据库竞争），单 detector 内部允许 query 并行。
- Q5: confidence 评分是否要 transparent（owner 可看分解）？倾向是，每个 pattern 的 evidence 中包含 score 拆解（base / crossSource / recency / feedback），便于 owner 理解。

## 9. Changelog / 变更记录

- 2026-05-01: whiteParachute — 初稿（Phase 2.5 进化提案层批次 3）
