---
id: FEAT-011
title: 手动 eat / shit（代谢命令 + 归档回滚）
status: approved
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-19
related:
  - ../evolution-metabolism.md
  - ./FEAT-010-skills-subsystem.md
  - ./FEAT-007-memory-fabric-independent.md
  - ../../roadmap/phases.md#p0-11手动-eat--shit
---

# 手动 eat / shit

## 1. Context / 背景

Haro 的进化代谢由 eat（摄入）+ shit（排出）两个 skill 构成。Phase 0 仅交付**手动触发**：用户显式执行命令 / slash。自动触发（Evolution Engine 调度）推迟到 Phase 2。本 spec 交付两个 skill 的 CLI 命令、执行流程、提案/归档回滚机制。eat 逻辑复用 `/home/heyucong.bebop/SKILL.md` 的思路，但按 Haro 的落地边界收窄：Phase 0 直接写 Memory，其他 sink 先生成 proposal bundle。

## 2. Goals / 目标

- G1: `haro eat <url|path|text>` 命令可用
- G2: `haro shit --scope <...> [--days N] [--dry-run]` 命令可用
- G3: eat proposal bundle、shit 归档 + 回滚机制落地
- G4: 两个命令都走 FEAT-010 的 skill 触发路径（CLI 层只做参数转发）

## 3. Non-Goals / 不做的事

- 不做 eat 的互联网主动抓取（只在用户提供 URL 时访问）
- 不做 shit 自动触发（Evolution Engine 集成在 Phase 2）
- 不做 Critic Agent 的自动对抗审查（Phase 2 再引入）
- 不做跨机器 / 分布式归档

## 4. Requirements / 需求项

### eat

