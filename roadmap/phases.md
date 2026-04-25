# Haro 四阶段路线图

## 总览

| 阶段 | 目标 | 核心交付 | 自治水平 |
|------|------|---------|---------|
| Phase 0: Foundation | 最小可用骨架 | PAL + Channel 层（CLI/飞书/Telegram）+ Agent Runtime + Memory Fabric 独立能力 + Skills 子系统（15 预装）+ CLI + 手动 eat/shit | 人类驱动 |
| Phase 1: Intelligence & Safety | 场景理解 + 动态编排 + 生产化护栏 | Scenario Router + Team Orchestrator + Web Dashboard 控制面 + Memory Fabric v1 + Evolution Asset Registry + 权限/Token 预算 MVP | Agent 驱动，人类审批 |
| Phase 2: Evolution | 自我进化 | Evolution Engine (Self-Monitor + Pattern Miner + Auto-Refactorer L0-L1) + 自动 eat/shit + 编排调试增强 + 会话生命周期策略 + checkpoint 人机介入 | Agent 自治，人类监督 |
| Phase 3: Autonomy | Agent 自主维护平台 | Agent-as-Developer + 自主需求分析 + L2-L3 重构 + 全编排模式 + Agent 自写 skill + 长周期预算治理 | Agent 自治，人类引导 |
| Phase 4: Ecosystem | 开放生态 | Agent Store + Provider 插件化 + 跨实例协作 + 团队资产共享 | — |

---

## Phase 0: Foundation — 最小可用骨架

**目标**：打通从任务输入到 Agent 执行的完整链路，验证核心架构可行。

**自治水平**：人类驱动

### Phase 0 MVP（11 项）

| 序号 | 交付项 | 说明 |
|------|--------|------|
| P0-1 | 项目脚手架 | monorepo 结构 + Zod config + pino 日志 |
| P0-3 | Codex Provider | 基于 `@openai/codex-sdk` |
| P0-4 | 最小 Agent 定义 | `id + name + systemPrompt + tools? + defaultProvider? + defaultModel?` |
| P0-5 | 单 Agent 执行循环 | 接收任务 → 选择 Provider → 调用 → 返回结果 |
| P0-6 | CLI 入口（cli channel） | REPL + 单次命令模式；同时作为 Channel 层的第一个 adapter |
| P0-7 | Memory Fabric 独立能力 | 原生读写 index.md + knowledge/，**不依赖外部系统**，同时兼容 aria-memory 目录格式 |
| P0-8 | Channel 抽象层 + 飞书 adapter | `MessageChannel` 接口 + 基于 lark-bridge-service 已验证 client 路径封装飞书 adapter |
| P0-9 | Telegram Channel adapter | 基于 `grammy` 或 `node-telegram-bot-api` |
| P0-10 | Skills 子系统 + 15 预装 | 安装/卸载/查询 + 记忆 6 + 自查 3 + loop + 飞书 3 + eat/shit |
| P0-11 | 手动 eat / shit | `haro eat <url/path>` + `haro shit --scope ...` + 归档回滚 |

### Phase 0 详细任务列表

**P0-1：项目脚手架**
- [ ] monorepo 结构初始化（packages/core, packages/cli, packages/providers）
- [ ] TypeScript 配置 + ESLint + Prettier
- [ ] Zod schema 定义全局配置结构
- [ ] pino 日志配置（stdout + `~/.haro/logs/` 双输出）
- [ ] SQLite 初始化脚本（sessions + session_events + workflow_checkpoints 表）

**P0-3：Codex Provider**
- [ ] 安装 `@openai/codex-sdk`
- [ ] 实现 `CodexProvider implements AgentProvider`
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
- [ ] `haro` — 启动 REPL（readline/promises + clack 一次性交互）
- [ ] `haro run "..."` — 单次任务
- [ ] `haro model` — 查看/切换 Provider 和 Model
- [ ] `haro config` — 配置管理
- [ ] `haro doctor` — 系统诊断（Provider 健康检查 + 配置验证）
- [ ] `haro skills` — 技能管理
- [ ] `haro status` — 运行状态
- [ ] REPL 内 Slash 命令：`/model /new /retry /compress /skills /usage`

