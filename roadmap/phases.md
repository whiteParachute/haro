# Haro 路线图

> 2026-05-01 重排：原 Phase 0/1/2/3/4 拆分为 Phase 0/1/1.5/2.0/2.5/3.0/3.5；Phase 4 Ecosystem 已移除（自用工具不需要）。
>
> 规划背景：[`docs/planning/archive/redesign-2026-05-01.md`](../docs/planning/archive/redesign-2026-05-01.md)

## 总览

| 阶段 | 状态 | 目标 | 核心交付 | 自治水平 |
|------|------|------|---------|---------|
| Phase 0: Foundation | 已完成 | 最小可用骨架 | CLI + Codex + 单 Agent Runtime + Memory + Channel（CLI/飞书/Telegram）+ Skills（15 预装）+ 手动 eat/shit | 人类驱动 |
| Phase 1: Intelligence & Safety | 已完成 | 场景理解 + 动态编排 + 生产化护栏 | Scenario Router + Team Orchestrator + Web Dashboard 控制面 + Memory Fabric v1 + Evolution Asset Registry + 权限/Token 预算 + 多用户 + ChatGPT 订阅认证 | Agent 驱动，人类审批 |
| Phase 1.5: Workbench Parity | **进行中**（FEAT-038/039 done）| 日用底座补完 + 架构解耦 | Web API 解耦 + CLI 等价补完 + Web Channel + MCP 工具层 + 定时任务 + 流式 UX 升级 | 人类驱动 |
| Phase 2.0: Evolution Awareness | 规划中 | 平台开始"看见"自己和外部世界 | Self-Monitor（被动观测）+ Industry Intel（业界趋势订阅）+ 自动 eat/shit 触发器 | Agent 感知，人类决策 |
| Phase 2.5: Evolution Proposal | 规划中 | 平台产出结构化进化提案 | Pattern Miner + Evolution Proposal Generator + Dashboard 审批队列 + 决策反馈闭环 | Agent 思考，人类审批 |
| Phase 3.0: Controlled Self-Evolution | 规划中 | 受控自演化（低风险自动落地） | Auto-Refactorer L0（Prompt）+ L1（编排/skill 配置）+ approval 后自动落地 + 灰度 + 回滚 | Agent 自治，人类监督 |
| Phase 3.5: Agent-as-Developer | 视情况 | Agent 改 Haro 自身代码 | L2/L3 重构 + Agent 自写 skill + Agent 自写 spec + 自提 PR + 长周期预算治理 | Agent 自治，人类引导 |

> ~~Phase 4 Ecosystem~~（Agent Store / 跨实例协作 / 团队资产共享）— **已移除**。Haro 定位为单实例自用工具，不需要生态层。

总周期估算：Phase 1.5 → 3.0 大约 **7–10 个月日历时间**到达"平台产出进化提案、低风险改动自动落地"的状态。Phase 3.5 不订时间，按数据说话。

---

## Phase 0: Foundation — 最小可用骨架

**状态**：已完成（2026-04-19 验收闭环）

**目标**：打通从任务输入到 Agent 执行的完整链路，验证核心架构可行。

**交付项**（11 项均已 done）：

| 序号 | 交付项 | Spec |
|------|--------|------|
| P0-1 | 项目脚手架 | FEAT-001 |
| P0-3 | Codex Provider | FEAT-003 |
| P0-4 | 最小 Agent 定义 | FEAT-004 |
| P0-5 | 单 Agent 执行循环 | FEAT-005 |
| P0-6 | CLI 入口（cli channel） | FEAT-006 |
| P0-7 | Memory Fabric 独立能力 | FEAT-007 |
| P0-8 | Channel 抽象层 + 飞书 adapter | FEAT-008 |
| P0-9 | Telegram Channel adapter | FEAT-009 |
| P0-10 | Skills 子系统 + 15 预装 | FEAT-010 |
| P0-11 | 手动 eat / shit | FEAT-011 |
| P0-12 | Setup / Onboard 首次引导 | FEAT-012 |

**验收记录**：[`docs/reviews/phase-0-audit-2026-04-19.md`](../docs/reviews/phase-0-audit-2026-04-19.md)

---

## Phase 1: Intelligence & Safety — 场景理解、动态编排、生产化护栏

**状态**：已完成（2026-05-01：18 个 spec 中 17 done，FEAT-030 draft）

**目标**：把 Phase 0 的单 Agent 骨架升级为可从零配置、可观测、可恢复、可审计、成本可控的多 Agent 平台。

**交付项**：

