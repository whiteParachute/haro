# Haro 项目飞书聊天记录恢复

## [2026-04-18 06:25 UTC] User

我们刚刚调研了这个yoyo项目，我们现在在self-code下面新建一个项目目录，用来记录我们对这个项目的全部设计。我预期这个项目是一个可以接入多provider的agent和agent team管理平台，首先平台具备自我进化能力，其次平台的主要维护者和迭代人，测试者，甚至部分需求来源和使用者都是agent。可以满足我对工作流和个人使用的集成化中台，根据不同的使用场景自动完成流程的自动化和进化。

## [2026-04-18 06:25 UTC] Bot

**记忆存储也已完成，Yoyo 项目信息已关联到 multi-agent-pa...**

记忆存储也已完成，Yoyo 项目信息已关联到 multi-agent-patterns、aria-memory 架构、feishu-bridge 等相关知识节点。随时可以继续深入设计或开始编码。

## [2026-04-18 06:49 UTC] User

我把你可以参考的项目都发给你，你继续完善一下我们的产品设计 https://github.com/yologdev/yoyo-evolve 这个是yoyo，主打自己进化，你还可以看一下我们的happyclaw-yl和Keyclaw，还有aria-memory我们改造过后的版本，还有对接飞书的lark-bridge，你当然也可以从互联网上自行找到项目补充这个设计，比如说hermes等热门项目

## [2026-04-18 06:49 UTC] Bot

**记忆更新完成（index v81）。Yoyo 项目的调研信息已持久化，随时...**

记忆更新完成（index v81）。Yoyo 项目的调研信息已持久化，随时可以继续深入某个模块的详细设计或开始 Phase 0 编码。

## [2026-04-18 07:04 UTC] User

https://x.com/sujingshen/status/2043898494818410731?s=46&t=KAvxBNvUXAcb7pnOXybm9g 你判断一下这种说法是否合理正确，这对我们的项目架构设计非常重要

## [2026-04-18 07:12 UTC] User

之前的任务做到什么程度了，你知道现在都没有反馈我比较担心。如果还在做的话就继续完成之前的任务，同时增加新的todo：https://github.com/multica-ai/multica/ 参考一下这个产品的逻辑，同时检查一下你之前做竞品调研的时候有没漏掉hermes这种harness逻辑设计的项目。我们项目最重要的能力就是ai自驱和生产内容的稳定，通过工程约束避免幻觉和agent误入歧途做很多无意义的工作

## [2026-04-18 07:32 UTC] Bot

**⚠️ 会话出错: Claude Code process exited w...**

⚠️ 会话出错: Claude Code process exited with code 143

## [2026-04-18 07:33 UTC] User

上一轮抓推文卡死我 kill 了。那条推文指向的是 SagaSu 博客文章《三省六部幻觉：为什么"虚拟公司"式多 Agent 架构在工程上不成立》（2026-04-14 发布于
  ▎ sagasu.art）。你直接去抓这篇博客原文，不要再试 x.com 和 twitter 各种镜像，读完后：（1）判断"虚拟公司式多 Agent 架构在工程上不成立"这个论点对我们
  ▎ yoyo 的架构设计是否成立；（2）参考 https://github.com/multica-ai/multica 的产品逻辑；（3）检查之前竞品调研是否漏掉 hermes 这种 harness 设计项目。

## [2026-04-18 07:33 UTC] Bot

**现在我有了全部信息，下面做综合分析。**

现在我有了全部信息，下面做综合分析。
---
一、"虚拟公司式多 Agent 架构在工程上不成立"——对 Yoyo 是否成立？

结论：论点的核心批判对象不是 Yoyo，但有两个警示值得吸收。

SagaSu 的批判靶子非常明确——职能标签 + 信息压缩单向流转的组合。具体来说：

| 特征 | 三省六部反模式 | Yoyo 当前设计 | 匹配？ |
|------|-------------|-------------|--------|
| Agent 按人类岗位划分（PM/Dev/QA） | ✅ | ❌ 按能力/工具/场景划分 | 不匹配 |
| 流水线式单向交接 | ✅ | ❌ Actor 模型 + 消息传递 | 不匹配 |
| 信息传递靠摘要/结论 | ✅ | ❌ Memory Fabric 共享原始上下文 | 不匹配 |
| 推理链跨 Agent 断裂 | ✅ | ⚠️ 需确保 Scenario Router 不引入断裂 | 部分风险 |

Yoyo 已经天然避开了文章批判的主要陷阱：
- Actor 模型 + 消息驱动（来自 AutoGen）是 orchestrator-worker 模式，不是流水线
- Memory Fabric（跨 Agent 共享记忆）正是文章所推崇的"传原文不传摘要"
- 有状态图 + Checkpointing（来自 LangGraph）保证了推理链的连续性

但需要吸收的两个警示：

警示 1：Team Orchestrator 的嵌套团队设计需谨慎。 文章明确指出"多 Agent 的价值是并行覆盖，不是分工"。Yoyo 的 Team Orchestrator 支持"Agent 可递归组合（Team 也是 Agent）"，如果在实现时不自觉地滑向职能分工模式（一个 team 负责编码、另一个负责测试），就会踩坑。设计规范应明确：Team 的拆分维度是信息属性/搜索空间，不是人类组织角色。

