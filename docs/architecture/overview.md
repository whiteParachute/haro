# Haro 架构总览

> 2026-05-01 重写：双层架构（workbench + 进化）+ 三层解耦（CLI / Web API / Web 前端）+ 四进化驱动源。
>
> 规划背景：[`docs/planning/redesign-2026-05-01.md`](../planning/redesign-2026-05-01.md)

## 一句话定位

Haro 是一个**自进化多 Agent 中间件平台**——不只让 Agent 完成任务，还让 Agent、编排方式和平台本身在使用中自动变得更好。

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
- 从互联网获取业界进展（Industry Intel）
- 需满足三条之一：① 符合 Haro 产品设计逻辑；② 最好获得用户认可；③ 或判断为业界更先进的方向

---

## 双层架构

Haro 把"日用 workbench"和"自我进化"放在两层，进化层寄生在 workbench 之上：

```
┌─────────────────────────────────────────────────────────────┐
│                    进化层 (Evolution Layer)                  │
│                                                             │
│   Self-Monitor   │  Industry Intel  │  Pattern Miner       │
│   （使用记忆）    │   （业界趋势）    │   （Agent 自判断）   │
│                                                             │
│              Evolution Proposal & Approval                  │
│                  （用户决策闭环）                            │
│                                                             │
│              Auto-Refactorer L0/L1 → L2/L3                  │
│                  （受控自演化 → Agent-as-Developer）         │
└─────────────────────────────────────────────────────────────┘
                          ↑ 喂数据 / 落地建议
┌─────────────────────────────────────────────────────────────┐
│                  Workbench 层 (Daily Driver)                 │
│                                                             │
│   Scenario Router   │   Team Orchestrator   │   Sessions   │
│                                                             │
│   Memory Fabric     │   Skills              │   eat/shit   │
│                                                             │
│   MCP 工具层        │   定时任务            │   流式 UX    │
│                                                             │
│   Provider Abstract │   Channel Abstract    │   预算守门   │
└─────────────────────────────────────────────────────────────┘
```

**关键认知**：进化层不是 workbench 的替代品，而是寄生在 workbench 之上。没有日用底座产生使用数据，进化引擎就没东西可吃。所以"先 workbench、后进化"是必然顺序，不是对原愿景的妥协。

### 四个进化驱动源

进化层从四个独立信号源消费数据：

| 驱动源 | 数据来源 | 实现位置 |
|--------|----------|----------|
| **使用记忆** | session 事件 / tool 调用 / 失败 / 重试 / token 浪费 / skill 命中率 | Self-Monitor（FEAT-040，Phase 2.0） |
| **业界趋势** | Anthropic / OpenAI changelog / 关键 GitHub repo release / agent 领域趋势 | Industry Intel（FEAT-036，Phase 2.0） |
| **用户决策** | Dashboard 上对进化提案的 approve / reject / modify | Evolution Proposal & Approval（FEAT-037，Phase 2.5） |
| **Agent 自判断** | Pattern Miner 从使用记忆 + 业界趋势中归纳的模式 | Pattern Miner（FEAT-042，Phase 2.5） |

四源数据汇入 Evolution Proposal Generator → 产出结构化提案 → owner 决策 → approval 后由 Auto-Refactorer L0/L1（Phase 3.0）/ L2/L3（Phase 3.5）落地。

---

## 三层解耦（CLI / Web API / Web 前端）

Phase 1.5 起，Haro 严格遵守三层解耦，便于独立发布与替换：

```
┌──────────────────────────────────────────────────┐
│                   Web 前端 (SPA)                  │
│         packages/web/  React 19 + Vite 6          │
│   通过稳定 HTTP/JSON contract 与 Web API 通信     │
└──────────────────────────────────────────────────┘
                   ↑ HTTP / WebSocket
┌──────────────────────────────────────────────────┐
│                   Web API (服务端)                │
│           packages/web-api/  Hono                 │
│   认证 / 路由 / WS / 鉴权 / runtime 调度          │
│        独立 package.json，可独立发布              │
└──────────────────────────────────────────────────┘
                   ↑ 直接函数调用
┌──────────────────────────────────────────────────┐
│                     CLI 入口                      │
│          packages/cli/  commander.js              │
│   薄启动器：haro web 调用 web-api，               │
│   其余命令直接调用 core / providers / channels    │
└──────────────────────────────────────────────────┘
                   ↑ 直接函数调用
┌──────────────────────────────────────────────────┐
│                      核心层                       │
│   packages/core/  packages/provider-*/            │
│   packages/channel-*/  packages/skills/           │
└──────────────────────────────────────────────────┘
```

