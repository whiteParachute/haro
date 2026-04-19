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
│         (方向设定 / 审阅 / 裁决)               │
├─────────────────────────────────────────────┤
│            Evolution Engine                  │
│   Self-Monitor │ Pattern Miner │ Auto-Refactorer  │
│   OODA 循环 + eat/shit 代谢 + @model-dependent 标注 │
│   evolution-context/ 共享目录(全局级，原始数据不压缩) │
├─────────────────────────────────────────────┤
│            Scenario Router                   │
│   场景感知 → 动态 Workflow 编排 → 有状态图+Checkpoint │
├─────────────────────────────────────────────┤
│         Agent & Team Runtime                 │
│   Agent Lifecycle │ Team Orchestrator │ Memory Fabric │
│   Actor 模型      │ hub-spoke 拓扑    │ 独立记忆为主  │
│   跨 session      │ 信息维度拆分      │ aria-memory 兼容│
│   状态文件        │ 对抗性验证        │ 主备可选     │
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
| Agent 级自进化 | Hermes (NousResearch/hermes-agent, ~98.6k stars) — 技能自创建+自改进+记忆 | Python + aiosqlite + FTS5 | Haro 做平台级：多 Agent + 编排 + Prompt + 平台代码的全面自进化；当前 Phase 0 正式实现收敛为 Codex Provider，但 PAL 继续保留多 Provider 抽象 |
| 统一 Agent 平台 | OpenClaw — 多 Provider + 多 Channel + 丰富工具 | TypeScript + pnpm + sqlite-vec + LanceDB | Haro 借鉴其 allow/deny 工具过滤、Dreaming 记忆 consolidation、Channel 抽象；但其"直调 Anthropic API"路径在 Haro 永远禁止 |
| Agent 团队管理 | Multica (~15.7k stars) — 管理多个 Agent CLI | — | Haro 是 runtime 层，Multica 是管理层；Haro 可作为 Multica 的 Provider |
| 编排框架 | CrewAI / AutoGen / LangGraph | — | Haro 融合三者优点 + 自进化（它们都是静态的） |
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
| 记忆 | 独立 Memory Fabric（基本照抄 aria-memory，含三层目录 + `.pending/` 多端合并） | 参考 aria-memory |
| 工具 / 技能 | 兼容 Claude Code skill 格式 + MCP | 参考 Claude Code |
| 配置 | Zod schema + 热重载 | 参考 lark-bridge |
| 存储 | SQLite WAL + FTS5（Phase 0）→ sqlite-vec / LanceDB 向量（Phase 2+） | 参考 OpenClaw / Hermes |
| 代码 Lint | ESLint + `@typescript-eslint/recommended` + `import/no-cycle`（Phase 2 由 eat/shit 代谢评估迁移 [oxlint](https://oxc.rs/docs/guide/usage/linter)，OpenClaw 已用） | 参考 OpenClaw（oxlint） |
| 进化 | 内置 Cron + eat/shit 代谢 + GitHub Actions；Phase 2+ 加入 OpenClaw 风格 Dreaming（短→长期晋升） | 参考 yoyo-evolve / OpenClaw |
| Agent SDK | `@openai/codex-sdk`（Phase 0 当前正式实现） | 对齐现有 Codex Provider |
| 消息渠道 | Channel 抽象层 + 飞书（复用 lark-bridge）+ Telegram | 参考 OpenClaw / KeyClaw |
