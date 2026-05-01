# Evolution Engine 协议规范（强制）

**状态：强制执行。所有 Evolution Engine 相关实现（Self-Monitor / Pattern Miner / Auto-Refactorer / Verifier 等）必须遵守本规范。**

## 概述

Evolution Engine 是 Haro 的自我进化层。本规范定义其**数据流、接口契约、自治边界**——让平台持续改进而不膨胀、不走偏。

Evolution Engine 由三件套组成：

- **OODA 循环**：Observe → Orient → Decide → Act 的线性改进主干
- **验证门控**：每次进化必须经过对抗性 Critic Agent 审查（遵守[多 Agent 约束④](./multi-agent-design-constraints.md)）
- **代谢机制**：eat/shit 的增减有度（见 [evolution-metabolism.md](./evolution-metabolism.md)，本规范不重复定义）

## 与其他规范的关系

| 规范 | 关系 |
|---|---|
| [design-principles.md](./design-principles.md) | 本协议是 P3（Harness 就是产品）/ P6（验证循环非可选）在 Evolution 层的落地；evolution-context/ 体现 P7（Filesystem as Context Substrate） |
| [multi-agent-design-constraints.md](./multi-agent-design-constraints.md) | 阶段间数据流约束是约束①（传原文者活）的协议化；验证门控是约束④（验证 Agent 是否定者）的协议化 |
| [evolution-metabolism.md](./evolution-metabolism.md) | eat 承接 Observe 阶段的用户反馈/互联网调研产出；shit 扫描 Act 阶段留下的代码遗产 |
| [provider-protocol.md](./provider-protocol.md) | Auto-Refactorer 执行时是 AgentProvider 的调用方 |
| FEAT-007 Memory Fabric | evolution-context/ 是临时工作台；Memory 是跨进化周期的长期知识仓（见本规范 §八） |

## Phase 映射（2026-05-01 重排后）

OODA 协议是跨阶段的持久契约。具体落地按 Phase 2.0 / 2.5 / 3.0 / 3.5 分批实现：

| Phase | OODA 段 | 实现 spec | 落地内容 | 自治水平 |
|---|---|---|---|---|
| **Phase 2.0 Awareness** | Observe（被动观测） | [FEAT-040 Self-Monitor](./phase-2.0/FEAT-040-self-monitor.md) | session / tool / channel / memory / budget 等被动埋点；feature views | 仅采集，不分析 |
| Phase 2.0 | Observe（外部信号） | [FEAT-036 Industry Intel](./phase-2.0/FEAT-036-industry-intel.md) | RSS / Atom / GitHub Release 订阅 + 自动 eat | 自动入库，不改 platform |
| Phase 2.0 | Act（dry-run only） | [FEAT-041 Auto eat/shit Trigger](./phase-2.0/FEAT-041-auto-eat-shit-trigger.md) | 政策驱动 dry-run + artifact 持久化（`bridge_status: pending-bridge`） | 仅写产物，不写 platform 状态 |
| **Phase 2.5 Proposal** | Orient | [FEAT-042 Pattern Miner](./phase-2.5/FEAT-042-pattern-miner.md) | 跨源（Self-Monitor + Intel + Memory）模式归纳；confidence ∈ [0,1] | Agent 思考，不产生改动 |
| Phase 2.5 | Decide | [FEAT-037 Evolution Proposal](./phase-2.5/FEAT-037-evolution-proposal.md) | 结构化提案 + Dashboard 审批队列 + bridge from FEAT-041 artifacts + decision log | Owner 决策，平台执行 |
| **Phase 3.0 Controlled Self-Evolution** | Act（受控） | （后续 spec） | Auto-Refactorer L0（Prompt） + L1（编排 / skill 配置）；approval 后自动落地 + 灰度 + 回滚 | Agent 自治，人类监督 |
| **Phase 3.5 Agent-as-Developer** | Act（开放） | （后续 spec） | Auto-Refactorer L2（结构重构）+ L3（架构演进）；Agent 自写 spec / 自提 PR | Agent 自治，人类引导 |

**约束 E1（OODA 单向）的 Phase 落地**：

- Phase 2.0 实现 Observe 段（FEAT-040 + FEAT-036），并把 Act 段限制为 dry-run（FEAT-041）；Orient / Decide 段在本阶段缺失，因此触发器仅落 artifact 等待桥接
- Phase 2.5 补齐 Orient（FEAT-042）和 Decide（FEAT-037）；FEAT-041 artifact 的 `bridge_status: pending-bridge` 在此阶段被 bridge 模块扫描转为 proposal
- Phase 3.0 / 3.5 补齐 Act 真正的 platform 改动；Auto-Refactorer 的 L 等级与 E10-E12 门控栈对齐

