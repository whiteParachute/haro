# Haro

## 当前设计基线

**2026-05-01 重设计**：Haro 采用双层架构（workbench + 进化）+ 四边界约束（CLI 优先 / 前后端解耦 / 多 provider 抽象 / 多 channel 抽象）；原 Phase 4 Ecosystem 已移除；**Phase 1.5（自用底座补完）已于 2026-05-02 完成**（FEAT-038 + FEAT-039 全收尾，CLI 与 Web 命令面等价、`@haro/core/services` 共享层就位）。任何 spec 评审、模块设计、UX 决策都要先过这四条边界。

历史决策记录见 [`docs/planning/archive/redesign-2026-05-01.md`](docs/planning/archive/redesign-2026-05-01.md)（已归档）；后续路线以 [`roadmap/phases.md`](roadmap/phases.md) 为准。

## 开发收尾流程

每次开发任务结束（功能实现完、bug 修复完、阶段性收尾时），按顺序调用：

1. `/codex:review` — 用 Codex 对本次改动做独立评审
2. `/neat-freak` — 同步项目文档（CLAUDE.md、README、docs/）与 Agent 记忆

两步都跑完再认为这一轮工作真正完成。
