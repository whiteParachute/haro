---
id: FEAT-001
title: 项目脚手架（monorepo + 配置 + 日志 + SQLite）
status: done
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-18
related:
  - ../../roadmap/phases.md#p0-1项目脚手架
  - ../../docs/data-directory.md
---

# 项目脚手架

## 1. Context / 背景

Haro 是全新仓库，当前只有设计文档，没有任何代码骨架。Phase 0 的所有后续 feature（Provider / Runtime / Channel / Skills）都依赖一个可跑的 monorepo 骨架：统一的 TypeScript 构建、配置解析、日志输出、SQLite 数据库。本 spec 是 Phase 0 的起点，交付一个"什么业务都不做但能跑起来"的空壳工程。

## 2. Goals / 目标

- G1: 一个 monorepo 工程骨架能通过 `pnpm install && pnpm build` 全量构建
- G2: 全局配置有 Zod schema 约束，格式错误时启动期直接抛错并给出清晰定位
- G3: 结构化日志（pino）同时输出到 stdout 与 `~/.haro/logs/haro.log`
- G4: SQLite（WAL 模式）初始化脚本可重复执行且幂等

## 3. Non-Goals / 不做的事

- 不实现任何 Provider / Channel / Agent 逻辑（放在后续 FEAT-002 及以后）
- 不做 Zod schema 的热重载（Phase 1 再考虑）
- 不做 PostgreSQL 迁移（按需）
- 不做 CI workflow（放在后续 FEAT 内或独立 infra 任务）
- 不封装自研日志抽象层（直接用 pino）

## 4. Requirements / 需求项

- R1: monorepo 结构初始化 — 至少包含 `packages/core`、`packages/cli`、`packages/providers`，使用 pnpm workspaces
- R2: TypeScript 配置统一 — root 的 `tsconfig.base.json` 被各 package `extends`；配套 ESLint + Prettier 基本规则
- R3: 全局配置由 Zod schema 定义，支持从 `~/.haro/config.yaml` 与项目级 `.haro/config.yaml` 读取（项目级优先）
- R4: pino 日志按 [CLI 设计](../../docs/cli-design.md) 的双输出配置：stdout + `~/.haro/logs/haro.log`；日志级别由配置控制（默认 `info`）
- R5: SQLite 初始化脚本创建五张表（`sessions`、`session_events`、`workflow_checkpoints`、`provider_fallback_log`、`component_usage`），**开启 WAL 模式 + 启用 FTS5 扩展**（供 FEAT-007 做记忆全文检索）；脚本幂等（`CREATE TABLE IF NOT EXISTS`）
- R6: 首次运行时自动创建 `~/.haro/` 下所需目录（`agents/`、`skills/`、`channels/`、`memory/`、`logs/`、`evolution-context/`、`archive/`）
- R7: 核心模块不得出现任何 Provider/Channel 特判硬编码（对齐可插拔原则；lint 规则占位即可，具体规则在 FEAT-002/008 落实）

## 5. Design / 设计要点

**目录结构**
```
haro/
├── package.json              # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .eslintrc.cjs
├── .prettierrc
├── packages/
│   ├── core/                 # Runtime / Memory Fabric / Scenario Router 的核心逻辑（本 spec 仅占位）
│   ├── cli/                  # haro 可执行入口（本 spec 仅占位）
│   └── providers/            # Provider 子包集合（本 spec 仅占位）
└── scripts/
    └── init-db.ts            # SQLite 初始化
```

**配置加载（R3）**
- 顺序：CLI 参数 > 项目级 > 全局 > 内置默认
- Zod schema 导出自 `packages/core/src/config/schema.ts`
- 合并策略：deep merge（同 key 项目级覆盖全局级）

**日志（R4）**
- 使用 `pino` + `pino-pretty`（开发）+ **`pino-roll` transport**（10MB × 5 份轮转）
- 日志结构：`{time, level, module, ...fields}`
- **脱敏**：通过 pino 的 `redact` 配置屏蔽 `*.apiKey`、`*.botToken`、`*.appSecret`、`authorization` 等字段

**SQLite（R5）**
- 使用 `better-sqlite3`（同步、零依赖、适合 CLI）
- **启用 FTS5 扩展**（`better-sqlite3` 的官方预编译二进制默认带 FTS5），为 FEAT-007 做记忆全文检索准备
- 表结构按 `docs/data-directory.md` 的定义