**P0-7：Memory Fabric 独立能力**
- [ ] 识别记忆目录（`~/.haro/memory/` 或配置的 aria-memory 路径）
- [ ] 原生读写 `index.md` + `knowledge/*.md`
- [ ] Session 结束后由 `memory-wrapup` skill 触发写入
- [ ] Per-Agent 记忆目录创建（`~/.haro/memory/agents/{name}/`）
- [ ] 平台级 / 共享记忆目录创建
- [ ] 主备配置支持（可选，兼容 aria-memory 主备用户）

**P0-8：Channel 抽象层 + 飞书 adapter**
- [ ] 定义 `MessageChannel` 接口（见 `specs/channel-protocol.md`）
- [ ] `ChannelRegistry` 注册表
- [ ] `cli` channel（内置）
- [ ] `feishu` channel（基于 lark-bridge-service 已验证 client 路径，websocket 接入）
- [ ] `~/.haro/channels/` 目录结构 + session 映射表
- [ ] `haro channel` 命令族
- [ ] 可插拔性 lint 规则（核心模块禁止出现 `channelId === 'xxx'` 特判）

**P0-9：Telegram Channel adapter**
- [ ] 基于 `grammy` 实现 `TelegramChannel`
- [ ] 长轮询模式
- [ ] 私聊流式输出（`@grammyjs/stream` + auto-retry），群聊降级为最终结果
- [ ] `haro channel setup telegram` 交互式接入向导（内建于 channel 命令族）

**P0-10：Skills 子系统 + 15 预装**
- [ ] Skill 安装 / 卸载 / 查询（兼容 Claude Code skill 格式）
- [ ] `~/.haro/skills/preinstalled/` + `user/` 目录
- [ ] `installed.json` 清单维护
- [ ] `usage.sqlite` 使用统计
- [ ] 预装 6 个记忆 skill（remember / memory / memory-wrapup / memory-sleep / memory-status / memory-auto-maintain）
- [ ] 预装 3 个自查 skill（review / security-review / simplify）
- [ ] 预装 1 个循环 skill（loop）
- [ ] 预装 3 个飞书 skill（lark-bridge / feishu-sessions / lark-setup）
- [ ] 预装 eat skill（复用 `/home/heyucong.bebop/SKILL.md`，保留原作者署名）
- [ ] 预装 shit skill（Haro 自研，见 `specs/evolution-metabolism.md`）

**P0-11：手动 eat / shit**
- [ ] `haro eat <url|path|text>` 命令
- [ ] eat 质量门槛 + 四问验证 + proposal bundle / Memory 写入 + 预览确认
- [ ] `haro shit --scope <rules|skills|mcp|memory|all>` 命令
- [ ] shit 扫描 → 评估 → 预览 → 归档
- [ ] `~/.haro/archive/shit-<timestamp>/` 归档结构 + manifest.json
- [ ] `haro shit rollback <archive-id>` 回滚

### Phase 0 验收标准

- [ ] `haro run "列出当前目录下的 TypeScript 文件"` 成功执行并返回结果
- [ ] Codex Provider 可独立使用
- [ ] Session 数据写入 SQLite
- [ ] 记忆文件在 session 结束后正确更新
- [ ] `haro doctor` 能正确诊断 Provider + Channel 状态
- [ ] 从飞书和 Telegram 分别发起一次任务并收到 Agent 回复
- [ ] 15 个预装 skill 全部可用（`haro skills list` 列出全部）
- [ ] `haro eat` 对一个 URL 完整走完四问验证 + 预览 + 写入流程
- [ ] `haro shit --scope skills --dry-run` 正确列出候选淘汰清单且不误删预装 skill
- [ ] `haro shit rollback` 能恢复归档的组件
- [ ] 核心模块的源码中**不存在** `providerId === 'xxx'` 或 `channelId === 'xxx'` 特判（lint 通过）

