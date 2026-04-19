# Haro 设计原则（强制）

**状态：强制执行。所有 Haro 模块、spec 决策、实现代码必须遵守本规范。具体功能 spec（FEAT-*）与本规范冲突时，以本规范为准。**

## 背景

本规范汇集贯穿 Haro 所有层的产品设计原则，优先级高于任何单点实现决策。核心立场：

**模型性能的决定因素在"模型周围的一切"，而非模型本身。Haro 的价值主张和护城河都建立在对这层基础设施的精细打磨上。**

原则之间可能有张力，本规范用"分层"方式调和——见各原则内文与本文末 §原则之间的耦合。

## 八条原则

### P1：非核心组件皆可插拔（No-Intrusion Plugin Principle）

**规则**：所有外挂功能或组件，只要不是系统核心，必须做到：

- 独立注册 / 装载 / 卸载
- 对核心模块**零侵入、零硬编码**（核心代码不得出现针对具体实现的特判分支）
- 能力通过标准接口 + `capabilities()` 查询暴露
- 卸载后核心功能不受影响

**典型可插拔组件**：Provider、Channel、Skill、Tool Provider、MCP Server、Memory Backend、Storage Backend。

**核心组件（不可插拔）**：Agent Runtime 核心、Scenario Router、Evolution Engine、Memory Fabric 协议层、Channel 协议层、PAL 协议层。

**违规示例（禁止）**：
```typescript
// 核心模块出现 if providerId === 'claude' 这类分支
if (provider.id === 'claude') {
  // claude 特殊处理
}
```

**合规示例**：
```typescript
// 通过 capabilities 分派，核心代码不知道具体 provider
if (provider.capabilities().contextCompaction) {
  await provider.compactContext();
}
```

**违规判定**：grep `providerId\s*===`、`channelId\s*===`、`agentId\s*===` 等硬编码分支；lint 规则兜底（见 FEAT-001 R7）。

---

### P2：代谢优于堆积（Metabolism Over Accumulation）

**规则**：Haro 在进化中坚持"留精华、不堆数量"。

- 新能力必须通过 [eat](./evolution-metabolism.md) 的质量门槛（四问验证）沉淀
- 冗余能力必须通过 [shit](./evolution-metabolism.md) 清除，可回滚
- **绝对数量不是目标**；少量反复打磨的核心能力胜过大量未经检验的散件
- 沉淀前必须考虑"加载代价"：永远加载的 CLAUDE.md / rules 比按需加载的 skills 成本高

**合规设计**：
- 预装 skill 有白名单保护不被 shit，但仍有使用统计；长期零使用触发"是否仍需预装"审视
- 新 rule / skill 30 天观察期后进入正常代谢

**违规示例（禁止）**：
- 把调研结论整段 dump 到 CLAUDE.md
- 通过"以防万一"加载大量 skill 导致 context 膨胀

**与 P5 的耦合**：代谢约束沉淀总量，progressive disclosure（P5）约束每次 prompt 的可见面。

详见：[evolution-metabolism.md](./evolution-metabolism.md)

---

### P3：Harness 就是产品（The Harness Is the Product）

**规则**：Haro 的产品是"包裹 LLM 的完整软件基础设施"，不是模型本身。模型质量差距通过 harness 设计可以翻盘；**相同模型在不同 harness 下可以相差一个数量级**。

**落地要求**：
- 重大工程投入方向优先级 > 模型选型
- Provider 可替换（Claude / Codex / 未来模型），harness 永远是自有
- "模型升级到新一代"带来的提升属于**被动红利**；Haro 的主动红利来自 harness 投入
- 随着模型改进，**harness 复杂度应下降**（脚手架隐喻）——每次模型换代主动审视哪些脚手架可以简化

**合规设计**：
- Harness 组件全部有专门 spec 覆盖：编排循环（FEAT-005）、工具（FEAT-010）、记忆（FEAT-007）、上下文（PAL + FEAT-005）、提示词构建（FEAT-004）、输出解析（PAL）、状态管理（FEAT-001 SQLite + agent state.json）、错误处理（Provider error mapping）、防护栏（权限 mode）、**验证循环（P6）**、子 Agent 编排（team-orchestration Phase 1）、生命周期（FEAT-004）
- 每个组件的演进需要明确"为哪一类任务提升多少性能"——空洞扩展 harness 属于"为工程而工程"

