# Team Orchestrator 设计

## 概述

Team Orchestrator 负责多 Agent 协作编排。**本模块必须严格遵守 [多 Agent 设计约束规范](../../specs/multi-agent-design-constraints.md)**，尤其是约束②（推理链分叉再合并）和约束③（并行覆盖不是分工）。

## 核心约束（摘要）

- **Team 拆分维度**：信息属性 / 搜索空间，**禁止**按人类岗位/角色拆分
- **协作拓扑**：hub-spoke，**禁止**串行交接链
- **信息传递**：传原始数据，**禁止**传摘要
- **验证 Agent**：对抗性否定者，不是接棒执行者

## 编排模式

### 模式一：Parallel（并行覆盖）

多个 Agent 围绕同一全局任务并行探索不同方向，Orchestrator 合并结果。

**适用场景**：搜索空间探索、方案比较、A/B 测试

```
                    ┌→ Agent A（探索方案 X）→┐
Orchestrator(任务) →├→ Agent B（探索方案 Y）→┤→ Orchestrator(合并) → 结果
                    └→ Agent C（探索方案 Z）→┘
```

**实现要求**：
- 所有 Agent 都能访问同一份全局原始任务描述和核心上下文（不传摘要）
- 不同 Agent 可以收到不同的探索方向 / 假设 / 搜索策略；这是 Parallel 的价值所在
- Orchestrator 收集所有 Agent 的完整输出后才进行合并
- 合并策略：投票、加权评分、对抗性评估等

### 模式二：Debate（对抗性辩论）

两个 Agent 持不同立场，Orchestrator 根据论点质量裁决。

**适用场景**：决策评估、方案验证、风险识别

```
                    ┌→ Proposer Agent（提出方案）→┐
Orchestrator(任务) →┤                             ├→ Orchestrator(裁决)
                    └→ Critic Agent（对抗性批评）→┘
```

**Critic Agent 设计要求（遵守约束④）**：
- Critic 必须访问原始方案文本（非摘要）
- Critic 的职责是寻找漏洞和问题，输出"否定清单"
- Critic 不得顺手给出修复方案（那是实现 Agent 的职责）

### 模式三：Pipeline（确定性工具链）

仅限无推理分支的确定性工具链，每步输入是上步的完整输出。

**适用场景**：数据清洗、格式转换、日志聚合

**⚠️ 使用限制**：任何涉及推理、判断、分析的场景**禁止**使用 Pipeline 模式。

### 模式四：Hub-Spoke（主从编排）

Orchestrator Agent 动态分配子任务，子 Agent 完成后回报完整结果。

**适用场景**：复杂任务分解（按信息维度，非角色）

```
                    ┌→ Worker A（子任务 1 原始材料）→┐
Orchestrator Agent ─┼→ Worker B（子任务 2 原始材料）→┼→ Orchestrator（合并）
                    └→ Worker C（子任务 3 原始材料）→┘
```

**注意**：子任务分解必须按信息属性，不按角色；Hub-Spoke 和 Parallel 的区别不在于"谁看全局信息"，而在于：
- Parallel：多个成员给出互相竞争或互相校验的候选答案
- Hub-Spoke：多个成员完成互补的子任务切片，最后再综合

子任务分解必须按信息属性，不按角色：
- 正确："Agent A 分析本地代码库，Agent B 搜索在线文档，Agent C 检查 CI 日志"
- 错误："Agent A 是开发，Agent B 是测试，Agent C 是审查"

### 模式五：Evolution Loop（进化循环）

专为 Evolution Engine 设计的三阶段循环编排。

```
评估 Agent（访问原始状态）→ 问题清单（原始数据）→ 规划 Agent → 实现方案 → 验证 Agent（否定者）
        ↑                                                                              |
        └──────────────────────────── Feedback（通过则退出）───────────────────────────┘
```

**信息流约束**：
- 每个阶段必须能访问 `evolution-context/` 中的完整原始数据
- 阶段间传递完整数据，不传"评估通过/失败"这种压缩结论

## Team 定义

Team 本身也是一个 Agent（可递归组合），通过 YAML 配置。Phase 1 会使用独立的 TeamConfig schema；目录可以和普通 Agent 共存，但不复用 Phase 0 的 AgentConfig `.strict()` schema。

```yaml
# ~/.haro/agents/review-team.yaml
id: review-team
name: 代码审查团队
type: team

# Team 成员（按信息维度拆分）
members:
  - agentId: local-code-analyzer    # 分析本地代码
  - agentId: online-doc-searcher    # 搜索在线文档
  - agentId: security-critic        # 安全对抗性审查

# 编排模式
orchestrationMode: parallel

# Parallel / Hub-Spoke 显式声明合并策略
mergeStrategy: adversarial-eval

# Critic（对抗性验证）
critic:
  agentId: security-critic
  role: adversarial  # 必须设为 adversarial，强制遵守约束④
```

## 违规检测

Team Orchestrator 在运行时检测以下违规行为：

| 违规行为 | 检测方式 | 处理 |
|---------|---------|------|
| Agent 只接收摘要（非原始数据） | 检查输入来源 | 警告 + 记录 |
| 串行交接链（A→B→C） | 检查编排图结构 | 拒绝启动 |
| Critic Agent 输出了实现方案 | 检查输出结构 | 警告 |
| 按角色标签创建 Agent | 检查 Agent 配置 | 警告 |