警示 2：进化引擎的自省结果传递。 Evolution Engine 的三阶段循环（评估→规划→实现）本身就是一个多步骤流程。如果评估阶段的输出被压缩成摘要传给规划阶段，就犯了文章批判的错误。每个阶段应该能访问完整的原始状态，而不是上一阶段的"结论"。

文章五原则对 Yoyo 的检验：

| 原则 | Yoyo 现状 | 建议 |
|------|----------|------|
| ①推理链不能断，只能分叉再合并 | ✅ Scenario Router 的图模型天然支持 | 确保所有分支结果回流到同一编排节点 |
| ②显式外部状态 | ✅ Memory Fabric + Checkpointing | 已符合 |
| ③多 Agent 价值是并行覆盖 | ⚠️ 设计上支持但未强调 | 在文档中明确 Team 编排的使用场景限制 |
| ④验证 Agent 是否定者 | ⚠️ 未明确设计 | 进化验证门控已有，但需加入对抗性验证 Agent |
| ⑤工具是工具不是角色 | ✅ Plugin + 装饰器链 | 已符合 |
---
二、Multica 的产品逻辑参考

Multica（15.7k stars）的定位是 "managed agents platform"——把 AI Agent 当团队成员管理。核心特点：

| 维度 | Multica | Yoyo | 比较 |
|------|---------|------|------|
| 核心定位 | Agent 团队管理平台 | 自进化 Agent 中间件 | 互补而非竞争 |
| Agent 来源 | 外接（Claude Code, Codex, Hermes, Gemini 等） | 自建 Runtime + 多 Provider | Yoyo 更底层 |
| 进化能力 | Skill Compounding（手动积累） | 自动进化引擎 | Yoyo 核心优势 |
| 协作模式 | Issue 分配 → Agent 独立执行 | Actor 消息驱动 + 场景编排 | Yoyo 更灵活 |
| 技术栈 | Next.js 16 + Go + PostgreSQL | TypeScript + Rust | 类似 |

值得借鉴的点：
1. Agent 作为一等公民的 UI 呈现：Multica 让 Agent 在 project board 上有 profile、参与 thread、创建 issue、汇报 blocker——这种"Agent 可见性"设计可以借鉴到 Yoyo 的 Evolution Dashboard
2. Runtime 统一管理：单一 dashboard 管理本地 daemon 和云实例，自动检测可用 Agent CLI——这与 Yoyo 的 Provider Abstraction Layer 思路一致
3. Skill Compounding：解决方案沉淀为可跨团队共享的 skill——Yoyo 的 Skill 进化已有规划，但可参考 Multica 的共享机制
4. 多 Provider 接入列表：Multica 支持 Claude Code, Codex, OpenClaw, OpenCode, Hermes, Gemini, Pi, Cursor Agent——这里的 Hermes 正是你提到的 harness 设计项目
关键差异：Multica 本质上仍是"静态"平台（Agent 能力不随使用自动提升），这恰好是 Yoyo 竞品调研中识别出的行业共同弱点。
---
三、Hermes 在竞品调研中的覆盖情况

你的调研中存在 两个不同的 "Hermes"，且都没有深入分析：

Hermes 1：开源模型 Agent 优化框架

- 在 landscape.md 第 124 行仅一行提及：Hermes | 开源模型 Agent 优化 | Provider Layer — 本地模型作为 Provider
- 问题：只提了"开源模型优化"这个方向，没有分析其 harness 设计模式

Hermes 2：Claude Code OAuth token 相关工具

- 在记忆中记录为 "Hermes Agent 直接窃取 Claude Code OAuth token，存在明确封号风险"
- 这是一个激进使用 Claude Code 订阅的外部工具

Hermes 3（漏掉的）：作为 Agent Harness/Runtime

- Multica 将 Hermes 列为支持的 Agent Provider 之一，与 Claude Code、Codex 并列
- 这表明 Hermes 已经发展为一个独立的 Agent CLI/Runtime，具备 harness 设计模式
- 你的调研 landscape.md 的框架对比矩阵（CrewAI/AutoGen/LangGraph/OpenHands/Mastra）完全没有把 Hermes 作为 harness/runtime 竞品来分析

建议补充调研：

| 待调研项 | 关注点 |
|---------|--------|
| Hermes Agent CLI | 它的 harness 设计：session 管理、context engineering、工具系统、状态持久化 |
| OpenClaw / OpenCode | Multica 列出的其他 Agent CLI，可能是新兴竞品 |
| Multica 本身 | 作为 "Agent 团队管理层" 的产品设计，与 Yoyo 的定位差异 |

另外，SagaSu 文章提到的 Anthropic Managed Agents 概念也值得对照——这是官方的多 Agent 编排方案，与 Multica 的 managed agents 思路有交集。
---
总结行动建议

1. Yoyo 架构安全：当前五层设计不属于"三省六部"反模式，但需要在 Team Orchestrator 文档中加入显式约束——"按信息维度拆分，不按角色拆分"
2. 补一条设计原则：把 SagaSu 文章的核心洞察写入架构规范——"传原文者活，转述摘要者死"
3. 补充竞品调研：Hermes 作为 harness/runtime 的深度分析是缺失的，需要单独调研其 CLI 设计模式
4. 参考 Multica：其 Agent 可见性 UI、Runtime 统一管理、Skill Compounding 值得借鉴，但其"静态"本质正是 Yoyo 的差异化优势

