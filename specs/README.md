# Haro Spec 体系与开发流程

本目录是 Haro 项目的 **spec 单一真源（single source of truth）**。所有 feature、defect、协议、约束都在这里登记，开发/测试/迭代都围绕 spec 展开，以此防止需求与实现漂移。

## 2026-05-08 新基线

Haro 当前主线已切换为 **AgentDock self-evolution sidecar**。

新 spec 优先进入 `specs/sidecar/`。旧 `phase-0/`、`phase-1/`、`phase-1.5/` 作为历史 workbench 路线资产保留；其中已交付模块可以复用经验，但不再决定后续主路径。旧 Phase 2.0 / 2.5 规划已被 sidecar-era specs 替代并删除。

硬约束：

- AgentDock 不能 import Haro。
- Haro 不能 import AgentDock 内部 `src/*` 模块。
- Haro 接入 AgentDock 只走外部 MCP server 注册、AgentDock scheduler/script task、AgentDock skills/MCP 调用面。
- 第一阶段只读 / dry-run；启动阶段自动 proposal 默认需要人审，L0/L1 apply 必须有 proposal、validation、human approval、snapshot、rollback ref。
- 外部前沿情报只能作为带来源 evidence 进入 proposal，不得绕过 validation / approval / rollback gate。

当前 sidecar-era specs：

| Spec | 主题 | 阶段 | 状态 |
| --- | --- | --- | --- |
| [FEAT-043](sidecar/FEAT-043-agentdock-contract-skeleton.md) | AgentDock contract skeleton | Phase B | in-progress |
| [FEAT-044](sidecar/FEAT-044-read-only-mcp-sidecar.md) | Read-only Haro MCP sidecar | Phase C | in-progress |
| [FEAT-045](sidecar/FEAT-045-scheduled-sidecar-cli.md) | Scheduled sidecar CLI | Phase D | draft |
| [FEAT-046](sidecar/FEAT-046-sidecar-asset-registry-adapter.md) | Sidecar asset registry adapter | Phase E | draft |
| [FEAT-047](sidecar/FEAT-047-gated-apply-l0-l1.md) | Gated apply L0/L1 | Phase F | implemented |
| [FEAT-048](sidecar/FEAT-048-frontier-intelligence-intake.md) | Frontier intelligence intake | Phase E | draft |
| [FEAT-049](sidecar/FEAT-049-patch-branch-l2-l3.md) | Patch branch L2/L3 | Phase G | implemented |

## 目录结构

```
specs/
├── README.md                       # 本文件：规范与流程
├── _template-feature.md            # Feature spec 模板
├── _template-defect.md             # Defect spec 模板
│
├── phase-0/                        # 按 phase 组织的 spec
│   ├── FEAT-001-xxx.md
│   ├── FEAT-002-xxx.md
│   └── BUG-001-xxx.md
├── phase-1/
│   └── ...
├── sidecar/                        # 2026-05-08 新基线：AgentDock sidecar specs
│   ├── FEAT-043-agentdock-contract-skeleton.md
│   ├── FEAT-044-read-only-mcp-sidecar.md
│   ├── FEAT-045-scheduled-sidecar-cli.md
│   ├── FEAT-046-sidecar-asset-registry-adapter.md
│   ├── FEAT-047-gated-apply-l0-l1.md
│   ├── FEAT-048-frontier-intelligence-intake.md
│   └── FEAT-049-patch-branch-l2-l3.md
├── phase-1.5/                      # 历史 workbench parity 资产（2026-05-01 路线）
│
├── multi-agent-design-constraints.md   # 强制规范（跨 phase）
├── provider-protocol.md                # 协议规范
├── provider-selection.md               # 协议规范
├── channel-protocol.md                 # 协议规范
├── evolution-metabolism.md             # 协议规范
├── evolution-engine-protocol.md        # 协议规范
└── team-orchestration-protocol.md      # 协议规范
```

- **`_template-*`**：以 `_` 前缀排在最上面，复制后填充
- **`sidecar/`**：2026-05-08 之后的新主线 feature / defect spec
- **`phase-N/`**：历史 workbench 路线的 feature / defect spec；除非用户明确要求，不再新增主线 spec
- **无前缀的 `*.md`（根目录）**：跨 phase 的强制规范和协议；如内容仍绑定旧 workbench，应按 sidecar 语境重评估后再引用