**约束 E13（按变更类型分类自治）的 Phase 落地**：

- Bugfix（Agent 自主 + 事后 review）— Phase 3.0 起允许 Auto-Refactorer 接手 L0 / L1 自动 fix；事后写 `human-review-queue.jsonl`
- Feature Request（人类决策 + Agent 实现）— Phase 2.5 FEAT-037 Evolution Proposal 是该流程的承载者
- Architecture Evolution（人类亲自决定 + Agent 协助）— Phase 3.5 才允许 Agent 提出，仍由 owner 在 Dashboard 决议

---

## 一、OODA 契约

### 约束 E1：四阶段边界清晰且单向

**规则**：OODA 四阶段的执行顺序严格为 Observe → Orient → Decide → Act，后阶段不得回写前阶段的输入。每个阶段的产物落到 `evolution-context/` 对应子目录，下一阶段从该目录读入。

**阶段职责**：

| 阶段 | 职责 | 禁止 |
|---|---|---|
| Observe（观测） | 采集原始运行数据 / 失败事件 / 用户反馈 / 互联网调研原文 | 做任何分析结论（只落原始数据） |
| Orient（分析） | Self-Monitor + Pattern Miner 从 observe/ 读入原始数据，产出模式分析报告 | 跳过某条原始数据而不说明理由；把结论压缩为 yes/no |
| Decide（决策） | 规划进化方案（含完整推理链）；判定是否需要人类认可 | 不读 orient/ 的完整内容就下结论 |
| Act（执行） | Auto-Refactorer 按 decide/evolution-plan.json 执行变更 | 在执行过程中临时添加未经 decide 阶段批准的改动 |

**违规判定**：代码审查 + `evolution-context/` 目录审计；任一阶段的输入不是前序阶段的**完整**输出即为违规。

---

### 约束 E2：阶段间只传原始数据，不传摘要

**规则**：前序阶段的产物必须是**原始数据**，后序阶段可自己重新分析、但不得接受上游压缩过的结论。

**合规设计**：
- `observe/failure-events.jsonl` 存完整失败事件（含 stack trace、工具调用记录、上下文片段），不存"3 个问题待修复"的摘要
- `orient/pattern-analysis.json` 里除了 pattern summary，必须引用对应的原始事件 ID；Decide 阶段可回查
- `decide/evolution-plan.json` 除了变更动作，必须附**完整推理链**（为何选方案 A 不选 B）

**违规示例（禁止）**：
```json
// orient/pattern-analysis.json 只写结论
{ "pattern": "工具调用超时", "suggestion": "加超时保护" }
```

**合规示例**：
```json
{
  "pattern_id": "p-001",
  "description": "工具调用在 >2s 后超时",
  "evidence_refs": ["failure-events.jsonl#L42", "failure-events.jsonl#L57"],
  "sample_count": 12,
  "confidence": 0.82,
  "raw_samples": [/* 完整事件原文 */]
}
```

**与多 Agent 约束①的对齐**：本约束是约束①（传原文者活）在 Evolution 流水线上的专用版本。

---

### 约束 E3：触发时机按 Phase 分级

**规则**：OODA 循环的触发方式随 Phase 演进收紧自动化程度，**不得越级自动化**。

| Phase | Observe 触发 | Orient 触发 | Decide 触发 | Act 触发 |
|---|---|---|---|---|
| 0 | 手动（`haro evolve observe`） | 手动 | 手动 | 手动（L0 prompt 改动仅） |
| 1 | 自动（按 session 收尾 / 按周） | 手动 | 手动 | 手动 |
| 2 | 自动 | 自动 | 手动（重要变更） | 手动审批后自动执行 L0/L1 |
| 3 | 自动 | 自动 | 自动（L0/L1）/ 手动（L2/L3） | 自动（L0/L1）/ 手动（L2/L3） |

**违规判定**：Phase 0 阶段若代码里出现"周期性自动触发 OODA"的定时器——拒绝合入；应走手动入口。

---

## 二、evolution-context/ 目录协议

### 约束 E4：目录结构与文件格式

**规则**：Evolution Engine 共享工作目录的结构与文件命名**固定**，各阶段读写路径**不得自定义**。

