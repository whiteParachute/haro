---
id: FEAT-010
title: Skills 子系统 + 15 预装 skill
status: draft
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-18
related:
  - ../../docs/modules/skills-system.md
  - ../evolution-metabolism.md
  - ./FEAT-007-memory-fabric-independent.md
  - ./FEAT-011-manual-eat-shit.md
  - ../../roadmap/phases.md#p0-10skills-子系统--15-预装
---

# Skills 子系统 + 15 预装

## 1. Context / 背景

Skills 子系统是 Haro 的能力扩展机制。Phase 0 交付安装 / 卸载 / 查询 + 15 个预装 skill + 与 Memory Fabric / eat/shit 的集成点。Skills 必须遵守 [可插拔原则](../../docs/architecture/overview.md#设计原则)，核心模块对具体 skill 名称零硬编码。

15 个预装清单和分类见 [skills-system.md](../../docs/modules/skills-system.md#预装-skills-phase-0)，本 spec 交付承接机制 + 打包分发。

## 2. Goals / 目标

- G1: Skills 安装 / 卸载 / 查询 CLI 命令
- G2: 目录结构与使用统计表落地
- G3: 15 个预装 skill 打包随 Haro 分发（从各自来源拉取并"冻结"到 `preinstalled/`）
- G4: Skill 触发机制（显式 slash / description 匹配）

## 3. Non-Goals / 不做的事

- 不做 Skill Marketplace（Phase 1）
- 不做 Agent 级 skill 绑定 UI（Phase 1，Phase 0 只通过 YAML 配置）
- 不做 Skill 签名 / 审计 / 沙箱（安全模型推迟）
- 不做 Skill 自动升级（Phase 2）
- 不做 Skill 编写工具（`skill-creator` 是用户手动使用的，Phase 0 不内置）

## 4. Requirements / 需求项

- R1: `haro skills` 命令族：`list / install / uninstall / info / enable / disable`
  - `install` 支持三种来源：git URL、本地路径、`marketplace:<name>`（marketplace 支持留到 Phase 1，命令框架保留）
- R2: 目录布局（按 [skills-system.md](../../docs/modules/skills-system.md#skills-目录结构)）：
  - `~/.haro/skills/preinstalled/`（受 shit 白名单保护）
  - `~/.haro/skills/user/`
  - `~/.haro/skills/installed.json`
  - `~/.haro/skills/usage.sqlite`
- R3: 15 个预装 skill 全部安装到 `preinstalled/`：
  - 记忆 6：`remember / memory / memory-wrapup / memory-sleep / memory-status / memory-auto-maintain`（从 aria-memory 插件复制）
  - 自查 3：`review / security-review / simplify`（从 Claude Code 内置复制）
  - 自动化 1：`loop`（从 Claude Code 内置复制）
  - 消息渠道 3：`lark-bridge / feishu-sessions / lark-setup`（从 lark-bridge 插件复制）
  - 代谢 2：`eat`（复用 `/home/heyucong.bebop/SKILL.md`，保留原作者署名 + `CC-BY-NC-SA-4.0`）、`shit`（自研，按 [evolution-metabolism.md](../evolution-metabolism.md#shit--排出规范)）
- R4: Skill 文件格式兼容 Claude Code skill 格式（`SKILL.md` + frontmatter）
- R5: 每次 skill 触发自动写 `usage.sqlite` 一行（供 shit 使用）
- R6: 触发方式：
  - 显式 slash：`/skill-name [args]`
  - description 匹配：SKILL.md frontmatter 的 `description` 段的触发词命中时自动调用
- R7: 记忆类 skill（6 个）内部调用 FEAT-007 的 `MemoryFabric` API
- R8: 核心代码不得出现具体 skill 名字硬编码（如 `if skill === 'memory'`）
- R9: `haro skills uninstall <id>` 对 preinstalled skill 拒绝（提示"预装 skill 不可卸载"）
- R10: License 合规：
  - aria-memory / lark-bridge / Claude Code 内置 skill 按其原 license 分发（在 `preinstalled/<name>/LICENSE` 保留原文件）
  - `eat` 保留 `CC-BY-NC-SA-4.0` 声明
  - `shit` 采用 Haro 项目 license（待定，见 Q3）

## 5. Design / 设计要点

**preinstalled 打包流程**

```
Haro 仓库 scripts/prepare-preinstalled.ts
  → 从 aria-memory / lark-bridge / Claude Code 仓库抓取指定 skill
  → 写入 packages/cli/resources/preinstalled/<name>/
  → 打包进发布产物
  → haro 首次启动时若 ~/.haro/skills/preinstalled/ 为空则展开
```

**installed.json 结构**

```json
{
  "version": 1,
  "skills": {
    "memory": {
      "source": "preinstalled",
      "originalSource": "aria-memory",
      "version": "0.1.0",
      "installedAt": "2026-04-18T...",
      "isPreinstalled": true
    },
    "my-custom": {
      "source": "user",
      "gitUrl": "https://github.com/foo/my-custom",
      "version": "1.0.0",
      "installedAt": "...",
      "isPreinstalled": false
    }
  }
}
```

**触发路由**

Scenario Router（Phase 1）按 description 匹配；Phase 0 由 Agent Runtime 在每轮 query 前让 provider 自行决定（SDK 的 skill/tool 注入机制）。

## 6. Acceptance Criteria / 验收标准

- AC1: 全新环境首次启动，`~/.haro/skills/preinstalled/` 自动展开，`haro skills list` 输出 15 个预装 skill（对应 R3）
- AC2: `haro skills install https://github.com/foo/bar` 成功把仓库作为 skill 装到 `user/`；`installed.json` 新增一条（对应 R1）
- AC3: `haro skills uninstall memory` 返回错误并提示预装 skill 不可卸载（对应 R9）
- AC4: 用户 REPL 输入 `/memory 查一下 xxx`，skill 被调用，`usage.sqlite` 中 `memory` 的 `use_count +1` 且 `last_used_at` 更新（对应 R5、R6）
- AC5: 运行 `grep -rE "skillId\s*===|skill\.id\s*===" packages/core packages/cli` 返回 0 行（对应 R8）
- AC6: 记忆类 skill（如 `remember`）内部只通过 `MemoryFabric` API 读写，不直接访问 `~/.haro/memory/` 文件（对应 R7；代码评审确认）
- AC7: 预装 skill 目录下均有 `LICENSE` 文件（对应 R10）
- AC8: description 匹配触发：用户输入"记住这个"，eat skill 被自动调用（对应 R6；集成测试模拟）

## 7. Test Plan / 测试计划

- 单元测试：
  - `install-from-git.test.ts` — 安装（mock git clone）
  - `install-from-path.test.ts` — 本地路径安装
  - `installed-manifest.test.ts` — installed.json 读写
  - `usage-tracker.test.ts` — 使用统计写入（AC4）
- 集成测试：
  - `preinstall-expand.test.ts` — 首次启动展开（AC1）
  - `uninstall-guard.test.ts` — 预装保护（AC3）
  - `description-trigger.e2e.test.ts` — 描述匹配触发（AC8）
- 手动验证：
  - AC7 license 文件
  - AC6 代码评审

## 8. Open Questions / 待定问题

- Q1: 预装 skill 的 license 多样（MIT / CC-BY-NC-SA-4.0 / Anthropic），分发时如何统一呈现？建议 `haro skills info <name>` 打印来源 + license
- Q2: `description` 匹配触发与 provider 自带 tool 机制会不会冲突？Claude SDK 自带 tool 装载，Haro 的 skill 触发应发生在 provider 之前还是作为 tool 传给 provider？需要与 FEAT-002 协调
- Q3: `shit` skill 使用什么 license？建议 Haro 本身统一在 Phase 0 末期确定项目 license 后一并定
- Q4: 预装 skill 的版本更新：Phase 0 锁死某个 commit，Phase 2+ 由 eat/shit 代谢调整
- Q5: `haro skills install <path>` 的路径如果是符号链接（开发调试），是否 follow？建议 follow + warn

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
