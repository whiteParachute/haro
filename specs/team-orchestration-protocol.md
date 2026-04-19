# Team Orchestration 协议规范（Phase 1，draft）

**状态：draft。本规范为 **Phase 1 实现前的硬约束锚点**——Phase 0 不实现 Team Orchestrator，但本 spec 定义的约束**自 Phase 0 起即生效**：任何 Phase 0 的 FEAT spec 若试图引入临时多 Agent 组合方案，必须对照本规范，冲突则推迟到 Phase 1。**

## 概述

Team Orchestrator 是 Haro 的多 Agent 协作编排层，属于 [架构概览](../docs/architecture/overview.md) 的第四层（Agent & Team Runtime）的组成部分。本规范定义：

- **Team 抽象**——Team 是什么、如何声明、如何嵌套
- **编排模式契约**——合法的五种模式及各自的硬约束
- **禁止项**——在多 Agent 协作中禁止出现的结构

本规范**不**定义具体实现（Actor 模型选型、消息队列形态、并发控制策略等），那是 Phase 1 起的 FEAT spec 负责的。

## 与其他规范的关系

| 规范 | 关系 |
|---|---|
| [multi-agent-design-constraints.md](./multi-agent-design-constraints.md) | 五条强制约束（①~⑤）是本规范的**直接理论基础**；本规范不重复定义，只给出在 Team 编排层的协议化落地 |
| [design-principles.md](./design-principles.md) | P1（可插拔）：Team Orchestrator 作为核心模块**不可拆**；P4（Steering）：Team 配置禁岗位字段；P5（Capability-Full × Context-Minimal）：成员工具暴露策略；P6（Validation Loop）：Critic Agent 是验证循环的编排形式 |
| [evolution-engine-protocol.md](./evolution-engine-protocol.md) | Evolution Loop 模式是 Evolution Engine 在 Team 编排层的特例；其 Critic 对接 E7/E7a |
| [provider-protocol.md](./provider-protocol.md) | Team 成员调用 Provider 时遵循 PAL 的通用契约；Team 编排层对 Provider 层零特判（P1） |
| FEAT-004 / FEAT-005 | FEAT-004 只定义**单 Agent** schema；Team 使用独立 TeamConfig schema。FEAT-005 的单 Agent Runner 是 Team 编排的基本执行单元；Team 层调用多个 Runner 实例 |

---

## 一、Team 抽象

### 约束 T1：Team 是可递归组合的 Agent

**规则**：Team 本身也是一个 Agent——它接收任务、产出结果，对上层透明；内部是多个 Agent 的协作编排。Team 可以嵌套 Team（Team-of-Teams），**递归深度不设硬上限但需要 Critic 审查**（见 T12）。

**合规设计**：
- Team 的外部接口与 Agent 完全一致（单次任务输入 → 结果输出）
- 上层调用方**不需要**知道被调对象是单 Agent 还是 Team
- 嵌套 Team 的中间编排节点必须能被 Checkpointing 定位，不得把嵌套 Team 视为"黑盒一次调用"而跳过内部 Checkpoint

**违规示例（禁止）**：
- Team 对外暴露内部成员列表作为接口契约 → 上层耦合到内部结构，破坏递归性
- Team 内部使用外部调用方无法 Checkpoint 的同步黑盒操作 → 破坏推理链可回放性

---

### 约束 T2：Team 声明格式

**规则**：Team 与普通 Agent 一样以 YAML 文件存储在 `~/.haro/agents/` 下，通过 `type: team` 字段区分。**目录扫描框架可以复用 FEAT-004 的发现逻辑，但 Team 必须使用独立的 TeamConfig schema / Team loader，不得直接复用 FEAT-004 的 AgentConfig `.strict()` 校验。**

**Team YAML 字段分层**：

**通用必填字段**：

```yaml
id: <kebab-case>                # 同 FEAT-004 R1
name: <人类可读名>
type: team                      # 固定值；单 Agent 默认为 'agent'，可省略
systemPrompt: <Team 级提示词>   # 描述 Team 目的，不描述成员如何工作
orchestrationMode: <mode>        # 必填，见 T4
members:                         # 必填，至少 1 项（1 项 Team 合法，但需说明理由）
  - agentId: <成员引用>
# mode-specific：
mergeStrategy: <strategy>        # parallel / hub-spoke 必填；见 T5 / T8
critic:                          # 若 mode 涉及 Critic 则必填
  agentId: <Critic Agent id>
  role: adversarial              # 固定值，强制对齐约束④
pipelineJustification: <text>    # pipeline 必填；见 T7
nestingJustification: <text>     # 超过嵌套阈值时必填；见 T12
```