**反模式**：
- "等下一代模型出来就解决了"——违背 Haro 的主动投入方向
- 无论模型多强都保留某个 workaround——应在代码里标 `[TO-REMOVE-WHEN-MODEL-SOLVES-X]` 注释，下次模型换代时复查

---

### P4：Steering 优先于 Implementing（Orchestrator, Not Implementer）

**规则**：人类的精力分配应该向上转移——从"敲代码 / 写内容 / 做执行"转向"定义标准、注入 guardrails、裁决方向"。Haro 的功能设计应该**最大化 steering 杠杆**、**最小化 implementing 摩擦**。

**落地要求**：
- Agent 默认具备完整工具权限（CLI / bash / observability），**不做"为了安全而阉割能力"的小盒子设计**（见 P5）
- 人工 review 环节优先做**门控**（pass/no-pass）和**裁决**（方向选 A 还是 B），不做"替 Agent 写半截代码"
- 一切发现的问题要回答："这次我修了；下次 Agent 怎么自动发现？"——答案必须落到 P6（验证循环）或 P7（agent-friendly codebase），不能停留在"我多加了一条 prompt"

**合规设计**：
- `haro review`（未来）把 PR review 做成 agent 化，人类只看 post-merge 抽样
- Agent 配置里**不允许**出现 role / goal / backstory 等"岗位式"字段（见 FEAT-004 R2 + [多 Agent 约束⑤](./multi-agent-design-constraints.md)）——那是 implementer 思维
- 默认 Agent prompt 的"工作方式"段显式告诉 Agent"你是实现侧"，把 steering 留给人类与 Evolution Engine

**反模式**：
- 人类反复手动修同一类 bug 却不沉淀 lint → 应该升级为 durable guardrail（见 P6）
- 把"详细步骤"写进 Agent 配置 → 退化为岗位式 Agent

---

### P5：Capability-Full × Context-Minimal（能力满载 × 上下文精简）

**规则**：Agent **能力边界不锁死**，但**每一轮 prompt 只暴露当前步骤所需的最小集合**。这两件事看似矛盾，实则是两个层次：

- **能力层**：Agent 持有的总工具/总 skill 集——尽量给满（完整 CLI、bash、observability、memory、web）；不为"防误操作"切成小盒子
- **上下文层**：每次发给模型的 prompt、tool list、skill definition——**progressive disclosure**，只注入当前任务相关的

**落地要求**：
- Skill 装载机制：默认只把 `name + description`（几十 tokens）塞进上下文；命中触发条件才加载完整 SKILL.md（这是 FEAT-010 的硬要求）
- Tool list 按任务裁剪：即使 Agent 拥有数十个工具，当前任务只给相关的若干个
- Memory context 按相关度注入：不是 dump 全部 index.md，而是查询后相关 top-K

**经验支撑**：实践中 5-10 个反复打磨的核心 skill 胜过数十个未经检验的散件；删除无用工具通常让输出质量提升。

**违规示例（禁止）**：
- 因为不知道 Agent 需要哪个工具，把所有工具都塞 prompt
- 默认把所有 skill 的 SKILL.md 全文塞 system prompt
- "Agent 可能危险，所以禁止它用 bash" → 这是把能力层和上下文层混淆

**合规示例**：
- Agent 的能力声明 = 所有 skill / tool
- Agent 的本轮 prompt 可见面 = 经过路由/评分后的 top-K 集合

**与多 Agent 约束⑤的关系**：约束⑤说"工具决定能力，不由角色标签限制"——配套本原则的能力层立场；progressive disclosure 是"能力给满"前提下的运行时裁剪机制。

---

### P6：Validation Loop Required（验证循环非可选）

**规则**：任何生产级 Agent 工作流**必须有验证循环**。没有验证循环的工作流是"演示"不是"产品"。

