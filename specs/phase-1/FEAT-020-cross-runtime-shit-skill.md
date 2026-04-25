---
id: FEAT-020
title: 跨运行时 shit skill（Codex / Claude Code）
status: approved
phase: phase-1
owner: whiteParachute
created: 2026-04-25
updated: 2026-04-25
related:
  - ../phase-0/FEAT-010-skills-subsystem.md
  - ../phase-0/FEAT-011-manual-eat-shit.md
  - ../evolution-metabolism.md
  - ../design-principles.md
  - ../multi-agent-design-constraints.md
  - ../../docs/modules/skills-system.md
---

# 跨运行时 shit skill（Codex / Claude Code）

## 1. Context / 背景

FEAT-011 已交付 Haro 内部的手动 `eat / shit` 代谢命令：`haro shit` 支持扫描、dry-run、归档、回滚和 high-risk 显式确认。`packages/skills/resources/preinstalled/shit/SKILL.md` 也已经作为 Haro 预装 skill 存在，但它目前只是极薄的 prompt 描述，不能直接承担 Codex / Claude Code 的可用工作流。

当前实际缺口是外部 agent runtime 的 skill surface 不完整：本地 `$CODEX_HOME/skills` 与 `$CLAUDE_HOME/skills` 已有 `eat`，但没有 `shit`。FEAT-020 明确 `shit` 必须对标 `eat`：二者是同一套代谢机制的输入/输出两端，都应以原生 `SKILL.md` 形式存在于 Codex 与 Claude Code 中。只提供 `eat` 会让知识摄入能力可用、代谢清理能力不可用，违背 [design-principles.md](../design-principles.md) 中 P2「metabolism over accumulation」、P5「capability-full / context-minimal」和 P6「validation loop」。

本 spec 插入为 FEAT-020，优先于后续 dashboard/channel 扩展。目标不是重写 FEAT-011 的清理算法，而是把现有 Haro `shit` 能力包装成一个 Codex 与 Claude Code 都能识别、安装和安全执行的 `SKILL.md`。

## 2. Goals / 目标

- G1: 提供一个 canonical `shit` skill 源，与既有 `eat` skill 对称，兼容 Codex skills 与 Claude Code skills 的 `SKILL.md` + frontmatter 格式。
- G2: `shit` skill 在 Codex 和 Claude Code 中都能被显式调用，并默认执行安全的 dry-run / review 流程。
- G3: `shit` skill 复用 FEAT-011 的 Haro CLI / SkillsManager 能力，不在 skill 文档中复制清理算法。
- G4: 安装或同步流程能把同一份 `shit` skill 发布到 `$CODEX_HOME/skills/shit` 与 `$CLAUDE_HOME/skills/shit`，避免两套 runtime 漂移。
- G5: 执行、high-risk 清理和 rollback 都有明确的人类确认、审计和测试覆盖。

## 3. Non-Goals / 不做的事

- 不修改 `runShit` 的候选扫描、风险分级、归档或回滚核心算法；这些仍归 FEAT-011 边界所有。
- 不引入自动触发的 shit 调度；自动代谢仍延后到 Evolution Engine 阶段。
- 不让 Codex / Claude Code skill 直接执行 `rm`、`unlink` 或自行移动用户文件。
- 不实现跨机器、分布式或多用户共享的 skills 清理。
- 不把 `shit` 泛化为任意 repo cleanup / refactor 工具；本次只处理 Haro skills/rules/mcp/memory 代谢边界。

## 4. Requirements / 需求项

