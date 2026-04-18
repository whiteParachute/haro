# Haro 四阶段路线图

## 总览

| 阶段 | 目标 | 核心交付 | 自治水平 |
|------|------|---------|---------|
| Phase 0: Foundation | 最小可用骨架 | PAL + Agent Runtime + 记忆集成 + CLI + 工具系统 + agentskills.io | 人类驱动 |
| Phase 1: Intelligence | 场景理解+动态编排 | Scenario Router + Team Orchestrator (Parallel/Debate/Pipeline) + Memory Fabric v1 | Agent 驱动，人类审批 |
| Phase 2: Evolution | 自我进化 | Evolution Engine (Self-Monitor + Pattern Miner + Auto-Refactorer L0-L1) + Dashboard | Agent 自治，人类监督 |
| Phase 3: Autonomy | Agent 自主维护平台 | Agent-as-Developer + 自主需求分析 + L2-L3 重构 + 全编排模式 | Agent 自治，人类引导 |
| Phase 4: Ecosystem | 开放生态 | Agent Store + Provider 插件化 + 跨实例协作 | — |

---

## Phase 0: Foundation — 最小可用骨架

**目标**：打通从任务输入到 Agent 执行的完整链路，验证核心架构可行。

**自治水平**：人类驱动

### Phase 0 MVP（7 项）

| 序号 | 交付项 | 说明 |
|------|--------|------|
| P0-1 | 项目脚手架 | monorepo 结构 + Zod config + pino 日志 |
| P0-2 | Claude Provider | 基于 `@anthropic-ai/claude-agent-sdk`，参考 lark-bridge，**禁止直调 Anthropic API** |
| P0-3 | Codex Provider | 基于 `@openai/codex-sdk`，参考 KeyClaw 的 CodexRunner |
| P0-4 | 最小 Agent 定义 | `id + name + systemPrompt + tools? + defaultProvider? + defaultModel?` |
| P0-5 | 单 Agent 执行循环 | 接收任务 → 选择 Provider → 调用 → 返回结果 |
| P0-6 | CLI 入口 | REPL 交互式模式 + 单次命令模式 |
| P0-7 | aria-memory 基础集成 | session 结束后写记忆（文件级直接操作） |

### Phase 0 详细任务列表

**P0-1：项目脚手架**
- [ ] monorepo 结构初始化（packages/core, packages/cli, packages/providers）
- [ ] TypeScript 配置 + ESLint + Prettier
- [ ] Zod schema 定义全局配置结构
- [ ] pino 日志配置（stdout + `~/.haro/logs/` 双输出）
- [ ] SQLite 初始化脚本（sessions + session_events + workflow_checkpoints 表）

**P0-2：Claude Provider**
- [ ] 安装 `@anthropic-ai/claude-agent-sdk`
- [ ] 实现 `ClaudeProvider implements AgentProvider`
- [ ] 使用 `query()` 方法（参考 lark-bridge）
- [ ] 订阅自动认证配置
- [ ] AgentCapabilities 返回（streaming: true, toolLoop: true）
- [ ] healthCheck() 实现
- [ ] **合规审查**：确认不使用 `anthropic.messages.create()`

**P0-3：Codex Provider**
- [ ] 安装 `@openai/codex-sdk`
- [ ] 实现 `CodexProvider implements AgentProvider`（参考 KeyClaw CodexRunner）
- [ ] API Key 认证配置
- [ ] `previous_response_id` 上下文延续
- [ ] AgentCapabilities 返回（streaming: false, contextContinuation: true）
- [ ] healthCheck() 实现

**P0-4：最小 Agent 定义**
- [ ] `AgentConfig` TypeScript 接口定义
- [ ] YAML 配置文件解析（Zod 验证）
- [ ] `~/.haro/agents/` 目录扫描加载
- [ ] Agent 注册表