**落地要求**：

验证层级（从硬到软，至少覆盖其中 2 类）：
- **规则验证**：lint / test / schema / type-check — 计算式判定，无歧义
- **视觉/结构验证**：screenshot 比对 / AST 对齐 / 格式检查
- **LLM 评判**：裁决 Agent（判 pass/no-pass，**不给修复建议**，遵守[多 Agent 约束④](./multi-agent-design-constraints.md)）

**工具失败不是中断**：任何工具调用失败必须作为**错误结果**回传给模型，让模型决策下一步。**禁止**因工具失败而直接终止整个任务（除非权限拒绝等无法恢复的情况）。

**验证发现要沉淀为 durable guardrail**：
- 一次性修复 ≠ 长期解决
- 每次验证发现的问题要回答："这个问题如何变成 lint / test / review agent 规则？"
- 沉淀路径：bug → eat → rule/skill/lint → 未来 Agent 不再犯

**合规设计**：
- FEAT-005（Runner）必须内置 "tool_result with isError:true → 继续循环" 语义，不把工具错误 throw 到循环外
- 代码生成类任务至少跑一次 `pnpm build` + `pnpm test` 作为规则验证
- 未来的 `review` skill 走 LLM 评判层

**违规示例（禁止）**：
- Agent 写完代码就返回结果，不跑测试、不做 review
- 工具失败直接 `throw`，破坏本次 session
- 发现某类 bug 后只在 prompt 里加一句"注意 X"——没有 durable guardrail

---

### P7：Agent-Friendly Codebase（代码库本身是 Agent 环境）

**规则**：Haro 自己的代码库是 Agent 工作空间。**代码库的可读性、一致性、构建速度直接决定 Agent-as-Maintainer（Phase 3）的可行性**。

**落地要求**：
- **One way to do X**：同一问题只有一种推荐写法；备选写法必须在 docs/ 或 CLAUDE.md 明确标注"为何存在另一条路"
- **Fast feedback**：`pnpm build` 单包 ≤ 1 分钟，全 workspace ≤ 2 分钟；超标立即开 BUG spec
- **Package 隔离**：`@haro/*` 各包边界清晰，跨包调用走显式 export，不走相对路径穿透
- **Observability 内置**：核心路径（Provider query、Memory write、Agent run、Channel dispatch）有结构化日志（pino），不依赖 console.log
- **Source verification via tests/lints**：代码结构本身由 ESLint 规则 + vitest 守护（如 FEAT-001 R7 的 `providerId ===` lint、FEAT-002 R6 的 raw-API guard、FEAT-004 AC5 的 agentId grep）。**"文档里说了不要这么写"不算 verification；CI 报错才算**

**Filesystem as Context Substrate**：文件系统是 Agent 跨 context 窗口的连续性载体。
- 不只是 Memory Fabric——`.haro/evolution-context/`、agent 的 `state.json`、`.pending/` 都是"context 外移"机制
- Agent 遇到可能超 context 的任务，应默认先"写到文件再读回来"，不是"让 context 尽量放得下"

**合规设计**：
- monorepo 各包 `package.json` 严格声明 exports（FEAT-001 已实现）
- 新增核心路径必须同步加 `createLogger().info()` / `warn()` / `error()` 结构化日志
- 每新增一条硬约束都要回答："能用 lint / test 强制吗？能就加；不能就在 Changelog 说明为何不能"

**违规示例（禁止）**：
- "这个项目有两种日志方式"（违反 one way to do X）
- 单包 build 慢到分钟级且无人修（违反 fast feedback）
- 靠口头/文档约定"不要直调某 API"（违反 source verification）

---

### P8：Memory as Knowledge Substrate（记忆是知识底座）

**规则**：Memory Fabric 不是可选外挂，是 Haro 的**第一方知识累积层**。它是 Agent 越用越好用、越用越贴近用户的唯一机制——没有它，Haro 退化为无状态 LLM 包装器。

**三条核心立场**：

