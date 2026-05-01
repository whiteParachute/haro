# 竞品调研：多 Agent 平台竞争格局

## 调研范围

覆盖 12 个竞品/参考项目；调研时间：2026-04-18 起持续更新（最近一次：2026-05-01 新增 happyclaw / hermes-agent / hermes-web-ui）。

## 竞品全景矩阵

| 项目 | 类别 | Stars | 核心特点 | Haro 关联 |
|------|------|-------|---------|-----------|
| Hermes | Agent Harness/Runtime | ~97.6k | 技能自创建+自改进+记忆，SQLite+FTS5 | 核心竞品（Agent 级自进化），Haro 做平台级 |
| happyclaw / AgentDock | 单用户多会话 workbench | ~7 | 飞书/Telegram/QQ/Web 4 channel + Claude/Codex 双 runner + MCP 工具层 + 定时任务 + Web 终端 + PWA | Haro Phase 1.5 借鉴其 Web channel / MCP 工具层 / 定时任务 / 流式 UX；保留 happyclaw 没有的多 Agent 编排 + 进化层 |
| hermes-agent | CLI 优先 Agent | — | 配置可在终端完成，无 Web UI 依赖 | Haro 借鉴其 CLI 优先理念，要求 CLI 命令族等价于 Web UI 全功能（FEAT-039） |
| hermes-web-ui | 前后端解耦 Web UI 范例 | — | Web 前端独立 repo，通过稳定 contract 与后端通信 | Haro Phase 1.5 借鉴其前后端解耦做法（FEAT-038） |
| EvoMap | 进化语法 / 资产化 | — | 声明式进化语法：signal → gene → prompt → event | Haro 参考其资产封装与审计思路，不直接引入完整 GEP runtime |
| OpenClaw | 统一 Agent 平台 / Gateway | — | Channel/Gateway 隔离、团队工作空间、会话管理 | Haro 参考其会话生命周期和权限模型，Channel 层保持自有可插拔设计 |
| Mercury Agent | 生产级 Agent Guard | — | 显式权限审批、Token/成本预算 | Haro Phase 1 引入操作分级和预算护栏 |
| Multica | Agent 团队管理平台 | ~15.7k | 管理多 Agent CLI，managed agents | Haro 可作为 Multica 的 Provider |
| CrewAI | 编排框架 | — | 角色式 Agent 编排，流水线 | 反面教材（角色化 Agent 违反约束③） |
| AutoGen | 编排框架 | — | Actor 模型 + 消息驱动 | Haro 运行时参考 |
| LangGraph | 工作流框架 | — | 有状态图 + Checkpointing | Scenario Router 核心参考 |
| OpenHands | 事件流 Agent | — | 事件流 + 沙箱执行 | 事件流设计参考 |
| Crush | 终端 Agent | — | OpenCode 继任，agentskills.io 标准 | agentskills.io 兼容性参考 |
| yoyo-evolve | 自进化单 Agent | — | 三阶段进化循环 + 验证门控 + 装饰器链 | Haro 核心灵感来源 |
| Mastra | TypeScript Agent 框架 | — | TypeScript 原生，工具系统 | 技术选型参考 |

## 深度分析

### 2026-04-25 参考产品吸收结论

本轮输入补充了六个成熟产品/框架的可借鉴点。Haro 的处理原则是：只吸收已被验证的产品机制，不复制与 Haro 多 Agent 约束冲突的架构。

| 来源 | 可借鉴点 | Haro 落点 | Phase |
|------|----------|-----------|-------|
| Hermes | Session / Persistent / Skill memory + FTS5 | FEAT-021 Memory Fabric v1：三级记忆、全文搜索、信息维度拆分、对抗性验证 | Phase 1 P0 |
| EvoMap | 协议化进化语法与资产审计 | FEAT-022 Evolution Asset Registry：eat/shit 产物、prompt、skill、编排规则统一资产化 | Phase 1 P0 |
| Mercury Agent | 权限审批和 Token 预算 | FEAT-023 Permission & Token Budget Guard：operation class、approval policy、workflow budget | Phase 1 P1 |
| LangGraph / CrewAI | 编排图可视化、任务流监控 | FEAT-018 调整版：workflow 图、checkpoint 时间线、stalled branch 调试 | Phase 1 P1 |
| OpenClaw | Channel 隔离、团队共享上下文、会话 lifecycle | Channel/Gateway 后续 spec：idle reset、daily reset、retention、共享上下文边界 | Phase 2 |
| AutoGen | 人可在循环中随时介入 | Evolution Engine checkpoint gate：预算超限、风险升级、策略分歧时请求人类裁决 | Phase 2 |

