---
id: FEAT-006
title: CLI 入口 + cli channel（REPL + 单次命令 + slash 命令）
status: done
phase: phase-0
owner: whiteParachute
created: 2026-04-18
updated: 2026-04-20
related:
  - ../../docs/cli-design.md
  - ../channel-protocol.md
  - ./FEAT-005-single-agent-execution-loop.md
  - ./FEAT-008-channel-abstraction-and-feishu.md
  - ../../roadmap/phases.md#p0-6cli-入口
---

# CLI 入口 + cli channel

## 1. Context / 背景

CLI 是 Haro 的第一个消息入口，也是 [Channel Abstraction](../channel-protocol.md) 的首个 adapter（`cli` channel）。REPL 交互与单次命令都通过同一条 Channel 路径走 Agent Runtime，确保飞书/Telegram 后续 adapter 与 CLI 完全同构。命令集参考 [CLI 设计](../../docs/cli-design.md)，命令实现由各个 FEAT 独立负责（Channel 管理由 FEAT-008，Skills 由 FEAT-010，eat/shit 由 FEAT-011），本 spec 交付框架与基础命令。

## 2. Goals / 目标

- G1: `haro` 命令入口可用，支持 REPL 与单次任务两种模式
- G2: 命令路由骨架（commander.js），其他 FEAT 可挂载子命令
- G3: `cli` channel 实现 `MessageChannel` 接口，把 REPL 输入/输出转为 Inbound/Outbound 消息
- G4: REPL 内置 slash 命令基础集（见 R3）

## 3. Non-Goals / 不做的事

- 不实现 `haro channel` 命令族（由 FEAT-008 负责）
- 不实现 `haro skills` 命令族（由 FEAT-010 负责）
- 不实现 `haro eat` / `haro shit`（由 FEAT-011 负责）
- 不做自定义键位绑定 / 全屏 TUI
- 不做 REPL 历史记录持久化（`~/.haro/repl-history` 留到 Phase 1）

## 4. Requirements / 需求项

- R1: CLI 入口基于 `commander.js`，提供路由骨架与子命令注册 API，供其他 FEAT 挂载
- R2: 默认命令：`haro`（REPL）、`haro run "<task>"`（单次）、`haro model` / `haro config` / `haro doctor` / `haro status`
- R3: REPL slash 命令集：`/model`、`/new`、`/retry`、`/compress`（仅当 `provider.capabilities().contextCompaction === true` 时可用）、`/skills`、`/usage`、`/agent <id>`、`/help`
- R4: 连续 REPL 输入循环使用 Node `readline/promises`；`@clack/prompts` 仅用于欢迎横幅、确认、选择器等一次性交互
- R5: 实现 `CliChannel implements MessageChannel`（`id = 'cli'`）；`start()` 启动 REPL 循环，`send()` 将 Agent 输出打印到终端
- R6: 入站消息调用 `ctx.onInbound()` 把用户输入路由到 Runner；slash 命令只在 CLI 本地消费，不透传给其他 channel
- R7: `haro doctor` 实现 Phase 0 可验收子集：检查 config 合法性、各 Provider.healthCheck、`~/.haro/` 目录可读写、SQLite 可连接；其他 Channel / Skill 检查在其 FEAT 交付后补齐
- R8: CLI 退出时调用 `ChannelRegistry.stop()` 优雅停机
- R9: `/retry` 必须创建**新 session** 重跑上一次用户输入；通过一条 `session_retry` synthetic event 关联旧 session，避免复用旧 sessionId 污染历史
- R10: `haro run --no-memory` 对当前 session 生效，优先级高于 Agent 默认配置与自动 skill；关闭 memory read/write 与 `memory-wrapup`

## 5. Design / 设计要点

**命令注册骨架**

```typescript
import { program } from 'commander'

export function registerCommand(name: string, configure: (cmd: Command) => void): void {
  configure(program.command(name))
}
```

**REPL 流**

```
haro 启动
  → 读 config + 创建 AgentRunner
  → ChannelRegistry 注册 cli channel 并 start()
  → readline 循环读取用户输入
    ├─ 纯文本 → ctx.onInbound({ type: 'text', content })
    ├─ /slash → 本地处理（不经 Runner）
    └─ Ctrl-C / EOF → graceful shutdown
```