**标准布局**：
```
~/.haro/evolution-context/
├── observe/
│   ├── session-metrics.jsonl    # 每行一条 EvolutionMetrics
│   ├── failure-events.jsonl     # 每行一条完整失败事件
│   ├── user-feedback.jsonl      # 每行一条用户反馈原文 + 元数据
│   └── industry-research/       # 每份调研一个独立 md 文件
│       └── <yyyy-mm-dd>-<slug>.md
├── orient/
│   ├── pattern-analysis.json    # Pattern Miner 产物（含原始事件 ref）
│   ├── metrics-summary.json     # Self-Monitor 聚合（附原始样本 ref）
│   └── gap-analysis.md          # 与业界对比（若 Phase 2+）
├── decide/
│   ├── evolution-plan.json      # 本次变更动作 + 推理链
│   └── human-gate.json          # 若触发人类认可：请求 + 批准记录
└── act/
    ├── refactor-results.json    # 执行结果 + 验证报告
    └── rollback-log.jsonl       # 回滚点（每次变更一条）
```

**数据格式契约**：
- 所有 `.jsonl` 文件：UTF-8、每行一条完整 JSON、不跨行
- 所有 `.json` 文件：人类可读（缩进 2 空格）、带 `generated_at` 和 `schema_version`
- 所有 `.md` 文件：含 frontmatter（至少 `id` / `created_at` / `source`）

**新增字段的规则**：允许 append，**禁止 rename 或删除已有字段**；字段移除必须走 BUG spec + 归档历史数据。

---

### 约束 E5：原始数据不压缩 / 不删除

**规则**：`evolution-context/` 中的**原始数据**（observe/ 的三份 jsonl + industry-research/ 的 md）**禁止被 Evolution Engine 自己删除或压缩**。

**保留策略**：
- 默认保留 90 天原始数据
- 超过保留期后**转入归档**（`~/.haro/archive/evolution-<yyyy-mm>/`），不直接删除
- 归档由 shit 代谢扫描触发（见 [evolution-metabolism.md](./evolution-metabolism.md)），**不允许** Auto-Refactorer 自行决定归档

**违规示例（禁止）**：
- Self-Monitor 发现 metrics 太多自己截断前 N 天 → 破坏 E2 的原始数据可回溯性
- Pattern Miner 分析完删除已"学过"的事件 → 违反 E5

---

### 约束 E6：evolution-context/ 是工作台，不是知识仓