### Hermes（~97.6k stars）

**定位**：Agent 级自进化运行时（Harness 设计）

**核心特点**：
- 技能（Skill）自创建：Agent 可以创建新的技能供后续使用
- 技能自改进：已有技能可以根据使用效果自动优化
- 持久化记忆：SQLite + FTS5 全文索引
- CLI 设计：作为独立的 Agent CLI 运行，Multica 将其列为 Provider

**架构亮点**：
- Harness 设计模式：统一管理 Agent 的会话、工具、状态
- 日志系统：完善的结构化日志，Haro 的 `haro doctor` 参考其诊断设计

**⚠️ 注意**：Hermes 历史上存在一个激进版本会窃取 Claude Code OAuth token，存在封号风险。Haro 明确禁止此类行为。

**Haro 差异**：Hermes 做单 Agent 的自进化，Haro 做**平台级**自进化——多 Agent 编排、Prompt A/B 测试、平台代码自维护。

### Multica（~15.7k stars）

**定位**：Managed Agents Platform — 把 AI Agent 当团队成员管理

**核心特点**：
- 外接多个 Agent CLI（Claude Code, Codex, Hermes, Gemini, Pi, Cursor Agent 等）
- Issue 分配 → Agent 独立执行的工作模式
- Agent 在 project board 上有 profile、参与 thread、创建 issue
- Skill Compounding：解决方案沉淀为可跨团队共享的 skill

**值得借鉴**：
1. Agent 可见性 UI（Evolution Dashboard 参考）
2. Runtime 统一管理（单一 dashboard 管理本地 daemon 和云实例）
3. Skill Compounding 的共享机制

**关键差异**：Multica 本质上是"静态"平台（Agent 能力不随使用自动提升）。这恰好是 Haro 的差异化优势。

**与 Haro 的关系**：Haro 是 runtime 层，Multica 是管理层。Haro 可以作为 Multica 支持的 Provider 之一。

### CrewAI

**定位**：角色式多 Agent 编排框架

**⚠️ 反面教材**：CrewAI 的角色化 Agent 设计（PM/Dev/QA）正是 SagaSu《三省六部幻觉》批判的"虚拟公司式架构"。

**Haro 不采用**：
- 按人类岗位划分 Agent（违反约束③）
- 流水线式单向交接（违反约束②）

**可借鉴点**：Agent 配置的 YAML 格式表达。

### AutoGen 0.4

**定位**：微软出品的多 Agent 编排框架

**核心特点**：Actor 模型 + 消息驱动

**Haro 采用**：Actor 模型 + 消息驱动（Phase 1）作为运行时核心。

### LangGraph

**定位**：有状态工作流框架

**核心特点**：有状态图 + 自动 Checkpointing

**Haro 采用**：Scenario Router 的图模型和 Checkpointing 机制参考 LangGraph。

### OpenHands

**定位**：事件流驱动的 Agent 执行平台

**核心特点**：完整的事件流记录 + 沙箱执行环境

**Haro 参考**：事件流设计（AgentEvent 类型系统）+ 沙箱执行思路（Phase 1）

### Crush / OpenCode

**定位**：终端 Agent CLI，agentskills.io 标准制定者

**Haro 参考**：agentskills.io 标准兼容（Phase 0 P0-6 / Skills 管理）

### yoyo-evolve

**定位**：单 Agent 自进化系统

**核心特点**：
- 三阶段进化循环（评估→规划→实现）
- 验证门控（进化结果必须通过验证才应用）
- 装饰器链工具包装
- 身份认知文件（IDENTITY.md / PERSONALITY.md）

**Haro 关系**：核心灵感来源。Haro 将 yoyo-evolve 的单 Agent 进化扩展到平台级多 Agent 进化。

### Mastra

**定位**：TypeScript 原生 Agent 框架

**Haro 参考**：TypeScript 技术栈选型参考。

## 行业共同弱点

所有竞品（Hermes 除外）的共同弱点：**Agent 能力不随使用自动提升**（静态平台）。

这正是 Haro 的核心差异化战场：**平台级自进化**。
