---
id: FEAT-004
title: 最小 Agent 定义（配置 + YAML 加载 + 注册表）
status: done
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-19
related:
  - ../../docs/modules/agent-runtime.md
  - ../multi-agent-design-constraints.md
  - ../../docs/architecture/overview.md
  - ../../roadmap/phases.md#p0-4最小-agent-定义
---

# 最小 Agent 定义

## 1. Context / 背景

Haro 的核心是"Agent 被声明 / 被发现 / 被执行"。Phase 0 不追求完整 Agent 生态，只落最小定义：一个 YAML 文件 + 一个注册表 + 一个 Zod schema。后续 FEAT-005 的执行循环依赖本 spec 产出的注册表。

Haro 不接受"岗位式 Agent"模型（违反 [多 Agent 约束⑤](../multi-agent-design-constraints.md)：Agent 能力由 tools 决定，不由角色标签限制）。因此 schema **不**维护"推迟字段黑名单"——列一个黑名单等于默认这些概念将来会回来，这本身就是岗位化思维的残留。做法是：schema `.strict()` 统一拒绝所有未知字段，错误信息只说"Agent 的行为由 tools 定义，不由字段描述"；如果有字段反复被用户/外部工具塞进来，立 BUG-XXX 分析"设计在哪里欠缺导致这个字段被需要"，而不是把它加进黑名单。

本 spec 的边界只覆盖**单 Agent 配置**。Phase 1 引入 `type: team` 时，Team 会使用**独立的 TeamConfig schema / Team loader**；可以复用同一个 `~/.haro/agents/` 目录与扫描框架，但**不**复用本 spec 的 `AgentConfig` `.strict()` schema。否则 `type` / `members` / `orchestrationMode` 等 Team 字段会被 Phase 0 schema 误判为非法字段。

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
- 不做 Team / Team-of-Teams 定义（`type: team`、`members`、`orchestrationMode` 等推迟到 Phase 1 独立 spec）

## 4. Requirements / 需求项

- R1: 定义 `AgentConfig` 接口仅含 `id`、`name`、`systemPrompt`、可选 `tools?: string[]`、可选 `defaultProvider?: string`、可选 `defaultModel?: string`
- R2: Zod schema 用 `.strict()` 模式；**未知字段一律拒绝**，错误信息固定为 `Unknown field '<name>' in agent '<id>'. Agent 的行为由 tools 决定，不由字段描述（见 FEAT-004 §1）`。**不**维护具体字段黑名单；如果某字段（例如 `role`）反复出现在用户配置里，立 BUG spec 分析设计欠缺，不把它加进白/黑名单
- R3: 扫描 `~/.haro/agents/*.yaml`，每个**单 Agent YAML** 加载为一个 AgentConfig；`id` 必须与文件名（去 `.yaml`）一致。Phase 1 的 Team YAML 若与单 Agent 共目录，必须由独立 schema / loader 分流，**不得**直接走本 spec 的 AgentConfig 校验
- R4: 提供 `AgentRegistry` 类：`register(cfg)` / `get(id)` / `list()` / `has(id)` / `tryGet(id)`；不同 Agent 间 id 唯一
- R5: 加载失败（schema 错、文件损坏、id 与文件名不符、id 重复）时，该 Agent 跳过并 log warn，不影响其他 Agent 加载
- R6: 首次运行时若 `~/.haro/agents/` 为空，自动创建示例 `haro-assistant.yaml`，内容见 §5 "默认示例 Agent"
- R7: **原则性要求**：core 代码不得依赖具体 Agent id（`if (agentId === '某具体 id')` 之类）。Haro 的设计假设"路由走注册表 + Team Orchestrator"，不应出现需要 if-else 认 id 的代码路径。与 Q10 相关决策一致：**不**主动加 ESLint 护栏；如果 review / 测试 / grep 发现违反，立 BUG spec 分析路由设计在哪里欠缺
- R8: `defaultProvider` / `defaultModel` 若指向未注册 provider / 未在 provider `listModels()` 返回清单中的模型，启动时**抛错**并指明缺失项（不静默降级）

## 5. Design / 设计要点

**tools 字段语义**

