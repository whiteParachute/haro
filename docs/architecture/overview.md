# Haro 架构总览

## 一句话定位

Haro 是一个自进化多 Agent 中间件平台 — 不只让 Agent 完成任务，还让 Agent 和平台本身在使用中自动变得更好。

## 设计哲学

传统平台：人类设计 → 人类开发 → 人类维护

Haro：人类设定方向 → Agent 设计/开发/测试 → Agent 自我进化 → 人类审阅/引导

### 人类的角色

- **方向把控者**：设定目标、确认架构演进方向
- **用户**：提出需求、反馈 Bug、给出改进建议
- **最终裁决者**：对 Agent 提出的需求、进化方向行使**认可权**；重要变更行使审阅权

### Agent 的角色

Agent 的自主性分两类，都受人类认可门控：

**自主发现（内部信号）**：
- 通过 review 代码发现 bug 和改进点
- 通过整理、提取记忆发现模式和遗漏
- 自行判断并修复 bug（走常规 PR 审阅）
- 主动提出需求（需用户认可后推进）

**自主选择进化方向（外部信号）**：
- 从互联网获取业界进展
- 需满足三条之一：① 符合 Haro 产品设计逻辑；② 最好获得用户认可；③ 或判断为业界更先进的方向

## 设计原则

以下原则贯穿所有模块，优先级高于具体设计决策。

### 非核心组件皆可插拔（No-Intrusion Plugin Principle）

所有外挂功能或组件，只要不是系统核心，都必须做到：

- **独立注册 / 装载 / 卸载**
- 对核心模块**零侵入、零硬编码**（不得在核心代码出现针对具体实现的特判分支）
- 能力通过标准接口 + `capabilities()` 查询暴露
- 卸载后核心功能不受影响

**典型可插拔组件**：Provider（Claude / Codex / …）、Channel（飞书 / Telegram / …）、Skill、Tool Provider、MCP Server、Memory Backend、Storage Backend。

**核心组件（不可插拔）**：Agent Runtime 核心、Scenario Router、Evolution Engine、Memory Fabric 协议层、Channel 协议层、PAL 协议层。

### 代谢优于堆积

Haro 在进化中坚持"留精华、不堆数量"：

- 新能力通过 [eat](../../specs/evolution-metabolism.md) 沉淀，有质量门槛
- 冗余能力通过 [shit](../../specs/evolution-metabolism.md) 清除，可回滚

这是 Evolution Engine 的底层代谢机制，与 OODA 改进循环并行。

## 六层架构

```
┌─────────────────────────────────────────────┐
│            Human Interface                   │
│  方向设定 / 审阅 / 裁决 / checkpoint 介入 / 预算审批 │
├─────────────────────────────────────────────┤
│            Evolution Engine                  │
│   Self-Monitor │ Pattern Miner │ Auto-Refactorer  │
│   OODA + eat/shit 代谢 + Evolution Asset Registry │
│   evolution-context/ 共享目录(全局级，原始数据不压缩) │
├─────────────────────────────────────────────┤
│            Scenario Router                   │
│   场景感知 → 动态 Workflow 编排 → Checkpoint + Debug │
├─────────────────────────────────────────────┤
│         Agent & Team Runtime                 │
│   Agent Lifecycle │ Team Orchestrator │ Memory Fabric │
│   Actor 模型      │ hub-spoke 拓扑    │ 三级记忆 + FTS5 │
│   跨 session      │ 信息维度拆分      │ Skill memory  │
│   权限/预算护栏   │ 对抗性验证        │ aria-memory 兼容│
├─────────────────────────────────────────────┤
│       Provider Abstraction Layer             │
│   Claude │ Codex │ GPT │ Gemini │ Local │ ...   │
│   超集能力矩阵 + 智能选择 + 动态重评估 + Fallback  │
├─────────────────────────────────────────────┤
│       Channel Abstraction Layer              │
│   CLI │ Feishu │ Telegram │ Slack │ Web │ ...   │
│   消息渠道接入 + 会话映射 + 富文本渲染             │
├─────────────────────────────────────────────┤
│         Tool & Service Layer                 │
│   Skills │ MCP │ GitHub │ CI-CD │ DB │ FS │ APIs │
└─────────────────────────────────────────────┘
```