**严格模式**：Team YAML 同 FEAT-004 R2 的精神，采用 `.strict()` 校验；但**合法字段集合由 TeamConfig schema 明确定义**，包括"通用字段 + mode-specific 字段"。未知字段一律拒绝，错误信息固定为：`Unknown field '<name>' in team '<id>'. Team 的行为由 orchestrationMode、members 与 mode-specific 字段定义（见 team-orchestration-protocol §T2）`。

**mode-specific 约束**：
- `parallel`：必须声明 `mergeStrategy`
- `hub-spoke`：必须声明 `mergeStrategy`
- `debate`：必须声明 `critic`
- `pipeline`：必须声明 `pipelineJustification`
- `evolution-loop`：Critic 与阶段契约见 T9；额外运行时结构由 Evolution Engine spec 定义
- 超过 `team.nestingDepthThreshold`：必须声明 `nestingJustification`

**禁止字段**（不得出现在 Team YAML 中；做法是 schema 不提供这些字段，不是维护关键词黑名单）：
- `role` / `goal` / `backstory` / `skills`（岗位式思维残留，违反约束⑤ + P4）
- `workflow` / `sequence` / `steps`（编排步骤的具体化违反约束②，应由 `orchestrationMode` 指定模式而非手写步骤）
- `permissions` / `access`（成员权限由成员自己的 Agent YAML 定义，Team 不做二次限制）

---

### 约束 T3：成员拆分维度——信息属性而非岗位

**规则**：Team 成员的拆分维度**必须**是信息属性 / 搜索空间 / 证据来源，**禁止**按人类岗位、职能或推理 handoff 阶段拆分。本约束是[多 Agent 约束⑤](./multi-agent-design-constraints.md)在 Team 编排层的强制落地。

**合规拆分（按信息维度）**：
- `local-code-analyzer` 分析本地代码
- `online-doc-searcher` 搜索在线文档
- `ci-log-inspector` 检查 CI 日志
- `historical-memory-miner` 挖历史记忆

**违规拆分（按岗位）**：
- `developer-agent` / `tester-agent` / `reviewer-agent` / `pm-agent`
- `frontend-dev` / `backend-dev`

**判定规则**：Critic 审核 Team YAML 时检查 `members[].agentId` 引用的 Agent 定义与 Team 对成员职责的描述；若协作结构已经退化为"开发/测试/产品/经理"这类人类岗位分工，而不是信息维度拆分 → Team 注册被拒绝。

---

## 二、编排模式契约

### 约束 T4：合法的编排模式清单

**规则**：`orchestrationMode` 字段**仅**允许以下五种取值；新增模式必须修订本规范（走 BUG/RFC spec 流程）。

| 模式 | 用途 | Phase 启用 | 核心契约 |
|---|---|---|---|
| `parallel` | 并行覆盖（同一全局任务的多路探索） | Phase 1 | 成员共享同一全局原始材料，但各自收到不同的探索指令；输出是互相竞争或互相校验的候选结果 |
| `debate` | 对抗性辩论（决策 / 方案验证） | Phase 1 | Proposer + Critic；Critic 遵守约束④（只否定不接棒） |
| `pipeline` | 确定性工具链 | Phase 1 | ⚠️ **仅限无推理分支的机械步骤**；涉及推理/判断**禁用** |
| `hub-spoke` | 主从编排（任务分解） | Phase 1 | Orchestrator 分配子任务；子任务必须按信息维度（T3） |
| `evolution-loop` | 进化循环（OODA 专用） | Phase 2 | 对接 Evolution Engine；Critic 契约对接 [E7/E7a](./evolution-engine-protocol.md) |

**每种模式的详细契约见 T5-T9**。

---

### 约束 T5：Parallel 模式契约

**形状**：
```
               ┌→ Agent A（全局任务 + 探索方向 X）→┐
Orchestrator ──┼→ Agent B（全局任务 + 探索方向 Y）→┼→ Orchestrator（合并）→ 结果
               └→ Agent C（全局任务 + 探索方向 Z）→┘
```

