---
id: FEAT-024
title: Web Dashboard — Knowledge & Skills（知识与技能管理）
status: done
phase: phase-1
owner: whiteParachute
created: 2026-04-25
updated: 2026-04-26
related:
  - ./FEAT-018-web-dashboard-orchestration-observability.md
  - ./FEAT-021-memory-fabric-v1.md
  - ./FEAT-022-evolution-asset-registry.md
  - ../phase-0/FEAT-010-skills-subsystem.md
  - ../phase-0/FEAT-011-manual-eat-shit.md
  - ../../docs/modules/memory-fabric.md
  - ../../docs/modules/skills-system.md
---

# Web Dashboard — Knowledge & Skills（知识与技能管理）

## 1. Context / 背景

FEAT-018 原计划同时交付 workflow 图、KnowledgePage、SkillsPage、LogsPage、Provider 统计和 MonitorPage。2026-04-25 owner 决策要求拆分。由于 KnowledgePage 依赖 FEAT-021 Memory Fabric v1，SkillsPage 又需要 FEAT-022 Evolution Asset Registry 才能正确展示 proposal/promote/archive 生命周期，因此二者合并为独立 spec。

本 FEAT 的目标是让用户在 Dashboard 中浏览、搜索和维护 Haro 的知识与技能资产，但不承担编排调试和运行时监控。

## 2. Goals / 目标

- G1: 实现 KnowledgePage，支持 Memory Fabric v1 的搜索、浏览和安全写入。
- G2: 实现 SkillsPage，支持 Skills 的列表、详情、启用、禁用、安装和卸载。
- G3: 展示 skill / memory 与 Evolution Asset Registry 的关联，能追溯来源和状态。
- G4: 通过 REST API 暴露 Memory 与 Skills read/write contract，不直接操作文件系统。

## 3. Non-Goals / 不做的事

- 不实现 workflow/branch/checkpoint 调试；属于 FEAT-018。
- 不实现 Logs/Provider/Monitor；属于 FEAT-025。
- 不实现 Memory Fabric v1 存储和 FTS5 核心；属于 FEAT-021。
- 不实现 Evolution Asset Registry 核心；属于 FEAT-022。
- 不允许通过 UI 写入 `platform` scope memory；platform scope 只能只读展示。
- 不绕过 `haro shit` 或 asset registry 直接删除 skill 文件。

## 4. Requirements / 需求项

- R1: REST API 覆盖 Memory 领域：`GET /api/v1/memory/query`、`POST /api/v1/memory/write`、`GET /api/v1/memory/stats`、`POST /api/v1/memory/maintenance`。
- R2: `POST /api/v1/memory/write` 仅允许写入 `shared` 和当前 agent scope；禁止写入 `platform` scope。
- R3: Memory 查询必须支持 scope、agentId、layer、verificationStatus、keyword、limit。
- R4: KnowledgePage 必须按 relevance 展示 summary、sourceRef、verificationStatus、assetRef、timestamp，并允许展开完整内容。
- R5: REST API 覆盖 Skills 领域：`GET /api/v1/skills`、`GET /api/v1/skills/:id`、`POST /api/v1/skills/:id/enable`、`POST /api/v1/skills/:id/disable`、`POST /api/v1/skills/install`、`DELETE /api/v1/skills/:id`。
- R6: SkillsPage 必须展示 id、source、enabled、installedAt、isPreinstalled、asset status、lastUsedAt、useCount。
- R7: 预装 skill 不得被卸载；禁用/启用必须遵守 SkillsManager 现有规则。
- R8: 安装或卸载 user skill 必须写 Evolution Asset Registry event；如果 FEAT-022 未完成，实现必须显式返回 unsupported，而不是静默跳过审计。
- R9: Skill 删除必须走 uninstall/archive 流程，不得直接删除文件。

## 5. Design / 设计要点

### 5.1 新增后端文件

```
packages/cli/src/web/routes/
├── memory.ts
└── skills.ts
```

### 5.2 新增前端文件

```
packages/web/src/
├── pages/
│   ├── KnowledgePage.tsx
│   └── SkillsPage.tsx
└── components/
    ├── knowledge/
    │   ├── MemorySearch.tsx
    │   └── MemoryResultCard.tsx
    └── skills/
        ├── SkillCard.tsx
        └── SkillInstallDialog.tsx
```

### 5.3 KnowledgePage

- 搜索框 + scope/layer/verificationStatus 筛选。
- 结果展示 sourceRef 和 assetRef，避免把未验证结论伪装成事实。
- 写入表单默认只允许 shared；agent scope 需要选择 agentId。
- platform scope 只读，UI 不提供写入入口。

### 5.4 SkillsPage

- 预装和 user skill 分组展示。
- enable/disable 是低风险操作；uninstall/install 需要展示 asset/audit 结果。
- `shit` 候选清理不在本页面直接执行，只跳转或提示使用代谢流程。

## 6. Acceptance Criteria / 验收标准

- AC1: KnowledgePage 可按 keyword/scope/layer 搜索 Memory，结果展示 verificationStatus 和 sourceRef。（对应 R1-R4）
- AC2: 尝试通过 Memory API 写入 platform scope 时，后端返回拒绝且不写入。（对应 R2）
- AC3: SkillsPage 可列出预装和 user skill，展示 enabled、source、installedAt、usage 和 asset 状态。（对应 R5-R6）
- AC4: 预装 skill 的 uninstall 操作不可用或返回拒绝。（对应 R7）
- AC5: user skill install/uninstall 成功后写入 asset event；FEAT-022 未实现时返回显式 unsupported。（对应 R8-R9）

## 7. Test Plan / 测试计划

- Memory route 测试：query/write/stats/maintenance，platform write 禁止。
- Skills route 测试：list/detail/enable/disable/install/uninstall，预装保护。
- 前端测试：MemorySearch、MemoryResultCard、SkillCard、SkillInstallDialog。
- 集成测试：skill install -> asset event -> SkillsPage 展示状态。

## 8. Open Questions / 待定问题

全部已关闭（见 Changelog 2026-04-26 决策条）。

- Q1: FEAT-024 是否必须等待 FEAT-021/022 都 done 后才能 approved，还是允许先做只读页面？ —— 等待 FEAT-021/022 都 done 后再 approved；当前 FEAT-021 和 FEAT-022 已为 `done`，满足开工前置条件。
- Q2: `memory/maintenance` 在 Phase 1 是同步返回结果，还是异步 taskId？ —— Phase 1 先采用异步 `taskId`，后续可再优化为同步返回结果。

## 9. Changelog / 变更记录

- 2026-04-25: Codex — 从 FEAT-018 拆分 KnowledgePage 与 SkillsPage，形成独立 FEAT-024。
- 2026-04-26: whiteParachute — 关闭 Open Questions 并批准进入实现：FEAT-024 等待 FEAT-021/022 done 后开工，当前前置均已满足；`memory/maintenance` Phase 1 先返回异步 `taskId`，后续再考虑同步优化。status: draft → approved。
- 2026-04-26: Codex — 交付 Memory REST、Skills REST、KnowledgePage、SkillsPage、asset audit/unsupported 分支、文档与回归测试；验证命令：`pnpm -F @haro/core test`、`pnpm -F @haro/cli test -- web-feat024.test.ts`、`pnpm -F @haro/web test -- feat024.test.tsx`、`pnpm test`、`pnpm lint`、`pnpm -F @haro/web lint`、`pnpm build`、`pnpm smoke`、Web smoke（/knowledge、/skills 截图 + REST）；commit: 9be4c40。status: approved → done。