### Phase 0 推迟项目

| 原计划 | 推迟至 | 原因 |
|--------|--------|------|
| MCP Tool Provider 适配器 | Phase 1 | Phase 0 用 SDK 内置工具即可 |
| 能力矩阵 | Phase 1 | Provider/Channel 都用 capabilities() 动态暴露，无需矩阵 |
| Actor 消息驱动运行时 | Phase 1 | Phase 0 单 Agent 直接调用就够了 |
| TaskDelegation 接口 | Phase 1 | Phase 0 没有多 Agent 协作 |
| 多后端执行沙箱 | Phase 1 | Phase 0 本地执行就够了 |
| 装饰器链工具包装 | Phase 0 后期 | 先直接用 SDK 工具 |
| Skill Marketplace | Phase 1 | Phase 0 只需安装/卸载能力 |
| eat / shit 自动触发 | Phase 2 | Phase 0 仅手动触发 |
| Provider 动态重评估 | Phase 2 | Phase 0 只做静态规则匹配 |

---

<a id="phase-1-intelligence--场景理解与动态编排"></a>

## Phase 1: Intelligence & Safety — 场景理解、动态编排与生产化护栏

**目标**：把 Phase 0 的单 Agent 骨架升级为可从零配置、可观测、可恢复、可审计、成本可控的多 Agent 平台。

**当前状态（2026-04-25）**：
- 已完成：FEAT-013 Scenario Router、FEAT-014 Team Orchestrator、FEAT-015/016 Dashboard 基础与 Agent 交互、FEAT-020 Codex runtime `shit` skill。
- 刚收尾：FEAT-017 Web Dashboard System Management（真实 provider 连通测试暂无 harness，按 owner 指示跳过）。
- 待重排：FEAT-018 Orchestration Debugger、FEAT-019 Channel & Agent Management、FEAT-024 Knowledge & Skills、FEAT-025 Runtime Logs & Provider Monitoring。
- 新增 P0 可用性缺口：Provider Onboarding Wizard（Hermes 风格 CLI 引导配置）、Guided Setup & Doctor Remediation（OpenClaw/Hermes 风格从零配置与修复）。
- 新增 P0 智能基础：Memory Fabric v1（Hermes 分层 + FTS5）、Evolution Asset Registry（EvoMap 风格资产化）。
- 新增 P1 护栏：权限分级 + Token 预算 MVP（Mercury 风格生产安全）。
- 新增 P1 产品成熟度：Dashboard 多用户、成熟分页、中文本地化（KeyClaw 风格管理面）。

### Phase 1 调整后的交付顺序

