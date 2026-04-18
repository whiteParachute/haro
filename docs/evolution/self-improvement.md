# Evolution Engine — 自我改进机制

## 概述

Haro 的自我改进机制将平台本身作为被改进的对象，实现从单 Agent 进化（yoyo-evolve 的思路）到**平台级多 Agent 进化**的跨越。

## 自我改进的四个层级

### L0：Prompt 优化（Phase 2）

最安全的进化层级，只修改 Prompt 文本，不改代码。

```
Pattern Miner 发现：使用"逐步思考"指令时成功率提升 15%
  ↓
Auto-Refactorer L0：
  将所有 systemPrompt 中的相关部分添加"逐步思考"指令
  同时保留 @model-dependent 标注
  ↓
A/B 测试：新 Prompt vs 旧 Prompt，50/50 流量分配
  ↓
验证 Agent（否定者）审查 A/B 结果
  ↓
若新 Prompt 胜出：应用到所有 Agent
```

### L1：编排模式调整（Phase 2）

修改 Team 编排配置（YAML），不改核心代码。

```
Pattern Miner 发现：复杂分析任务用 Debate 模式比 Parallel 模式准确率高 23%
  ↓
Auto-Refactorer L1：
  更新 Scenario Router 的场景→编排模式映射规则
  ↓
验证 + 人类审阅
```

### L2：代码结构重构（Phase 3）

Agent-as-Developer：Agent 修改 Haro 自身的 TypeScript 代码。

**约束**：
- 必须有完整的测试覆盖
- 必须通过 CI/CD 所有检查
- 代码变更提交 PR，供人类审阅

### L3：架构演进（Phase 3）

最高风险层级，涉及架构级别变化。

**约束**：
- 必须经过人类裁决
- 分阶段实施，每阶段验证后才继续

## Pattern Miner

Pattern Miner 从历史执行数据中挖掘成功模式：

```typescript
interface SuccessPattern {
  /** 模式 ID */
  id: string

  /** 触发条件（场景特征） */
  condition: {
    taskTags: string[]
    providerUsed: string
    orchestrationMode: string
  }

  /** 观测到的效果 */
  outcomes: {
    successRate: number
    avgDuration: number
    userSatisfactionAvg: number
  }

  /** 样本数量（达到阈值才考虑应用） */
  sampleCount: number

  /** 置信度（0-1） */
  confidence: number
}
```

**挖掘维度**：
- 哪些 Prompt 指令组合成功率最高
- 哪种编排模式对哪类任务效果最好
- 哪个 Provider/Model 组合对哪类场景最优
- 哪些工具调用序列最高效

## Self-Monitor

Self-Monitor 持续采集平台运行指标，作为进化的原始数据：

```typescript
interface PlatformMetrics {
  timestamp: string

  // Provider 层指标
  providerMetrics: {
    [providerId: string]: {
      callCount: number
      successRate: number
      avgLatency: number
      fallbackRate: number
    }
  }

  // Agent 层指标
  agentMetrics: {
    [agentId: string]: {
      sessionCount: number
      avgCompletionRate: number
      memoryGrowthRate: number  // 记忆增长速率
    }
  }

  // 平台整体
  evolutionCycleCount: number   // 已执行的进化循环次数
  humanInterventionRate: number // 人类干预频率（趋势向下为健康）
}
```

## Agent-as-Maintainer

Phase 3 的核心能力：Haro 的代码由 Agent 自行维护。

**工作流**：

```
问题发现（Self-Monitor / 用户反馈 / Agent 自主发现）
  ↓
需求分析 Agent（从用户反馈、互联网趋势分析需求）
  ↓
设计 Agent（产出设计方案，遵守所有设计约束）
  ↓
实现 Agent（修改代码，使用 Claude Provider 或 Codex Provider）
  ↓
验证 Agent（对抗性测试，否定者角色）
  ↓
CI/CD 自动验证（测试 + Lint + 类型检查）
  ↓
人类审阅 PR（重要变更）
  ↓
合并并部署
```

## Evolution Dashboard

进化过程可视化（Phase 2 交付）：

```
┌─────────────────────────────────────────────┐
│             Evolution Dashboard              │
├─────────────────────────────────────────────┤
│  进化循环: #247  状态: 运行中               │
│  当前阶段: Orient（模式分析）              │
├──────────────────┬──────────────────────────┤
│ Provider 成功率  │ 人类干预频率（趋势）     │
│ Claude: 97.3%   │ ████████░░ 本周 3 次     │
│ Codex:  94.1%   │ ██████░░░░ 上周 5 次     │
├──────────────────┴──────────────────────────┤
│ 最近进化记录                                │
│ #247 [L0] 为 code-reviewer 优化 systemPrompt│
│ #246 [L1] 调整复杂分析任务编排模式          │
│ #245 [L0] 添加"逐步思考"指令 → 成功率+8%  │
└─────────────────────────────────────────────┘
```

**指标说明**：
- **人类干预频率趋势向下**：说明平台自治能力提升，是健康信号
- **进化循环计数**：记录总进化次数，追踪平台成熟度
