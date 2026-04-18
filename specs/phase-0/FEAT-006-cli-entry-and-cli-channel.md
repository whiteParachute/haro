---
id: FEAT-006
title: CLI 入口 + cli channel（REPL + 单次命令 + slash 命令）
status: draft
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-18
related:
  - ../../docs/cli-design.md
  - ../channel-protocol.md
  - ./FEAT-005-single-agent-execution-loop.md
  - ./FEAT-008-channel-abstraction-and-feishu.md
  - ../../roadmap/phases.md#p0-6cli-入口
---

# CLI 入口 + cli channel

## 1. Context / 背景

CLI 是 Haro 的第一个消息入口，也是 [Channel Abstraction](../channel-protocol.md) 的首个 adapter（`cli` channel）。REPL 交互与单次命令都通过同一条 Channel 路径走 Agent Runtime，确保飞书/Telegram 后续 adapter 与 CLI 完全同构。命令集参考 [CLI 设计](../../docs/cli-design.md)，命令实现由各个 FEAT 独立负责（Channel 管理由 FEAT-008，Skills 由 FEAT-010，eat/shit 由 FEAT-011），本 spec 只交付框架与基础命令。

## 2. Goals / 目标

- G1: `haro` 命令入口可用，支持 REPL 与单次任务两种模式
- G2: 命令路由骨架（commander.js），其他 FEAT 可挂载子命令
- G3: `cli` channel 实现 `MessageChannel` 接口，把 REPL 输入/输出转为 Inbound/Outbound 消息
- G4: REPL 内置 slash 命令基础集（见 R3）

## 3. Non-Goals / 不做的事

- 不实现 `haro channel` 命令族（由 FEAT-008 负责）
- 不实现 `haro skills` 命令族（由 FEAT-010 负责）
- 不实现 `haro eat` / `haro shit`（由 FEAT-011 负责）
- 不实现自定义快捷键、键位绑定（按 clack 默认）
- 不做 REPL 历史记录持久化（`~/.haro/repl-history` 留到 Phase 1）

## 4. Requirements / 需求项

- R1: CLI 入口基于 `commander.js`，提供路由骨架与子命令注册 API，供其他 FEAT 挂载
- R2: 默认命令：`haro`（REPL）、`haro run "<task>"`（单次）、`haro model` / `haro config` / `haro doctor` / `haro status`
- R3: REPL slash 命令集：`/model`、`/new`、`/retry`、`/compress`（Claude 且 `capabilities.contextCompaction === true` 时可用）、`/skills`（未实现时 log）、`/usage`、`/agent <id>`、`/help`
- R4: REPL 使用 `@clack/prompts` 作为交互库；单次命令使用 pretty print
- R5: 实现 `CliChannel implements MessageChannel`（id=`cli`）；`start()` 启动 REPL 循环，`send()` 将 Agent 输出打印到终端
- R6: 入站消息调用 `ctx.onInbound()` 把用户输入路由到 Scenario Router（Phase 0 直接调 FEAT-005 的 AgentRunner）
- R7: `haro doctor` 实现 Phase 0 可验收子集：检查 config 合法性、各 Provider.healthCheck、`~/.haro/` 目录可读写、SQLite 可连接；其他 Channel / Skill 检查在其 FEAT 交付后补齐
- R8: CLI 退出时调用 `ChannelRegistry.stop()` 优雅停机

## 5. Design / 设计要点

**命令注册骨架**

```typescript
// packages/cli/src/index.ts
import { program } from 'commander'

export function registerCommand(
  name: string,
  configure: (cmd: Command) => void
): void {
  configure(program.command(name))
}

// 其他 FEAT 在各自包 init 时：
registerCommand('channel', cmd => {
  cmd.command('list').action(listChannels)
  // ...
})
```

**REPL 流**

```
haro 启动
  → 读 config + 创建 AgentRunner
  → ChannelRegistry 注册 cli channel 并 start()
  → cli channel 进入 prompt 循环
    ├─ 纯文本 → ctx.onInbound({ type: 'text', content })
    ├─ /slash → 本地处理（不经 Scenario Router）
    └─ Ctrl-C → graceful shutdown
```

**slash 路由**

| 命令 | 实现位置 |
|------|---------|
| `/model` | cli channel 内，调用 `selectionEngine` 切换（Phase 0 写 session override） |
| `/new` | cli channel 内，清 session 引用 |
| `/retry` | 调用 Runner.retry(lastSessionId) |
| `/compress` | 仅在 `provider.capabilities().contextCompaction` 为 true 时启用，否则提示 |
| `/skills` | FEAT-010 未上时仅打印占位 |
| `/usage` | 查 `sessions.usage` 汇总 |
| `/agent <id>` | 切换当前 Agent |
| `/help` | 打印可用命令 |

## 6. Acceptance Criteria / 验收标准

- AC1: `haro run "列出当前目录下的 TypeScript 文件"` 打印结果并在 0 ≤ 返回码 = 0 的情况下结束（对应 R1、R2、R5）
- AC2: `haro` 进入 REPL 显示欢迎横幅 + 当前 Provider/Model；输入 `/help` 列出 R3 的全部 slash 命令（对应 R3）
- AC3: REPL 中输入任意中文自然语言，打印 Agent 流式/最终结果，与 `haro run` 等效（对应 R6）
- AC4: `haro doctor` 输出结构含：配置、Provider 状态、数据目录、SQLite；检出问题时返回码 ≠ 0（对应 R7）
- AC5: REPL 中按 Ctrl-C 退出，进程干净终止（无未 flushed 日志）（对应 R8）
- AC6: 使用 Codex Provider（capabilities.contextCompaction = false）时，`/compress` 返回提示 "当前 Provider 不支持上下文压缩"（对应 R3）
- AC7: 其他 FEAT（channel/skills/eat/shit）未实现时，`haro <不存在的子命令>` 返回 commander 默认的 help 信息（对应 R1）

## 7. Test Plan / 测试计划

- 单元测试：
  - `command-registry.test.ts` — 子命令注册/反注册
  - `slash-router.test.ts` — 各 slash 分支
  - `cli-channel.test.ts` — send/onInbound 的消息格式
- 集成测试：
  - `run-command.e2e.test.ts`（AC1）— 子进程跑 `haro run`
  - `repl-smoke.e2e.test.ts`（AC3）— 用 stdin 注入任务
- 手动验证：
  - AC2（视觉效果）
  - AC5（Ctrl-C 干净退出）

## 8. Open Questions / 待定问题

- Q1: `@clack/prompts` 是否支持持续输入流？若不支持需 fallback 到 `readline`
- Q2: `/retry` 是否重建 session 还是复用 sessionId？复用更易追踪但语义不清
- Q3: `haro run` 的 `--no-memory` flag 优先级与 FEAT-010 的 skill 配置如何协同？
- Q4: REPL 的 slash 命令是否走 Channel 协议？本 spec 选择"走本地路由"避免跨 channel 泄漏 CLI 专有语义

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