**硬约束**：
- **全局上下文一致**：所有成员都必须能访问**同一份全局原始任务描述与核心上下文**；不允许某个成员因看不到原始材料而只能消费 Orchestrator 的摘要（违反约束①）
- **探索指令允许不同**：Parallel 的价值是对同一全局任务做多路探索，因此 Orchestrator **可以**给不同成员分配不同的探索方向 / 假设 / 搜索策略；只要全局原始材料保持一致，这不构成违规
- **输出完整性**：Orchestrator **必须**收到所有成员的完整输出（不压缩、不截断）再进行合并；任何基于部分成员产出的 early-return 属于违规（违反约束②）
- **合并策略显式声明**：Team YAML 必须在 `mergeStrategy` 字段声明合并方式；**取值开放**（不枚举锁定），但由 Critic 在 Team 注册时审核"该策略与本 Team 任务匹配性是否合理"；未声明或策略语义不清 → 拒绝注册

**设计边界**：
- Parallel 产出的多个结果是**对同一问题的候选答案 / 候选判断 / 候选方案**，彼此存在竞争、交叉验证或覆盖关系
- 如果每个成员承担的是**互补且缺一不可**的子任务切片（例如一人读代码、一人查文档、一人翻 CI，再由上层拼装成完整答案），那更接近 `hub-spoke` 而不是 `parallel`

**当前已知的合并策略**（非穷举，仅作参考；新策略由使用方按需增加并在 Critic 审核时说明）：

| 策略名 | 语义 | 适用 |
|---|---|---|
| `vote` | 多数投票；平票时交由人类裁决 | 结果是离散选项 / 分类判断 |
| `weighted-score` | 成员输出各自带分数，按预设权重加权 | 结果可被打分（如质量 / 置信度） |
| `adversarial-eval` | 成员输出交另一 Critic Agent 独立评估后裁决 | 与 Debate 模式的融合用法；方案对比 |
| `union` | 合集（去重后并集） | 搜索空间覆盖类任务（如多源调研） |
| `best-of-n` | 按评分选最高的一个 | 方案生成 / 内容撰写 |
| `custom:<skill-id>` | 调用指定 skill 做自定义合并 | 任何上述不覆盖的场景 |

**扩展机制**：新增合并策略的门槛——在 Team YAML 的 `mergeStrategy` 使用新名字即可，但 Critic 审核时要求团队**同时**提供：(1) 策略的语义定义、(2) 为何现有策略不够用、(3) 该策略不会退化为摘要传递（不违反 T11）的证明。审核通过的新策略**应该**回头补入本规范的"已知策略表"（走 spec amend 流程）。

**违规示例（禁止）**：
- 成员 A 先完成后 Orchestrator 就返回，不等 B/C → 违反输出完整性
- 成员之间互相传递中间结果 → 变成 chain，违反约束②

---

### 约束 T6：Debate 模式契约

**形状**：
```
               ┌→ Proposer（提出方案）─→┐
Orchestrator ──┤                         ├→ Orchestrator（裁决）
               └→ Critic（对抗性批评）─→┘
```

**硬约束**：
- **Critic 访问原文**：Critic 必须接收 Proposer 的**完整**方案（不是 Orchestrator 的摘要）→ 违反约束①
- **Critic 不接棒**：Critic 的输出必须是**否定清单**；**禁止**含 `suggestion` / `fix` / `alternative` / `revised_proposal` 字段（对齐约束④）
- **裁决主体是 Orchestrator**：Proposer 和 Critic 之间**不直接交互**；所有信息流经 Orchestrator。若让 Critic 给 Proposer 回复后继续迭代 → 变成 chain，违反约束②
- **`critic.role` 固定为 `adversarial`**：其他取值（如 `collaborative` / `advisor`）一律拒绝