- R1: 仓库内必须有一份 canonical `shit/SKILL.md`，其 frontmatter 能被 Codex 和 Claude Code 识别；`name` 必须为 `shit`，description 必须说明它是安全清理/归档 Haro skills 与规则的工作流。
- R1a: `shit` skill 的跨运行时发布策略必须对标 `eat`：如果 `eat` 被安装到 Codex / Claude Code，则 `shit` 也应通过同一同步路径安装到对应 runtime，避免代谢能力只进不出。
- R2: `shit/SKILL.md` 必须写清执行协议：先运行 `haro shit --dry-run` 获取候选，再由用户确认后才允许执行非 dry-run。
- R3: `shit/SKILL.md` 必须声明禁止直接删除文件；所有归档、恢复和状态变更必须通过 `haro shit` / `haro shit rollback` 或对应 Haro API 完成。
- R4: `shit/SKILL.md` 必须覆盖 scope、days、dry-run、confirm-high、rollback 的用法，并给出 Codex / Claude Code 均可执行的命令形态。
- R5: 安装/同步机制必须能把 canonical skill 复制到 `$CODEX_HOME/skills/shit/SKILL.md` 和 `$CLAUDE_HOME/skills/shit/SKILL.md`；测试中必须使用临时 home，不写真实用户目录。
- R6: 同步机制必须检测已存在但内容不同的目标 skill：默认不静默覆盖，必须输出差异或备份策略。
- R7: 当当前环境找不到 `haro` CLI 或 Haro project home 时，`shit` skill 必须拒绝执行破坏性操作，只输出人工检查清单和恢复建议。
- R8: high-risk 候选必须要求显式 `--confirm-high` 或等价确认；skill 不得替用户推断确认。
- R9: rollback 必须是一等流程：skill 文档、同步测试和手动验证步骤都必须覆盖 `haro shit rollback <archive-id>`。
- R10: 文档必须说明该 skill 是 FEAT-011 的跨运行时包装层，不改变 Haro Runner、Provider 或 Agent 核心执行语义。

## 5. Design / 设计要点

### 5.1 Canonical source

继续使用 Haro repo 内的预装 skill 作为 canonical source：

```text
packages/skills/resources/preinstalled/shit/
├── SKILL.md
├── LICENSE
└── NOTICE
```

本次应把现有极简 `SKILL.md` 扩展为完整 workflow 文档。它需要保持 Claude Code 兼容的最小 frontmatter，同时避免使用只属于某一 runtime 的私有字段。

`shit` 与 `eat` 是一组对称 skill：`eat` 负责把外部知识转为可复用资产，`shit` 负责把过期、重复、低价值或风险过高的资产移出活跃上下文。实现与发布时不得把 `shit` 视为普通 cleanup helper；它必须作为代谢闭环的一半，跟随 `eat` 一起进入 Codex / Claude Code 的 skill surface。

### 5.2 Runtime installation / sync

新增或扩展一个同步入口，逻辑上执行：

```text
canonical preinstalled/shit
  -> $CODEX_HOME/skills/shit
  -> $CLAUDE_HOME/skills/shit
```

建议实现为 Haro CLI 的轻量命令或 setup 子步骤，例如：

```bash
haro skills sync-runtime --skill shit --runtime codex,claude
```

命令默认只同步 `shit` 及其必要 metadata。测试环境用临时目录覆盖 `CODEX_HOME` / `CLAUDE_HOME`，避免污染真实 `~/.codex` 和 `~/.claude`。

### 5.3 Skill execution contract

Codex / Claude Code 加载 `shit` skill 后，执行状态机固定为：

```text
request
  -> environment check
  -> dry-run scan
  -> present candidates and risk
  -> explicit user confirmation
  -> haro shit execute
  -> archive manifest review
  -> optional rollback
```

关键 invariant：

- dry-run 是默认动作。
- 没有用户确认时不得执行非 dry-run。
- high-risk 项没有 `--confirm-high` 时不得执行。
- skill 文档不得包含直接删除命令。
- Haro CLI 不可用时只能给出检查清单，不能自行实现清理。

### 5.4 Boundary with FEAT-011

FEAT-020 只新增跨运行时 skill packaging 和安装同步能力。`runShit`、`SkillsManager.invokeCommandSkill('shit')`、archive manifest 和 rollback 的业务语义仍由 FEAT-011 负责。若实现时发现 FEAT-011 语义不足，应先补 FEAT-011 的缺陷 spec，不在 FEAT-020 中扩张核心清理算法。

### 5.5 Multi-agent constraints