| Spec | 交付项 | 状态 |
|------|--------|------|
| FEAT-013 | Scenario Router | done |
| FEAT-014 | Team Orchestrator | done |
| FEAT-015 | Web Dashboard 基础 | done |
| FEAT-016 | Web Dashboard Agent 交互 | done |
| FEAT-017 | Web Dashboard 系统管理 | done |
| FEAT-018 | Web Dashboard 编排可观测 | done |
| FEAT-019 | Channel & Agent 管理 | done |
| FEAT-020 | Codex runtime `shit` skill | done |
| FEAT-021 | Memory Fabric v1 | done |
| FEAT-022 | Evolution Asset Registry | done |
| FEAT-023 | Permission & Token Budget Guard | done |
| FEAT-024 | Knowledge & Skills Dashboard | done |
| FEAT-025 | Runtime Logs & Provider Monitoring | done |
| FEAT-026 | Provider Onboarding Wizard | done |
| FEAT-027 | Guided Setup & Doctor Remediation | done |
| FEAT-028 | Web Dashboard 多用户与产品成熟度 | done |
| FEAT-029 | Codex ChatGPT 订阅认证 | done |
| FEAT-030 | Dashboard ChatGPT 认证 UI | draft |

**Phase 1 边界（已生效）**：
- 不自动触发完整 Evolution Engine（→ Phase 2.0/2.5/3.0）
- 不引入向量数据库（FTS5 用到 Phase 2+）
- 不做跨组织共享 Agent Store（→ ~~Phase 4~~ 已移除）
- 不引入企业 SSO / OIDC / LDAP（FEAT-028 仅本地多用户）
- provider secret 不写明文 YAML（仅 secretRef 或受保护 env file）

---

## Phase 1.5: Workbench Parity — 日用底座补完 + 架构解耦

**状态**：进行中（2026-05-01 启动；FEAT-038 + FEAT-039 已 done，FEAT-031/032/033/034 仍 draft）

**目标**：把 Haro workbench 层补完到 happyclaw 级别的"开箱日用"水平，同时完成"CLI 优先 + Web UI 与后端解耦"的架构调整，让 Phase 2.0+ 的进化层有稳定的数据源和接口契约可以寄生。

**触发动机**：
- owner 自用单人，需要 CLI 在脱离 Web UI 时也能完成全部使用与配置（hermes-agent 风格）
- Web UI 与后端要可独立发布（hermes-web-ui 风格）
- happyclaw 在 MCP 工具层、定时任务、流式 UX 上领先，必须补齐

**交付项**：

| Spec | 交付项 | 估算 | 优先级 |
|------|--------|------|--------|
| FEAT-038 | Web API 解耦（新建 `packages/web-api`，从 CLI 剥离） | 3–4 天 | P0 |
| FEAT-039 | CLI 功能等价补完（chat / session / agent / skill / memory / logs / workflow / budget / user 命令族） | 1.5–2 周 | P0 |
| FEAT-031 | Web Channel（Web UI 作为 IM channel：对话、历史、文件） | 1–1.5 周 | P0 |
| FEAT-032 | MCP 工具层 + 4 核心工具（send_message / memory_query / memory_remember / schedule_task） | 1.5–2 周 | P0 |
| FEAT-033 | 定时任务最小版（cron + 一次性，复用现有 session 上下文） | 1 周 | P1 |
| FEAT-034 | 流式 UX 升级（thinking 折叠、tool timeline、Hook 状态、GFM/lightbox） | 1.5–2 周 | P1 |

**预埋钩子**：FEAT-038 / 039 / 031 应在实现时埋好 Self-Monitor 的"被动记录"埋点（session 事件、tool 调用、失败/重试），数据先 buffer，等 Phase 2.0 直接消费。

**Phase 1.5 不做**：
- 不接 QQ / 微信 channel（owner 不需要）
- 不做 Web 终端（xterm + node-pty，可选，延后）
- 不做 PWA / 移动适配（自用单机不需要）
- 不退化多 provider 抽象（保留为 xiaomi/kimi 等做准备）
- 不退化多用户 / Audit / i18n / 分页（保留，仅降优先级）

**Phase 1.5 验收标准**：
- [x] `packages/web-api` 独立可发布，前后端通过稳定 HTTP/JSON contract 通信（FEAT-038 done）
- [x] CLI 命令族覆盖 Web Dashboard 所有页面的核心动作（chat/session/agent/skill/memory/logs/workflow/budget/user）（FEAT-039 done，含 REPL slash + `--json/--human` envelope 统一）
- [ ] Web channel 可在浏览器对话、查看历史、上传/下载文件（FEAT-031 draft）
- [ ] Agent 可通过 MCP 工具发消息、查/写记忆、调度任务（FEAT-032 draft）
- [ ] 定时任务支持 cron 表达式 + 一次性触发（FEAT-033 draft）
- [ ] 流式 UX：thinking 可折叠、tool 调用有 timeline、Markdown 含表格/代码高亮/图片预览（FEAT-034 draft）

---

## Phase 2.0: Evolution Awareness — 进化感知层

**状态**：规划中

**目标**：让平台开始"看见"自己和外部世界，但还不自己改自己。

**驱动源（4 个进化驱动源中的前 2 个）**：
1. **使用记忆**（Self-Monitor）— 自己的运行轨迹、token 浪费、失败模式、skill 命中率
2. **业界趋势**（Industry Intel）— Anthropic / OpenAI changelog、关键 GitHub repo release、agent 领域趋势

**交付项**：