**Lint 选型的 Phase 2 演进**

当前使用 ESLint + `@typescript-eslint/recommended` + `import/no-cycle`，理由是生态成熟、插件覆盖面大。OpenClaw 已采用 **oxlint**（Oxc 的 Rust 原生 linter，性能比 ESLint 高 50~100 倍）。Phase 2 由 [eat/shit 代谢机制](../evolution-metabolism.md) 评估是否迁移到 oxlint，评估维度：
- CI 耗时收益（若 Haro monorepo 达到 50+ 包规模再评估意义更大）
- 插件生态是否已覆盖当前依赖的规则（`import/no-cycle`、`@haro/no-provider-hardcode` 等）
- 迁移成本与回滚路径

## 6. Acceptance Criteria / 验收标准

- AC1: 在全新克隆的仓库中执行 `pnpm install && pnpm build`，无错误完成（对应 R1、R2）
- AC2: 故意在 `~/.haro/config.yaml` 填入非法字段（如 `providers.codex.defaultModel: 123`）启动时，进程立即退出并在 stderr 打印 Zod 校验路径 `providers.codex.defaultModel: Expected string, received number`（对应 R3）
- AC3: 运行 `node -e "require('./packages/core/dist/logger').info('hi')"` 后，能在 stdout 看到 JSON 日志，同时 `~/.haro/logs/haro.log` 追加相同一行（对应 R4）
- AC4: 连续两次执行 `scripts/init-db.ts`，第二次不产生错误且表结构不变（对应 R5）
- AC5: 全新环境（无 `~/.haro/`）首次运行 CLI 占位命令后，`~/.haro/` 下 7 个子目录均被创建（对应 R6）

## 7. Test Plan / 测试计划

- 单元测试：
  - `config/schema.test.ts` — Zod 合法/非法样本（AC2）
  - `logger.test.ts` — 输出路径（AC3）
  - `init-db.test.ts` — 幂等性（AC4）
  - `ensure-dirs.test.ts` — 目录创建（AC5）
- 集成测试：
  - `scripts/smoke.ts` — 完整跑一遍 install/build/init-db/dir 创建（AC1、AC5）
- 手动验证：
  - AC2 非法配置的错误信息可读性

## 8. Open Questions / 待定问题

全部已关闭（见 Changelog 2026-04-18 决策条）。

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
- 2026-04-18: whiteParachute — 关闭 Open Questions → approved
  - Q1 → pnpm（monorepo 性能 + 锁文件小；与 OpenClaw 一致）
  - Q2 → ESLint + `@typescript-eslint/recommended` + `import/no-cycle`；Phase 2 由 eat/shit 代谢评估迁移 oxlint
  - Q3 → `better-sqlite3` + 启用 FTS5
  - Q4 → `pino-roll` transport（10MB × 5 份）+ redact 脱敏
- 2026-04-18: whiteParachute — approved → done
  - 脚手架落地：`packages/{core,cli,providers}` + `scripts/{init-db,smoke}.ts`，`pnpm install && pnpm build && pnpm test && pnpm smoke` 全绿（25 测试覆盖 AC1–AC5）
  - AC 全部通过：AC1（dist artifacts 校验 + smoke）、AC2（bin/haro.js 非法配置非零退出 + stderr Zod 路径）、AC3（in-process dual-output + 独立子进程 `node -e` 对比）、AC4（初始化脚本幂等 + 数据保留）、AC5（7 个子目录首次创建 + 二次幂等）
  - 运行期默认 `rolling: true`（pino-roll 10MB × 5），模块级默认 logger 使用 sync multistream 以满足 AC3 的 `node -e` 确定性断言；`HARO_LOG_ROLLING=0/1` 环境变量显式覆盖
  - R7 以 ESLint `no-restricted-syntax` 占位规则预防 `providerId === <literal>` / `channelId === <literal>` 硬编码，后续由 FEAT-002 / FEAT-008 替换为专用 plugin
  - 经两轮 codex:review（a382c6187a167c276 + af79ab9ecae96d0dd）修完 F-001 ~ F-008 所有 MUST-FIX 项