## [2026-04-18 07:41 UTC] User

按你整理的所有行动建议来继续完善我们的调研文档，把所有内容按照spec的形式整理，防止我们在代码执行层面出现偏差

## [2026-04-18 07:42 UTC] Bot

**记忆已同步完成，索引版本升到 82。所有修改已落地。**

记忆已同步完成，索引版本升到 82。所有修改已落地。

## [2026-04-18 07:49 UTC] User

其他待做的调研任务你也都完成一下，然后更新所有文档，然后对我描述一下我们整个项目的设计和规划

## [2026-04-18 07:50 UTC] Bot

**同步记忆：所有调研完成，所有文档已更新。现在给你完整的项目描述。**

同步记忆：所有调研完成，所有文档已更新。现在给你完整的项目描述。Yoyo 项目全景

一句话定位

Yoyo 是一个自进化多 Agent 中间件平台 — 不只让 Agent 完成任务，还让 Agent 和平台本身在使用中自动变得更好。设计哲学

传统平台：人类设计 → 人类开发 → 人类维护
Yoyo：人类设定方向 → Agent 设计/开发/测试 → Agent 自我进化 → 人类审阅/引导

人类从「操作者」变为「方向引导者」和「最终裁决者」。五层架构



┌─────────────────────────────────────────────┐
│            Human Interface                   │
│         (方向设定 / 审阅 / 裁决)               │
├─────────────────────────────────────────────┤
│            Evolution Engine                  │
│   Self&#45;Monitor │ Pattern Miner │ Auto&#45;Refactorer  │
│   OODA 循环 + @model&#45;dependent 可演化标注        │
│   evolution&#45;context/ 共享目录(原始数据不压缩传递)  │
├─────────────────────────────────────────────┤
│            Scenario Router                   │
│   场景感知 → 动态 Workflow 编排 → 有状态图+Checkpoint │
├─────────────────────────────────────────────┤
│         Agent & Team Runtime                 │
│   Agent Lifecycle │ Team Orchestrator │ Memory Fabric │
│   Actor 模型      │ hub&#45;spoke 拓扑    │ 跨 Agent 共享 │
│   跨 session      │ 信息维度拆分      │ 多层索引      │
│   状态文件        │ 对抗性验证        │ aria&#45;memory 扩展│
├─────────────────────────────────────────────┤
│         Provider Abstraction Layer           │
│   Claude │ GPT │ Gemini │ Local │ MCP │ Hermes │
│   能力矩阵 + 智能选择 + Fallback + 成本感知      │
├─────────────────────────────────────────────┤
│         Tool & Service Layer                 │
│   飞书 / GitHub / CI&#45;CD / DB / FS / APIs     │
│   agentskills.io 标准兼容                     │
└─────────────────────────────────────────────┘

竞争格局与差异化定位

调研覆盖了 9 个竞品/参考项目：

| 层次 | 竞品 | Yoyo 差异 |
|------|------|----------|
| Agent 级自进化 | Hermes (~97.6k stars) — 技能自创建+自改进+记忆 | Yoyo 做平台级：多 Agent + 编排 + Prompt + 平台代码的全面自进化 |
| Agent 团队管理 | Multica (~15.7k stars) — 管理多个 Agent CLI | Yoyo 是 runtime 层，Multica 是管理层；Yoyo 可作为 Multica 的 Provider |
| 编排框架 | CrewAI / AutoGen / LangGraph | Yoyo 融合三者优点 + 自进化（它们都是静态的） |
| 事件流 | OpenHands | Yoyo 参考其事件流+沙箱，加入进化维度 |
| 终端 Agent | Crush (OpenCode 继任) | 参考其 agentskills.io 标准兼容 |
| 自进化 Agent | yoyo-evolve | 核心灵感来源，Yoyo 从单 Agent 扩展到平台级 |

Yoyo 三大独有能力（竞品均不具备的组合）：
1. 平台级自进化 — Prompt A/B 测试、编排模式自动调整、Pattern Mining、Agent-as-Maintainer（自有代码由 Agent 维护）
2. 多 Agent 编排智能 — Actor 模型 + 5 种编排模式 + 场景感知动态编排 + 有状态图 Checkpointing
3. 进化可观测 — Evolution Dashboard + 结构化进化日志 + 人类干预频率趋势
---

强制设计约束

基于三大厂商（Anthropic / OpenAI / Google）工程实践和 SagaSu《三省六部幻觉》分析，制定了 specs/multi&#45;agent&#45;design&#45;constraints.md 规范，五条核心原则：

| 原则 | 内容 |
|------|------|
| ①传原文者活 | 下游 Agent 接收原始材料，非上游 Agent 的理解/摘要 |
| ②推理链分叉再合并 | hub-spoke 拓扑，禁止串行交接 chain |
| ③并行覆盖不是分工 | 多 Agent 的价值是扩大搜索空间 |
| ④验证 Agent 是否定者 | 对抗性找问题，不是接棒做下一步 |
| ⑤工具是工具不是角色 | 能力由工具绑定决定，不由角色标签限制 |

