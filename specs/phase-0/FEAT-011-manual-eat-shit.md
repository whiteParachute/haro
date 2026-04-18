---
id: FEAT-011
title: 手动 eat / shit（代谢命令 + 归档回滚）
status: draft
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-18
related:
  - ../evolution-metabolism.md
  - ./FEAT-010-skills-subsystem.md
  - ./FEAT-007-memory-fabric-independent.md
  - ../../roadmap/phases.md#p0-11手动-eat--shit
---

# 手动 eat / shit

## 1. Context / 背景

Haro 的进化代谢由 eat（摄入）+ shit（排出）两个 skill 构成。Phase 0 仅交付**手动触发**：用户显式执行命令 / slash。自动触发（Evolution Engine 调度）推迟到 Phase 2。本 spec 交付两个 skill 的 CLI 命令、执行流程、归档回滚机制。eat 逻辑复用 `/home/heyucong.bebop/SKILL.md`，shit 为 Haro 自研（设计见 [evolution-metabolism.md](../evolution-metabolism.md#shit--排出规范)）。

## 2. Goals / 目标

- G1: `haro eat <url|path|text>` 命令可用
- G2: `haro shit --scope <...> [--days N] [--dry-run]` 命令可用
- G3: shit 归档 + 回滚机制落地
- G4: 两个命令都走 FEAT-010 的 skill 触发路径（即 CLI 层只做参数转发，核心逻辑在 skill 内）

## 3. Non-Goals / 不做的事

- 不做 eat 的互联网主动抓取（只在用户提供 URL 时访问）
- 不做 shit 自动触发（Evolution Engine 集成在 Phase 2）
- 不做 Critic Agent 的对抗审查（shit 执行前的对抗审查推迟到 Phase 2）
- 不做跨机器 / 分布式归档

## 4. Requirements / 需求项

### eat

- R1: 命令 `haro eat <input>`；`<input>` 可为 HTTP(S) URL / 本地路径 / 纯文本（超过 256 字符视为文本，短字符串且无斜杠视为"请尝试作为路径"）
- R2: 执行流程严格按 [evolution-metabolism.md 的 eat 规范](../evolution-metabolism.md#eat--摄入规范) 四步：获取 → 分析 → 决策 → 输出
- R3: 包含质量门槛（8 条拒绝条件）+ 四问验证
- R4: 写入前必须预览 + 用户确认；支持 `--yes` 跳过确认（默认不跳过）
- R5: 分桶决策：CLAUDE.md / rules / skills / 拒绝；一次 eat 可能产生多个输出
- R6: 防膨胀检查：写入前校验 CLAUDE.md ≤ 200 行、rule 文件 < 100 行；Skill 创建提示调用 `skill-creator`（不内置）

### shit

- R7: 命令 `haro shit --scope <rules|skills|mcp|memory|all> [--days N] [--dry-run]`；默认 `--days 90 --scope all`
- R8: 执行流程严格按 [evolution-metabolism.md 的 shit 规范](../evolution-metabolism.md#shit--排出规范) 五步：扫描 → 评估 → 预览 → 用户确认 → 执行
- R9: 防误删白名单：预装 skill、`specs/` 下所有强制规范、`memory/platform/index.md`、带 `@core` 标注的 rule 文件
- R10: 归档位置：`~/.haro/archive/shit-<timestamp>/` + `manifest.json`（含回滚脚本）
- R11: `haro shit rollback <archive-id>` 支持整包回滚；`--item <path>` 支持单项回滚
- R12: 风险等级：low / medium / high；high 项必须显式 `--confirm-high` 或勾选确认才能执行

### 通用

- R13: 两个命令内部均通过 FEAT-010 的 Skills 机制触发（eat / shit skill），CLI 只是参数桥接
- R14: 命令失败时不影响系统状态；eat 失败时不留脏文件，shit 失败时回滚任何已归档项

## 5. Design / 设计要点

**eat 的"输入类型识别"**

```
if /^https?:\/\// → URL fetcher
else if fs.existsSync(input) → Local file / dir
else if input.match(/^github\.com\//) → git clone --depth 1
else if input.length > 256 || hasNewlines → Plain text
else → 提示二义性，要求 --as url|path|text
```

**shit 的"必要性评估"输入**

直接读 FEAT-007 + FEAT-010 维护的使用统计：
- `~/.haro/skills/usage.sqlite::skill_usage`
- `~/.haro/haro.db::component_usage`（统一的 rule/mcp/memory 使用统计）

**manifest.json 结构**（见 evolution-metabolism.md 的示例）

**回滚**

```bash
haro shit rollback <archive-id>           # 读 manifest.json，逆序 mv 回原位
haro shit rollback <archive-id> --item <originalPath>  # 单项
```

## 6. Acceptance Criteria / 验收标准

### eat

- AC1: `haro eat https://example.com/article`，走完四步，用户选择"全部执行"后：对应文件写入且 `updated` 字段更新（对应 R1~R5）
- AC2: 故意给一个已被 Claude 通用知识覆盖的内容（如"Python 基础语法"），eat 在质量门槛阶段拒绝并给出理由（对应 R3）
- AC3: 故意让 eat 建议写入 180 行的 rule 文件，防膨胀检查触发拆分建议（对应 R6）
- AC4: `haro eat "短文本"` 不加 `--as` 时提示二义性退出（对应 R1）

### shit

- AC5: 设置 `--days 1` 在全新安装（所有组件 `use_count = 0`）环境运行，全部非预装组件进入候选；预装 skill 不出现在候选（对应 R7、R9）
- AC6: `haro shit --dry-run` 打印候选清单但不归档任何文件（对应 R7）
- AC7: 实际执行后，候选项移到 `~/.haro/archive/shit-<ts>/`，原位置不再存在；`manifest.json` 写入回滚指令（对应 R10）
- AC8: `haro shit rollback <id>` 恢复所有归档项到原位（对应 R11）
- AC9: 标记为 high 风险的项（如删除一个被 Agent 配置 `tools:` 引用的 skill）默认不勾选，需 `--confirm-high`（对应 R12）
- AC10: shit 过程中故意模拟写失败，已归档项自动回滚，用户看到错误但状态一致（对应 R14）

### 通用

- AC11: `haro eat / haro shit` 的命令实现内部调用 `SkillRuntime.invoke('eat', args)` / `.invoke('shit', args)`，不在 CLI 层写业务逻辑（对应 R13；代码评审）

## 7. Test Plan / 测试计划

- 单元测试：
  - `eat-quality-gate.test.ts` — 8 条拒绝条件（AC2）
  - `eat-input-detection.test.ts` — URL/path/text 识别（AC4）
  - `shit-scan.test.ts` — 使用统计 → 候选清单
  - `shit-whitelist.test.ts` — 白名单保护（AC5）
  - `archive-manifest.test.ts` — manifest 结构 + 回滚脚本
- 集成测试：
  - `eat-to-rules.e2e.test.ts` — 从 URL 到 rule 文件落地（AC1）
  - `shit-roundtrip.e2e.test.ts` — 扫描 → 归档 → 回滚（AC7、AC8）
  - `shit-failure-recovery.test.ts` — AC10
- 手动验证：
  - AC3 防膨胀行为
  - AC9 交互体验

## 8. Open Questions / 待定问题

- Q1: eat 访问 URL 时的 fetcher 策略与 Phase 0 的 CLI 能力：是否复用 web-content-fetcher？
- Q2: 归档位置 `~/.haro/archive/` 是否考虑大小上限？超过后自动清理最老归档？
- Q3: shit 的"被取代"判定需要语义比较，Phase 0 只做"名称前缀相似 + 时间晚"的粗启发式，是否可接受？
- Q4: `haro eat` 对 GitHub repo 的分析深度：只读 README，还是读 README + src/?
- Q5: eat 写入到 skills/ 时是否自动构造 skill scaffold，还是仅建议调用 skill-creator？当前倾向后者

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