**规则**：`evolution-context/` 是**本次进化周期的临时工作空间**；Agent 的长期知识必须走 [P8 Memory](./design-principles.md#P8)，**不得**依赖 evolution-context/ 作为长期查询的数据源。

**转化路径**（见本规范 §八）：
- Act 阶段完成后，成功经验通过 `eat` 沉淀到 Memory（rules / skills / knowledge）
- 失败模式通过 Memory write 记录到 `agents/<id>/knowledge/anti-patterns/`
- 本周期结束，evolution-context/ 的当期数据在保留期后归档

---

## 三、验证门控协议

### 约束 E7：每次进化方案必须通过对抗性验证

**规则**：Decide 阶段产出的 `evolution-plan.json` 在 Act 之前**必须**经过 Critic Agent 审查；未通过或未审查的方案**禁止**进入 Act。

**Critic Agent 接口契约**：

```typescript
interface EvolutionCritic {
  /**
   * 输入：Decide 阶段的完整方案 + 前序阶段的原始数据路径
   *       Critic 必须能回读 observe/ 和 orient/ 完整内容
   * 输出：否定清单（issues）+ 放行标记
   *
   * 违规检测（E8）：issues 中不得出现 fix/recommendation 字段
   */
  review(plan: EvolutionPlan, contextDir: string): Promise<CriticReport>;
}

interface CriticReport {
  /** 发现的问题（纯否定，不含修复方案） */
  issues: Array<{
    severity: 'block' | 'warn';
    category: 'correctness' | 'regression' | 'coverage' | 'principle-violation' | 'other';
    description: string;
    evidence_refs: string[];  // 指向 evolution-context/ 内具体位置
  }>;
  /** 通过判定 */
  passed: boolean;
  /** 若 passed=false，必须列出 block 级 issue */
}
```

**放行条件**：`issues` 中不存在 `severity === 'block'` 的条目即为通过。

**重大变更的附加门控**：涉及 Feature Request / Architecture Evolution 的方案**必须**在 Critic 通过后再经人类事前 approve（写入 `decide/human-gate.json`）才能 Act——见 E13。

---

### 约束 E7a：Critic 必须独立判断原则冲突

**规则**：Critic 的 `review()` 实现**必须**把"是否与 [design-principles.md](./design-principles.md) 任一条原则冲突"作为**必填分析维度**，**独立**判断，**不采信** Agent 在 `principle_alignment.agent_assessment` 字段的自标结论。

**CriticReport 扩充契约**：

```typescript
interface CriticReport {
  issues: Array<{ /* 如 E7 */ }>;
  passed: boolean;

  /** E7a 新增：必填。Critic 对 design-principles 的独立判定 */
  principle_conflict_analysis: {
    involved_principles: Array<'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8'>;
    conflict_detected: boolean;
    /** 每条涉及原则的具体分析（即使 conflict_detected=false 也要给出"为何不冲突"） */
    per_principle_analysis: Array<{
      principle: string;
      assessment: 'compatible' | 'tension' | 'conflict';
      rationale: string;
    }>;
  };
}
```

**冲突处理规则**：
- 任一条原则被判 `conflict` → 该变更**自动升格为 Architecture Evolution**（E13），必须人类事前裁决
- `tension` 不自动升格，但必须在 `issues` 中以 `severity: 'warn'` 记录，让 Decide 阶段知情
- **Critic 缺少 `principle_conflict_analysis` 字段 → 视为 Critic 未通过验证**，该次 review 作废需重跑

**违规示例（禁止）**：
- CriticReport 没有 `principle_conflict_analysis` 字段 → 违反 E7a
- Critic 直接复制 Agent 自标的 `principle_alignment` 结论 → 违反"独立判断"
- Critic 对涉及的原则只有"no issue"一笔带过，没有 per_principle rationale → 违反契约

---

### 约束 E8：Critic 是否定者，不是接棒者

**规则**：Critic Agent 的输出**只能是否定清单**，**禁止**给出修复建议、替代方案、重写版本。

**禁止字段**：`issues[i].suggestion` / `issues[i].fix` / `issues[i].alternative` / `criticReport.revised_plan`

**理由**：
- 对应 [多 Agent 约束④](./multi-agent-design-constraints.md)：Critic 的价值是对抗性否定；给修复建议会让它从"否定者"滑向"接棒者"，污染推理链
- 修复方案是 Decide 阶段的职责；若 Critic 发现新问题，应由 Decide 阶段重新规划，而非让 Critic 顺手写

**合规示例**：
```json
{ "severity": "block", "category": "regression",
  "description": "方案将修改 FEAT-002 R6 的 raw-API guard，但未评估对 Claude 合规性的影响",
  "evidence_refs": ["decide/evolution-plan.json#changes[2]"] }
```

**违规示例（禁止）**：
```json
{ "severity": "block", "description": "应当保留 guard 同时允许单元测试绕过",
  "suggestion": "加一个 __test__ 环境变量" }   // ← 违反 E8
```

---

## 四、`@model-dependent` 标注协议

### 约束 E9：标注语法与识别规则

**规则**：Prompt 文本、Agent 配置、Team 编排规则中**可演化**的片段必须用 `@model-dependent` 标注包裹，Evolution Engine 仅对标注范围内的内容进行 A/B 测试与自动优化。

**标注语法**（所有文件格式统一）：

```
# @model-dependent [: <optimization-tag>]
<可演化内容>
# @model-dependent-end
```

- `optimization-tag` 可选，用于分组：`clarity` / `persuasiveness` / `tool-selection` / `verbosity` 等
- 标注必须成对；孤立的 `@model-dependent-end` 视为语法错误
- 嵌套标注**禁止**

**可应用范围**：
- 是 `systemPrompt` 内的语义段落、指令条目
- 是 Team 编排 YAML 的 orchestrationMode / critic.role 之类可替换选项
- **不是**：接口定义、字段名、协议常量、provider id 等结构性元素

**违规示例（禁止）**：
```yaml
# @model-dependent
id: code-reviewer        # ← 结构性字段，禁止标注
# @model-dependent-end
```

**合规示例**：
```yaml
systemPrompt: |
  你是 Haro 中的代码审查 Agent。
  # @model-dependent: tool-selection
  优先用 grep + ast-grep 做结构性搜索，用 read-file 做细读。
  # @model-dependent-end
```

---

### 约束 E10：A/B 测试的承接规则

**规则**：Evolution Engine 对 `@model-dependent` 片段做 A/B 时，必须：

- 在 `orient/pattern-analysis.json` 记录两组的完整执行样本（不压缩）
- 在 `decide/evolution-plan.json` 写清晰的"胜出方"+ 样本数 + 置信度
- 通过 E7 验证门控
- 通过 shit 代谢的重复性检查（同一 tag 最近 30 天已优化过的不重复做）

**胜出阈值**：`confidence >= 0.75` 且 `sample_count >= 20`（Phase 2 默认，可在后续 spec 调整），否则维持原版本。

---

## 五、自我改进的四个层级

### 约束 E11：L0-L3 层级边界（纯技术门控）

**规则**：所有进化动作归入 L0/L1/L2/L3 中的一档；**跨档位的组合变更必须拆成独立 PR**。本约束只定义**技术门控栈**（Critic / tests / CI / 分阶段），**不**涉及人类介入——人类介入由 E13 按变更类型决定（见 §六）。

| 层级 | 作用域 | 示例 | Phase 启用 | 技术门控栈 |
|---|---|---|---|---|
| L0 Prompt 优化 | 只改 Prompt 文本、YAML 配置文本字段 | 调整 systemPrompt 用语 | Phase 0 起（手动）；Phase 2 起自动 | 仅 E7 Critic |
| L1 编排模式调整 | 改 Team 编排 YAML、选择规则 YAML | Scenario Router 映射变更 | Phase 2 起 | E7 Critic + 回归测试 |
| L2 代码结构重构 | 改 TypeScript 代码（非核心模块） | Skill 子系统重构、Memory 存储优化 | Phase 3 起 | E7 Critic + 完整测试覆盖 + CI 全绿 |
| L3 架构演进 | 改核心模块或跨层协议 | Channel 层抽象调整、PAL 新增接口 | Phase 3 起 | E7 Critic + 完整测试 + CI + 分阶段实施（每阶段有验证点） |

**重要立场**：代码层的质量校验**完全由 Critic + tests + CI 自动完成**，不依赖人类逐行审代码。人类的带宽应留给方向/需求裁决（E13）。这是 [design-principles.md P4 Steering 优先于 Implementing](./design-principles.md) 的直接落地。

**核心模块不得被 L2 覆盖**：Agent Runtime 核心、Scenario Router、Evolution Engine 自身、Memory Fabric 协议层、Channel 协议层、PAL 协议层——这些模块的修改**只能走 L3**。

**违规示例（禁止）**：
- 一个 PR 同时改 Prompt（L0）和 Provider 接口（L3）→ 拒绝；必须拆
- Auto-Refactorer 在 Phase 0 直接改代码（跳过 L0） → 违反 E3 和 E11
- 把 L2 技术门控的"人类代码 review"当作放行条件 → 违反本约束立场；代码层由 Critic + 测试守护

---

## 六、自治边界

### 约束 E12：按 Phase 分级的自治天花板

**规则**：Evolution Engine 的每一步动作，其**发起方**、**执行方**按当前 Phase 严格受限。**人类参与的内容是方向/需求（by E13），不是代码/实现**——下表中"人类"均指"方向与需求的裁决者"。

| Phase | 发起方 | 执行方 | 人类介入对象 |
|---|---|---|---|
| Phase 0 Foundation | 人类（CLI 手动触发） | 人类 | 全过程 |
| Phase 1 Intelligence | 人类或 Agent | Agent | 需求/方向（事前 approve）；bugfix 事后 review |
| Phase 2 Evolution | Agent | Agent | 同上 |
| Phase 3 Autonomy | Agent | Agent | 同上；架构演进仍需事前裁决（见 E13） |

**重要不变量**：
- **任何 Phase** 下架构演进（E13 类型三）都需要人类事前裁决，**不存在**"全自主"
- **任何 Phase** 下 Feature Request（E13 类型二）都需要人类事前 approve 需求本身
- **任何 Phase** 下 Bugfix（E13 类型一）可 Agent 主导，但 Act 完成后必须进入人类事后 review 队列
- 跨 Phase 切换需写入 `~/.haro/config.yaml` 的 `evolution.phase`，默认 0；升级至 2+ 前必须完成本 Phase 的交付项（见 roadmap/phases.md）
- **人类不审代码 diff**——代码层由 E11 的 Critic + tests + CI 守护；人类审的是"方向是否偏离"和"需求是否 approve"

---

### 约束 E13：Agent 发起变更的自治边界按变更类型划分

**规则**：Agent 自主发现问题或选择进化方向时，**按变更类型**分三类，每类的人类介入时机和内容不同。**核心立场：人类审方向/需求，不审代码**。

| 变更类型 | 定义 | Agent 自主？ | 人类介入时机 | 人类介入内容 |
|---|---|---|---|---|
| **Bugfix** | 修复已有 spec 声明的功能偏离、回归问题、违反既定约束的行为 | ✅ Agent 主导 | **事后 review** | 知悉 + 确认；发现方向偏离时可要求回滚。不审代码细节 |
| **Feature Request（需求）** | 新增未在当前 spec 覆盖的功能 / 交互 / 能力，或调整既有功能的产品定义 | ❌ | **事前 approve** | 审"做什么"（需求 + 方向）；不审代码实现 |
| **Architecture Evolution（架构演进）** | 改动核心模块、跨层协议、设计原则、约束规范 | ❌ | **事前裁决 + 分阶段审视** | 审架构方向；每阶段验证方向是否偏离。不审代码 diff |

**共同条件（所有类型都要满足）**：
- 不得与 [design-principles.md](./design-principles.md) 冲突；若产生原则级冲突，**自动升格为架构演进**走人类事前裁决（冲突判断见 E7a）
- 必须通过 E7 Critic 验证（代码层质量由此保证）
- 按 E11 归档到 L0/L1/L2/L3 并遵守对应技术门控栈

---

#### Bugfix 的事后 review 流程

Bugfix **不限层级**（L0/L1/L2/L3 都可），Agent 自主 Act 完成后：

1. Agent 写入 `act/refactor-results.json` 时必须标记 `post_review_required: true`
2. 系统把该条追加到 `act/human-review-queue.jsonl`（每行一条待 review 项）
3. 人类在合适时机批量 review，结果写入 `act/human-review.jsonl`：
   ```json
   {
     "refactor_id": "r-123",
     "reviewed_at": "2026-04-19T12:00:00Z",
     "reviewer": "whiteParachute",
     "verdict": "ack" | "concern" | "rollback-request",
     "note": "optional"
   }
   ```
4. 若 `verdict === 'rollback-request'`，触发 shit 代谢路径的回滚流程，不直接在 Agent 决策路径内处理

**立场澄清**：事后 review 是"通知 + 可干预的后备"，不是"事前门控"。人类带宽用于**方向性校准**，不用于逐条审 bugfix 代码。

---

#### Bugfix 发起的必要字段

发起时必须在 `decide/evolution-plan.json` 附 `bug_source` 字段，指向**具体**的 spec 条目（R/AC）或既有约束：

```json
{ "change_type": "bugfix",
  "bug_source": "FEAT-007#R5",          // 必填；指向具体条目
  "description": "T1 同步写入在高并发下出现 race",
  "evidence_refs": ["observe/failure-events.jsonl#L42"] }
```

**找不到明确的 spec 违反点 → 这不是 bugfix**，按 Feature Request 或架构演进处理（需要 human approve）。这条规则防止 Agent 把"感觉应该改"的模糊改动伪装成 bugfix 绕过人类决策。

---

#### 原则冲突判定（硬性要求）

每次变更的 `decide/evolution-plan.json` 必须附 `principle_alignment` 字段，Agent 自标：

```json
{ "principle_alignment": {
    "involved_principles": ["P1", "P5"],
    "agent_assessment": "no-conflict",
    "rationale": "..."
}}
```

**但最终判定由 E7 Critic 独立完成**（见 E7a），Agent 的自标只作为"已考虑"证据，**不采信**作为放行理由。若 Critic 判定存在原则冲突，变更自动升格为架构演进。

---

#### "Agent 判断业界更先进方向"的归类

- 这属于 **Feature Request** 的子类（是"提需求"，不是"修 bug"）——必须人类事前 approve
- Agent 在 `decide/evolution-plan.json` 附调研原文引用 + 对比理由，作为给人类的**建议材料**
- 人类在 `human-gate.json` 记录 approve / reject / defer；Agent **不得**自行放行

---

#### 合规示例

- Agent 发现 FEAT-007 的 T1 写入路径有 race（违反 R5）→ Bugfix → `bug_source: "FEAT-007#R5"` → Critic 通过 → Act → 写入 human-review-queue → 人类事后 ack
- Agent 发现业界流行用 vector DB 做 skill 路由 → Feature Request（业界方向子类）→ 附调研 → 等人类 approve 需求 → Act（代码由 Critic + tests + CI 守护）→ 无需人类审代码
- Agent 发现 Provider 层应新增 `validate()` 接口（改 provider-protocol.md）→ 架构演进 → 人类事前裁决方向 + 分阶段 → 每阶段人类核对方向是否偏离

#### 违规示例（禁止）

- 变更与 design-principles.md 某条原则冲突，但 Agent 归为 Bugfix 自行放行 → Critic 应识别并升格（E7a）
- Agent 把"新增一个 skill"标为 Bugfix → 这是 Feature Request，必须人类 approve
- Bugfix 的 `bug_source` 字段缺失或模糊（"感觉这里不对"）→ 拒绝 Act
- Agent 在 Bugfix Act 后不写 `post_review_required`→ 拒绝，该 Act 视为未完成

---

## 七、反馈来源分类

### 约束 E14：Agent 自主发现的源头分类（溯源标注）

**规则**：Agent 自主发现的每一条 observation 必须标注**来源路径**，用于溯源与 Pattern Miner 分析。**路径分类只决定溯源标签，不决定自治边界**——自治边界由 E13 的变更类型决定。

**两类源头路径**：

**路径 A：内部信号**
- 代码 review 自发现（Agent 通过 review 识别 bug、改进点、坏味道）
- 记忆挖掘（整理 Memory 时发现模式、遗漏、矛盾）
- 运行数据挖掘（Pattern Miner 从历史执行数据发现规律）

**路径 B：外部信号**
- 互联网调研（Agent 从互联网获取业界进展）
- 用户反馈 / 提需求
- 组织内其他系统（飞书 / GitHub Issue 等）推送的信号

**路径分类与 E13 变更类型的关系**：

| 源头路径 | 典型变更类型（但不限于） |
|---|---|
| 内部信号 · 代码 review 发现功能偏离 | Bugfix |
| 内部信号 · Pattern Miner 发现新模式值得固化 | Feature Request |
| 内部信号 · 发现架构缺陷 | 架构演进 |
| 外部信号 · 业界新方法 | Feature Request（业界方向子类） |
| 外部信号 · 用户反馈 bug | Bugfix |
| 外部信号 · 用户提需求 | Feature Request |

**关键澄清**：
- **内部信号 ≠ 免 human gate**——内部信号产生的 Feature Request 或架构演进仍要走 E13 的人类介入要求
- **外部信号 ≠ 必过 human gate**——外部信号（例如用户报 bug）若归类为 Bugfix，Agent 可按 E13 自主

**归类职责**：Agent 必须在 `observe/*.jsonl` 条目的元数据中标注 `source_path: "internal-*"` 或 `"external-*"` + 具体子类；Critic 在 E7 验证时会交叉检查"路径标注 × E13 变更类型"是否自洽。

---

## 八、与 Memory / 代谢的关系

### 约束 E15：evolution-context/ 与 Memory 的边界

**规则**：evolution-context/ 是**临时工作台**，Memory 是**长期知识仓**，两者的数据生命周期**不得混淆**。

| 维度 | evolution-context/ | Memory Fabric |
|---|---|---|
| 生命周期 | 本次进化周期；90 天后归档 | 长期保留；shit 扫描归档 |
| 写入权 | Evolution Engine（四阶段） | Agent / 用户 / eat / 本协议规定的沉淀路径 |
| 读取方 | Evolution Engine 后续阶段 + Critic | 所有 Agent（按 scope） |
| 目的 | 支撑当次 OODA 推理 | 支撑未来任意任务 |

**转化路径**（强制）：
- **Act 成功后**：成功模式通过 `eat` 沉淀到 Memory（rules / skills / knowledge）
- **失败教训**：写入 `agents/<id>/knowledge/anti-patterns/<date>-<slug>.md`
- **用户反馈**：原文落 observe/user-feedback.jsonl 之外，**关键事实**由 Agent 通过 T1/T2 写入 Memory（见 FEAT-007）

**违规示例（禁止）**：
- 把永久性知识存在 `evolution-context/` 里依赖查询 → 违反 E6
- Memory 里堆满 jsonl 原始事件 → Memory 不是事件日志存储

---

### 约束 E16：与 eat/shit 代谢的职责分工

**规则**：

- **OODA** 负责"如何改进"（线性优化）
- **eat** 负责"外部产物如何沉淀进来"（质量门槛 + 分桶）
- **shit** 负责"冗余如何清理"（包括 evolution-context/ 归档）

三者**不互相替代**：
- 不能用 eat 代替 Decide 阶段的规划
- 不能用 shit 代替 E11 的 L2/L3 重构
- 不能用 OODA 代替 eat 的沉淀路径

**合规示例**：
- 用户反馈 → observe/user-feedback.jsonl（原文）→ eat 评估是否沉淀为 rule/skill → 若沉淀则进 Memory
- 互联网调研 → observe/industry-research/ → Decide 阶段引用 → 若采用则进 evolution-plan.json
- 90 天后 → shit 扫描 evolution-context/ → 归档到 `archive/evolution-<month>/`

---

## 九、违规检测清单

| 违规行为 | 检测方式 | 处理 |
|---|---|---|
| 阶段间传摘要而非原始数据（违反 E2） | 代码审查 + `evolution-context/` 目录审计 | 拒绝 Act |
| Critic 输出修复建议（违反 E8） | `CriticReport.issues[*]` 字段扫描 | 拒绝该 Critic 结果 |
| 未经 E7 验证直接 Act | Act 执行前检查 `act/refactor-results.json` 是否有对应 Critic report | 拒绝 |
| 跨档位混合 PR（违反 E11） | PR diff 分析 | 要求拆分 |
| Phase 0 出现自动 OODA 定时器（违反 E3） | 代码审查 + grep "setInterval.*evolve" | 拒绝合入 |
| 结构性字段被 `@model-dependent` 标注（违反 E9） | Lint | 拒绝 |
| Agent 在 Feature Request / 架构演进类变更上缺失 human-gate（违反 E13） | Act 前检查 `decide/human-gate.json` | 拒绝 |
| Bugfix 缺失 `bug_source` 字段或指向模糊（违反 E13） | 扫描 `decide/evolution-plan.json` schema | 拒绝 |
| 变更类型归类错误（把 Feature Request 标为 Bugfix）（违反 E13） | Critic 在 E7 阶段交叉检查 E13 类型 + 实际 diff 范围 | Critic block issue |
| Bugfix Act 未写 `post_review_required` 或未追加到 `human-review-queue.jsonl`（违反 E13） | Act 后审计 | 视为 Act 未完成，需补录 |
| CriticReport 缺失 `principle_conflict_analysis` 字段（违反 E7a） | 运行时 schema 校验 | Critic review 作废需重跑 |
| Critic 采信 Agent 的 `agent_assessment` 结论而非独立判断（违反 E7a） | 对比 Agent 自标 vs Critic rationale，若完全复用则报警 | Critic review 作废 |
| L2/L3 变更把"人类代码 review"当放行条件（违反 E11 立场） | 门控栈审计 | 拒绝 |
| 源头路径标注缺失或与 E13 类型不自洽（违反 E14） | Critic 在 E7 交叉检查 `source_path` × 变更类型 | Critic block issue |
| evolution-context/ 原始数据被 Auto-Refactorer 删除（违反 E5） | 文件系统审计 | 回滚 + BUG spec |
| 长期知识写进 evolution-context/（违反 E6） | 90 天保留期后数据被引用 → 报警 | 人工评估转入 Memory |

---

## 十、名词定义

| 名词 | 定义 |
|---|---|
| Evolution Engine | Haro 的自我进化子系统，由 Self-Monitor / Pattern Miner / Auto-Refactorer / Critic 组成 |
| OODA 循环 | Observe → Orient → Decide → Act 四阶段线性改进流程 |
| evolution-context/ | `~/.haro/evolution-context/`，Evolution Engine 四阶段共享工作目录 |
| Critic Agent | 对抗性 Agent，专职否定方案；遵守多 Agent 约束④ |
| `@model-dependent` | 可演化片段标注；Evolution Engine 仅对标注范围内内容做 A/B / 自动优化 |
| L0 / L1 / L2 / L3 | 进化层级：Prompt / 编排 / 代码 / 架构 |
| 人类认可 | 用户在 `decide/human-gate.json` 写入 approve 记录；Phase 分级自治边界的关键节点 |

## 参考

- [design-principles.md](./design-principles.md)
- [multi-agent-design-constraints.md](./multi-agent-design-constraints.md)
- [evolution-metabolism.md](./evolution-metabolism.md)
- [provider-protocol.md](./provider-protocol.md)
- [FEAT-007-memory-fabric-independent.md](./phase-0/FEAT-007-memory-fabric-independent.md)

## Changelog

- 2026-04-19: whiteParachute — 初稿 draft。整合 `docs/evolution/feedback-loop.md`（OODA / evolution-context 布局 / 验证门控 / @model-dependent）+ `docs/evolution/self-improvement.md`（L0-L3 层级 / Agent-as-Maintainer 约束）的硬约束部分。共 16 条强制约束 E1-E16
- 2026-04-19: whiteParachute — 重构 E13：从"三选一认可"改为**按变更类型分类自治**（Bugfix / Feature Request / Architecture Evolution）；Bugfix Agent 可自主决策（需具体 spec 违反点），Feature Request 和架构演进必须人类参与决策。同步调整 E14：源头路径标注不再决定自治边界，仅作溯源用途，自治边界一律由 E13 决定
- 2026-04-19: whiteParachute — 分工立场硬化：**人类审方向/需求，不审代码**。E11 技术门控栈剥离人类代码 review 条款；E12 明确人类介入对象；E13 Bugfix 改为可跨 L0-L3、Agent 主导 + **事后 review**（通过 `human-review-queue.jsonl` 通知机制，不阻塞 Agent 执行）。新增 **E7a Critic 必须独立判断原则冲突**——Agent 自标 `principle_alignment` 只作"已考虑"证据，最终由 Critic 独立 per-principle 判定；冲突自动升格为架构演进。
- 2026-04-19: whiteParachute — 用户 review 完成，状态确认为 approved。