**P0-5：单 Agent 执行循环**
- [ ] Provider/Model 选择规则引擎（4 条默认规则）
- [ ] `AgentRunner.run(task, agentId)` 主循环
- [ ] AgentEvent 流消费（text / tool_call / tool_result / result / error）
- [ ] Session 创建 + 事件写入 SQLite
- [ ] Fallback 触发逻辑
- [ ] 跨 session 状态文件读写（`~/.haro/agents/{name}/state.json`）

**P0-6：CLI 入口**
- [ ] commander.js 命令路由
- [ ] `haro` — 启动 REPL（@clack/prompts）
- [ ] `haro run "..."` — 单次任务
- [ ] `haro model` — 查看/切换 Provider 和 Model
- [ ] `haro config` — 配置管理
- [ ] `haro doctor` — 系统诊断（Provider 健康检查 + 配置验证）
- [ ] `haro skills` — 技能管理
- [ ] `haro status` — 运行状态
- [ ] REPL 内 Slash 命令：`/model /new /retry /compress /skills /usage`

**P0-7：aria-memory 基础集成**
- [ ] 识别记忆目录（`~/.haro/memory/` 或配置的 aria-memory 路径）
- [ ] Session 结束后提取关键信息写入 `knowledge/*.md`
- [ ] 更新 `index.md`
- [ ] Per-Agent 记忆目录创建（`~/.haro/memory/agents/{name}/`）

### Phase 0 验收标准

- [ ] `haro run "列出当前目录下的 TypeScript 文件"` 成功执行并返回结果
- [ ] Claude Provider 和 Codex Provider 均可独立使用
- [ ] 合规审查通过（Claude Provider 不直调 Anthropic API）
- [ ] Session 数据写入 SQLite
- [ ] 记忆文件在 session 结束后正确更新
- [ ] `haro doctor` 能正确诊断 Provider 状态

### Phase 0 推迟项目

| 原计划 | 推迟至 | 原因 |
|--------|--------|------|
| MCP Tool Provider 适配器 | Phase 1 | Phase 0 用 SDK 内置工具即可 |
| 能力矩阵 | Phase 1 | 只有 2 个 Provider，硬编码差异就够了 |
| Actor 消息驱动运行时 | Phase 1 | Phase 0 单 Agent 直接调用就够了 |
| TaskDelegation 接口 | Phase 1 | Phase 0 没有多 Agent 协作 |
| 多后端执行沙箱 | Phase 1 | Phase 0 本地执行就够了 |
| 装饰器链工具包装 | Phase 0 后期 | 先直接用 SDK 工具 |

---

## Phase 1: Intelligence — 场景理解与动态编排

**目标**：引入 Scenario Router 和 Team Orchestrator，支持多 Agent 协作。

**核心交付**：
- Scenario Router（场景感知 + 有状态图 + Checkpointing）
- Team Orchestrator（Parallel + Debate + Pipeline 三种模式）
- Memory Fabric v1（从文件级升级为库级集成）
- Actor 消息驱动运行时
- MCP Tool Provider 适配器

---

## Phase 2: Evolution — 自我进化

**目标**：平台开始自我改进。

**核心交付**：
- Evolution Engine
  - Self-Monitor（性能指标采集）
  - Pattern Miner（成功模式挖掘）
  - Auto-Refactorer L0（Prompt 优化）
  - Auto-Refactorer L1（编排模式调整）
- Evolution Dashboard（可视化进化日志）
- OODA 循环实现

---

## Phase 3: Autonomy — Agent 自主维护

**目标**：Agent 成为平台的主要维护者。

**核心交付**：
- Agent-as-Developer（Agent 修改 Haro 自身代码）
- 自主需求分析（从用户反馈、互联网趋势挖掘需求）
- Auto-Refactorer L2-L3（结构重构 + 架构演进）
- 全编排模式（Hub-Spoke + Evolution Loop）

---

## Phase 4: Ecosystem — 开放生态

**目标**：建立 Haro 生态系统。

**核心交付**：
- Agent Store（可共享的 Agent 定义）
- Provider 插件化（第三方 Provider 接入）
- 跨实例协作（多个 Haro 实例协同）