## Spec 类型

| 类型 | 前缀 | 模板 | 场景 |
|------|------|------|------|
| Feature | `FEAT-` | `_template-feature.md` | 新功能、增强、重构 |
| Defect | `BUG-` | `_template-defect.md` | 缺陷、回归、事故复盘 |
| 协议/约束 | 无 | 自由结构 | 跨 feature 的硬性规则（如 Provider 协议） |

## 编号规则

- **全局递增不分 phase**：`FEAT-001`, `FEAT-002`, ...，`BUG-001`, `BUG-002`, ...
- **文件名格式**：`<TYPE>-<NNN>-<kebab-case-slug>.md`
  - 例：`phase-0/FEAT-003-pluggable-provider-registry.md`
- 编号一次分配永不复用；废弃的 spec 保留文件，`status: superseded`

## Status 流转

```
draft → approved → in-progress → done
   ↓                                ↓
 (废弃)                          superseded（被新 spec 取代）
```

| Status | 含义 | 允许的动作 |
|--------|------|-----------|
| `draft` | 编写中 / 待确认 | 自由编辑；**不得开工** |
| `approved` | 已批准 | 可开工；小改直接改 + Changelog；大改退回 `draft` |
| `in-progress` | 正在实现 | 可改 Test Plan、补充 Open Questions 的后续决策；Requirement 不可加 |
| `done` | 已完成 | 仅修订拼写/链接；Requirement / AC 冻结 |
| `superseded` | 被替代 | body 顶部写明指向的新 spec ID，不再维护 |

### Approved 的门槛

一条 spec 从 `draft → approved` 必须同时满足：

1. **Open Questions 清零**（所有 `Q1/Q2/...` 已有结论）
2. **Acceptance Criteria 全部可测**（给定-当-则结构，人可以明确判断通过/失败）
3. **Requirements 与 Acceptance Criteria 对齐**（每条 R 至少有一条 AC 覆盖）
4. **用户（白帆）点头**

### In-progress → Done 的门槛

1. 所有 AC 对应的测试用例通过（CI 全绿）
2. `docs/` 同步更新完毕
3. PR 合入 main
4. Changelog 补充 `done` 一行

## 开发流程

```
需求/Bug 进入
    ↓
Step 1 起草 spec
    - 复制 _template-feature.md 或 _template-defect.md 到 phase-N/
    - 分配编号；填 Context / Goals / Non-Goals / Requirements / AC / Test Plan
    - status: draft
    ↓
Step 2 澄清 Open Questions
    - 列出所有歧义
    - 逐条给出决策；无法回答的等用户确认
    ↓
Step 3 切 approved
    - 用户审阅 → 点头 → 改 status 为 approved
    ↓
Step 4 实现
    - 改 status 为 in-progress
    - 开分支（见《分支 & 提交规范》）
    - commit / PR 引用 spec ID + Requirement 编号
    ↓
Step 5 测试与合入
    - AC 对应的测试全绿 + CI 通过
    - docs/ 同步
    - PR 合入 main
    ↓
Step 6 收尾
    - 改 status 为 done
    - Changelog 补 done 一行
```

### 开发中发现新 bug

**不嵌入当前 feature spec**，另立 `BUG-XXX` defect spec。理由：避免 spec 变成杂货篮，失去单一真源价值。

如果这个 bug **阻塞**当前 feature 推进，可在 feature spec 的 `related` 字段里引用新 BUG ID，但 Requirement 与 AC 仍分离。

## Spec 与 Code 的绑定规范

### 分支命名

```
feat/FEAT-003-pluggable-provider-registry
fix/BUG-007-feishu-session-leak
```

### Commit message

```
<type>(<scope>): <short subject>  [spec: <ID>#<R/AC>]

<optional body>
```

示例：

```
feat(pal): add ProviderRegistry skeleton  [spec: FEAT-003#R1]
fix(channels): prevent double-close on reconnect  [spec: BUG-007#AC1]
test(pal): AC2 regression for registry unloading  [spec: FEAT-003#AC2]
```