额外约束：Pipeline 仅限确定性工具链；Team 按信息维度拆分不按岗位；跨 session 必须有四类信息的状态文件；Evolution Engine 各阶段可访问前序完整原始数据。技术选型

| 维度 | 选型 | 来源 |
|------|------|------|
| 核心语言 | TypeScript (Node.js 22) + Rust 热路径 | 与 KeyClaw/lark-bridge 一致 |
| 运行时 | Actor 模型 + 消息驱动 | AutoGen 0.4 |
| 工作流 | 有状态图 + 自动快照 | LangGraph Checkpointing |
| 记忆 | aria-memory 扩展为 Memory Fabric | 自有 264 impressions + 65 knowledge |
| 工具 | ContextPlugin + 装饰器链 + agentskills.io 兼容 | KeyClaw + yoyo-evolve + Hermes/Crush |
| 配置 | Zod schema + 热重载 | lark-bridge |
| 存储 | SQLite WAL → PostgreSQL + pgvector | KeyClaw |
| 进化 | 内置 Cron + GitHub Actions | yoyo-evolve |
| Agent SDK | @anthropic-ai/claude-agent-sdk | lark-bridge |四阶段路线图| 阶段 | 目标 | 核心交付 | 自治水平 |
|------|------|---------|---------|
| Phase 0: Foundation | 最小可用骨架 | PAL + Agent Runtime + 记忆集成 + CLI + 工具系统 + agentskills.io | 人类驱动 |
| Phase 1: Intelligence | 场景理解+动态编排 | Scenario Router + Team Orchestrator (Parallel/Debate/Pipeline) + Memory Fabric v1 | Agent 驱动，人类审批 |
| Phase 2: Evolution | 自我进化 | Evolution Engine (Self-Monitor + Pattern Miner + Auto-Refactorer L0-L1) + Dashboard | Agent 自治，人类监督 |
| Phase 3: Autonomy | Agent 自主维护平台 | Agent-as-Developer + 自主需求分析 + L2-L3 重构 + 全编排模式 | Agent 自治，人类引导 |
| Phase 4: Ecosystem | 开放生态 | Agent Store + Provider 插件化 + 跨实例协作 | — |自有项目集成矩阵



aria&#45;memory ──→ Memory Fabric 默认后端 (Phase 0 直接复用)
lark&#45;bridge ──→ Service Provider 飞书接入 + Hook 系统参考 + Zod 配置
KeyClaw     ──→ AgentRunner 接口 + ContextPlugin + 8 Provider 经验 + GroupQueue
yoyo&#45;evolve ──→ 三阶段进化循环 + 验证门控 + 装饰器链 + 身份认知文件

文档体系



yoyo/
├── docs/
│   ├── architecture/
│   │   ├── overview.md          ← 架构总览 + 5 条多 Agent 原则
│   │   ├── provider&#45;layer.md    ← PAL 设计
│   │   └── evolution&#45;engine.md  ← 进化引擎 + 阶段间信息流约束
│   ├── modules/
│   │   ├── agent&#45;runtime.md     ← Agent 生命周期 + 通信约束 + 跨 session 状态
│   │   ├── team&#45;orchestrator.md ← 编排模式 + 三省六部约束 + 重新设计的模板
│   │   ├── memory&#45;fabric.md     ← 记忆织网
│   │   └── scenario&#45;router.md   ← 场景路由
│   ├── research/
│   │   ├── landscape.md         ← 9 个竞品调研 (含 Hermes/Multica/Crush 深度)
│   │   └── prior&#45;art.md         ← 自有项目资产盘点
│   └── evolution/
│       ├── feedback&#45;loop.md     ← 反馈闭环
│       └── self&#45;improvement.md  ← 自我改进机制
├── specs/
│   ├── provider&#45;protocol.md     ← Provider 接入协议
│   └── multi&#45;agent&#45;design&#45;constraints.md  ← ⭐ 多 Agent 设计约束规范 (强制)
└── roadmap/
    └── phases.md                ← 四阶段路线图

整体来说，Yoyo 的设计在行业内已经有清晰的差异化定位。Hermes 的出现让我们必须把差异化从"Agent 越用越好"上升到"平台越用越好"——单个 Agent 的自我改进 Hermes 已经做得很好了（97.6k stars 验证了市场需求），Yoyo 的战场在更高一层：多 Agent 编排的智能化和整个平台的自进化。这个定位目前没有竞品占领。新消息已到达⚠️ 已中断

## [2026-04-18 08:01 UTC] User

和我预期的还有一定差距，人类不仅可以指引方向，也可以是提需求和反馈bug的人。agent不仅可以根据人类提供的方向进行具体规划设计演进，也可以自行从互联网中获取进化方向，但是需要满足我们的产品设计逻辑，且最好获得人类认可的方向，或者是判断为业界更先进的方向

## [2026-04-18 08:02 UTC] Bot

**记忆已同步完成（indexVersion 83）。所有文档和记忆现在都反映...**

记忆已同步完成（indexVersion 83）。所有文档和记忆现在都反映了修正后的设计。

## [2026-04-18 08:14 UTC] User

phase 0开始之前还有很多需要在一开始确认的细节设计需要明确，你列一下有哪些，第一阶段我只想接入claude code和codex

