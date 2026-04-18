# Haro

> 贯穿高达作品的哈罗（Haro）——人人喜欢的电子宠物，也是主角团最忠实的战斗帮手。

**Haro 是一个自进化多 Agent 中间件平台** — 不只让 Agent 完成任务，还让 Agent 和平台本身在使用中自动变得更好。

## 设计哲学

传统平台：人类设计 → 人类开发 → 人类维护

**Haro**：人类设定方向 → Agent 设计/开发/测试 → Agent 自我进化 → 人类审阅/引导

人类从「操作者」变为「方向引导者」和「最终裁决者」。

## 五层架构

```
┌─────────────────────────────────────────────┐
│            Human Interface                   │
│         (方向设定 / 审阅 / 裁决)               │
├─────────────────────────────────────────────┤
│            Evolution Engine                  │
│   Self-Monitor │ Pattern Miner │ Auto-Refactorer  │
│   OODA 循环 + @model-dependent 可演化标注        │
│   evolution-context/ 共享目录(原始数据不压缩传递)  │
├─────────────────────────────────────────────┤
│            Scenario Router                   │
│   场景感知 → 动态 Workflow 编排 → 有状态图+Checkpoint │
├─────────────────────────────────────────────┤
│         Agent & Team Runtime                 │
│   Agent Lifecycle │ Team Orchestrator │ Memory Fabric │
│   Actor 模型      │ hub-spoke 拓扑    │ 跨 Agent 共享 │
│   跨 session      │ 信息维度拆分      │ 多层索引      │
│   状态文件        │ 对抗性验证        │ aria-memory 扩展│
├─────────────────────────────────────────────┤
│         Provider Abstraction Layer           │
│   Claude │ GPT │ Gemini │ Local │ MCP │ Hermes │
│   能力矩阵 + 智能选择 + Fallback + 成本感知      │
├─────────────────────────────────────────────┤
│         Tool & Service Layer                 │
│   飞书 / GitHub / CI-CD / DB / FS / APIs     │
│   agentskills.io 标准兼容                     │
└─────────────────────────────────────────────┘
```

## 快速开始

> 施工中 — Phase 0 开发中

```bash
# 安装（尚未发布）
npm install -g haro

# 初始化
haro config

# 系统诊断
haro doctor

# 启动交互式 REPL
haro

# 单次任务
haro run "帮我分析这段代码的性能问题"
```

## 文档

- [架构总览](docs/architecture/overview.md)
- [Provider 抽象层](docs/architecture/provider-layer.md)
- [多 Agent 设计约束规范](specs/multi-agent-design-constraints.md)（强制）
- [Provider 接入协议](specs/provider-protocol.md)
- [Provider 选择规则](specs/provider-selection.md)
- [Agent Runtime](docs/modules/agent-runtime.md)
- [Memory Fabric](docs/modules/memory-fabric.md)
- [Team Orchestrator](docs/modules/team-orchestrator.md)
- [Scenario Router](docs/modules/scenario-router.md)
- [CLI 设计](docs/cli-design.md)
- [数据目录](docs/data-directory.md)
- [四阶段路线图](roadmap/phases.md)
- [竞品调研](docs/research/landscape.md)
- [自有项目资产](docs/research/prior-art.md)
- [反馈闭环](docs/evolution/feedback-loop.md)
- [自我改进机制](docs/evolution/self-improvement.md)

## 三大独有能力

1. **平台级自进化** — Prompt A/B 测试、编排模式自动调整、Pattern Mining、Agent-as-Maintainer
2. **多 Agent 编排智能** — Actor 模型 + 5 种编排模式 + 场景感知动态编排 + 有状态图 Checkpointing
3. **进化可观测** — Evolution Dashboard + 结构化进化日志 + 人类干预频率趋势

## 开发状态

| 阶段 | 状态 | 目标 |
|------|------|------|
| Phase 0: Foundation | 🚧 开发中 | PAL + Agent Runtime + 记忆集成 + CLI |
| Phase 1: Intelligence | 📋 规划中 | Scenario Router + Team Orchestrator |
| Phase 2: Evolution | 📋 规划中 | Evolution Engine |
| Phase 3: Autonomy | 📋 规划中 | Agent-as-Developer |
| Phase 4: Ecosystem | 📋 规划中 | 开放生态 |

## License

待定
