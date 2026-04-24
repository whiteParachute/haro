---
id: FEAT-017
title: Web Dashboard — System Management（系统管理）
status: approved
phase: phase-1
owner: whiteParachute
created: 2026-04-23
updated: 2026-04-24
related:
  - ../design-principles.md
  - ./FEAT-015-web-dashboard-foundation.md
  - ./FEAT-016-web-dashboard-agent-interaction.md
  - ../../docs/modules/agent-runtime.md
---

# Web Dashboard — System Management（系统管理）

## 1. Context / 背景

FEAT-015 已完成 Dashboard 基础框架，FEAT-016 已完成 Agent 交互层（Chat + Sessions + WebSocket）。本 FEAT 实现**系统管理页面**——面向运维和配置管理的仪表盘功能，对应 CLI 的 `haro doctor`、`haro config`、`haro channel` 等命令的 Web 化呈现。

系统管理层的核心价值：把原本只能在终端查看的文本报告，转化为可交互的可视化界面；把 YAML 配置的查看和修改，从命令行迁移到表单式编辑器。

2026-04-24 W1 边界澄清：本 FEAT 只覆盖 Status/Settings 中的 Channel **只读摘要与基础健康检查**，用于系统状态诊断；Channel 生命周期操作（enable/disable/setup/remove）、独立 ChannelPage、独立 `/api/v1/channels*` contract 与 Gateway 控制统一归属 FEAT-019，避免两个 approved specs 同时定义同一 REST contract。

## 2. Goals / 目标

- G1: 实现 StatusPage，展示 doctor 报告和系统状态（DB 统计、provider 健康、channel 状态）
- G2: 实现 SettingsPage，支持 YAML 配置的读取、编辑和保存
- G3: 后端提供 Status、Config 两大领域的 REST API；Status/Doctor response 内嵌 Channel Health 只读摘要，独立 `/api/v1/channels*` 由 FEAT-019 拥有
- G4: 遵循 P4（Steering 优先于 Implementing）原则——StatusPage 帮助用户做 steering 决策，SettingsPage 提供 guardrails 配置

## 3. Non-Goals / 不做的事

- 不实现 Chat、Sessions 等 Agent 交互页面（属于 FEAT-016）
- 不实现 Team Orchestrator 可视化（属于 FEAT-018）
- 不实现 Memory / Skills / Provider 统计页面（属于 FEAT-018）
- 不修改 `haro doctor` 或配置加载的核心逻辑
- 不提供"一键修复"按钮——StatusPage 是诊断展示，修复决策由用户或 Agent 做出
- 不提供 Channel 生命周期操作页面/API（enable/disable/setup/remove）、独立 `/api/v1/channels*` 读写 contract 或 Gateway 控制面板；这些操作性管理能力与 Channel 专属 API 属于 FEAT-019

## 4. Requirements / 需求项

- R1: REST API 覆盖 Status 领域：`GET /api/v1/status`（系统状态概览）、`GET /api/v1/doctor`（完整 doctor 报告）。
- R2: REST API 覆盖 Config 领域：`GET /api/v1/config`（合并后配置）、`PUT /api/v1/config`（更新配置，写入项目 `.haro/config.yaml`）、`GET /api/v1/config/sources`（配置来源列表）。
- R3: Channel Health 只读数据嵌入 Status/Config 领域：`GET /api/v1/status` 返回 `channels` 健康摘要（id、enabled、health、lastCheckedAt），`GET /api/v1/doctor` 的 `channels` 分组返回基础 doctor 结果，`GET /api/v1/config` / `GET /api/v1/config/sources` 只读展示 `channels.*` 配置与来源。FEAT-017 **不定义任何独立 `/api/v1/channels*` 端点**；`GET /api/v1/channels`、`GET /api/v1/channels/:id/doctor` 以及所有 mutation 均由 FEAT-019 拥有。
- R4: StatusPage 展示系统健康卡片网格：DB 连接状态、目录可写性、provider 健康、channel 状态、近期 session 统计。
- R5: StatusPage 展示 doctor 详细报告，按类别分组（文件系统、数据库、配置、provider、channel），问题项高亮标红。
- R6: SettingsPage 以表单方式展示当前配置，支持编辑常用字段（logging level、defaultAgent、taskTimeoutMs 等）。
- R7: SettingsPage 展示配置来源层级（CLI overrides → 项目级 → 全局级 → 默认值），明确每个字段的生效来源。
- R8: 配置保存前通过后端校验（复用 `loadConfig` 的 Zod schema），校验失败返回具体错误字段。
- R9: SettingsPage 默认只展示常用配置项，高级配置通过"展开高级选项"切换（P5 Progressive Disclosure）。

## 5. Design / 设计要点

### 5.1 新增后端文件

```
packages/cli/src/web/routes/
├── status.ts       # Status / doctor REST
├── config.ts       # Config 读写 REST
# 不新增 channels.ts；Channel Health 作为 status.ts / doctor response 的只读分组，独立 /api/v1/channels* 属于 FEAT-019
```

**Config 写入边界：**
`PUT /api/v1/config` 仅写入项目级 `.haro/config.yaml`，不修改全局配置或 CLI overrides。写入前通过 Zod schema 校验，校验失败返回 400 + 字段级错误信息。配置表单可以只读展示 `channels.*` 的生效来源与当前值，但不得通过本 FEAT 定义或调用独立 `/api/v1/channels*`；需要查看 Channel 专属详情、启停、删除、Doctor 或 Setup 时跳转到 FEAT-019 的 ChannelPage/API。