| Spec | 交付项 | 估算 |
|------|--------|------|
| FEAT-040 | Self-Monitor — 被动观测：session/tool/失败/重试/token 浪费/skill 命中率 统计 | 1–1.5 周 |
| FEAT-036 | Industry Intel — 订阅 Anthropic/OpenAI changelog + 关键 GitHub repo release，自动 eat 进 Memory Fabric | 1.5–2 周 |
| FEAT-041 | 自动 eat/shit 触发器 — 触发条件、阈值、回滚机制 | 1.5–2 周 |

**周期估算**：1.5–2 个月。

**Phase 2.0 不做**：
- 不让 Agent 自己改自己（→ Phase 3.0）
- 不做模式归纳（→ Phase 2.5 Pattern Miner）
- 不出进化提案（→ Phase 2.5 Evolution Proposal）

---

## Phase 2.5: Evolution Proposal — 进化提案层

**状态**：规划中

**目标**：平台能产出结构化进化建议，由 owner 做决策。这才是真正的"自规划进化路线"。

**驱动源（4 个进化驱动源中的后 2 个）**：
3. **用户决策**（Evolution Proposal/Approval）— 提案 → 证据 → 决策 → 反馈
4. **Agent 自判断**（Pattern Miner + 自规划）— 从使用数据 + 业界趋势中归纳模式，生成提案

**交付项**：

| Spec | 交付项 | 估算 |
|------|--------|------|
| FEAT-042 | Pattern Miner — 从 Self-Monitor + Intel 中归纳模式（失败 pattern、低效 pattern、外部新机会） | 2–3 周 |
| FEAT-037 | Evolution Proposal Generator + Dashboard 审批队列 + 决策反馈闭环 | 3–4 周 |

**Evolution Proposal 结构**（产品级形态，不是后台逻辑）：
- 现状描述
- 证据链（Self-Monitor 数据 / Industry Intel 来源 / Agent 自评）
- 建议改动（具体 spec / skill / prompt 修改）
- 影响面（哪些模块、哪些 session）
- 风险与回滚路径
- 决策按钮（approve / reject / modify）

owner 在 Dashboard 上的决策本身被 Self-Monitor 记录，反馈给下一轮规划，形成闭环。

**周期估算**：1.5–2 个月。

---

## Phase 3.0: Controlled Self-Evolution — 受控自演化

**状态**：规划中

**目标**：approval 通过的低风险改动自动落地，平台开始"自己改自己"，但严格在 L0/L1 安全范围。

**Auto-Refactorer 等级**：
- **L0**：Prompt 调优（systemPrompt / agent description / skill description）
- **L1**：编排模式调整（Scenario Router 规则 / Team Orchestrator 配置 / skill 启用矩阵 / Memory Fabric 压缩策略）

**核心交付**：
- Auto-Refactorer L0 + L1 实现
- approval 后自动落地的执行链
- **灰度发布**（先在隔离 session / agent 上验证）
- **自动回滚**（指标退化触发）
- 长周期使用统计驱动的进化频率自适应

**周期估算**：2–3 个月。

**Phase 3.0 不做**：
- 不做 L2/L3（→ Phase 3.5）
- 不写代码（→ Phase 3.5）
- 不改 spec（→ Phase 3.5）

---

## Phase 3.5: Agent-as-Developer — Agent 自主维护平台

**状态**：视情况启动

**目标**：Agent 成为 Haro 的主要维护者。

**Auto-Refactorer 等级**：
- **L2**：结构重构（模块划分、接口调整）
- **L3**：架构演进（新模块引入、协议层升级）

**核心交付**：
- Agent 修改 Haro 自身代码（写代码、补 spec、提 PR 给 owner review）
- Agent 自主编写新 skill
- 长周期预算治理（按 agent / workspace / operation class 统计预算与审批趋势）
- 全编排模式（Hub-Spoke + Evolution Loop）

**启动条件**：Phase 3.0 自动 L0/L1 落地至少稳定 3 个月，有足够多的 approval/rollback 数据，owner 信任度建立。

**周期估算**：不订时间，按数据说话。

---

## 不做的事（明确划出去）

- ~~**Phase 4 Ecosystem**~~：Agent Store / 跨实例协作 / 团队资产共享 — Haro 是单实例自用工具，不做生态层
- **企业级 SSO / OIDC / LDAP** — 仅本地多用户
- **向量数据库** — FTS5 够用到 Phase 2+；向量检索如果要做，由 eat/shit 评估后引入
- **QQ / 微信 channel** — owner 不需要
- **Web 终端 / PWA** — 自用单机不需要
- **Multi-tenant SaaS** — 不做对外平台

---

## 路线图变更记录

- **2026-05-01**：原 Phase 0/1/2/3/4 重排为 Phase 0/1/1.5/2.0/2.5/3.0/3.5；Phase 4 Ecosystem 移除；Phase 1.5 新增；Phase 2/3 内部重构为感知层 / 提案层 / 受控自演化 / Agent-as-Developer 四段。详见 [`docs/planning/archive/redesign-2026-05-01.md`](../docs/planning/archive/redesign-2026-05-01.md)。
- **2026-04-25**：Phase 1 调整后的交付顺序定稿（FEAT-013 ~ 028）。
- **2026-04-19**：Phase 0 验收闭环。
