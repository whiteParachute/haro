# Haro 架构总览

## 一句话定位

Haro 是一个自进化多 Agent 中间件平台 — 不只让 Agent 完成任务，还让 Agent 和平台本身在使用中自动变得更好。

## 设计哲学

传统平台：人类设计 → 人类开发 → 人类维护

Haro：人类设定方向 → Agent 设计/开发/测试 → Agent 自我进化 → 人类审阅/引导

人类的角色：
- **方向引导者**：设定目标、提出需求、反馈 Bug
- **最终裁决者**：审阅进化结果、确认重要变更

Agent 的角色：
- 根据人类方向进行具体规划、设计、演进
- 自行从互联网中获取进化方向（需符合产品设计逻辑，最好获得人类认可）
- 执行测试、维护代码、迭代功能

## 五层架构

```
┌─────────────────────────────────────────────┐
│            Human Interface                   │
│         (方向设定 / 审阅 / 裁决)               │
├─────────────────────────────────────────────┤
│            Evolution Engine                  │
│   Self-Monitor │ Pattern Miner │ Auto-Refactorer  │
│   OODA 循环 + @model-dependent 可演化标注        │
│   evolution-context/ 共享目录(原始数据不压缩传递)  │
├─────────────────────────────────────────────┤
│            Scenario Router                   │
│   场景感知 → 动态 Workflow 编排 → 有状态图+Checkpoint │
├─────────────────────────────────────────────┤
│         Agent & Team Runtime                 │
│   Agent Lifecycle │ Team Orchestrator │ Memory Fabric │
│   Actor 模型      │ hub-spoke 拓扑    │ 跨 Agent 共享 │
│   跨 session      │ 信息维度拆分      │ 多层索引      │
│   状态文件        │ 对抗性验证        │ aria-memory 扩展│
├─────────────────────────────────────────────┤
│         Provider Abstraction Layer           │
│   Claude │ GPT │ Gemini │ Local │ MCP │ Hermes │
│   能力矩阵 + 智能选择 + Fallback + 成本感知      │
├─────────────────────────────────────────────┤
│         Tool & Service Layer                 │
│   飞书 / GitHub / CI-CD / DB / FS / APIs     │
│   agentskills.io 标准兼容                     │
└─────────────────────────────────────────────┘
```

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

| 层次 | 竞品 | Haro 差异 |
|------|------|----------|
| Agent 级自进化 | Hermes (~97.6k stars) — 技能自创建+自改进+记忆 | Haro 做平台级：多 Agent + 编排 + Prompt + 平台代码的全面自进化 |
| Agent 团队管理 | Multica (~15.7k stars) — 管理多个 Agent CLI | Haro 是 runtime 层，Multica 是管理层；Haro 可作为 Multica 的 Provider |
| 编排框架 | CrewAI / AutoGen / LangGraph | Haro 融合三者优点 + 自进化（它们都是静态的） |
| 事件流 | OpenHands | Haro 参考其事件流+沙箱，加入进化维度 |
| 终端 Agent | Crush (OpenCode 继任) | 参考其 agentskills.io 标准兼容 |
| 自进化 Agent | yoyo-evolve | 核心灵感来源，Haro 从单 Agent 扩展到平台级 |

## 三大独有能力（竞品均不具备的组合）

1. **平台级自进化** — Prompt A/B 测试、编排模式自动调整、Pattern Mining、Agent-as-Maintainer（自有代码由 Agent 维护）
2. **多 Agent 编排智能** — Actor 模型 + 5 种编排模式 + 场景感知动态编排 + 有状态图 Checkpointing
3. **进化可观测** — Evolution Dashboard + 结构化进化日志 + 人类干预频率趋势

## 技术选型

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
| Agent SDK | @anthropic-ai/claude-agent-sdk | lark-bridge |