- **累积而非重置**：每次 session 的关键事实必须有路径回写到 Memory（T1 显式写 / T2 事件驱动写 / T3 session 结束兜底——见 FEAT-007）。Session 之间是连续的知识延伸，不是孤立的一次性调用。

- **用户贴合而非通用**：Memory 的 per-agent 私有空间（`~/.haro/memory/agents/<id>/`）记录的是"这个 Agent 在这个用户手里逐渐学到的偏好 / 习惯 / 历史决策"。**Agent 必须具备识别当前对话 user 身份的能力**（通过 channel 层提供的 user identity、显式登录、或基于对话特征的推断），并据此区分记忆与行为——**相同任务对不同用户、不同 Haro 实例、甚至同一实例的不同用户应当给出不同答案**。这是特性不是 bug。

- **P5 的路由实现**：Memory 是 P5 "capability-full × context-minimal" 的核心路由机制。它决定每一轮 prompt 应该暴露哪些工具 / 哪些 skill / 哪些历史片段——因为它知道"这个用户、这个任务、过去怎么处理的"。没有 memory，context-minimal 只能靠静态规则；有了 memory，context-minimal 可以按用户实际习惯动态裁剪。

**落地要求**：
- **对 P1 可插拔的例外**：MemoryFabric 作为核心能力**不可替换拆除**——它是 harness 的结构性承重墙。但**后端存储层**可配置（支持 aria-memory 目录格式迁入）——这是 FEAT-007 R1 已经落地的设计
- **同 session 写入即可见**：T1/T2 写入必须在下一次 query 前对 Agent 可见，不依赖下次 session 启动才 flush——否则 Agent 会"学完立刻忘"
- **多 Channel 幂等合并**：不同渠道的 Memory 写入必须有幂等键（source + wrapup_id + hash），避免同一事实被重复学习（FEAT-007 R6）
- **与 eat/shit 代谢耦合**（P2）：
  - eat 把外部知识沉淀为 Memory 条目
  - shit 扫描长期无访问的 Memory 条目 → archive（不直接删除）
- **Per-Agent 隔离 + 可选共享空间**：默认隔离防止人格污染；共享记忆（`shared/`）作为 Phase 1 的 opt-in 机制

**合规设计**：
- Agent Runtime 每轮 query 前必须调 `memoryFabric.contextFor({ agentId, query })`（FEAT-007 R4），把相关条目注入 system prompt
- `wrapupSession()` 在 channel session end 时自动触发 T3 兜底
- 新 Provider / Channel 接入时必须想清楚"本通道的关键事实如何回写 Memory"——**没想清楚不能算 approved**

**违规示例（禁止）**：
- Agent 读 Memory 但不往里写——单向关系，违反"累积"立场
- Memory 内容在会话之间丢失（例如只放 in-memory cache 没落盘）
- 所有用户共享同一份 Memory——违反"用户贴合"立场
- Agent 无法区分当前对话的是哪个 user，所有交互都落到同一记忆空间——违反"用户贴合"立场
- 把 Memory 当普通 KV 存储用（放临时状态、缓存计算结果）——这会污染长期知识

**合规示例**：
- 用户说"我习惯用 pnpm 不用 npm"→ T1 写入 agent knowledge → 下次 Agent 建议命令时优先选 pnpm
- Agent 在代码里发现一个稳定出现的 bug 模式 → T2 异步 deposit → memory-sleep 合并为 knowledge 文件 → 未来 review 任务自动对照
- 用户多次在飞书里让 Agent 用中文输出 → 该偏好沉淀 → 后续即便在 CLI 上也默认中文

**与其他原则的耦合**：
- 是 **P5** 的运行时路由机制（提供"哪些工具/skill 与当前任务相关"的动态答案）
- 是 **P2** 代谢的承接载体（eat 产物落地 / shit 评估对象）
- 是 **P3** harness 12 组件中的"记忆管理"具体落地
- 是 **P7** "filesystem as context substrate" 在语义知识层面的专用子系统

---

## 原则之间的耦合