| 顺序 | 优先级 | Spec | 交付项 | 来源借鉴 | 说明 |
|------|--------|------|--------|----------|------|
| 1 | P0 | FEAT-017 | Web Dashboard System Management | — | 已 done；真实 provider 连通测试跳过 |
| 2 | P0 | FEAT-026 | Provider Onboarding Wizard | Hermes | `haro provider` 命令族、provider setup/doctor/models/select、secretRef 与 systemd env file 对齐 |
| 3 | P0 | FEAT-027 | Guided Setup & Doctor Remediation | OpenClaw / Hermes | `haro setup` 从零引导、`haro doctor` 结构化 remediation、global/systemd profile 检查 |
| 4 | P0 | FEAT-021 | Memory Fabric v1 | Hermes | 三级记忆、FTS5 搜索、Haro 信息维度拆分、对抗性验证 |
| 5 | P0 | FEAT-022 | Evolution Asset Registry | EvoMap | eat/shit 产物、prompt、skill、编排规则统一资产化，带版本与审计 |
| 6 | P1 | FEAT-023 | Permission & Token Budget Guard | Mercury Agent | 操作权限分级、Token/成本预算、并行 Agent 预算汇总 |
| 7 | P1 | FEAT-018 | Orchestration Debugger | LangGraph / CrewAI | workflow 图、checkpoint 时间线、卡住分支诊断；已从原大 spec 拆出 |
| 8 | P1 | FEAT-019 | Channel & Agent Management | OpenClaw | Channel/Gateway/Agent 管理；idle/daily reset 延后 Phase 2 |
| 9 | P1 | FEAT-028 | Web Dashboard Product Maturity | KeyClaw | 本地多用户、统一服务端分页、完整中文本地化、角色化操作 |
| 10 | P2 | FEAT-024 | Knowledge & Skills Dashboard | Hermes / EvoMap | Memory 搜索、Skill 生命周期、asset 追溯 |
| 11 | P2 | FEAT-025 | Runtime Logs & Provider Monitoring | Mercury / OpenClaw | session events、provider fallback、token 趋势、活跃 session |
| 12 | P2 | 后续 spec | Actor 运行时、MCP Tool Provider、Skill marketplace 深化 | AutoGen / OpenClaw | 不阻塞首配、Memory/资产/预算三条主线 |

### Phase 1 明确不做

- 不自动触发完整 Evolution Engine；自动 OODA、自动 eat/shit 仍属于 Phase 2。
- 不引入向量数据库；Phase 1 搜索使用 SQLite FTS5，向量检索留到 Phase 2+。
- 不做跨组织共享 Agent Store；Phase 1 只建立本地资产审计和同步基础。
- 不让 Dashboard 执行高风险编排控制；FEAT-018 调试视图以只读为主，交互式重跑/暂停/策略调整留到 Phase 2。
- 不把 OpenClaw 的固定 Gateway 结构照搬进核心；只借鉴会话生命周期和权限模型。
- 不引入企业级 SSO / OIDC / LDAP；FEAT-028 只做单机本地用户与角色模型。
- 不把 provider secret 明文写入普通 YAML；FEAT-026 只允许 secretRef 或受权限保护的 env file。

---

## Phase 2: Evolution — 自我进化

**目标**：平台开始自我改进。

**核心交付**：
- Evolution Engine
  - Self-Monitor（性能指标采集）
  - Pattern Miner（成功模式挖掘）
  - Auto-Refactorer L0（Prompt 优化）
  - Auto-Refactorer L1（编排模式调整）
- Evolution Dashboard（可视化进化日志，复用 Phase 1 的 workflow/debug 基础）
- OODA 循环实现
- **eat / shit 自动触发**（Evolution Engine 调度）
- **Provider/Model 动态重评估**（Agent 自评估 + 用户反馈）
- Memory Dreaming / consolidation（短期记忆晋升、长期记忆归档、低价值记忆进入 shit 候选）
- Channel 会话生命周期策略（idle reset / daily reset / retention）
- Checkpoint 人机介入点：在高风险、预算超限、策略分歧或架构演进前主动请求人类裁决

---

## Phase 3: Autonomy — Agent 自主维护

**目标**：Agent 成为平台的主要维护者。

**核心交付**：
- Agent-as-Developer（Agent 修改 Haro 自身代码）
- 自主需求分析（从用户反馈、互联网趋势挖掘需求）
- Auto-Refactorer L2-L3（结构重构 + 架构演进）
- 全编排模式（Hub-Spoke + Evolution Loop）
- **Agent 自主编写新 skill**（Agent-as-Maintainer 的延伸）
- Permission & Budget Guard 升级为长期治理：按 agent / workspace / operation class 统计预算与审批趋势

---

## Phase 4: Ecosystem — 开放生态

**目标**：建立 Haro 生态系统。

**核心交付**：
- Agent Store（可共享的 Agent 定义）
- Provider 插件化（第三方 Provider 接入）
- 跨实例协作（多个 Haro 实例协同）
