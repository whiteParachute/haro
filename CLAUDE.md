# Haro

## 当前设计基线

**2026-05-01 重设计**：Haro 采用双层架构（workbench + 进化）+ 四边界约束（CLI 优先 / 前后端解耦 / 多 provider 抽象 / 多 channel 抽象）；原 Phase 4 Ecosystem 已移除；当前阶段为 **Phase 1.5（自用底座补完）**。任何 spec 评审、模块设计、UX 决策都要先过这四条边界。

新会话或长会话恢复时**先读** [`docs/planning/redesign-2026-05-01.md`](docs/planning/redesign-2026-05-01.md)——这是 Phase 1.5 的执行真源。

## 开发收尾流程

每次开发任务结束（功能实现完、bug 修复完、阶段性收尾时），按顺序调用：

1. `/codex:review` — 用 Codex 对本次改动做独立评审
2. `/neat-freak` — 同步项目文档（CLAUDE.md、README、docs/）与 Agent 记忆

两步都跑完再认为这一轮工作真正完成。
