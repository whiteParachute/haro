---
id: BUG-XXX
title: <简短标题>
status: draft            # draft | triaged | fixing | fixed | wont-fix | duplicate
severity: medium         # critical | high | medium | low
phase: phase-0
found-in: <版本 / 分支 / commit>
owner: <负责人>
created: YYYY-MM-DD
updated: YYYY-MM-DD
related:                 # 相关 spec / PR / 上游 issue
  -
---

# <Bug 标题>

## 1. Summary / 概述

<一句话描述现象。>

## 2. Environment / 环境

- 版本 / 分支 / commit:
- 运行环境（OS / Node / 依赖版本）:
- 配置要点:

## 3. Repro Steps / 复现步骤

1.
2.
3.

## 4. Expected vs Actual / 预期 vs 实际

- 预期:
- 实际:
- 证据（日志片段 / 截图 / trace 链接）:

## 5. Impact / 影响面

<哪些功能 / 用户 / 环境受影响；是否阻塞当前 phase；是否有 workaround。>

## 6. Root Cause / 根因

<根因分析结论。修复前可留空，确认后回填；避免仅写「修好了」不写为什么。>

## 7. Fix Requirements / 修复需求

> 与 feature spec 的 Requirements 同样编号，供 PR / 测试引用。

- R1: <修复后必须成立的行为>
- R2: <需要规避的副作用 / 向后兼容约束>

## 8. Acceptance Criteria / 验收标准

- AC1: 按第 3 节的复现步骤执行，结果符合第 4 节的「预期」。
- AC2: 新增回归测试覆盖该场景，CI 通过。
- AC3: ...

## 9. Verification Plan / 验证方案

- 回归测试用例（代码位置 / 用例名）:
- 手动验证步骤:
- 周边功能回归检查清单:

## 10. Changelog / 变更记录

- YYYY-MM-DD: <作者> — 登记
