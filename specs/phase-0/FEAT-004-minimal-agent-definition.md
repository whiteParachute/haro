---
id: FEAT-004
title: 最小 Agent 定义（配置 + YAML 加载 + 注册表）
status: draft
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-18
related:
  - ../../docs/modules/agent-runtime.md
  - ../multi-agent-design-constraints.md
  - ../../roadmap/phases.md#p0-4最小-agent-定义
---

# 最小 Agent 定义

## 1. Context / 背景

Haro 的核心是"Agent 被声明 / 被发现 / 被执行"。Phase 0 不追求完整 Agent 生态，只落最小定义：一个 YAML 文件 + 一个注册表 + 一个 Zod schema。后续 FEAT-005 的执行循环依赖本 spec 产出的注册表。

有意推迟的字段（`role` / `goal` / `backstory` / `identity` / `personality` / `triggers` / `constraints` / `activeLearnings` / `sharedMemory` / `evolvedFrom`）留给 Phase 1+，同时避免引入"按岗位拆 Agent"的反模式（违反 [多 Agent 约束⑤](../multi-agent-design-constraints.md)）。

## 2. Goals / 目标

- G1: 定义最小 `AgentConfig` TypeScript 接口 + Zod schema
- G2: 从 `~/.haro/agents/*.yaml` 目录扫描加载 Agent 配置
- G3: 提供内存中的 `AgentRegistry`，供 FEAT-005 消费

## 3. Non-Goals / 不做的事

- 不做 Agent 进程 / Actor 隔离（Phase 1）
- 不做 role / goal / backstory（避免岗位式拆分）
- 不做 Agent 版本管理、进化历史字段（`evolvedFrom` / `version` 推迟）
- 不做 Agent 热重载（修改 YAML 需重启）
- 不做 Agent 间权限 / 共享记忆（`sharedMemory` 推迟到 Phase 1）

## 4. Requirements / 需求项

- R1: 定义 `AgentConfig` 接口仅含 `id`、`name`、`systemPrompt`、可选 `tools?: string[]`、可选 `defaultProvider?: string`、可选 `defaultModel?: string`
- R2: Zod schema 对 YAML 严格校验；遇到推迟字段（如 `role`、`backstory`）抛错并在错误信息中引用本 spec 的 Non-Goals
- R3: 扫描 `~/.haro/agents/*.yaml`，每个文件加载为一个 AgentConfig；`id` 必须与文件名（去 `.yaml`）一致
- R4: 提供 `AgentRegistry` 类：`register(cfg)` / `get(id)` / `list()` / `has(id)`；不同 Agent 间 id 唯一
- R5: 加载失败（schema 错、文件损坏、id 与文件名不符）时，该 Agent 跳过并 log warn，不影响其他 Agent 加载
- R6: 首次运行时若 `~/.haro/agents/` 为空，自动创建一个示例 `haro-assistant.yaml`（systemPrompt 通用）
- R7: 核心代码不得硬编码任何具体 Agent id（如 `if agentId === 'haro-assistant'`）

## 5. Design / 设计要点

**YAML 示例**

```yaml
id: code-reviewer
name: 代码审查员
systemPrompt: |
  你是一个专注代码质量的审查 Agent。
tools:
  - read
  - bash
# 可选覆盖：
defaultProvider: claude
defaultModel: claude-opus-4-5
```

**加载流程**

```
扫描 ~/.haro/agents/*.yaml
  ↓
逐个 parse YAML → Zod 校验 → 构造 AgentConfig
  ↓
id 与文件名对齐检查
  ↓
AgentRegistry.register(cfg)
```

**id 约束**

- 必须匹配 `^[a-z0-9][a-z0-9-]*[a-z0-9]$`（kebab-case）
- 长度 ≤ 64

## 6. Acceptance Criteria / 验收标准

- AC1: 给定 `~/.haro/agents/foo.yaml` 合法内容，`AgentRegistry.get('foo')` 返回对应配置（对应 R1、R3、R4）
- AC2: 给定 `~/.haro/agents/bar.yaml` 内含推迟字段 `role: 'engineer'`，加载时 log warn 并跳过；其他 Agent 正常加载（对应 R2、R5）
- AC3: 两个 YAML 文件声明相同 `id`，第二个 log warn 并拒绝注册（对应 R4）
- AC4: 全新环境启动，`~/.haro/agents/haro-assistant.yaml` 被自动创建且 schema 有效（对应 R6）
- AC5: 运行 `grep -rE "agentId\s*===" packages/core` 返回 0 行（对应 R7；此为 Phase 0 的简化检查，Phase 1 升级为 lint 规则）
- AC6: id 不匹配文件名（如 `foo.yaml` 内声明 `id: bar`），加载失败并报清晰错误（对应 R3）

## 7. Test Plan / 测试计划

- 单元测试：
  - `agent-config.schema.test.ts` — 合法/非法样本（AC1、AC2、AC6）
  - `agent-registry.test.ts` — 注册/查询/重复 id（AC3）
  - `bootstrap-default-agent.test.ts` — 首次创建示例 Agent（AC4）
- 集成测试：
  - `load-agents-from-dir.test.ts` — 真实扫描目录（含合法/非法/重复混合样本）
- 手动验证：
  - AC5 grep 命中为 0

## 8. Open Questions / 待定问题

- Q1: `tools` 字段在 Phase 0 对应哪些具体工具？（SDK 内置 / Skills 预装）— 需与 FEAT-010 对齐
- Q2: `defaultProvider` / `defaultModel` 若指向未注册的 provider，启动时抛错还是静默降级到默认规则？建议抛错
- Q3: 推迟字段的"严格拒绝"是否会对后续 Phase 1 字段引入引发频繁破坏？考虑用 `strict: false` + warn list
- Q4: 是否支持项目级 `.haro/agents/` 覆盖全局？Phase 0 倾向先不支持

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