**CLI 优先原则**：CLI 是"功能等价 Web UI 减去图形化体验"的完整入口。任何 Web Dashboard 上的核心动作，CLI 都必须有等价命令（hermes-agent 风格）。

**前后端解耦原则**：Web 前端不直接 import Web API 内部模块，仅通过 HTTP/JSON 通信。前端可以单独开发、单独发布、甚至被第三方前端替换（hermes-web-ui 风格）。

---

## 设计原则

以下原则贯穿所有模块，优先级高于具体设计决策。

### 非核心组件皆可插拔（No-Intrusion Plugin Principle）

所有外挂功能或组件，只要不是系统核心，都必须做到：

- **独立注册 / 装载 / 卸载**
- 对核心模块**零侵入、零硬编码**（不得在核心代码出现针对具体实现的特判分支）
- 能力通过标准接口 + `capabilities()` 查询暴露
- 卸载后核心功能不受影响

**典型可插拔组件**：Provider（Codex / xiaomi-token-plan / kimi-token-plan / …）、Channel（CLI / 飞书 / Telegram / Web / …）、Skill、Tool Provider、MCP Server、Memory Backend、Storage Backend。

**核心组件（不可插拔）**：Agent Runtime 核心、Scenario Router、Evolution Engine、Memory Fabric 协议层、Channel 协议层、Provider 协议层。

### 代谢优于堆积

Haro 在进化中坚持"留精华、不堆数量"：

- 新能力通过 [eat](../../specs/evolution-metabolism.md) 沉淀，有质量门槛
- 冗余能力通过 [shit](../../specs/evolution-metabolism.md) 清除，可回滚

这是 Evolution Engine 的底层代谢机制，与 OODA 改进循环并行。

### CLI 优先

CLI 与 Web UI 是平级入口，**不是**主从关系。任何配置、使用、查询、管理动作都必须有等价 CLI 命令。Web UI 是 CLI 的图形化加速，不是 CLI 的超集。

### 前后端解耦

Web 前端通过稳定 HTTP/JSON contract 与 Web API 通信。前端可独立开发、独立发布、被第三方前端替换。Web API 不假设前端是"自家的"。

---

## 六层架构（核心模块）

```
┌─────────────────────────────────────────────────┐
│            Human Interface                       │
│  方向设定 / 审阅 / 裁决 / Evolution Proposal 审批  │
├─────────────────────────────────────────────────┤
│            Evolution Engine                      │
│   Self-Monitor │ Industry Intel │ Pattern Miner  │
│   Evolution Proposal │ Auto-Refactorer L0–L3    │
│   eat/shit 代谢 + Evolution Asset Registry       │
├─────────────────────────────────────────────────┤
│            Scenario Router                       │
│   场景感知 → 动态 Workflow 编排 → Checkpoint     │
├─────────────────────────────────────────────────┤
│         Agent & Team Runtime                     │
│   Agent Lifecycle │ Team Orchestrator │ Memory  │
│   Actor 模型      │ hub-spoke 拓扑    │ FTS5    │
│   权限/预算护栏   │ 对抗性验证        │ aria-memory 兼容│
├─────────────────────────────────────────────────┤
│       Provider Abstraction Layer                 │
│   Codex（已实现）│ xiaomi-token-plan（规划）     │
│   kimi-token-plan（规划）│ ...                   │
│   能力矩阵 + 智能选择 + Fallback                 │
├─────────────────────────────────────────────────┤
│       Channel Abstraction Layer                  │
│   CLI │ 飞书 │ Telegram │ Web（Phase 1.5）│ ... │
│   消息渠道接入 + 会话映射 + 富文本渲染           │
├─────────────────────────────────────────────────┤
│         Tool & Service Layer                     │
│   Skills │ MCP（Phase 1.5 工具层）│ FS │ APIs   │
└─────────────────────────────────────────────────┘
```