### 5.2 新增前端文件

```
packages/web/src/
├── stores/
│   ├── config.ts      # Config 状态管理
│   └── system.ts      # System status 状态管理
├── pages/
│   ├── StatusPage.tsx
│   └── SettingsPage.tsx
└── components/
    ├── status/
    │   ├── HealthCard.tsx
    │   ├── ProviderStatusGrid.tsx
    │   └── DoctorReport.tsx
    └── settings/
        ├── ConfigEditor.tsx
        └── ConfigSources.tsx
```

### 5.3 StatusPage 设计

**健康卡片网格：**
| 卡片 | 数据来源 | 状态展示 |
|------|----------|----------|
| 数据库 | `db` 连接测试 | 连接数、最近 checkpoint |
| 文件系统 | `fs` 可写检查 | 各目录可写状态 |
| Providers | `ProviderRegistry` | 各 provider 在线/离线 |
| Channels | `GET /api/v1/status` 的 `channels` 字段 + `GET /api/v1/doctor` 的 channels 分组 | 各 channel 启用状态、健康摘要、配置来源（只读） |
| Sessions | SQLite `sessions` 表 | 今日 session 数、成功率 |

**Doctor 报告：**
- 按类别分组：filesystem、database、config、providers、channels
- 每个问题项展示：severity（error/warn/info）、message、fix suggestion（只展示，不自动执行）
- 无问题时展示"所有检查通过"状态

### 5.4 SettingsPage 设计

**表单分区：**
- 常用配置：logging.level、defaultAgent、runtime.taskTimeoutMs
- 高级配置（折叠）：memory.path、channels.*、evolution.*；`channels.*` 在本 FEAT 中默认只读展示来源与当前值，生命周期操作归 FEAT-019
- 只读展示：配置来源层级（每个字段标注来自哪一层级）

**保存流程：**
1. 用户编辑表单
2. 点击保存 → 前端做字段级校验（类型、范围）
3. 发送 `PUT /api/v1/config` → 后端 Zod 校验
4. 成功 → 提示"配置已保存，对 CLI 立即生效"
5. 失败 → 展示具体错误字段

## 6. Acceptance Criteria / 验收标准

- AC1: StatusPage 加载后展示系统健康卡片网格，各卡片状态与 `haro doctor` 输出一致。
- AC2: StatusPage 的 doctor 报告按类别分组，问题项高亮标红，fix suggestion 只读展示。
- AC3: SettingsPage 正确读取并展示当前合并配置，每个字段标注生效来源层级。
- AC4: SettingsPage 可编辑常用配置并保存，保存后 `haro config` 命令显示更新后的值。
- AC5: 保存非法配置时，前端展示字段级错误提示，后端返回 400 不写入文件。
- AC6: Status/Settings 可只读列出所有 channel 的启用状态、健康摘要与配置来源，doctor 报告通过 `GET /api/v1/doctor` 的 channels 分组展示；本 FEAT 不出现 `/api/v1/channels*` 路由，也不出现 enable/disable/setup/remove 操作按钮或端点。

## 7. Test Plan / 测试计划

- 后端：Config 写入测试（合法/非法值）、doctor 报告格式化测试、Status/Doctor 内嵌 Channel Health 测试（确认不存在任何 `/api/v1/channels*` route）
- 前端：HealthCard 渲染测试、ConfigEditor 表单校验测试
- E2E：修改配置 → 验证 CLI 读取到新值 → 恢复原始配置

## 8. Open Questions / 待定问题

- ~~Q1: SettingsPage 是否提供 YAML 原始文本编辑模式（Monaco/CodeMirror）作为高级选项？~~ **决策：是。** 提供"高级模式"切换按钮，使用 CodeMirror 6 轻量版展示原始 YAML，保存前走同样的 Zod 校验流程。FEAT-019 的 AgentEditorPage 也复用同一 CodeMirror 组件。
- ~~Q2: doctor 报告的 fix suggestion 是否应该在 Dashboard 中提供"复制修复命令"按钮？~~ **决策：是。** 每个 fix suggestion 旁提供"复制命令"按钮（纯展示，不自动执行），方便用户粘贴到终端或 Agent Chat 中执行。

## 9. Changelog / 变更记录

- 2026-04-23: whiteParachute — 初稿 draft
  - 从原 FEAT-015 大 spec 中拆分出 System Management 子 FEAT
  - 聚焦 Status、Settings、Channels 三大页面及对应 REST API
- 2026-04-23: review fix — Open Questions 清零（高级模式用 CodeMirror 6、doctor 提供复制命令按钮）

- 2026-04-24: review fix — Breaking: 解决 W1，FEAT-017 Channel 范围收窄为 Status/Settings 的只读摘要与 `/status`/`/doctor` 内嵌健康分组；删除独立 `/api/v1/channels*` 与 enable/disable/setup/remove 合约，操作性 ChannelPage/Gateway 管理和 Channel 专属 API 统一交给 FEAT-019。按 `specs/README.md` 的 approved 合约变更规则，status 回退为 draft，待 owner 重新批准。
- 2026-04-24: owner re-approved — whiteParachute 批准 W1 边界修订，status: draft → approved。