**与早期设计的差异**：
- Channel Abstraction Layer 提升为独立一层（原本只在 Tool Layer 里列了"飞书"）
- Tool Layer 去除"agentskills.io 标准兼容"（改为直接兼容 Claude Code skill 格式）

## 多 Agent 强制设计约束（五条核心原则）

基于 SagaSu《三省六部幻觉：为什么"虚拟公司"式多 Agent 架构在工程上不成立》分析，制定以下强制约束：

| 原则 | 内容 |
|------|------|
| ①传原文者活 | 下游 Agent 接收原始材料，非上游 Agent 的理解/摘要 |
| ②推理链分叉再合并 | hub-spoke 拓扑，禁止串行交接 chain |
| ③并行覆盖不是分工 | 多 Agent 的价值是扩大搜索空间，不是模拟人类分工 |
| ④验证 Agent 是否定者 | 对抗性找问题，不是接棒做下一步 |
| ⑤工具是工具不是角色 | 能力由工具绑定决定，不由角色标签限制 |

额外约束：
- Pipeline 仅限确定性工具链
- Team 按信息维度拆分，不按岗位拆分
- 跨 session 必须有四类信息的状态文件
- Evolution Engine 各阶段可访问前序完整原始数据（不传摘要）

详见：[specs/multi-agent-design-constraints.md](../../specs/multi-agent-design-constraints.md)

## 竞争格局

调研覆盖 9 个竞品/参考项目：

| 层次 | 竞品 | 技术栈 | Haro 差异 |
|------|------|--------|----------|
| Agent 级自进化 | Hermes (NousResearch/hermes-agent, ~98.6k stars) — 技能自创建+自改进+三级记忆、SQLite/FTS5 | Python + aiosqlite + FTS5 | Haro 做平台级：多 Agent + 编排 + Prompt + 平台代码的全面自进化；Memory Fabric v1 借鉴其分层和 FTS5，但增加信息维度拆分与对抗性验证 |
| 统一 Agent 平台 | OpenClaw — 多 Provider + 多 Channel + 丰富工具 | TypeScript + pnpm + sqlite-vec + LanceDB | Haro 借鉴其 Channel 隔离、Gateway 会话生命周期、团队共享上下文与权限模型；不照搬固定 Gateway 结构 |
| 进化语法 / 资产化 | EvoMap — signal → gene → prompt → event 的声明式进化表达 | — | Haro 不直接引入 GEP runtime，但把 eat/shit 产物、prompt、skill、编排规则资产化，预留 GEP 兼容字段 |
| 生产级 Agent Guard | Mercury Agent — 显式权限审批与 Token 预算 | — | Haro Phase 1 增加 operation class、approval policy 与 per-workflow Token budget，尤其约束多 Agent 并行成本 |
| Agent 团队管理 | Multica (~15.7k stars) — 管理多个 Agent CLI | — | Haro 是 runtime 层，Multica 是管理层；Haro 可作为 Multica 的 Provider |
| 编排框架 | CrewAI / AutoGen / LangGraph | — | Haro 借鉴 LangGraph 的状态图可视化、CrewAI 的任务流监控、AutoGen 的人机循环介入；但仍遵守 fork-and-merge 与 validator negative-only 约束 |
| 事件流 | OpenHands | — | Haro 参考其事件流+沙箱，加入进化维度 |
| 终端 Agent | Crush (OpenCode 继任) | — | 参考其 skill 生态思路 |
| 自进化 Agent | Yoyo（SagaSu 出品） | Next.js 16 + Go + PostgreSQL | 核心灵感来源，Haro 从单 Agent 扩展到平台级 |
| 消息渠道 | KeyClaw / lark-bridge | — | Haro 抽象为独立 Channel 层，复用 lark-bridge 作为飞书 adapter |