---

## 多 Agent 强制设计约束（五条核心原则）

基于 SagaSu《三省六部幻觉：为什么"虚拟公司"式多 Agent 架构在工程上不成立》分析：

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

---

## 竞争格局

调研覆盖 11 个竞品/参考项目（2026-05-01 新增 happyclaw / hermes-agent / hermes-web-ui）：

| 层次 | 竞品 | 技术栈 | Haro 差异 |
|------|------|--------|----------|
| 单用户多会话 workbench | **happyclaw / AgentDock** — 飞书 / Telegram / QQ / Web 4 channel + Claude/Codex 双 runner + MCP 工具层 + 定时任务 + Web 终端 + PWA | TypeScript + Hono + React 19 + better-sqlite3 | Haro Phase 1.5 借鉴其 Web channel / MCP 工具层 / 定时任务 / 流式 UX；不照搬 PWA / Web 终端；保留 happyclaw 没有的多 Agent 编排 + eat/shit + 进化层 |
| CLI 优先 Agent | **hermes-agent** — 配置可在终端完成，无 Web UI 依赖 | Python | Haro 借鉴其 CLI 优先理念，要求 CLI 命令族等价于 Web UI 全功能（FEAT-039） |
| 前后端解耦范例 | **hermes-web-ui** — Web 前端独立 repo，通过稳定 contract 与后端通信 | TypeScript | Haro Phase 1.5 借鉴其前后端解耦做法（FEAT-038） |
| Agent 级自进化 | Hermes (NousResearch) — 技能自创建+自改进+三级记忆 | Python + aiosqlite + FTS5 | Haro 做平台级：多 Agent + 编排 + Prompt + 平台代码全面自进化；Memory Fabric v1 借鉴其分层和 FTS5 |
| 统一 Agent 平台 | OpenClaw — 多 Provider + 多 Channel + 丰富工具 | TypeScript + pnpm + sqlite-vec + LanceDB | Haro 借鉴其 Channel 隔离、Gateway 会话生命周期、权限模型 |
| 进化语法 / 资产化 | EvoMap — signal → gene → prompt → event 声明式进化表达 | — | Haro 不引入 GEP runtime，但 eat/shit 产物、prompt、skill、编排规则资产化 |
| 生产级 Agent Guard | Mercury Agent — 显式权限审批 + Token 预算 | — | Haro Phase 1 增加 operation class、approval policy、per-workflow Token budget |
| 编排框架 | CrewAI / AutoGen / LangGraph | — | Haro 借鉴 LangGraph 状态图可视化、CrewAI 任务流监控、AutoGen 人机循环介入 |
| 事件流 | OpenHands | — | Haro 参考其事件流 + 沙箱，加入进化维度 |
| 终端 Agent | Crush (OpenCode 继任) | — | 参考其 skill 生态思路 |
| 自进化 Agent | Yoyo（SagaSu 出品） | Next.js 16 + Go + PostgreSQL | 核心灵感来源，Haro 从单 Agent 扩展到平台级 |
| 消息渠道 | KeyClaw / lark-bridge | — | Haro 抽象为独立 Channel 层，复用 lark-bridge 作为飞书 adapter |

## 三大独有能力（竞品均不具备的组合）

1. **平台级自进化** — Prompt A/B 测试 + 编排模式自动调整 + Pattern Mining + Agent-as-Developer + eat/shit 代谢
2. **多 Agent 编排智能** — Actor 模型 + 5 种编排模式 + 场景感知动态编排 + 有状态图 Checkpointing
3. **进化可观测** — Evolution Dashboard + 结构化进化日志 + 用户决策反馈闭环 + 人类干预频率趋势

---

## 技术选型

