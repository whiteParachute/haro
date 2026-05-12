# Haro

## 当前设计基线

**2026-05-08 新基线**：Haro 不再继续自建完整 workbench/runtime。AgentDock 是独立运行的 agent runtime / workbench；Haro 是 AgentDock 的可插拔 self-evolution sidecar。

依赖方向只能是：

```text
haro -> AgentDock public API / MCP / event export / filesystem contract
```

硬约束：

- AgentDock 不能 import Haro。
- Haro 不能 import AgentDock 内部 `src/*` 模块。
- Haro 接入 AgentDock 只走现有能力：外部 MCP server 注册、AgentDock scheduler/script task、AgentDock skills/MCP 调用面。
- Haro 不接管 AgentDock 的 Session、Runner、Memory Agent、IM、Web/PWA 或 Scheduler 主链路。
- Memory 由 AgentDock/aria-memory-vault 负责。Haro 不创建或维护自有 memory store，不改变 `aria-memory-vault` 结构；如需读写记忆，必须通过 AgentDock 暴露的 memory API/MCP/能力完成，Haro 侧最多保存 memory source ref / observation ref。
- 第一阶段只做 read-only / dry-run；L0/L1 apply 必须有 proposal、validation、snapshot、rollback ref。

历史基线：2026-05-01 双层架构（workbench + 进化）和 Phase 1.5 workbench parity 已归档，只作为可复用经验来源，不再作为后续主路径。

当前权威文档：

- [`docs/planning/agentdock-kernel-sidecar-architecture.md`](docs/planning/agentdock-kernel-sidecar-architecture.md)
- [`docs/architecture/overview.md`](docs/architecture/overview.md)
- [`roadmap/phases.md`](roadmap/phases.md)
- [`specs/sidecar/`](specs/sidecar/)（FEAT-043 到 FEAT-047）
- [`docs/planning/archive/redesign-2026-05-01.md`](docs/planning/archive/redesign-2026-05-01.md)（历史归档）

## 历史模块处理

| 历史模块 | 新状态 | 处理方式 |
| --- | --- | --- |
| Memory 接入 | AgentDock-owned | Haro 通过 AgentDock MCP/API/任务上下文读取记忆；不维护自有 Memory Fabric |
| MCP tools permission/audit | 保留经验 | 复用守门链思想，重建 Haro sidecar tools |
| Evolution Asset Registry | 保留并迁移 | 移到 sidecar 数据目录 |
| eat/shit | 保留思想 | 作为 asset metabolism 继续使用 |
| CLI / Web API / Web Dashboard | 降级 | admin/debug/control surface，不再主推 |
| Scenario Router / Team Orchestrator | 冻结 | 只保留 validation 相关经验 |
| Provider / Channel / Session runtime | 废弃主路径 | 不再继续扩展 |

## 开发收尾流程

每次开发任务结束（功能实现完、bug 修复完、阶段性收尾时），按顺序调用：

1. `/codex:review` — 用 Codex 对本次改动做独立评审
2. `/neat-freak` — 同步项目文档（CLAUDE.md、README、docs/）与 Agent 记忆

两步都跑完再认为这一轮工作真正完成。