`tools: string[]` **只是字符串透传**，schema 不校验工具名字是否存在。Haro 自己**不**管理或创建工具——Provider 带什么工具，Agent 就能用什么（对齐 multi-agent 约束⑤"工具决定能力"）：

- Codex Provider（Phase 0）：`toolLoop: false`，`tools` 字段整体忽略（见 FEAT-003 R4）

运行时由 Provider 对照自己 SDK 的内置工具名解析；YAML 里写了不存在的工具名 → warn + 丢弃，不抛错。

**加载流程**

```
扫描 ~/.haro/agents/*.yaml
  ↓
逐个 parse YAML → Zod .strict() 校验 → 构造 AgentConfig
  ↓
id 与文件名对齐检查
  ↓
defaultProvider / defaultModel 存在性校验（调 ProviderRegistry + Provider.listModels()）
  ↓
AgentRegistry.register(cfg)
```

> Phase 1 备注：若 `~/.haro/agents/` 同时承载单 Agent 与 Team，目录扫描器可以共享，但必须在 schema 分流后分别进入 `AgentRegistry` / `TeamRegistry` 或等价注册面；**不能**把 Team 直接喂给本流程。

**id 约束**

- 必须匹配 `^[a-z0-9][a-z0-9-]*[a-z0-9]$`（kebab-case）
- 长度 ≤ 64

**YAML 示例**

```yaml
id: code-reviewer
name: 代码审查员
systemPrompt: |
  你在 Haro 中审阅代码。优先对照约束④（validator 是否定者）：列问题清单，不接棒做修复。
tools:
  - Read
  - Grep
  - Glob
# 可选覆盖（若指向未注册 provider / 未在实时模型清单内的 model，启动抛错）：
defaultProvider: codex
defaultModel: gpt-5-codex
```

**默认示例 Agent（R6）**

首次启动写入 `~/.haro/agents/haro-assistant.yaml`，内容：

```yaml
id: haro-assistant
name: Haro 默认助手
systemPrompt: |
  你在 Haro 中执行用户交付的任务。

  工作方式：
  - 你拥有一组工具，能力由这些工具决定；不要假定自己有工具之外的能力
  - 原始信息（用户输入、工具返回）优先于推断与摘要；需要给其他 Agent 或后续步骤留下信息时，写原文而非结论
  - 与其他 Agent 协作时共同访问同一份原始材料，不要把你的理解转述给下游
  - 每次会话的关键事实会通过 Memory Fabric 写回长期记忆供后续使用

  回答风格：
  - 直接、简洁、不铺垫；先给结论再给依据
  - 不确定就说不确定，不要编造
  - 涉及代码、命令、文件路径时给精确引用

  需要谨慎的操作：
  - 执行有副作用的操作前先确认意图：修改文件、删除数据、发消息、调用付费接口、改动外部系统等
  - 只读操作（查文档、搜索网络、读取本地文件、获取业界进展）可以直接做，不需要每次问
  - 不把用户的敏感信息写进长期记忆，除非用户显式同意
  - 不扮演虚构角色、不给自己立人设、不假设组织身份
```

prompt 设计对照原则：

| 原则 | 对应文本 |
|------|---------|
| 约束① 传原文不传摘要 | "原始信息优先于推断与摘要；写原文而非结论" |
| 约束② 分叉再合并不串行 | 移除任何"交给其他 Agent"的 handoff 语言；路由由 Scenario Router 负责 |
| 约束⑤ 工具决定能力 | "你拥有一组工具，能力由这些工具决定" |
| overview §2.2 自我进化 | 显式放行"搜索网络、获取业界进展"作为只读操作 |
| 副作用护栏 | 只拦写操作（修改文件、发消息、付费接口），不拦读操作 |

## 6. Acceptance Criteria / 验收标准