> **原则**：Haro 技术栈独立决策，参考其他项目而非绑定。唯一例外：Claude 调用方式必须与 lark-bridge 一致，以防违反 Claude 规定导致订阅账号被封禁。

| 维度 | 选型 | 参考来源 |
|------|------|---------|
| 核心语言 | TypeScript (Node.js 22) | — |
| 运行时 | Actor 模型 + 消息驱动 | 参考 AutoGen 0.4 |
| 工作流 | 有状态图 + 自动快照 | 参考 LangGraph Checkpointing |
| 记忆 | 独立 Memory Fabric（Markdown 兼容层 + SQLite FTS5；三层；platform/shared/agent scope） | 参考 Hermes + aria-memory |
| 工具 / 技能 | 兼容 Claude Code skill 格式 + MCP（Phase 1.5 工具层） | 参考 Claude Code |
| 配置 | Zod schema + 热重载 | 参考 lark-bridge |
| 存储 | SQLite WAL + FTS5（Phase 1 已落地）→ sqlite-vec / LanceDB 向量（Phase 2+，由 eat/shit 评估后引入） | 参考 Hermes / OpenClaw |
| 代码 Lint | ESLint + `@typescript-eslint/recommended` + `import/no-cycle` | — |
| 进化 | eat/shit 代谢 + Evolution Asset Registry；Phase 2.0+ 接入 Self-Monitor / Industry Intel / Pattern Miner / Auto-Refactorer | 参考 yoyo-evolve / EvoMap |
| Provider SDK | `@openai/codex-sdk`（当前唯一正式实现） | 对齐现有 Codex Provider |
| 消息渠道 | Channel 抽象层 + 飞书（lark-bridge）+ Telegram + Web（Phase 1.5） | 参考 OpenClaw / KeyClaw / happyclaw |
| Web 后端 | Hono + better-sqlite3（Phase 1.5 剥离到 `packages/web-api`） | 参考 happyclaw |
| Web 前端 | React 19 + Vite 6 + Tailwind 4 + shadcn/ui（独立发布） | 参考 hermes-web-ui / happyclaw |
| CLI 框架 | commander.js + readline/promises + clack | 参考 hermes-agent |

---

## Permission & Token Budget Guard（FEAT-023）

FEAT-023 在 Router、Team Orchestrator、CLI/Web read model 之间提供统一护栏 contract：

- **权限分级**：`read-local`、`write-local`、`execute-local`、`network`、`external-service`、`archive`、`delete`、`credential`、`budget-increase` 映射到默认 policy；`delete`/`credential` 默认拒绝，`archive`/`budget-increase`/外部服务写默认需要显式确认
- **写入范围保留**：`write-local` 区分 workspace、`~/.haro/` 状态目录与 workspace 外路径，classification/audit 不把 workspace 外写入泛化为普通本地写入
- **预算边界**：Phase 1 使用固定 token hard limit；provider/model 成本估算仅作为展示字段，不作为阻断依据
- **Team 汇总**：Team Orchestrator 在 branch attempt / retry / merge 前检查预算，leaf terminal 后从 usage 写入 `token_budget_ledger`，summary 汇总所有 branch
- **审计与观测**：denied、needs-approval、near-limit、exceeded 写入 `operation_audit_log`；CLI `status` 与 Web `/api/v1/guard/*` 可读取 workflow blocked reason、budget exceeded 与 permission decision 摘要

边界说明：Permission Guard 不替代 `shit` 的 dry-run-first / `--confirm-high` 机制；二者叠加时取更严格策略。FEAT-023 不实现企业 RBAC/SSO、真实账单或 Dashboard 页面，只提供后端 read model/API。

---

## 架构变更记录

- **2026-05-01**：双层架构（workbench + 进化）+ 三层解耦（CLI / Web API / Web 前端）+ 四进化驱动源 重写。详见 [`docs/planning/redesign-2026-05-01.md`](../planning/redesign-2026-05-01.md)。
- **2026-04-25**：Phase 1 Permission & Token Budget Guard contract 定稿（FEAT-023）。
- **2026-04-19**：Phase 0 验收闭环；Channel Abstraction Layer 提升为独立一层。