## [2026-04-18 08:14 UTC] Bot

**好了，现在我清楚 KeyClaw 的实现模式了。让我把所有需要在 Phas...**

好了，现在我清楚 KeyClaw 的实现模式了。让我把所有需要在 Phase 0 动手前拍板的决策列出来——逐项标注当前状态和我的建议。Phase 0 前置设计决策清单

一、根本性架构决策（必须第一个定）

Q1: Yoyo 的 Agent 执行模型是什么？

当前设计文档里混杂了两种思路，没有明确选一种：

| 方案 | 描述 | 代表产品 |
|------|------|---------|
| A: SDK 直调 | Yoyo 直接调用 Claude Agent SDK / Codex SDK，自己实现 agent loop | KeyClaw 现有做法 |
| B: CLI 子进程 | Yoyo spawn claude/codex CLI 进程，通过 stdin/stdout/文件通信 | Multica 做法 |
| C: 混合 | 核心用 SDK 直调，但保留 CLI 子进程作为 Fallback 或特定场景 | — |

KeyClaw 用的是 方案 A（@anthropic&#45;ai/claude&#45;agent&#45;sdk + @openai/codex&#45;sdk），已验证可行。

我的建议: 方案 A。你已有 KeyClaw 的成熟实现可复用，SDK 直调对 token 流、工具调用、上下文管理的控制力远强于 CLI 子进程。

你需要确认: 用方案 A 还是 B？这决定了整个 Provider 层的接口设计。二、Provider 层具体设计（6 个决策点）

Q2: Claude Provider 调 SDK 的哪一层？

Claude Agent SDK 有两层接入点：

| 层级 | API | 控制力 | 复杂度 |
|------|-----|--------|--------|
| 底层: Messages API | anthropic.messages.create() | 完全控制 agent loop | 高 — 自己实现工具调用循环 |
| 高层: Agent SDK | claude(...) 一键启动 | SDK 管理 loop | 低 — 但自定义受限 |

KeyClaw 用的是 Agent SDK 高层。Yoyo 作为平台级产品需要更多控制力（自定义 context strategy、checkpoint、进化钩子），可能需要底层。

你需要确认: 从 Agent SDK 高层开始（快速出活），还是直接用 Messages API 底层（更多控制力）？

Q3: Codex Provider 调什么？