- R1: 命令 `haro eat <input>`；`<input>` 可为 HTTP(S) URL / GitHub URL / 本地路径 / 纯文本
- R2: 执行流程严格按 [evolution-metabolism.md 的 eat 规范](../evolution-metabolism.md#eat--摄入规范) 四步：获取 → 分析 → 决策 → 输出
- R3: 包含质量门槛（8 条拒绝条件）+ 四问验证
- R4: 写入前必须预览 + 用户确认；支持 `--yes` 跳过确认（默认不跳过）
- R5: 分桶决策：
  - `memory`：直接写入 FEAT-007 `MemoryFabric`
  - `claude/rules/skills`：写入 `~/.haro/archive/eat-proposals/<timestamp>/` proposal bundle，不自动生效
  - `reject`：输出拒绝原因
- R6: 防膨胀检查：proposal bundle 中 `claude/` 单文件 ≤ 200 行、`rules/` 单文件 < 100 行、`skills/` 的 `SKILL.md` < 500 行；超限时只生成拆分建议，不落盘
- R7: URL fetcher 仅支持 `text/html` / `text/plain` / `text/markdown` / GitHub README 类文本内容；未知二进制内容直接拒绝
- R8: GitHub repo URL 默认只读取 `README` + 顶层说明文件；`--deep` 时才额外读取 `docs/` 与精选源码入口

### shit

- R9: 命令 `haro shit --scope <rules|skills|mcp|memory|all> [--days N] [--dry-run]`；默认 `--days 90 --scope all`
- R10: 执行流程严格按 [evolution-metabolism.md 的 shit 规范](../evolution-metabolism.md#shit--排出规范) 五步：扫描 → 评估 → 预览 → 用户确认 → 执行
- R11: 防误删白名单：预装 skill、`specs/` 下所有强制规范、`memory/platform/index.md`、带 `@core` 标注的 rule 文件、未 promote 的 eat proposal bundle
- R12: 归档位置：`~/.haro/archive/shit-<timestamp>/` + `manifest.json`（含回滚步骤）
- R13: `haro shit rollback <archive-id>` 支持整包回滚；`--item <path>` 支持单项回滚
- R14: 风险等级：low / medium / high；high 项必须显式 `--confirm-high` 或勾选确认才能执行
- R15: 被取代判定在 Phase 0 只允许使用**保守启发式**（名称相似、更新时间更晚、usage=0 等）；不得做无证据的语义自动删除

### 通用

- R16: 两个命令内部均通过 FEAT-010 的 Skills 机制触发（eat / shit skill），CLI 只是参数桥接
- R17: 命令失败时不影响系统状态；eat 失败时不留脏 proposal bundle，shit 失败时回滚任何已归档项
- R18: Phase 0 不做 archive 自动清理；若 `~/.haro/archive` 超过配置阈值，仅给 warning，不自动删除最老归档

## 5. Design / 设计要点

**eat 的输入类型识别**

```
if /^https?:\/\// → URL fetcher
else if looksLikeGitHubRepoUrl(input) → GitHub loader
else if fs.existsSync(input) → Local file / dir
else if input.length > 256 || hasNewlines → Plain text
else → 提示二义性，要求 --as url|path|text
```

**proposal bundle 结构**

```
~/.haro/archive/eat-proposals/<timestamp>/
├── manifest.json
├── memory-preview.md
├── claude/
├── rules/
└── skills/
```

**shit 的必要性评估输入**

- `~/.haro/skills/usage.sqlite::skill_usage`
- `~/.haro/haro.db::component_usage`
- 文件系统元数据（mtime / 是否仍被配置引用）

## 6. Acceptance Criteria / 验收标准

### eat

- AC1: `haro eat https://example.com/article` 走完四步后：memory 类候选被写入 MemoryFabric，rules/skills/claude 类候选进入 proposal bundle，且 manifest 完整（对应 R1~R6）
- AC2: 故意给一个已被 Claude/Haro 通用知识覆盖的内容（如“Python 基础语法”），eat 在质量门槛阶段拒绝并给出理由（对应 R3）
- AC3: 故意让 eat 建议写入 180 行的 rule 文件时，防膨胀检查触发拆分建议且**不**落 proposal 文件（对应 R6）
- AC4: `haro eat "短文本"` 不加 `--as` 时提示二义性退出（对应 R1）
- AC5: GitHub repo URL 默认只读取 README；加 `--deep` 后才扩大到 `docs/`/入口源码（对应 R8）

### shit

- AC6: 设置 `--days 1` 在全新安装（所有组件 `use_count = 0`）环境运行，全部非预装组件进入候选；预装 skill 与未 promote proposal bundle 不出现在候选（对应 R9、R11）
- AC7: `haro shit --dry-run` 打印候选清单但不归档任何文件（对应 R9、R10）
- AC8: 实际执行后，候选项移到 `~/.haro/archive/shit-<ts>/`，原位置不再存在；`manifest.json` 写入回滚步骤（对应 R12）
- AC9: `haro shit rollback <id>` 恢复所有归档项到原位（对应 R13）
- AC10: high 风险项（如删除一个被 Agent 配置引用的 skill）默认不勾选，需 `--confirm-high`（对应 R14）
- AC11: shit 过程中故意模拟写失败，已归档项自动回滚，用户看到错误但状态一致（对应 R17）

### 通用

- AC12: `haro eat / haro shit` 的命令实现内部调用 `SkillRuntime.invoke('eat', args)` / `.invoke('shit', args)`，不在 CLI 层写业务逻辑（对应 R16）

## 7. Test Plan / 测试计划

- 单元测试：
  - `eat-quality-gate.test.ts` — 8 条拒绝条件（AC2）
  - `eat-input-detection.test.ts` — URL/path/text/GitHub 识别（AC4）
  - `proposal-bundle.test.ts` — bundle 结构与尺寸保护（AC1、AC3）
  - `shit-scan.test.ts` — 使用统计 → 候选清单
  - `shit-whitelist.test.ts` — 白名单保护（AC6）
  - `archive-manifest.test.ts` — manifest 结构 + 回滚步骤
- 集成测试：
  - `eat-to-memory.e2e.test.ts` — 从 URL 到 Memory + proposal bundle（AC1）
  - `shit-roundtrip.e2e.test.ts` — 扫描 → 归档 → 回滚（AC8、AC9）
  - `shit-failure-recovery.test.ts` — AC11
- 手动验证：
  - AC3 防膨胀行为
  - AC10 交互体验

## 8. Open Questions / 待定问题

全部已关闭（见 Changelog 2026-04-19 决策条）。

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
- 2026-04-19: whiteParachute — 关闭 Open Questions → approved
  - Q1 → Phase 0 不引入通用 web-content-fetcher；eat 内部使用最小文本 fetcher，未知二进制内容直接拒绝
  - Q2 → archive 不自动清理；超过阈值仅 warning，避免 silent data loss
  - Q3 → 被取代判定只允许保守启发式 + 人工确认，不做无证据语义删除
  - Q4 → GitHub repo 默认只读 README/说明；`--deep` 才扩大读取范围
  - Q5 → skills 不直接安装到 active 目录，先生成 proposal bundle，由用户后续 install/promote