**slash 路由**

| 命令 | 实现位置 |
|------|---------|
| `/model` | cli channel 内，读写 session override |
| `/new` | cli channel 内，清当前 session 引用 |
| `/retry` | 新建 session，写 `session_retry` event 后调用 Runner |
| `/compress` | 仅在 `contextCompaction === true` 时启用，否则提示 |
| `/skills` | 若 FEAT-010 未上，输出占位说明 |
| `/usage` | 查 `sessions` / `session_events` 汇总 |
| `/agent <id>` | 切换当前 Agent |
| `/help` | 打印可用命令 |

## 6. Acceptance Criteria / 验收标准

- AC1: `haro run "列出当前目录下的 TypeScript 文件"` 打印结果并以返回码 0 结束（对应 R1、R2、R5）
- AC2: `haro` 进入 REPL 显示欢迎横幅 + 当前 Provider/Model；输入 `/help` 列出 R3 的全部 slash 命令（对应 R3、R4）
- AC3: REPL 中输入任意中文自然语言，打印 Agent 结果，与 `haro run` 等效（对应 R5、R6）
- AC4: `haro doctor` 输出结构含：配置、Provider 状态、数据目录、SQLite；检出问题时返回码 ≠ 0（对应 R7）
- AC5: REPL 中按 Ctrl-C 退出，进程干净终止（无未 flushed 日志）（对应 R8）
- AC6: 使用 Codex Provider（`contextCompaction = false`）时，`/compress` 返回提示 "当前 Provider 不支持上下文压缩"（对应 R3）
- AC7: 执行 `/retry` 后产生新 session，且新 session 的首条 synthetic event 指向旧 sessionId（对应 R9）
- AC8: `haro run --no-memory "..."` 时本次 session 不读写 memory，且无 `memory-wrapup` hook（对应 R10）

## 7. Test Plan / 测试计划

- 单元测试：
  - `command-registry.test.ts` — 子命令注册
  - `slash-router.test.ts` — 各 slash 分支
  - `cli-channel.test.ts` — send/onInbound 的消息格式
  - `retry-routing.test.ts` — 新 session + synthetic event
- 集成测试：
  - `run-command.e2e.test.ts` — 子进程跑 `haro run`
  - `repl-smoke.e2e.test.ts` — 用 stdin 注入任务
  - `no-memory.e2e.test.ts` — `--no-memory` 优先级
- 手动验证：
  - AC2（视觉效果）
  - AC5（Ctrl-C 干净退出）

## 8. Open Questions / 待定问题

全部已关闭（见 Changelog 2026-04-19 决策条）。

## 9. Changelog / 变更记录

- 2026-04-18: whiteParachute — 初稿
- 2026-04-19: whiteParachute — 关闭 Open Questions → approved
  - Q1 → `@clack/prompts` 不承担持续 REPL 输入；Phase 0 改为 `readline/promises` 跑循环，clack 只负责一次性交互
  - Q2 → `/retry` 使用新 session + synthetic event 关联旧 session；不复用旧 sessionId
  - Q3 → `--no-memory` 为最高优先级 session override，关闭 memory read/write 与 wrapup
  - Q4 → slash 命令坚持本地路由，不走通用 Channel 协议，避免 CLI 专有语义泄漏到其他 channel
- 2026-04-20: whiteParachute — done
  - `packages/cli/src/{index,channel}.ts`、`packages/cli/bin/haro.js` 与 `packages/cli/package.json` 落地 commander CLI + `CliChannel`，打通 `haro` REPL、`haro run`、`haro model` / `config` / `doctor` / `status`，并保持 slash 命令本地消费
  - `packages/core/src/runtime/{runner,types}.ts` 为 `/new` 增加 per-session continuation reset 开关，确保 FEAT-006 仍复用 FEAT-005 Runner 主路径而不是分叉第二套执行栈
  - `packages/cli/test/{cli,bin-entrypoint}.test.ts` 补齐 run / REPL / doctor / retry synthetic event / no-memory / model state / config error / binary entrypoint 覆盖；2026-04-20 手动复核 Ctrl-C 退出路径后完成交付