## 三大独有能力（竞品均不具备的组合）

1. **平台级自进化** — Prompt A/B 测试、编排模式自动调整、Pattern Mining、Agent-as-Maintainer + eat/shit 代谢
2. **多 Agent 编排智能** — Actor 模型 + 5 种编排模式 + 场景感知动态编排 + 有状态图 Checkpointing
3. **进化可观测** — Evolution Dashboard + 结构化进化日志 + 人类干预频率趋势

## 技术选型

> **原则**：Haro 技术栈独立决策，参考其他项目而非绑定。唯一例外：Claude 调用方式必须与 lark-bridge 一致，以防违反 Claude 规定导致订阅账号被封禁。

| 维度 | 选型 | 参考来源 |
|------|------|---------|
| 核心语言 | TypeScript (Node.js 22) | — （Rust 等其他语言按需引入，不做强绑定） |
| 运行时 | Actor 模型 + 消息驱动 | 参考 AutoGen 0.4 |
| 工作流 | 有状态图 + 自动快照 | 参考 LangGraph Checkpointing |
| 记忆 | 独立 Memory Fabric（Markdown 兼容层 + SQLite FTS5 索引；Session / Persistent / Skill 三层；platform/shared/agent scope） | 参考 Hermes + aria-memory |
| 工具 / 技能 | 兼容 Claude Code skill 格式 + MCP | 参考 Claude Code |
| 配置 | Zod schema + 热重载 | 参考 lark-bridge |
| 存储 | SQLite WAL + FTS5（Phase 1 Memory/Search/Asset read model）→ sqlite-vec / LanceDB 向量（Phase 2+） | 参考 Hermes / OpenClaw |
| 代码 Lint | ESLint + `@typescript-eslint/recommended` + `import/no-cycle`（Phase 2 由 eat/shit 代谢评估迁移 [oxlint](https://oxc.rs/docs/guide/usage/linter)，OpenClaw 已用） | 参考 OpenClaw（oxlint） |
| 进化 | eat/shit 代谢 + Evolution Asset Registry；Phase 2+ 接入 OODA、Dreaming、Pattern Miner 与自动触发 | 参考 yoyo-evolve / EvoMap / OpenClaw |
| Agent SDK | `@openai/codex-sdk`（Phase 0 当前正式实现） | 对齐现有 Codex Provider |
| 消息渠道 | Channel 抽象层 + 飞书（复用 lark-bridge）+ Telegram | 参考 OpenClaw / KeyClaw |

## Permission & Token Budget Guard（FEAT-023）

FEAT-023 在 Router、Team Orchestrator、CLI/Web read model 之间提供统一护栏 contract：

- **权限分级**：`read-local`、`write-local`、`execute-local`、`network`、`external-service`、`archive`、`delete`、`credential`、`budget-increase` 映射到默认 policy；`delete`/`credential` 默认拒绝，`archive`/`budget-increase`/外部服务写默认需要显式确认。
- **写入范围保留**：`write-local` 会区分 workspace、`~/.haro/` 状态目录与 workspace 外路径，classification/audit 不把 workspace 外写入泛化为普通本地写入。
- **预算边界**：Phase 1 使用固定 token hard limit；provider/model 成本估算仅作为展示字段，不作为阻断依据。
- **Team 汇总**：Team Orchestrator 在 branch attempt / retry / merge 前检查预算，leaf terminal 后从 usage 写入 `token_budget_ledger`，summary 汇总所有 branch。
- **审计与观测**：denied、needs-approval、near-limit、exceeded 写入 `operation_audit_log`；CLI `status` 与 Web `/api/v1/guard/*` 可读取 workflow blocked reason、budget exceeded 与 permission decision 摘要。

边界说明：Permission Guard 不替代 `shit` 的 dry-run-first / `--confirm-high` 机制；二者叠加时取更严格策略。FEAT-023 不实现企业 RBAC/SSO、真实账单或 Dashboard 页面，只提供后端 read model/API。