### PR 标题与正文

- **标题**必须含 spec ID：`[FEAT-003] Pluggable Provider Registry`
- **正文第一节**贴 spec 相对路径链接
- 使用 `.github/PULL_REQUEST_TEMPLATE.md` 模板（仓库已配置）

### 测试用例

测试代码里引用 AC 编号（作为注释或测试名的一部分）：

```typescript
// AC1: 给定已注册的 provider，当 unregister 时，registry.list() 不再包含它
describe('ProviderRegistry [FEAT-003]', () => {
  test('AC1 unregister removes provider', () => { ... })
})
```

## Spec 变更规则

| 变更类型 | 处理 |
|---------|------|
| **拼写/措辞/格式** | 直接改；`updated` 字段更新；Changelog 可不加 |
| **补充示例、澄清原有规则** | 直接改；Changelog 加一行说明 |
| **新增 Requirement 或 AC** | status 退回 `draft`，重走 approved 门槛 |
| **删除或修改已 approved 的 Requirement** | 同上；Changelog 写明"Breaking" |
| **整个 spec 被新 spec 替代** | 改 status 为 `superseded`；body 顶部写 `> Superseded by [FEAT-NNN](...)` |

**原则**：spec 是合约，改合约的成本应略高于写合约，以此阻止"边做边改"的惰性。

## docs/ 与 spec 的同步规则

- `docs/` 下的架构/模块文档**必须与 spec 保持一致**
- 改 spec Requirement → 同一个 PR 里改 docs
- 先改哪个都行，合并时必须两者一致
- 检测漂移：PR 评审时人工核对（Phase 2+ 可由 Agent 自动校验）

## 流程强制度

**当前阶段（Phase 0–1）采用 honor system**：

- 不上 CI 强制检查（避免过度工程）
- PR 模板硬编码 spec 链接字段，忘写会被模板自查提醒
- 分支保护规则仅要求 CI 测试通过

**Phase 2+ 可升级**：
- lint 规则扫描 commit message 中的 `spec: FEAT-XXX` 标签
- Agent 自动比对 PR 改动与 spec Requirement 编号
- `done` 前自动检查 docs/ 是否同步

## 协议/约束类 spec 的特殊性

根目录下的协议与强制规范（如 `multi-agent-design-constraints.md`、`provider-protocol.md`）不走 feature 流程，但：

- 变更需用户审阅
- 所有引用到它们的 feature/bug spec 都应在 `related` 中链接
- 协议变更视为 breaking change，触发所有引用 spec 的重评估

## 快速开始（给当前 phase 的新工作）

```bash
# 1. 复制模板
cp specs/_template-feature.md specs/sidecar/FEAT-NNN-<slug>.md

# 2. 填充 frontmatter + 所有 section
# 3. 提交 draft 让用户确认
git add specs/sidecar/FEAT-NNN-*.md
git commit -m "spec(draft): FEAT-NNN <title>"

# 4. 讨论 → Open Questions 清零 → 用户点头 → 改 status 为 approved
# 5. 开分支开工
git checkout -b feat/FEAT-NNN-<slug>
```

## 历史：前端与 Dashboard 开发规范

> 2026-05-08：本节属于旧 Haro workbench / Dashboard 路线的历史规范。后续 Haro sidecar 不再把 Web Dashboard 作为主产品面扩展；如需新增可视化能力，优先通过 AgentDock 现有 Web/PWA 或 AgentDock session + MCP tool 交互承载。

Dashboard（Web 管理后台）作为 Haro 的**呈现层**，其需求规划遵循**后端先行、前端跟进**的分层模式。这一模式确保核心能力先在服务端沉淀，前端在此基础上做可视化适配，避免"前端等接口"或"后端适配 UI"的双向耦合。

### 原则：后端先行，前端跟进

