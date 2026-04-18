---
id: FEAT-XXX
title: <简短标题>
status: draft            # draft | approved | in-progress | done | superseded
phase: phase-0           # 所属迭代阶段（phase-0 / phase-1 / ...）
owner: <负责人>
created: YYYY-MM-DD
updated: YYYY-MM-DD
related:                 # 相关 spec / issue / PR（可选）
  -
---

# <Feature 标题>

## 1. Context / 背景

<为什么做？当前的问题或缺口是什么？没有这一段，读者无法判断 Goals 是否合理。>

## 2. Goals / 目标

- G1: <一个可衡量的目标>
- G2: ...

## 3. Non-Goals / 不做的事

- <明确排除的范围，防止 scope creep>
- <未来可能做、本次不做的事项也列在这里>

## 4. Requirements / 需求项

> 编号后的需求是开发与测试对齐的锚点。PR / commit message / 测试用例都应引用编号（R1、R2…）。

- R1: <一句话描述必须满足的能力>
- R2: ...

## 5. Design / 设计要点

<核心方案、关键接口、数据流、状态机。不必详尽，但要让读者理解「如何实现 R1~Rn」。复杂设计可拆到独立文档并在此链接。>

## 6. Acceptance Criteria / 验收标准

> 每条 AC 必须可测（人能明确判断通过/失败）。AC 与 R 对齐；一条 R 可能对应多条 AC。

- AC1: 给定 <前置条件>，当 <动作> 时，应当 <可观察结果>。（对应 R1）
- AC2: ...

## 7. Test Plan / 测试计划

- 单元测试覆盖：<模块 / 函数 / 分支>
- 集成或 E2E 测试：<场景>
- 手动验证步骤：<如适用>
- 回归风险点：<需要额外检查的周边功能>

## 8. Open Questions / 待定问题

> 所有 Open Question 必须在 status 切到 `approved` 之前关闭，否则实现阶段会返工。

- Q1: <未决问题>

## 9. Changelog / 变更记录

- YYYY-MM-DD: <作者> — 初稿
