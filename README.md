# Haro

> 贯穿高达作品的哈罗（Haro）——人人喜欢的电子宠物，也是主角团最忠实的战斗帮手。

**Haro 是一个自进化多 Agent 中间件平台** — 不只让 Agent 完成任务，还让 Agent 和平台本身在使用中自动变得更好。

## 设计哲学

传统平台：人类设计 → 人类开发 → 人类维护

**Haro**：人类设定方向 → Agent 设计/开发/测试 → Agent 自我进化 → 人类审阅/引导

- **人类** 是 **方向把控者 + 用户 + 最终裁决者**：提需求、反馈 Bug、给出架构演进方向、对 Agent 的提议行使认可权
- **Agent** 可从两类路径自主发现：内部（代码 review + 记忆挖掘）和外部（互联网调研）；提需求/选进化方向需用户认可

## 核心设计原则

1. **非核心组件皆可插拔（No-Intrusion Plugin Principle）** — Provider / Channel / Skill / MCP / Memory Backend 等外挂组件独立注册、独立装卸，核心模块零硬编码
2. **代谢优于堆积** — 通过 [eat / shit](specs/evolution-metabolism.md) 双向代谢，能力既增又减，防止膨胀

## 六层架构

```
┌─────────────────────────────────────────────┐
│            Human Interface                   │
├─────────────────────────────────────────────┤
│            Evolution Engine                  │
│   OODA 循环 + eat/shit 代谢 + @model-dependent  │
├─────────────────────────────────────────────┤
│            Scenario Router                   │
│   场景感知 → 动态 Workflow → 有状态图+Checkpoint │
├─────────────────────────────────────────────┤
│         Agent & Team Runtime                 │
│   Actor 模型 │ hub-spoke │ Memory Fabric      │
├─────────────────────────────────────────────┤
│       Provider Abstraction Layer             │
│   Codex │ ... （谁在回答）                     │
├─────────────────────────────────────────────┤
│       Channel Abstraction Layer              │
│   CLI │ Feishu │ Telegram │ ... （从哪里来）    │
├─────────────────────────────────────────────┤
│         Tool & Service Layer                 │
│   Skills │ MCP │ GitHub │ DB │ APIs          │
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

# 消息渠道管理
haro channel list
haro channel setup feishu

# 进化代谢
haro eat https://example.com/article
haro shit --scope skills --dry-run
```

## 文档

### 架构
- [架构总览（含设计原则）](docs/architecture/overview.md)
- [Provider Abstraction Layer](docs/architecture/provider-layer.md)

### 模块
- [Agent Runtime](docs/modules/agent-runtime.md)
- [Memory Fabric](docs/modules/memory-fabric.md)
- [Team Orchestrator](docs/modules/team-orchestrator.md)
- [Scenario Router](docs/modules/scenario-router.md)
- [Channel Layer（飞书 + Telegram）](docs/modules/channel-layer.md)
- [Skills 子系统（预装 15）](docs/modules/skills-system.md)

### 演化
- [反馈闭环](docs/evolution/feedback-loop.md)
- [自我改进机制（含 eat/shit 代谢）](docs/evolution/self-improvement.md)

### 规范（强制 / 协议）
- [多 Agent 设计约束规范（强制）](specs/multi-agent-design-constraints.md)
- [Provider 接入协议](specs/provider-protocol.md)
- [Provider 选择规则（含动态重评估）](specs/provider-selection.md)
- [Channel 接入协议](specs/channel-protocol.md)
- [Evolution 代谢机制（eat + shit）](specs/evolution-metabolism.md)

### 其他
- [CLI 设计](docs/cli-design.md)
- [数据目录](docs/data-directory.md)
- [四阶段路线图](roadmap/phases.md)
- [竞品调研](docs/research/landscape.md)
- [自有项目资产](docs/research/prior-art.md)

## 三大独有能力

1. **平台级自进化** — Prompt A/B 测试、编排模式自动调整、Pattern Mining、Agent-as-Maintainer + eat/shit 代谢
2. **多 Agent 编排智能** — Actor 模型 + 5 种编排模式 + 场景感知动态编排 + 有状态图 Checkpointing
3. **进化可观测** — Evolution Dashboard + 结构化进化日志 + 人类干预频率趋势

## 开发状态

| 阶段 | 状态 | 目标 |
|------|------|------|
| Phase 0: Foundation | 🚧 开发中 | PAL + Channel + Agent Runtime + Memory Fabric + Skills（15 预装）+ 手动 eat/shit |
| Phase 1: Intelligence | 📋 规划中 | Scenario Router + Team Orchestrator + Memory Fabric v1 |
| Phase 2: Evolution | 📋 规划中 | Evolution Engine + eat/shit 自动触发 + Provider 动态重评估 |
| Phase 3: Autonomy | 📋 规划中 | Agent-as-Developer |
| Phase 4: Ecosystem | 📋 规划中 | 开放生态 |

## 技术选型要点

- TypeScript (Node.js 22) 为主，其他语言按需引入
- 当前 Phase 0 仅保留 Codex Provider；其余技术栈（运行时、存储、记忆）仅为"参考"相邻项目，非强绑定

## License

待定