**与 Evolution Engine 的对齐**：Debate 模式的 Critic 契约是 [E7 Critic](./evolution-engine-protocol.md#约束-e7每次进化方案必须通过对抗性验证) 的一般化；Evolution Loop（T9）是 Debate 在进化场景的专用变体。

---

### 约束 T7：Pipeline 模式契约（使用限制）

**形状**：
```
输入 → Step A → Step B → Step C → 输出
```

**硬约束 / 限制**：
- **仅限无推理分支的确定性工具链**：数据清洗、格式转换、日志聚合等机械步骤
- **任何涉及推理 / 判断 / 分析的场景一律禁用**——该用 Parallel / Debate / Hub-Spoke
- **每步输入 = 上步完整输出**：禁止摘要；违反即 violate 约束①
- **Team YAML 必须声明 `pipelineJustification` 字段**说明"本 Pipeline 为何不涉及推理"，Critic 在注册时审核；未声明或说明空洞拒绝注册

**违规示例（禁止）**：
- Pipeline 的某一步调用 LLM 做"判断是否符合要求"→ 涉及推理，违反限制
- 声明为 Pipeline 但实际某步依赖上步的"评估结论"而非"原始产物"→ 违反约束①

**设计意图**：Pipeline 的存在是为承接确定性 ETL 类工作，不是为了便利地堆叠多 Agent。默认下设计者应从 Parallel / Debate / Hub-Spoke 选起；明确无推理时才选 Pipeline。

---

### 约束 T8：Hub-Spoke 模式契约

**形状**：
```
                   ┌→ Worker A（子任务 1 原始材料）→┐
Orchestrator Agent ┼→ Worker B（子任务 2 原始材料）→┼→ Orchestrator（合并）
                   └→ Worker C（子任务 3 原始材料）→┘
```

**硬约束**：
- **子任务拆分按信息维度**（T3 强制落地）；违反拆分维度视为 Team 注册失败
- **Worker 之间不通信**：任何 Worker-to-Worker 消息通道属于违规（变成隐式 chain）
- **原始材料透传**：Orchestrator 把原始任务+分片后的原始材料传给 Worker，**不传**自己的中间理解
- **合并阶段必须能访问所有 Worker 的完整输出**：同 T5 的输出完整性约束

**与 Parallel 的区别**：
- Parallel：共享同一全局任务，输出是多个候选答案/判断，最后做竞争性合并
- Hub-Spoke：共享全局背景，但每个 Worker 负责一个互补子任务切片；最终结果依赖所有切片回流后再综合
- 两者都可以让成员看到全局原始信息；差别不在"谁看全局"，而在"输出关系是竞争型还是互补型"

---

### 约束 T9：Evolution Loop 模式契约

**形状**：
```
评估 Agent（读 observe/ 原始数据）
    → 问题清单 → 规划 Agent
    → 实现方案 → 验证 Agent（对接 E7 Critic）
    → Feedback（通过则 Act / 不通过则回规划）
```

**硬约束**：
- **专用于 Evolution Engine**，不作通用多 Agent 模式使用
- **各阶段必须能访问 `evolution-context/` 前序阶段的完整原始数据**（直接落地 [E2](./evolution-engine-protocol.md)）
- **Critic = E7/E7a 的实现**：其 CriticReport 结构按 [evolution-engine-protocol.md E7/E7a](./evolution-engine-protocol.md) 契约，**包含 `principle_conflict_analysis`**
- **反馈不是 chain**：验证未通过时，Feedback 回到**规划阶段**而非"让 Critic 给 Proposer"；这是约束②的具体落地
- Phase 启用：**Phase 2 才可使用**（Phase 0/1 不得引入 Evolution Loop）

---

## 三、禁止项（跨模式）

### 约束 T10：禁止串行 chain 拓扑

**规则**：任何形如 `A → B → C → D` 的串行交接链**一律禁止**，无论 A/B/C/D 是否都被命名为"Agent"。本约束是[多 Agent 约束②](./multi-agent-design-constraints.md)的协议级兜底。

**违规示例**：
- 用 Pipeline 实现其实涉及推理的串行流程 → 违反 T7 + T10
- 多个 Debate 轮次首尾相接形成隐式 chain → 违反 T10

**合法的"多步"形式**：必须是 Hub-Spoke 或 Evolution Loop 的受控回流（中间点回到 Orchestrator），而非成员间的直接交接。

---

### 约束 T11：禁止摘要传递（跨成员 / 跨阶段）

**规则**：Team 内部传递必须是**原始材料**，**禁止**由 Orchestrator 或任何中间环节对原始内容做摘要后投递给下一成员。本约束是[约束①](./multi-agent-design-constraints.md)的协议级兜底。

**落地要求**：
- 原始材料存放于 Memory Fabric 或 evolution-context/；Team 调用时传引用（文件路径 / memory id），**不**传压缩后的文本
- 当材料实在过大时，采用"分片后各自读原片段"的方式（对应 P7 filesystem-as-substrate），**不**做语义摘要
- 确因规模必须摘要时，必须**同时**提供原始引用，让下游可选择深读

**违规示例**：
- Orchestrator 在分发 Parallel 任务时把任务"总结"成几句话 → 违反
- Hub-Spoke 中 Orchestrator 把跨部分的共识总结后再发给 Worker → 违反

---

### 约束 T12：禁止跨 Team 嵌套深度无界失控

**规则**：Team-of-Teams 嵌套**允许**，但每层嵌套必须有**明确语义理由**（写入 `nestingJustification` 字段）；嵌套深度超过阈值的 Team 必须在 Critic 审核中给出单独的"嵌套必要性分析"才能注册。

**阈值可配置**：深度阈值由 `~/.haro/config.yaml::team.nestingDepthThreshold` 控制，**默认 3**；取值范围 `[1, 10]`，低于 1 或高于 10 配置加载时拒绝。项目级 `.haro/config.yaml` 可覆盖全局值。

**判定依据**：嵌套本身不违规；**过度嵌套是设计债的信号**——大概率意味着拆分维度选错了（违反 T3），或者用 Team 替代了本应由 skill 或工具完成的工作。阈值只是"何时强制 Critic 额外审视"的触发线，不是"绝对不许超过"的硬墙。

**违规示例**：
- 嵌套深度超过阈值但 `nestingJustification` 缺失或空洞（如"需要更灵活"）→ 拒绝注册
- 每层只有 1 个成员却嵌套多层 → 明显设计有问题
- 为了"看起来更模块化"而嵌套但嵌套层之间没有实质的信息维度差异

---

### 约束 T13：禁止岗位式 Team / Agent 语义

**规则**：与 T3 互补——无论是 Team 配置还是其引用的成员 Agent，**都不得**把协作结构建模成人类岗位/部门分工。[约束⑤](./multi-agent-design-constraints.md) + [P4](./design-principles.md) 的协议级兜底。

**判定方式**：
- 不维护岗位关键词黑名单；这会和 FEAT-004 的设计边界冲突，也会把合法的验证型 / 观察型 Agent 误伤为非法
- 由 TeamConfig schema 禁止岗位式字段（T2），由 Critic 在注册审核时判断该 Team 的成员职责描述是否已经退化为人类岗位分工
- 若某类岗位式命名/描述反复出现，立 BUG / RFC spec 追踪根因，而不是向协议里追加黑名单词表

---

## 四、违规检测清单

| 违规行为 | 检测方式 | 处理 |
|---|---|---|
| Team YAML 含未知字段（违反 T2 strict） | 加载时 `.strict()` 校验 | 拒绝加载 + 固定错误信息 |
| Team / 成员职责描述退化为岗位分工（违反 T3/T13） | Critic 注册审核 + schema 字段约束 | 拒绝注册 |
| Parallel 模式 Orchestrator 提前 return（违反 T5） | 运行时 Checkpoint 审计 | 标记异常 session + warn |
| Debate 模式 Critic 输出含 suggestion/fix（违反 T6 + 约束④） | Critic 输出 schema 校验 | 丢弃该 Critic 结果 + warn |
| Pipeline 模式涉及推理（违反 T7） | Critic 在 Team 注册时审核 `pipelineJustification` | 拒绝注册 |
| Hub-Spoke Worker 间直接通信（违反 T8） | 运行时消息通道审计 | 拒绝该通信 + Team 暂停 |
| Evolution Loop 在 Phase 0/1 被调用（违反 T9） | 运行时 Phase check | 拒绝启动 |
| 串行 chain 拓扑（违反 T10） | Team 注册时图结构检查 | 拒绝注册 |
| Orchestrator 传摘要而非原文（违反 T11） | 代码审查 + 运行时数据审计 | 视严重程度 block / warn |
| 嵌套超过 `team.nestingDepthThreshold` 无 justification（违反 T12） | Team 注册时检查 | 要求补 justification，否则拒绝 |
| `mergeStrategy` 未声明或语义不清（违反 T5） | Team 注册时 Critic 审核 | 拒绝注册 |

---

## 五、Phase 0 的生效边界

**Phase 0 不实现 Team Orchestrator**。因此本规范要拆成两类：

### A. 即刻生效的设计禁令（从 Phase 0 起生效）

- 任何 Phase 0 的 FEAT spec 若试图引入"多 Agent 临时组合"方案，必须对照本规范；冲突项推迟到 Phase 1
- Phase 0 只允许**单 Agent 执行循环**（FEAT-005）+ Agent 的 sub-agent 调用（通过 Claude/Codex SDK 的 tool loop），**不得**出现上述五种模式的正式实现
- 即使在 Phase 0 的草案设计中，也不得引入以下反模式：
  - 按岗位/部门拆成员
  - 串行 chain handoff
  - 用摘要替代原始材料做跨 Agent 传递
  - 让 Critic 变成接棒执行者
- Phase 0 若有"看起来像多 Agent"的功能（如 Evolution Engine 的初步形态），必须归入单 Agent 范畴或显式标注"不是 Team 编排"

### B. Phase 1 才能真正落地的 enforcement

- TeamConfig schema 校验
- Team loader / registry
- 编排图结构检查
- 运行时消息通道审计
- Critic 注册审核
- Phase gating（如 `evolution-loop` 仅 Phase 2 启用）

换句话说：**Phase 0 先执行设计约束，Phase 1 再补自动化 enforcement。** 本规范在 Phase 0 不是"现在就能靠代码拦住一切"，而是"现在就不允许把架构往错误方向写"。

## 六、名词定义

| 名词 | 定义 |
|---|---|
| Team | 由多个 Agent 组成、对外表现为一个 Agent 的协作单元（T1） |
| Orchestrator | Team 的协调者角色；负责分发任务、合并结果、应用 mergeStrategy；本身是 Agent（不是单独类） |
| Worker | Hub-Spoke 模式下承担具体子任务的成员 Agent |
| Proposer / Critic | Debate 模式的两种角色；Critic 遵守 adversarial 契约 |
| Evolution Loop | 专为 Evolution Engine 设计的编排模式；对接 [evolution-engine-protocol.md](./evolution-engine-protocol.md) |

## 参考

- [multi-agent-design-constraints.md](./multi-agent-design-constraints.md)
- [design-principles.md](./design-principles.md)
- [evolution-engine-protocol.md](./evolution-engine-protocol.md)
- [provider-protocol.md](./provider-protocol.md)
- [FEAT-004-minimal-agent-definition.md](./phase-0/FEAT-004-minimal-agent-definition.md)

## Changelog

- 2026-04-19: whiteParachute — 初稿 draft（Phase 1 实现前锚点）。整合 `docs/modules/team-orchestrator.md` 的 5 种编排模式 + 违规检测，硬约束化为 13 条（T1-T13），并与 multi-agent 约束 ① ② ④ ⑤ + design-principles P1/P4/P5/P6 + evolution-engine-protocol E7/E7a 对齐。Phase 0 不实现，但约束即刻生效
- 2026-04-19: whiteParachute — 两处 relaxation：
  - T5 `mergeStrategy` 改为**取值开放**；列出 6 种已知策略（`vote` / `weighted-score` / `adversarial-eval` / `union` / `best-of-n` / `custom:<skill-id>`）作参考；新策略由使用方提供语义定义+为何现有不够用+不退化摘要传递证明，Critic 审核通过后回头补入本规范
  - T12 嵌套深度阈值从硬编码 `3` 改为 `team.nestingDepthThreshold` 配置项（默认 3，范围 [1, 10]），项目级可覆盖
  - 未 approved，等待用户审阅
- 2026-04-19: whiteParachute — 设计对齐修订：
  - T2 明确 Team 复用目录发现思路，但**不**复用 FEAT-004 的 AgentConfig `.strict()` schema；改为独立 TeamConfig schema，并把 `mergeStrategy` / `pipelineJustification` / `nestingJustification` 收入 mode-specific 合法字段集合
  - T3/T13 去掉岗位关键词黑名单；改为 schema 字段边界 + Critic 语义审核，避免和 FEAT-004 冲突并误伤合法 Agent
  - T5 重写 `parallel`：成员共享同一全局原始信息，但允许带不同探索指令；与 `hub-spoke` 的边界改为"竞争型输出 vs 互补型输出"
  - §五重写：区分"Phase 0 即刻生效的设计禁令"与"Phase 1 才落地的 enforcement"