Codex SDK (@openai/codex&#45;sdk) 是轮次制（无中途推送）。KeyClaw 已有 CodexRunner 实现。

需要确认: 直接复用 KeyClaw 的 CodexRunner 逻辑，还是重新设计接口？

Q4: 两个 Provider 的能力差异如何抽象？

Claude 和 Codex 的行为差异大：

| 差异点 | Claude (Agent SDK) | Codex (SDK) |
|--------|-------------------|-------------|
| 流式推送 | ✅ 支持 mid-query push | ❌ 轮次制，无中途推送 |
| 工具调用 | SDK 内置 tool loop | 需外部 MCP |
| Context 管理 | 支持 compaction | 依赖 previous_response_id |
| 权限模式 | plan/auto/bypass | 不同的权限模型 |

需要确认: AgentRunner 接口要抽象到什么程度？最小公共集（两者都支持的），还是超集（允许 Provider 特有能力暴露）？

Q5: 认证方式

| Provider | 认证选项 |
|---------|---------|
| Claude | Anthropic API Key / OAuth / Bedrock credentials |
| Codex | OpenAI API Key / 本地 CLI auth.json 同步 |

需要确认: Phase 0 先支持哪些认证方式？建议最简：Claude 用 API Key，Codex 用 API Key。

Q6: Fallback 策略的具体行为

文档写了"主 Provider 失败原子切换到备用"，但：
- Claude 失败 → 切 Codex？（模型能力差异很大，切了可能效果更差）
- 还是 Claude API 失败 → 切 Claude Bedrock？（同模型不同通道）
需要确认: Phase 0 的 Fallback 是同模型跨通道，还是跨模型？三、Agent 模型精简（3 个决策点）

Q7: Phase 0 的最小可用 Agent 定义是什么？

当前 Agent 定义有 20+ 个字段，Phase 0 不可能全实现。哪些是 Day 1 必须的？

我的建议——Phase 0 最小 Agent：
```typescript
interface AgentConfig {

// Day 1 必须

id: string

name: string

provider: 'claude' | 'codex'    // Phase 0 只有两个

systemPrompt: string            // 核心指令

tools: string[]                 // 启用的工具名称列表

// Day 1 可选

model?: string                  // 覆盖 provider 默认模型

contextStrategy?: 'compaction' | 'checkpoint'

fallbackProvider?: string

}

``
**推迟到 Phase 1+**:
&#45;role/goal/backstory(CrewAI 式)
&#45;identity/personality(IDENTITY.md/PERSONALITY.md)
&#45;triggers/constraints/preferences
&#45;activeLearnings
&#45;sharedMemory
&#45;evolvedFrom/version`
你需要确认: 这个精简是否可接受？还是有哪些字段你觉得 Day 1 必须？

Q8: Agent 的进程模型

| 方案 | 描述 | 优劣 |
|------|------|------|
| 单进程多 Agent | 所有 Agent 在同一个 Node.js 进程内，通过 async 调度 | 简单，但一个 crash 全挂 |
| 每 Agent 一个子进程 | 每个 Agent spawn 独立 Node 进程 | 隔离好，但 IPC 开销大 |
| 单进程 + Worker Threads | 主进程调度，密集计算用 Worker | 折中 |

KeyClaw 用的是容器级隔离（每个用户一个 Docker 容器）。Phase 0 没有多用户需求。

我的建议: Phase 0 用单进程多 Agent，够用且最简单。

Q9: Agent 的持久化

Agent 配置存在哪里？

| 方案 | 描述 |
|------|------|
| A: 配置文件 | ~/.yoyo/agents/agent&#45;name.yaml |
| B: SQLite | 数据库存储，支持查询 |
| C: 代码定义 | 在项目代码中定义，不运行时创建 |

需要确认: Phase 0 用文件还是数据库？四、数据目录与状态管理（4 个决策点）

Q10: Yoyo 的数据根目录

| 候选 | 说明 |
|------|------|
| ~/.yoyo/ | 类似 ~/.claude/ |
| $XDG_DATA_HOME/yoyo/ | XDG 规范 |
| 项目本地 .yoyo/ | 类似 .git/，每个项目独立 |

需要确认: 全局的还是项目级的？还是两者都有？

Q11: 会话 (Session) 的存储

Agent 运行一次就是一个 Session。Session 数据存在哪里？

| 数据 | 存什么 |
|------|--------|
| 会话历史 | 用户消息 + Agent 回复 + 工具调用 |
| 事件流 | 所有执行事件（EventStream） |
| 状态文件 | 跨 session 的四类信息 |

需要确认: 用文件（JSON/JSONL）还是 SQLite？KeyClaw 用 SQLite WAL，Hermes 也用 SQLite + FTS5。

Q12: 配置文件格式| 格式 | 优劣 |
|------|------|
| yoyo.config.ts | 类型安全，可编程，但需要编译 |
| yoyo.json | 简单，Zod 验证 |
| yoyo.yaml | 可读性好，人类友好 |

lark-bridge 用的是 JSON + Zod。

需要确认: 配置格式选哪个？

Q13: 日志目录和格式

pino 已确定，但输出到哪里？
- stdout（适合开发）
- ~/.yoyo/logs/（适合 daemon 模式）
- 两者都有？
---

五、工具系统（3 个决策点）

Q14: Phase 0 的工具来源

如果用 SDK 直调（方案 A），工具有两个来源：

| 来源 | 描述 |
|------|------|
| SDK 内置 | Claude Agent SDK 自带 bash/read/write/edit 等 |
| Yoyo 自建 | 自己实现工具并注册到 SDK |

需要确认: Phase 0 直接用 SDK 内置工具，还是从 Day 1 就实现自己的工具层（装饰器链包装 SDK 工具）？

Q15: MCP Server 支持范围

Phase 0 要支持 MCP 吗？KeyClaw 已有 MCP 集成。

建议: Phase 0 先不做 MCP，除非你有特定 MCP Server 需要接入。

Q16: agentskills.io 兼容在 Phase 0 做吗？

路线图里放在了 P0-6，但这是个相对独立的功能。

建议: 推迟到 Phase 1。Phase 0 专注核心 loop 跑通。六、记忆集成（2 个决策点）

Q17: aria-memory 的集成方式

| 方案 | 描述 |
|------|------|
| A: 文件级 | Yoyo 直接读写 aria-memory 的文件（index.md, knowledge/, impressions/） |
| B: 子进程 | spawn aria-memory agent 作为子进程 |
| C: 库导入 | 把 aria-memory 的核心逻辑抽成库 import |

现在 aria-memory 是 Claude Code 的 extension（skill + hook），不是独立库。

需要确认: Phase 0 是直接操作文件（最快），还是做正式的库抽取？

Q18: Per-Agent 记忆的目录结构


~/.yoyo/memory/
├── platform/          # 平台级记忆
│   ├── index.md
│   └── knowledge/
├── agents/
│   ├── agent&#45;alpha/   # Agent 私有记忆
│   │   ├── index.md
│   │   └── knowledge/
│   └── agent&#45;beta/
└── shared/            # 团队共享记忆


需要确认: 这个结构行吗？还是 Phase 0 先用单一平面目录？七、CLI 设计（2 个决策点）

Q19: CLI 框架选型

| 框架 | 特点 |
|------|------|
| commander.js | 最流行，简单直接 |
| oclif | Salesforce 出品，支持插件 |
| clipanion | Yarn 使用，类型安全 |
| ink | React 风格 TUI |
| 自研 | 类似 claude-code 的简单 REPL |

需要确认: 选哪个？

Q20: CLI 的交互模式

Phase 0 需要支持几种模式？

| 模式 | 描述 | Phase 0？ |
|------|------|----------|
| 交互式 REPL | yoyo 启动后持续对话 | ✅ 核心 |
| 单次命令 | yoyo run "做某事" | ✅ 基础 |
| 管道模式 | echo "做某事" | yoyo | ❌ 推迟 |
| Daemon 模式 | 后台常驻 | ❌ 推迟 |八、Phase 0 裁剪建议

基于你说"只接入 Claude Code 和 Codex"，以下是我建议从 P0 路线图中推迟的项目：

| 原计划 | 建议 | 原因 |
|--------|------|------|
| MCP Tool Provider 适配器 | → Phase 1 | Phase 0 用 SDK 内置工具即可 |
| 能力矩阵 | → Phase 1 | 只有 2 个 Provider，硬编码差异就够了 |
| Fallback 机制 | → Phase 0 后期 | 先跑通单 Provider，再做切换 |
| Actor 消息驱动运行时 | → Phase 1 | Phase 0 单 Agent 直接调用就够了 |
| 事件流记录 | → Phase 0 后期 | 先跑通再加审计 |
| TaskDelegation 接口 | → Phase 1 | Phase 0 没有多 Agent 协作 |
| 多后端执行沙箱 | → Phase 1 | Phase 0 本地执行就够了 |
| 装饰器链工具包装 | → Phase 0 后期 | 先直接用 SDK 工具 |
| agentskills.io 兼容 | → Phase 1 | 独立功能，不影响核心 |
| Hook 系统 | → Phase 0 后期 | 先做核心 loop |

Phase 0 真正的最小可交付:


P0&#45;MVP:
  1&#46; 项目脚手架 (monorepo + Zod config + pino)
  2&#46; Claude Provider (Agent SDK 直调)
  3&#46; Codex Provider (SDK 直调)
  4&#46; 最小 Agent 定义 (id + name + provider + systemPrompt + tools)
  5&#46; 单 Agent 执行循环 (接收任务 → 调 Provider → 返回结果)
  6&#46; CLI 入口 (REPL + 单次命令)
  7&#46; aria&#45;memory 基础集成 (session 结束写记忆)

以上 20 个决策点，我标了建议但最终需要你拍板。你觉得哪些可以直接按我的建议来，哪些需要讨论？

## [2026-04-18 08:24 UTC] User

我逐个回答这些问题，但是我要插入一个最重要的问题，我不想让这个项目叫yoyo，我想改名成哈罗（Haro），就是贯穿高达作品中的哈罗，他不仅是人人喜欢的电子宠物，同样是主角团最忠实的战斗帮手。记得把项目文件夹名和项目中所有的yoyo都改好名字。
Q1: 同意方案A，但是使用claude code的时候要用lark-bridge的这种形式，否则会被claude封号
Q2-Q3都需要满足项目用法和Q1前提
Q4：因为Q1 claude封号顾虑，所以一定是超集
Q5：claude code的用法要完全参考lark-bridge，codex可以参考keyclaw

## [2026-04-18 08:24 UTC] Bot

**最后更新记忆：全部完成。记忆在后台同步中。总结一下这轮做了什么：**

最后更新记忆：全部完成。记忆在后台同步中。总结一下这轮做了什么：
---
完成清单

1. 改名 Yoyo → Haro

- 文件夹 /self&#45;codes/yoyo/ → /self&#45;codes/haro/
- 15 个 markdown 文件中所有 "Yoyo/yoyo" → "Haro/haro"
- 保留了外部项目名 "yoyo-evolve" 不改（那是竞品，不是我们的）

2. Q1-Q5 决策写入设计文档

| 决策 | 结论 | 落地位置 |
|------|------|---------|
| Q1 执行模型 | SDK 直调，Claude Code 必须走 Agent SDK（非 Anthropic API）防封号 | provider&#45;layer.md D1-D2 |
| Q2 Claude 调什么 | @anthropic&#45;ai/claude&#45;agent&#45;sdk 的 query() — 完全参考 lark-bridge | provider&#45;layer.md + specs/provider&#45;protocol.md |
| Q3 Codex 调什么 | @openai/codex&#45;sdk — 参考 KeyClaw | 同上 |
| Q4 接口设计 | 超集——暴露 Provider 特有能力 | specs/provider&#45;protocol.md AgentCapabilities |
| Q5 认证 | Claude=订阅自动认证，Codex=API Key | specs/provider&#45;protocol.md 认证协议 |

3. 具体产出

- specs/provider&#45;protocol.md — 完全重写，从泛化的 LLM/Tool/Service 三类型改为以 AgentProvider 为核心，包含完整的 TypeScript 接口定义（AgentProvider / AgentCapabilities / AgentQueryParams / AgentEvent）
- docs/architecture/provider&#45;layer.md — 完全重写，加入 D1-D4 决策、两个 Provider 的具体实现方案、认证配置、封号风险警告
- roadmap/phases.md P0-2 和验收标准 — 更新为新的 Provider 设计
---
剩下 Q6-Q20 你要继续逐个回答，还是想先就当前的 Provider 设计再深入讨论？
---
新消息已到达⚠️ 已中断

## [2026-04-18 08:34 UTC] User

Q6: 说到fallback逻辑我就想到设计中需要补充一个底层逻辑：由agent根据规则选择最适合的provider和模型执行对应的任务，fallback逻辑可以在第一模型/第一provider无法使用的情况下回退到第二模型/第二provider
Q7-Q9：根据我们之前问题的答案重新评估
Q10：两者都有，有可能需要在项目空间存储一些定制化的东西
Q11: SQLite
Q12: json/yaml都可以，这些应该是AI管理，所以选择ai最喜欢的格式
Q13: 日志可以参考hermes，有必要的话可以两者都有，同时提供doctor命令
Q14: 工具可以用内置的，非必要不自建
Q15: phase 0 不做
Q16: skills 要做
Q17: memory独立设计，可以独立部署也可以配置符合格式的记忆目录，比如aria-memory的记忆目录，同时兼容一些我对aria-memory的改动设计，如可配置主备，仅主可执行global_sleep等逻辑
Q18: 同17
Q19-20: cli这块我不太懂，你可以参考hermes和openclaw，找出一个足够轻量又符合我们项目逻辑的选型

## [2026-04-18 08:34 UTC] Bot

**记忆同步（后台）：好了。记忆后台同步中。来总结这轮 Q6-Q20 的全部决策：**

记忆同步（后台）：好了。记忆后台同步中。来总结这轮 Q6-Q20 的全部决策：
---
Q6-Q20 决策总结

Q6: Provider/Model 智能选择 ← 新增核心机制

不只是 Fallback，是完整的选择规则引擎：


任务 → 匹配选择规则 → 选出最优 Provider + Model → 执行
                                                    ↓ 失败
                                              Fallback 到备选


已创建 specs/provider&#45;selection.md，包含：
- SelectionRule 接口（match 条件 + select 结果 + fallback + priority）
- 4 条默认规则（default / complex-reasoning / code-generation / quick-task）
- 项目级 .haro/selection&#45;rules.yaml 可覆盖全局规则
- Fallback 触发条件和日志规范

Q7: 最小 Agent 定义（重新评估后）

```typescript
interface AgentConfig {

id: string

name: string

systemPrompt: string

tools?: string[]

// Provider 由选择规则引擎决定，不再硬绑到 Agent 上

defaultProvider?: string     // 可选覆盖

defaultModel?: string        // 可选覆盖

}

```
Phase 1 再加 role/goal/backstory/identity/personality 等字段。

Q8: 单进程多 Agent

Q9: Agent 配置用 YAML 文件 ~/.haro/agents/xxx.yaml

Q10: 双层数据目录

```plain_text
~/.haro/                      ← 全局
├── config.yaml               ← 全局配置
├── selection-rules.yaml      ← 全局选择规则
├── agents/                   ← Agent 定义
├── skills/                   ← 全局 Skills
├── memory/                   ← 平台级记忆
├── logs/                     ← 日志
└── haro.db                   ← SQLite

.haro/                        ← 项目级（可选）
├── config.yaml               ← 项目级配置（覆盖全局）
├── selection-rules.yaml      ← 项目级选择规则（覆盖全局）
└── skills/                   ← 项目级 Skills
```

Q11: SQLite 存会话和事件

Q12: YAML 配置格式（AI 管理友好、人类可读）

Q13: pino 日志双输出 + haro doctor

Q14: SDK 内置工具，非必要不自建

Q15: Phase 0 不做 MCP

Q16: Skills 做，agentskills.io 标准

Q17-Q18: 记忆独立模块

- 可独立部署，也可配置已有目录（如 aria-memory）
- 兼容 aria-memory 目录格式和改动设计
- 支持主备配置，仅主执行 global_sleep
- Per-Agent 私有记忆在 ~/.haro/memory/agents/{name}/

Q19-Q20: CLI 选型

commander.js（命令路由）+ @clack/prompts（交互式提示）

参考 Hermes 的命令集设计，精简为 Phase 0 核心：

| 命令 | 功能 |
|------|------|
| haro | 启动交互式 REPL |
| haro run "..." | 单次任务 |
| haro model | 查看/切换 Provider 和 Model |
| haro config | 配置管理 |
| haro doctor | 系统诊断 |
| haro skills | 技能管理 |
| haro status | 运行状态 |

REPL 内 Slash 命令：/model /new /retry /compress /skills /usage
---
20 个前置决策全部定稿。Phase 0 可以开始写代码了。要开始搭脚手架吗？
---
新消息已到达⚠️ 已中断

## [2026-04-18 08:42 UTC] User

再确认一下 还有什么没有明确的项目或问题

## [2026-04-18 08:47 UTC] Bot

**最后一个记忆任务也完成了，不过因为权限问题没能写入 .claude/mem...**

最后一个记忆任务也完成了，不过因为权限问题没能写入 .claude/memory/ 目录。不过之前的任务已经成功更新了 .aria&#45;memory/ 目录下的知识文件，所以记忆内容是完整的，只需要你执行那个 git commit 即可。

一切就绪，等你的指令开始写代码。

## [2026-04-18 09:01 UTC] User

你帮我提交commit，然后用ralph loop来做phase 0，确保一阶段目标全部达成且完全遵守设计文档中所有要求和设计。尤其是确保claude code的对接完全符合anthropic规定，参考lark-bridge

## [2026-04-18 09:01 UTC] Bot

**Not logged in · Please run /login**

Not logged in · Please run /login

## [2026-04-18 09:31 UTC] Bot

**会话空闲超时，已自动关��。发送���消息可开启新对话。**

会话空闲超时，已自动关��。发送���消息可开启新对话。

## [2026-04-18 09:31 UTC] Bot

**⚠️ 会话出错: Claude Code returned an erro...**

⚠️ 会话出错: Claude Code returned an error result: Not logged in · Please run /login
