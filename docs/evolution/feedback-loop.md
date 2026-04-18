# Evolution Engine — 反馈闭环设计

## 概述

Haro 的 Evolution Engine 实现平台级自进化。反馈闭环是进化的核心驱动机制，确保平台在使用过程中持续改进。

## OODA 循环

Evolution Engine 采用 OODA（Observe → Orient → Decide → Act）循环：

```
Observe（观测）
  ↓
  收集运行数据：
  - Session 成功率 / 失败率
  - Provider 选择命中率
  - Agent 执行时间分布
  - 用户反馈（人类提需求/反馈 Bug）
  - 工具调用成功率

Orient（分析）
  ↓
  Self-Monitor + Pattern Miner：
  - 识别失败模式
  - 挖掘成功模式（哪些 Prompt/编排模式效果好）
  - 与业界最新进展对比（互联网自主获取）

Decide（决策）
  ↓
  规划进化方向（需符合产品设计逻辑）：
  - 优先级排序
  - 人类认可（最好获得人类确认）
  - 或判断为业界更先进的方向（可自主决策）

Act（执行）
  ↓
  Auto-Refactorer：
  - L0: Prompt 优化
  - L1: 编排模式调整
  - L2: 代码结构重构（Phase 3）
  - L3: 架构演进（Phase 3）
```

## 数据收集

### 信息流约束（强制）

**Evolution Engine 各阶段必须能访问前序阶段的完整原始数据**（遵守约束①）：

- `evolution-context/` 共享目录存储各阶段的完整数据
- **禁止**将评估结论压缩为"通过/失败"后传给规划阶段
- 规划阶段直接读取 `evolution-context/` 中的完整评估数据

```
evolution-context/
├── observe/
│   ├── session-metrics.jsonl    # 原始 session 指标
│   ├── failure-events.jsonl     # 完整失败事件记录
│   └── user-feedback.jsonl      # 用户反馈原文
├── orient/
│   ├── pattern-analysis.json    # 完整的模式分析报告
│   └── industry-research.md     # 互联网调研原文
├── decide/
│   └── evolution-plan.json      # 进化计划（含完整推理链）
└── act/
    └── refactor-results.json    # 实施结果
```

### 收集的指标

```typescript
interface EvolutionMetrics {
  // Session 级别
  sessionId: string
  agentId: string
  provider: string
  model: string
  duration: number
  success: boolean
  failureReason?: string

  // 质量指标
  userSatisfaction?: number     // 用户评分（1-5）
  taskCompletionRate: number    // 任务完成率
  retryCount: number            // 重试次数

  // Provider 选择指标
  ruleMatchedId?: string        // 匹配的选择规则
  fallbackTriggered: boolean    // 是否触发 Fallback
}
```

## 反馈来源

### 人类反馈

- **需求输入**：人类直接提出新功能需求
- **Bug 反馈**：人类报告问题
- **方向引导**：人类确认或否定进化方向
- **最终裁决**：重要进化变更需人类审阅

### 自主发现

- **互联网调研**：Agent 自行从互联网获取业界进展
  - 条件：符合 Haro 产品设计逻辑
  - 最好：获得人类认可的方向
  - 或：判断为业界更先进的方向（可自主决策）
- **运行数据挖掘**：Pattern Miner 从历史执行数据中发现规律

## 验证门控

进化结果必须通过验证 Agent 的对抗性测试才能应用（参考 yoyo-evolve 的验证门控）：

```
进化方案
  ↓
验证 Agent（否定者，遵守约束④）
  ├→ 找到问题 → 拒绝，记录问题，重新规划
  └→ 无问题 → 通过门控 → 人类审阅（重大变更）→ 应用
```

**验证 Agent 的职责**：
- 寻找漏洞、边界案例、潜在风险
- 输出否定清单（哪里有问题）
- **不**给出修复建议（那是规划阶段的职责）

## @model-dependent 可演化标注

Prompt 和配置中使用 `@model-dependent` 标注标记可演化部分：

```yaml
# 标注示例
systemPrompt: |
  你是一个代码审查 Agent。
  # @model-dependent: 以下指令可由 Evolution Engine 优化
  在审查代码时，重点关注安全漏洞和性能问题。
  # @model-dependent-end
```

Evolution Engine 识别 `@model-dependent` 标注的内容作为 A/B 测试和自动优化的目标。
