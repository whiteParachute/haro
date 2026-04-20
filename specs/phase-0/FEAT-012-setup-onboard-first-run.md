---
id: FEAT-012
title: setup / onboard 首次引导闭环
status: done
phase: phase-0
owner: whiteParachute
created: 2026-04-20
updated: 2026-04-20
related:
  - ../../docs/reviews/install-ux-plan-2026-04-20.md
  - ../../docs/cli-design.md
  - ../../README.md
  - ./FEAT-003-codex-provider.md
  - ./FEAT-006-cli-entry-and-cli-channel.md
---

# setup / onboard 首次引导闭环

## 1. Context / 背景

`README.md` 已能说明 Haro 的工程能力，但首次使用路径仍要求用户自行拼接“安装依赖 → 构建 → 导出 `OPENAI_API_KEY` → 跑 doctor / run”的步骤。根据 [`docs/reviews/install-ux-plan-2026-04-20.md`](../../docs/reviews/install-ux-plan-2026-04-20.md) 的 M1 目标，Haro 需要一个统一的首次命令，把环境检查、配置落盘与下一步建议收敛成一个闭环，消除“第一次应该先做什么”的歧义。

## 2. Goals / 目标

- G1: 提供 `haro setup` 作为首次使用入口，并提供 `haro onboard` 别名
- G2: 首次命令能检查 Phase 0 最小上手前置条件：Node、pnpm、数据目录、`OPENAI_API_KEY`
- G3: 在不写入敏感信息的前提下，把首次运行所需的默认非敏感配置落到 `~/.haro/config.yaml`
- G4: 命令结束时总能输出清晰的下一步动作

## 3. Non-Goals / 不做的事

- 不做 npm 全局安装、一键安装脚本、`pnpm setup` 等发布/开发入口收敛（留给 M2/M4）
- 不做 gateway / daemon / `haro gateway *` 命令族（留给 M3）
- 不把 `OPENAI_API_KEY` 写入 YAML；凭证仍只来自环境变量
- 不新增复杂全屏交互向导；Phase 0 先以最小、稳定的 CLI 引导闭环为主

## 4. Requirements / 需求项

- R1: `packages/cli/src/index.ts` 暴露 `haro setup`，并为其增加 `onboard` 别名
- R2: `haro setup` 检查当前 Node 版本是否满足仓库要求（`>=22`）、`pnpm` 是否可调用、`~/.haro/` 根目录是否可写、`OPENAI_API_KEY` 是否已设置
- R3: `haro setup` 不得把凭证写入 `config.yaml`；只允许写入非敏感配置，例如 `providers.codex.defaultModel`
- R4: Phase 0 仅有 Codex Provider，因此 setup 必须把默认 Provider 明确收敛为 `codex`；若可解析模型列表，则优先保留现有 `providers.codex.defaultModel`，否则自动选择可用默认模型
- R5: setup 完成后必须输出结构化的人类可执行摘要：已通过项、阻塞项（如有）、配置落盘位置，以及下一步命令（至少包含 `doctor`、`run`、`channel setup feishu`）
- R6: `README.md` 与 `docs/cli-design.md` 必须同步到新的首次使用路径，避免文档继续声称“尚无 setup/onboard”

## 5. Design / 设计要点

**执行顺序**

1. 复用 CLI bootstrap，确保 `~/.haro/` 目录与数据库基础设施已初始化
2. 读取 Node 版本、`pnpm --version`、数据目录可写性、`OPENAI_API_KEY`
3. 若已有 `providers.codex.defaultModel`，直接保留；若缺失且存在 API Key，则尝试 `provider.listModels()` 选择第一个 live 模型
4. 将非敏感配置写回 `config.yaml`
5. 打印 setup 摘要与 next steps；有阻塞项时返回非零退出码

**配置策略**

- 默认 Provider 不新增新的全局配置字段；Phase 0 继续通过规则默认走 `codex`
- setup 只补 `providers.codex.defaultModel`，因为这是现有 schema 已支持的稳定配置位
- API Key 不进配置文件，延续 FEAT-003 R5

## 6. Acceptance Criteria / 验收标准

- AC1: `haro setup` 在 `OPENAI_API_KEY` 已设置、provider 可列出模型时，返回码为 0，并把 `providers.codex.defaultModel` 写入 `config.yaml`（对应 R1、R2、R3、R4）
- AC2: `haro onboard` 与 `haro setup` 等价，返回同样的引导结果（对应 R1）
- AC3: 当 `OPENAI_API_KEY` 缺失时，`haro setup` 返回码非 0，但仍打印阻塞项与下一步修复动作；`config.yaml` 中不出现任何凭证字段（对应 R2、R3、R5）
- AC4: `haro setup` 输出包含：检查摘要、配置文件位置、`haro doctor` / `haro run "..."` / `haro channel setup feishu` 三条 next steps（对应 R5）
- AC5: `README.md` 的 Quick Start 改为先执行 `setup/onboard`，且不再声称“还没有顶层 setup/onboard 命令”；`docs/cli-design.md` 同步出现该命令（对应 R6）

## 7. Test Plan / 测试计划

- 单元/集成测试：
  - `packages/cli/test/cli.test.ts` 覆盖 `setup` 成功路径、`onboard` 别名、缺失 API Key 的阻塞路径、输出 next steps
- 手动验证：
  - 从干净的临时 `HARO_HOME` 跑 `node packages/cli/bin/haro.js setup`
  - 检查 `config.yaml` 未写入敏感凭证
- 回归风险点：
  - 现有 `doctor` / `run` / `channel setup` 命令不应被破坏

## 8. Open Questions / 待定问题

全部已关闭（见 Changelog 2026-04-20 决策条）。

## 9. Changelog / 变更记录

- 2026-04-20: whiteParachute — 初稿并直接进入实现
  - Q1 → Phase 0 的 `setup` 先做最小闭环，不额外引入全屏 wizard
  - Q2 → 默认 Provider 不新增 schema 字段，继续固定为 `codex`
  - Q3 → 默认 model 优先保留现有配置；否则在存在 API Key 时再调用 `listModels()` 自动选择
- 2026-04-20: whiteParachute — done
  - `packages/cli/src/setup.ts` 实装 `haro setup` / `haro onboard` 首次引导闭环：检查 Node / pnpm / 数据目录 / `OPENAI_API_KEY`，仅写入非敏感默认配置，并输出结构化 next steps
  - `packages/cli/src/index.ts` 注册 `setup` 命令与 `onboard` 别名；`packages/cli/bin/haro.js` 补 flush 保护，避免 setup / doctor 等短命命令在退出前丢 stdout/stderr
  - `packages/cli/test/cli.test.ts` 补齐 setup 成功路径、onboard 别名、缺失 `OPENAI_API_KEY` 阻塞路径覆盖；`README.md` 与 `docs/cli-design.md` 同步到新的首次使用路径
  - 2026-04-20 收尾验证：重新检查 diff 边界仅涉及 setup / onboard 及其文档/测试；手动 setup 成功路径因当前 shell 未提供 `OPENAI_API_KEY` 标记为 Not-tested