| 场景 | 后端 FEAT | 前端跟进 |
|------|-----------|----------|
| **纯后端增强**（如优化 checkpoint 存储格式、重构 Provider 选择逻辑） | 独立后端 FEAT，不涉及前端 | Dashboard 系列无需同步规划 |
| **需要前端呈现的新能力**（如新增 Memory 查询维度、新增 Skills 元数据字段） | 后端 FEAT 中写明 **"Dashboard 需新增 XX 页面/组件"** | 由后续 Dashboard FEAT（015~019 系列）承接实现 |
| **交互型新功能**（如新的 Agent 交互模式、新的 team 编排模式） | 同一个 FEAT 中**同步定义**前后端端到端需求 | 实现可分先后：后端先行开发，前端在独立分支跟进 |

### Dashboard FEAT 编号规则

Dashboard 第一批功能使用 `FEAT-015`~`FEAT-019`。后续全局编号仍按整体优先级递增，可插入非 Dashboard 任务：

| 编号 | 范围 | 说明 |
|------|------|------|
| FEAT-015 | Foundation | 前端包 + Hono 后端骨架 + CLI 命令 |
| FEAT-016 | Agent Interaction | Chat + Sessions + WebSocket |
| FEAT-017 | System Management | Status + Settings（仅内嵌 Channel Health；不拥有独立 `/api/v1/channels*`）；2026-04-25 done，真实 provider 连通测试跳过 |
| FEAT-018 | Orchestration Debugger | Dispatch + workflow graph + checkpoint timeline + stalled branch debug（从原大 spec 拆分） |
| FEAT-019 | Channel & Agent Management | Channel/Gateway/Agent YAML 管理；FEAT-019 独占独立 `/api/v1/channels*` contract |

FEAT-020 已作为非 Dashboard 插队任务登记：Codex runtime `shit` skill。

#### FEAT-018 当前边界（Orchestration Debugger）

FEAT-018 只负责 **workflow 编排调试的只读可观测面**，避免把后续 Dashboard 页面重新塞回同一个大 spec：

- **拥有的 REST contract**：`/api/v1/workflows*`，用于 workflow list/detail/checkpoints read model。
- **必须展示的核心对象**：fork-and-merge workflow graph、checkpoint timeline、branch ledger、merge envelope、leafSessionRefs、rawContextRefs、stalled branch / blocked reason。
- **只读读取 FEAT-023**：预算与权限状态来自 FEAT-023 已提供的 `/api/v1/guard/workflows*` read model；FEAT-018 只聚合/展示 summary，不重复实现策略引擎。
- **不得新增或注册**：`/api/v1/memory*`、`/api/v1/skills*`、`/api/v1/providers*`。这些范围分别由 FEAT-024 / FEAT-025 或后续 spec 承接。
- **不得提供写操作**：不在 Dashboard 中直接 approve/continue/stop、重跑 branch、跳过 branch 或修改编排策略。

2026-04-25 路线调整新增：

| 编号 | 范围 | 说明 |
|------|------|------|
| FEAT-022 | Evolution Asset Registry | EvoMap 风格资产封装：skill/prompt/rule/archive 的版本与审计 |
| FEAT-023 | Permission & Token Budget Guard | Mercury 风格操作权限分级 + workflow/branch token 预算 |
| FEAT-024 | Web Dashboard Knowledge & Skills | 从 FEAT-018 拆分：历史 Knowledge/Skills 页面、asset 追溯 |
| FEAT-025 | Web Dashboard Runtime Logs & Provider Monitoring | 从 FEAT-018 拆分：Session events、provider fallback、provider/token 统计、Monitor |
| FEAT-026 | Provider Onboarding Wizard | Hermes 风格 `haro provider` 引导配置、model 选择、secretRef 与 provider doctor |
| FEAT-027 | Guided Setup & Doctor Remediation | OpenClaw/Hermes 风格 `haro setup` 从零引导、`haro doctor` 结构化修复建议 |
| FEAT-028 | Web Dashboard Product Maturity | KeyClaw 风格本地多用户、统一服务端分页、中文本地化与角色化操作 |
| FEAT-029 | Codex ChatGPT 订阅认证 | 让 Codex 复用官方 ChatGPT 登录（device-auth），不自实现 OAuth |
| FEAT-030 | Dashboard ChatGPT 认证 UI | FEAT-029 的 Dashboard 可视化与 terminal login bridge（draft） |