```
P3 Harness 就是产品
      │
      ├─ 模型外一切都要做好 ──→ P4 steering (人的投入方向)
      │                       ├─ P5 capability-full × context-minimal (每轮可见面)
      │                       │     ↑
      │                       │     │ 路由依据
      │                       │     │
      │                       ├── P8 memory as knowledge substrate
      │                       │   (用户贴合 + 累积越用越好用)
      │                       │
      │                       ├─ P6 validation loop (输出质量)
      │                       └─ P7 agent-friendly codebase (agent 工作环境)
      │
      └─ 随模型演进要瘦身 ──→ P2 代谢优于堆积 (不堆数量)
                                ↑
                                │ 承接载体
                                │
                             P8 memory (eat 落地点 / shit 扫描对象)

P1 可插拔 ──→ 所有其他原则的结构性前提（P8 是对 P1 的显式例外：Memory 核心能力不可拆）

多 Agent 约束 5 条 ←→ 本原则在 Agent 编排层的具体落地
```

## 违规处理

- **原则级违规**：原则 P1-P7 的硬性规则违反，应在 PR 评审阶段拒绝合入；若已合入，立 BUG spec 回滚
- **原则级歧义**：本规范与具体 FEAT spec 冲突时，以本规范为准；若 FEAT spec 有充分理由例外，必须在其 Changelog 里明确说明例外依据
- **新增原则**：需用户审阅批准；新增原则的 spec 基础必须足够（避免频繁改动原则）

## 影响面（对现存 spec 的审视清单）

以下 spec 在本原则立项后需要对照检查（**不意味着都要改**，只是要回答"你与 P1-P8 的关系是什么"）：

| spec | 关注点 |
|---|---|
| `multi-agent-design-constraints.md` | 5 条约束是 P4/P5 的具体落地，关系明确 |
| `provider-protocol.md` | 超集接口 + capabilities 来自 P1；错误映射协议涉及 P6 |
| `evolution-metabolism.md` | eat/shit 是 P2 的具体机制；eat 产物落地到 P8 |
| `FEAT-004-minimal-agent-definition.md` | `.strict()` + 拒绝岗位字段来自 P4；tools 字段字符串透传来自 P5 |
| `FEAT-005-single-agent-execution-loop.md` (draft) | **大量**对接 P4/P6/P7——起草时必须引用本规范；每轮 query 前 `memoryFabric.contextFor()` 注入来自 P8 |
| `FEAT-007-memory-fabric-independent.md` | 核心承重墙，是 P8 的实现载体；R1/R4/R6 直接对应 P8 前两条立场（累积 + 用户贴合）；**P8 新增的"user 身份识别 + 按 user 区分记忆"超出 FEAT-007 现有 scope（agent/platform/shared），后续需独立 spec 补 user 维度** |
| `channel-protocol.md` | P8 要求 channel 层向上传递 user identity，后续需审视 `InboundMessage` 是否已承载足够的 user 信息（Phase 0 可能需要补一版协议） |
| `FEAT-010-skills-subsystem.md` (draft) | progressive disclosure 装载来自 P5；预装保护 + 观察期来自 P2；skill 选择的相关度评分依赖 P8 |

## 参考

- [多 Agent 设计约束规范](./multi-agent-design-constraints.md)
- [Evolution 代谢机制规范](./evolution-metabolism.md)
- [Provider 接入协议](./provider-protocol.md)
- [Channel 接入协议](./channel-protocol.md)

## Changelog

- 2026-04-19: whiteParachute — 初稿 draft，整合 `docs/architecture/overview.md §设计原则` 的原生 2 条 + 5 条新原则，共 7 条
- 2026-04-19: whiteParachute — 补 P8 Memory as Knowledge Substrate，对接 P5 的运行时路由机制 + P2 的代谢承接载体。扩到 8 条
- 2026-04-19: whiteParachute — P8 "用户贴合"立场硬化：显式要求 Agent 识别当前对话 user 身份，按 user 区分记忆与行为；标记该能力超出 FEAT-007 现 scope，后续补 spec。
- 2026-04-19: whiteParachute — 用户 review 完成，状态确认为 approved。
