---
id: FEAT-001
title: 项目脚手架（monorepo + 配置 + 日志 + SQLite）
status: draft
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
- R5: SQLite 初始化脚本创建四张表（`sessions`、`session_events`、`workflow_checkpoints`、`provider_fallback_log`、`component_usage`），开启 WAL 模式；脚本幂等（`CREATE TABLE IF NOT EXISTS`）
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
- 使用 `pino` + `pino/file` + `pino-pretty`（开发）
- 日志结构：`{time, level, module, ...fields}`

**SQLite（R5）**
- 使用 `better-sqlite3`（同步、零依赖、适合 CLI）
- 表结构按 `docs/data-directory.md` 的定义

## 6. Acceptance Criteria / 验收标准

- AC1: 在全新克隆的仓库中执行 `pnpm install && pnpm build`，无错误完成（对应 R1、R2）
- AC2: 故意在 `~/.haro/config.yaml` 填入非法字段（如 `providers.claude.apiKey: 123`）启动时，进程立即退出并在 stderr 打印 Zod 校验路径 `providers.claude.apiKey: Expected string, received number`（对应 R3）
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

- Q1: 是否使用 pnpm？（也可以 npm workspaces 或 yarn v4；pnpm 的理由：monorepo 性能好、锁文件小）
- Q2: ESLint 规则是否直接用 `@typescript-eslint/recommended` + `import/no-cycle` 起步？
- Q3: `better-sqlite3` 还是 `sqlite3`（异步）？目前 CLI 场景倾向同步版；如果 Phase 1 有异步需求再换
- Q4: 日志文件轮转用 `pino/file` 原生还是 `rotating-file-stream`？MVP 阶段可以先不轮转

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