2026-05-01 路线重排新增（详见 [`docs/planning/archive/redesign-2026-05-01.md`](../docs/planning/archive/redesign-2026-05-01.md)）：

**Phase 1.5 — 自用底座补完**（specs/phase-1.5/）：

| 编号 | 范围 | 说明 |
|------|------|------|
| FEAT-031 | Web Channel | 浏览器作为 IM channel（对话 / 历史 / 文件），与飞书 / Telegram 同等公民 |
| FEAT-032 | MCP 工具层 | 历史内置 MCP server；sidecar 口径下 memory 工具由 AgentDock 提供 |
| FEAT-033 | Cron 任务最小版 | cron + 一次性，复用现有 session 上下文（done 2026-05-06；hermes-agent 风格 `tick()` + 三触发源 + inflight registry 30s graceful cancel） |
| FEAT-034 | 流式 UX 升级 | thinking 折叠 / tool timeline / Hook 状态 / GFM / lightbox（done 2026-05-07） |
| FEAT-038 | Web API 解耦 | 新建 `packages/web-api`，从 CLI 剥离；hermes-web-ui 风格前后端解耦 |
| FEAT-039 | CLI 等价补完 | chat / session / agent / logs / workflow / budget / user / skill / config 命令族；memory CLI 为历史兼容 |

**历史 Phase 2.0 / Phase 2.5 规划**：已由 `specs/sidecar/FEAT-043` 到 `FEAT-049` 替代并删除，避免继续误导到 Haro 自建 workbench 路线。

2026-04-25 后续路线重排原则：

1. **先补首配闭环**：FEAT-026/027 优先于新增复杂能力，确保用户能从空环境配置 provider、全局命令、systemd/web 服务并跑通 smoke test。
2. **再补智能底座**：FEAT-022/023 建立资产审计、权限和预算；Memory 改由 AgentDock 侧提供，Haro 不再维护自有 Memory Fabric。
3. **最后补管理面成熟度**：FEAT-028 与 FEAT-024/025 共同把 Dashboard 从调试壳升级为可多人使用、可分页浏览、中文可读的控制面。

2026-05-08 sidecar 重排原则：

1. **AgentDock kernel 优先**：Haro 不再自建 workbench/runtime，只作为 AgentDock sidecar 接入。
2. **Contract 先行**：先落 `@haro/agentdock-contract`，再做 MCP / scheduled CLI / apply。
3. **先只读后可写**：observe/propose/validate/query 先落地；L0/L1 apply 必须后置到 validation + human approval + snapshot + rollback gate。
4. **删除旧未来规划**：旧 Phase 2.0 / 2.5 spec 已删除，后续以 `specs/sidecar/` 为准。

### 规划 checklist（后端 FEAT 起草时自检）

后端 FEAT 的作者在起草时必须回答：

1. **是否有新的数据产出需要 Dashboard 展示？** → 在 FEAT 的 `Goals` 或 `Non-Goals` 中明确说明，并在 `related` 字段引用待创建的 Dashboard FEAT。
2. **是否有新的配置项需要 Dashboard 编辑？** → 同上。
3. **是否有新的 Agent 交互模式？** → 在同一个 FEAT 中同步定义前端交互流程（如新的 WS 消息类型、新的页面状态）。

### 前端跟进 checklist（Dashboard FEAT 起草时自检）

Dashboard FEAT 的作者在起草时必须回答：

1. **本 FEAT 依赖哪些后端能力？** → 在 `related` 中引用已实现的后端 FEAT。
2. **后端 API 是否已就绪？** → 若后端 API 尚未实现，必须在 `Open Questions` 中标注阻塞项。
3. **是否有仅前端独立的改进？** → 如 UI 主题优化、布局重构，可作为独立 Dashboard FEAT。

## 参考

- [Feature 模板](./_template-feature.md)
- [Defect 模板](./_template-defect.md)
- [PR 模板](../.github/PULL_REQUEST_TEMPLATE.md)
- [多 Agent 设计约束](./multi-agent-design-constraints.md)
- [路线图](../roadmap/phases.md)（sidecar-era Phase A–G）