本 spec 不引入 team workflow，也不改变多 Agent 拓扑。`multi-agent-design-constraints.md` 在本 spec 中作为边界约束引用：如果后续让多个 agent 并行审查候选项，必须传递原始候选清单与 manifest，而不是摘要；validator 只能否定风险，不能直接批准删除。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定 repo 的 canonical `packages/skills/resources/preinstalled/shit/SKILL.md`，当运行 frontmatter 校验时，Codex / Claude Code 所需的 `name` 与 `description` 字段均存在且 `name === "shit"`。（对应 R1）
- AC1a: 给定 `eat` 已同步到 Codex / Claude Code runtime，当运行同一同步入口时，`shit` 也应被同步到相同 runtime，且不能出现只安装 `eat` 不安装 `shit` 的默认路径。（对应 R1a）
- AC2: 给定用户在 Codex 或 Claude Code 中显式调用 `shit`，当 skill 被加载时，第一步可观察建议必须是 `haro shit --dry-run` 或等价 dry-run API，而不是直接执行清理。（对应 R2）
- AC3: 给定 `SKILL.md` 内容，当静态扫描 destructive command 时，不得出现直接 `rm`、`unlink`、`mv` 用户目标文件等绕过 Haro archive 的指令。（对应 R3）
- AC4: 给定 `CODEX_HOME` 与 `CLAUDE_HOME` 指向临时目录，当运行 runtime sync 时，应生成 `skills/shit/SKILL.md`、`LICENSE`、`NOTICE`，且内容与 canonical source 一致。（对应 R5）
- AC5: 给定目标 runtime 已存在内容不同的 `shit/SKILL.md`，当运行 runtime sync 且未传显式覆盖参数时，应拒绝静默覆盖并输出冲突说明或备份位置。（对应 R6）
- AC6: 给定测试环境中 `haro` CLI 不可用，当执行 `shit` skill 的破坏性路径时，应输出拒绝说明和人工检查清单，不应产生任何归档或删除副作用。（对应 R7）
- AC7: 给定 dry-run 结果包含 high-risk 候选，当用户未显式传 `--confirm-high` 时，执行路径应跳过 high-risk 项并提示确认要求。（对应 R8）
- AC8: 给定一次成功归档产生 archive id，当用户调用 rollback 流程时，skill 应指向 `haro shit rollback <archive-id>`，并要求展示 rollback 结果。（对应 R9）
- AC9: 给定 FEAT-020 实现 diff，当审查 Runner、Provider、AgentRunner 相关文件时，不应出现为支持 `shit` skill 而改变核心执行语义的修改。（对应 R10）

## 7. Test Plan / 测试计划

- 单元测试：
  - `shit-skill-frontmatter.test.ts`：校验 canonical `SKILL.md` 的 frontmatter、description 和跨 runtime 兼容性。（AC1）
  - `shit-skill-contract.test.ts`：静态校验 dry-run-first、no-direct-delete、high-risk-confirm、rollback 文案。（AC2、AC3、AC7、AC8）
- 集成测试：
  - `runtime-skill-sync.test.ts`：用临时 `CODEX_HOME` / `CLAUDE_HOME` 验证 `shit` skill 同步、checksum 一致、LICENSE/NOTICE 一并复制。（AC4）
  - `runtime-skill-sync-conflict.test.ts`：验证目标已存在且内容不同 时不会静默覆盖。（AC5）
  - `shit-skill-no-haro.test.ts`：模拟 `haro` 不在 PATH，确认 skill 的 destructive path 只输出拒绝和人工检查清单。（AC6）
- 回归测试：
  - 继续运行 `packages/skills/test/metabolism.test.ts`，确认 FEAT-011 的 dry-run、archive、rollback 行为不被包装层改坏。
  - 继续运行 `packages/skills/test/preinstall-expand.test.ts`，确认预装 skill 展开逻辑仍包含 `shit`。
- 手动验证：
  - 在临时 Codex home 安装后，确认 `/skills` 或等价 skill 列表可看到 `shit`。
  - 在临时 Claude Code home 安装后，确认 Claude Code 能发现 `shit`。
  - 手动执行一次 `haro shit --dry-run --scope skills --days 1`，确认只输出候选、不归档。

本 spec 不涉及 Web/前端用户路径，因此不要求 Playwright CLI 真实浏览器 E2E。

## 8. Open Questions / 待定问题

全部已关闭（见 Changelog 2026-04-25 approved 决策条）。

## 9. Changelog / 变更记录

- 2026-04-25: whiteParachute — 初稿，插入 FEAT-020，定义将 Haro 预装 `shit` 提升为 Codex / Claude Code 跨运行时 skill 的范围、边界、验收与测试计划。
- 2026-04-25: whiteParachute — approved
  - Q1 → runtime sync 入口先做独立 `haro skills sync-runtime` 能力，后续 setup/onboard 可调用它。
  - Q2 → 真实用户目录中已存在第三方 `shit` skill 时默认 fail-fast；只有显式 `--overwrite` 才允许覆盖，且实现应保留备份或冲突说明。
  - Q3 → Codex 与 Claude Code 使用同一份 `description` 和同一份 canonical `SKILL.md`，不做 runtime 分叉。
  - 设计确认：`shit` 对标 `eat`，二者作为代谢闭环的输入/输出两端，必须成对进入 Codex / Claude Code skill surface。