- AC1: 给定 `~/.haro/agents/foo.yaml` 合法内容，`AgentRegistry.get('foo')` 返回对应配置（对应 R1、R3、R4）
- AC2: 给定 `~/.haro/agents/bar.yaml` 内含**任意未知字段**（例如 `role: 'engineer'` 或 `goal: 'ship it'` 或 `foo: 1`），加载时 log warn 并跳过；错误信息包含 `Unknown field` 与本 spec 指引；其他 Agent 正常加载（对应 R2、R5）
- AC3: 两个 YAML 文件声明相同 `id`，第二个 log warn 并拒绝注册（对应 R4、R5）
- AC4: 全新环境启动，`~/.haro/agents/haro-assistant.yaml` 被自动创建；文件 frontmatter 合法 + `systemPrompt` 等于 §5 "默认示例 Agent" 所列内容（对应 R6）
- AC5: 开发期 quick-check：运行 `grep -rE "agentId\s*===" packages/core/src` 返回 0 行（对应 R7；此 grep 仅作开发期自检，不上 CI；若命中则立 BUG spec）
- AC6: id 不匹配文件名（如 `foo.yaml` 内声明 `id: bar`），加载失败并报清晰错误（对应 R3）
- AC7: YAML 指定 `defaultProvider: unknown-provider` 或 `defaultModel: nonexistent-model`，启动时抛错并指明缺失项（对应 R8）

## 7. Test Plan / 测试计划

- 单元测试：
  - `agent-config.schema.test.ts` — 合法/未知字段/id 格式样本（AC1、AC2、AC6）
  - `agent-registry.test.ts` — 注册/查询/重复 id / tryGet（AC3）
  - `bootstrap-default-agent.test.ts` — 首次创建示例 Agent + systemPrompt 字节级对齐 §5 版本（AC4）
  - `provider-model-resolution.test.ts` — mock ProviderRegistry + mock listModels；defaultProvider/defaultModel 不存在时抛错（AC7）
- 集成测试：
  - `load-agents-from-dir.test.ts` — 真实扫描目录（含合法/未知字段/重复 id/不匹配 id 混合样本）
- 手动验证：
  - AC5 grep quick-check

## 8. Open Questions / 待定问题

全部已关闭（见 Changelog 2026-04-18 决策条）。

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
- 2026-04-18: whiteParachute — 关闭 Open Questions → approved
  - Q1 → `tools: string[]` 只做字符串透传；不校验工具名存在性；Haro 自己不管理/创建工具，完全依赖 Provider SDK 自带的内置工具（对齐约束⑤）。不做 FEAT-010 对齐硬依赖
  - Q2 → `defaultProvider` / `defaultModel` 未命中时**抛错**（不静默降级）。新增 R8 + AC7 固化
  - Q3 → **撤回"推迟字段黑名单"设计**：维护黑名单本身是岗位化思维的残留。改为 `.strict()` 统一拒绝所有未知字段，错误消息不提"deferred"等暗示；字段反复出现 → 立 BUG 分析设计欠缺。§1 Context 重写
  - Q4 → Phase 0 不支持项目级覆盖
  - R7 改写 → 从"ESLint 拦截硬编码"→"原则性声明 + BUG 兜底"：不加护栏，靠设计纪律；发现违反立 BUG。AC5 降级为开发期人工 grep 而非 CI 规则
  - R6 → 补齐默认 `haro-assistant.yaml` 内容；systemPrompt 对照 multi-agent 约束 + overview §2.2 自我进化逐条审核（只读操作含"搜索网络"放行；副作用操作需确认）
- 2026-04-19: whiteParachute — 实现合入 → done
  - `@haro/core/agent` 落地 `AgentConfig` + Zod `.strict()` schema + `AgentRegistry` + 目录扫描 loader + 默认示例 bootstrap；AC5 grep quick-check 固化为 `agent-id-hardcode-guard.test.ts`
  - R8/AC7 startup 校验：当 Agent 带 `defaultProvider` 或 `defaultModel` 而 loader 没拿到 `providerRegistry` 时，直接抛 `AgentConfigResolutionError { kind: 'missing-provider-registry' }`，不静默降级
  - R6 bootstrap 触发条件收紧为"目录严格为空"（任何 `.gitkeep`/README 都尊重为用户意图，不覆盖）
  - 单测 70 条（含 AC1/AC2/AC3/AC4/AC6/AC7 覆盖 + bootstrap byte-level 校验 + 非 YAML 文件忽略 + 坏 YAML 告警）；`pnpm build` / `pnpm test` 全绿
- 2026-04-19: whiteParachute — 边界澄清：本 spec 只覆盖单 Agent Config；Phase 1 的 TeamConfig 复用目录发现思路，但不复用本 spec 的 `.strict()` schema
