# 自有项目资产盘点

## 概述

Haro 可以直接复用以下四个自有项目的代码和设计经验。

## 自有项目集成矩阵

```
aria-memory ──→ Memory Fabric 默认后端 (Phase 0 直接复用)
lark-bridge ──→ Service Provider 飞书接入 + Hook 系统参考 + Zod 配置
KeyClaw     ──→ AgentRunner 接口 + ContextPlugin + 8 Provider 经验 + GroupQueue
yoyo-evolve ──→ 三阶段进化循环 + 验证门控 + 装饰器链 + 身份认知文件
```

## aria-memory

**项目性质**：Claude Code 的 extension（skill + hook），自定义记忆系统

**资产内容**：
- `index.md` 格式：记忆索引文件规范
- `knowledge/` 目录：结构化知识文件
- `impressions/` 目录：印象记录文件（264 impressions, 65 knowledge 条目）
- `global_sleep` 逻辑：全局记忆维护机制

**Haro 集成方式**：
- Phase 0：直接读写 aria-memory 目录格式的文件（文件级操作）
- Phase 1：将核心逻辑抽取为可 import 的库

**关键改动（Haro 兼容并扩展）**：
- 主备配置：支持主备目录，仅主执行 `global_sleep`
- Per-Agent 私有记忆：`~/.haro/memory/agents/{name}/`

**集成位置**：`docs/modules/memory-fabric.md`

## lark-bridge

**项目性质**：飞书（Lark/Feishu）集成桥接服务

**资产内容**：
- **Claude 接入方式**：通过 `@anthropic-ai/claude-agent-sdk` 的订阅认证（无需 API Key）⭐ 最重要
- Hook 系统：事件钩子设计模式
- Zod 配置：JSON + Zod 验证的配置管理模式
- TypeScript 技术栈：Node.js 22 + TypeScript

**Haro 集成方式**：
- Claude Provider 的认证方式**完全参考** lark-bridge（D2 决策核心依据）
- Hook 系统设计参考（Phase 0 后期）
- Zod 配置模式直接复用（改为 YAML 格式）

**集成位置**：`docs/architecture/provider-layer.md`，`specs/provider-protocol.md`

## KeyClaw

**项目性质**：多 Provider Agent 运行器

**资产内容**：
- **AgentRunner 接口**：统一的 Agent 执行抽象（Phase 0 直接参考）
- **ContextPlugin**：上下文插件系统（装饰器链）
- **8 个 Provider 的接入经验**：包括 Claude、Codex、本地模型等
- **GroupQueue**：任务队列管理
- **CodexRunner**：Codex SDK 的具体实现 ⭐ Phase 0 Codex Provider 直接参考
- SQLite WAL：会话存储设计（Haro 采用相同方案）
- 容器级隔离：每个用户一个 Docker 容器（Phase 0 不需要，但架构参考）

**Haro 集成方式**：
- Codex Provider 直接参考 CodexRunner 实现（D3 决策）
- AgentRunner 接口设计参考
- ContextPlugin 系统参考（Phase 0 后期的装饰器链）

**集成位置**：`docs/modules/agent-runtime.md`，`specs/provider-protocol.md`

## yoyo-evolve

**项目地址**：https://github.com/yologdev/yoyo-evolve

**项目性质**：单 Agent 自进化系统，Haro 的核心灵感来源

**资产内容**：
- **三阶段进化循环**：评估（Evaluate）→ 规划（Plan）→ 实现（Implement）
- **验证门控**：进化结果必须通过验证 Agent 否定测试才应用
- **装饰器链**：工具包装和增强的设计模式
- **身份认知文件**：IDENTITY.md / PERSONALITY.md（Agent 自我描述）
- **内置 Cron**：定时进化触发机制
- **GitHub Actions 集成**：CI/CD 触发进化

**Haro 集成方式**：
- Evolution Engine 的三阶段循环设计直接参考 yoyo-evolve
- 验证门控模式复用（并扩展为对抗性验证 Agent，遵守约束④）
- 装饰器链工具包装参考（Phase 0 后期）
- 内置 Cron + GitHub Actions 进化触发（Phase 2）

**Haro 扩展**：将 yoyo-evolve 的单 Agent 进化扩展为**平台级多 Agent 进化**：
- 平台代码自维护（Agent-as-Maintainer）
- Prompt A/B 测试
- 编排模式自动调整
- Pattern Mining（跨 Agent 的成功模式挖掘）

**集成位置**：`docs/evolution/feedback-loop.md`，`docs/evolution/self-improvement.md`

## 资产复用优先级

| 资产 | Phase 0 | Phase 1 | Phase 2 |
|------|---------|---------|---------|
| lark-bridge Claude 认证 | ✅ 直接复用 | — | — |
| KeyClaw CodexRunner | ✅ 直接参考 | — | — |
| aria-memory 文件格式 | ✅ 兼容 | ✅ 库抽取 | — |
| yoyo-evolve 进化循环 | — | — | ✅ 扩展实现 |
| KeyClaw ContextPlugin | — | ✅ 复用 | — |
| lark-bridge Hook 系统 | — | ✅ 参考 | — |
