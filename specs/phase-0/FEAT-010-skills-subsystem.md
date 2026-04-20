---
id: FEAT-010
title: Skills 子系统 + 15 预装 skill
status: done
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-20
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

15 个预装清单和分类见 [skills-system.md](../../docs/modules/skills-system.md#预装-skillsphase-0)，本 spec 交付承接机制 + 打包分发。

## 2. Goals / 目标

- G1: Skills 安装 / 卸载 / 查询 CLI 命令
- G2: 目录结构与使用统计表落地
- G3: 15 个预装 skill 打包随 Haro 分发（从各自来源拉取并冻结到 `preinstalled/`）
- G4: Skill 触发机制（显式 slash / description 匹配）

## 3. Non-Goals / 不做的事

- 不做 Skill Marketplace（Phase 1）
- 不做 Agent 级 skill 绑定 UI（Phase 1，Phase 0 只通过 YAML 配置）
- 不做 Skill 签名 / 审计 / 沙箱（安全模型推迟）
- 不做 Skill 自动升级（Phase 2）
- 不做额外的 Telegram setup 预装 skill（保持预装总数为 15）

## 4. Requirements / 需求项

- R1: `haro skills` 命令族：`list / install / uninstall / info / enable / disable`
  - `install` 支持三种来源：git URL、本地路径、`marketplace:<name>`（marketplace 支持留到 Phase 1，命令框架保留）
- R2: 目录布局：
  - `~/.haro/skills/preinstalled/`
  - `~/.haro/skills/user/`
  - `~/.haro/skills/installed.json`
  - `~/.haro/skills/usage.sqlite`
- R3: 15 个预装 skill 全部安装到 `preinstalled/`：
  - 记忆 6：`remember / memory / memory-wrapup / memory-sleep / memory-status / memory-auto-maintain`
  - 自查 3：`review / security-review / simplify`
  - 自动化 1：`loop`
  - 消息渠道 3：`lark-bridge / feishu-sessions / lark-setup`
  - 代谢 2：`eat`、`shit`
- R4: Skill 文件格式兼容 Claude Code skill 格式（`SKILL.md` + frontmatter）
- R5: 每次 skill 触发自动写 `usage.sqlite` 一条 usage 统计（可实现为 upsert 计数，不要求 append-only）
- R6: 触发顺序：
  - 显式 slash：`/skill-name [args]`，**优先级最高**
  - description 匹配：在 Provider 调用之前由 Haro 自己判定并至多自动触发一个 skill
  - 自动触发结果再交给 Provider；Phase 0 不把 skill 作为 provider tool 注入链的一部分
- R7: 记忆类 skill（6 个）内部调用 FEAT-007 的 `MemoryFabric` API
- R8: 核心代码不得出现具体 skill 名字硬编码（如 `if skill === 'memory'`）
- R9: `haro skills uninstall <id>` 对 preinstalled skill 拒绝（提示"预装 skill 不可卸载"）
- R10: 分发必须暴露 license/source 元数据：
  - 每个预装 skill 目录保留 `LICENSE` / `NOTICE`（若上游有）
  - `haro skills info <name>` 打印 `source / pinnedCommit / license`
  - Haro 自研 skill 的仓库级 license 归仓库发布策略管理，不在本 feature 内单独决策
- R11: `haro skills install <path>` 若目标是符号链接，允许 follow，但最终复制解析后的真实内容到 `user/` 并在 manifest 中记录 `resolvedFrom`
- R12: 预装 skill 源码版本以 commit SHA 冻结，记录在 `preinstalled-manifest.json`

## 5. Design / 设计要点

**preinstalled 打包流程**

```
scripts/prepare-preinstalled.ts
  → 从 aria-memory / lark-bridge / Claude Code 源抓取指定 skill
  → 记录 source + commit + license 到 preinstalled-manifest.json
  → 写入 packages/cli/resources/preinstalled/<name>/
  → 首次启动时展开到 ~/.haro/skills/preinstalled/
```

**installed.json 结构**

```json
{
  "version": 1,
  "skills": {
    "memory": {
      "source": "preinstalled",
      "originalSource": "aria-memory",
      "pinnedCommit": "<sha>",
      "installedAt": "2026-04-19T...",
      "isPreinstalled": true,
      "license": "MIT"
    }
  }
}
```

**触发路由**

- 显式 slash：CLI / channel 层解析后直接指定 skill id
- description 匹配：Haro 自己做轻量匹配，不依赖 provider 自己发现
- Phase 0 限制：一次用户输入最多自动匹配一个 skill；若多项命中，则按显式优先 > 精确触发词 > 置信度排序取一项，并记录 debug 日志

## 6. Acceptance Criteria / 验收标准

- AC1: 全新环境首次启动，`~/.haro/skills/preinstalled/` 自动展开，`haro skills list` 输出 15 个预装 skill（对应 R3）
- AC2: `haro skills install https://github.com/foo/bar` 成功把仓库作为 skill 装到 `user/`；`installed.json` 新增一条（对应 R1）
- AC3: `haro skills uninstall memory` 返回错误并提示预装 skill 不可卸载（对应 R9）
- AC4: 用户 REPL 输入 `/memory 查一下 xxx`，skill 被调用，`usage.sqlite` 中 `memory` 的 `use_count +1` 且 `last_used_at` 更新（对应 R5、R6）
- AC5: 运行 `grep -rE "skillId\s*===|skill\.id\s*===" packages/core packages/cli` 返回 0 行（对应 R8）
- AC6: 记忆类 skill（如 `remember`）内部只通过 `MemoryFabric` API 读写，不直接访问 `~/.haro/memory/` 文件（对应 R7）
- AC7: 预装 skill 目录下均有 `LICENSE`/`NOTICE`（若上游提供）且 `haro skills info <name>` 能展示来源与 pinned commit（对应 R10、R12）
- AC8: description 匹配触发：用户输入“记住这个偏好”，`remember` 被自动调用，而不是 `eat`（对应 R6）
- AC9: 安装符号链接路径时，最终内容被复制进 `user/`，manifest 记录 `resolvedFrom`（对应 R11）

## 7. Test Plan / 测试计划

- 单元测试：
  - `install-from-git.test.ts` — 安装（mock git clone）
  - `install-from-path.test.ts` — 本地路径安装 / symlink follow
  - `installed-manifest.test.ts` — `installed.json` / `preinstalled-manifest.json`
  - `usage-tracker.test.ts` — 使用统计写入（AC4）
  - `trigger-routing.test.ts` — 显式 slash / 自动匹配优先级
- 集成测试：
  - `preinstall-expand.test.ts` — 首次启动展开（AC1）
  - `uninstall-guard.test.ts` — 预装保护（AC3）
  - `description-trigger.e2e.test.ts` — 描述匹配触发（AC8）
- 手动验证：
  - AC7 license/source 展示
  - AC6 代码评审

## 8. Open Questions / 待定问题

全部已关闭（见 Changelog 2026-04-19 决策条）。

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
- 2026-04-19: whiteParachute — 关闭 Open Questions → approved
  - Q1 → 统一通过 `haro skills info <name>` 暴露 `source + pinnedCommit + license`；目录保留 LICENSE/NOTICE
  - Q2 → description 匹配在 Haro 自己的路由层先做，结果再交 Provider；Phase 0 不把 skill 当 provider tool 注入
  - Q3 → Haro 自研 skill 的仓库级 license 由仓库发布策略统一管理；此 feature 只要求暴露当前 license 状态，不把 license 选择做成实现 blocker
  - Q4 → 预装 skill 版本以 commit SHA 冻结，记录在 `preinstalled-manifest.json`
  - Q5 → 安装符号链接路径时 follow + copy，并在 manifest 中记录 `resolvedFrom`
- 2026-04-20: whiteParachute — done
  - `packages/skills` 落地 SkillsManager、installed/preinstalled manifest、usage.sqlite、git/path 安装、启停/卸载保护、以及显式 slash / description 匹配路由
  - `packages/skills/resources/preinstalled/` 与 `preinstalled-manifest.json` 交付 15 个预装 skill 快照，保留 source / pinnedCommit / license / keywords / handler 元数据，并在首次启动时展开到 `~/.haro/skills/preinstalled/`
  - `packages/cli/src/index.ts` 挂载 `haro skills list/install/uninstall/info/enable/disable`，`/skills` 改为列出已装 skill，未知 slash 命令可下沉到 Skills 路由；`packages/cli/test/cli.test.ts` 与 `packages/skills/test/preinstall-expand.test.ts` 补齐 preinstall / uninstall-guard / usage / trigger / symlink / git install 覆盖
