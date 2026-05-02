---
id: FEAT-039
title: CLI 功能等价补完（chat / session / agent / memory / logs / workflow / budget / user / skill / config）
status: draft
phase: phase-1.5
owner: whiteParachute
created: 2026-05-01
updated: 2026-05-01
related:
  - ../phase-0/FEAT-006-cli-entry-and-cli-channel.md
  - ../phase-1/FEAT-016-web-dashboard-agent-interaction.md
  - ../phase-1/FEAT-024-web-dashboard-knowledge-skills.md
  - ../phase-1/FEAT-025-web-dashboard-runtime-monitoring.md
  - ../phase-1/FEAT-028-web-dashboard-product-maturity.md
  - ../phase-1.5/FEAT-031-web-channel.md
  - ../phase-1.5/FEAT-033-scheduled-tasks.md
  - ../phase-1.5/FEAT-038-web-api-decoupling.md
  - ../../docs/cli-design.md
  - ../../docs/planning/redesign-2026-05-01.md
---

# CLI 功能等价补完（chat / session / agent / memory / logs / workflow / budget / user / skill / config）

## 1. Context / 背景

Haro 的"CLI 优先"边界约束（[2026-05-01 重设计第二条](../../docs/planning/redesign-2026-05-01.md)）要求 CLI 与 Web Dashboard 命令面等价。但当前 CLI 在 Phase 0 / Phase 1 完成的命令族只覆盖了 setup / doctor / provider / channel / gateway / skills / web / run / model / eat / shit / status 等"管理面"，缺**日常使用面**：

- 没有 `haro chat`（持续对话视图）
- 没有 `haro session list/show/resume`（会话浏览）
- 没有 `haro agent create/edit/delete`（CLI 端 agent 管理）
- 没有 `haro memory query/remember/list`（CLI 端记忆操作）
- 没有 `haro logs tail/show`（实时日志）
- 没有 `haro workflow list/replay`（编排查询）
- 没有 `haro budget show/audit`（预算 CLI 视图）
- 没有 `haro user`（多用户管理 CLI）
- `haro config` 只读，没有 set/get/unset
- `haro skill <name>` 单数详细控制缺失

参考 hermes-agent 的做法，CLI 必须能在脱离 Web UI 的情况下完成全部使用与配置。本 spec 把 [`docs/cli-design.md`](../../docs/cli-design.md) 中"Phase 1.5 规划中命令"段落落到 spec，作为实施依据。

## 2. Goals / 目标

- G1: 为 Web Dashboard 每个核心页面提供 CLI 等价命令族（详见 [cli-design § Web UI 等价对照表](../../docs/cli-design.md#web-ui-等价对照表)）。
- G2: 所有"列出 / 查询 / 状态"类命令必须支持 `--json` / `--human` 输出格式开关，便于脚本化。
- G3: 所有命令必须能通过 `--help` 自描述，含示例与常见错误码。
- G4: REPL 内补充 4 个 slash 命令：`/sessions` / `/memory` / `/logs` / `/budget`。
- G5: 共享底层：所有 CLI 命令都通过 `@haro/core` 与 `@haro/web-api` 共享同一 service layer，不允许 CLI 与 web-api 各自实现一遍业务逻辑。
- G6: 输出可被管道消费：JSON 模式默认 NDJSON 友好（一行一条记录），便于 `jq` / `grep` 链式处理。

## 3. Non-Goals / 不做的事

- 不重写已有命令族（setup / doctor / provider / channel / gateway / skills 复数 / web / run / model / eat / shit / status / update / config 只读）的内部逻辑。
- 不引入 TUI（terminal UI）框架；保持 commander + readline + clack 简单组合。
- 不实现命令补全（bash / zsh completion）；留给 follow-up spec。
- 不引入 plugin 机制让第三方扩展命令；命令面由 Haro 核心维护。
- 不做 CLI 端的 channel 直接发消息（"haro send-to feishu --session ..."）；那属于 FEAT-032 MCP 工具的脚本调用形态，通过 `haro run` 包装即可。

## 4. Requirements / 需求项

### 4.1 命令族列表

每个命令族对应一段 5.x design 章节。

- R1: `haro chat` — 进入 chat REPL；支持 `--session <id>` / `--agent <id>` / `--send "<msg>"`（单轮）/ `--history`（先选 session）。
- R2: `haro session` — `list` / `show <id>` / `show <id> --tail` / `resume <id>` / `export <id> [--format md|json]` / `delete <id>`。
- R3: `haro agent` — `list` / `show <id>` / `create <id> --from-template default` / `edit <id>` / `delete <id>` / `validate <id>` / `test <id> --task "..."`。
- R4: `haro memory` — `query "<q>" [--scope agent|shared|platform]` / `remember "<text>" --scope ...` / `list --scope ...` / `show <id>` / `export --scope ... --output <dir>`。
- R5: `haro logs` — `tail` / `tail --session <id>` / `show --since <dur> --level <l>` / `show --component provider|channel|workflow` / `export --since <dur> --output <file>`。
- R6: `haro workflow` — `list` / `show <id>` / `show <id> --json` / `replay <id>` / `checkpoints <id>`。
- R7: `haro budget` — `show` / `show --agent <id>` / `show --workflow <id>` / `set --agent <id> --tokens <n>` / `audit --since <dur>`。
- R8: `haro user` — `list` / `show <username>` / `create <username> --role owner|admin|viewer` / `role <username> <role>` / `disable <username>` / `reset-token <username>`。
- R9: `haro skill <name>` — 单数详细控制：`run [--input "..."]` / `disable` / `uninstall` / `show events` / `validate`。
- R10: `haro config` — 补完 `get <key>` / `set <key> <value> [--scope global|project]` / `unset <key> [--scope ...]`，secret 字段拒绝直接写明文 YAML。

### 4.2 通用约束

- R11: 所有命令必须支持 `--json` / `--human`；默认按 stdout 是否 TTY 自动选择（TTY → human，非 TTY → JSON）。
- R12: 所有写命令（create / edit / delete / set / cancel / disable）必须在动作前显示 dry-run 预览（除非 `--yes` 或 `--quiet`）；高风险动作（delete user / unset secretRef / wipe memory）必须二次确认。
- R13: 所有命令的实现必须调用 `@haro/core` 服务层 API，**禁止**在 CLI 包内重复实现业务逻辑或直接读写 SQLite。
- R14: 所有命令必须有结构化错误码 + remediation；错误码注册在 `packages/core/src/errors/` 共享，CLI 与 web-api 共用同一 catalog。
- R15: REPL slash `/sessions` / `/memory` / `/logs` / `/budget` 必须复用对应的 `haro <cmd>` 实现，不允许走两套代码路径。

## 5. Design / 设计要点

### 5.1 实现层级

```
packages/cli/src/index.ts
  └─ commander 注册子命令
        └─ packages/cli/src/commands/<topic>.ts (薄壳，处理参数)
              └─ packages/core/src/services/<topic>.ts (业务逻辑)
                    └─ DB / config / runtime / channel registry
```

`@haro/web-api` 调用同一组 service：

```
packages/web-api/src/routes/<topic>.ts
  └─ packages/core/src/services/<topic>.ts (同一份)
```

### 5.2 输出渲染

- JSON 模式：`{ ok: true, data: <payload> }` 单 record；`list` 命令输出 NDJSON（每行一条）
- Human 模式：表格用 `cli-table3` 或自实现轻量 renderer；颜色用 `chalk` 既有依赖
- 错误：JSON 输出 `{ ok: false, error: { code, message, remediation? } }`，exit code 非零

### 5.3 命令分组（commander 子命令树）

```
haro
├── chat           [-s|--session ID] [-a|--agent ID] [--send TEXT] [--history]
├── session
│   ├── list       [--status ...] [--limit N] [--json|--human]
│   ├── show ID    [--tail] [--json]
│   ├── resume ID
│   ├── export ID  [--format md|json] [-o FILE]
│   └── delete ID  [--yes]
├── agent
│   ├── list / show / create / edit / delete / validate / test
├── memory
│   ├── query "Q" / remember TEXT / list / show ID / export
├── logs
│   ├── tail [--session ID] / show [--since DUR] [--level L] [--component C] / export
├── workflow
│   ├── list / show ID / replay ID / checkpoints ID
├── budget
│   ├── show / set / audit
├── user
│   ├── list / show / create / role / disable / reset-token
├── skill SUBCMD ...     # skill <name> run / disable / ...
├── config
│   ├── get / set / unset
└── (existing commands)  setup / doctor / provider / channel / gateway / skills / web / run / model / eat / shit / status / update
```

### 5.4 REPL slash 补完

```
/sessions          # 列出最近 N 个 session，回车可切换
/memory <query>    # FTS5 搜索
/logs              # 当前 session 最近事件
/budget            # 当前 session 预算消耗
```

### 5.5 与 FEAT-038 的关系

CLI 命令通过 `@haro/core/services` 调用业务逻辑；web-api 通过同一 services 暴露 HTTP。两者在 service layer 汇合，所以 FEAT-039 必须先等 FEAT-038 把 service 抽出，否则 CLI 与 web-api 会出现两份实现。

## 6. Acceptance Criteria / 验收标准

- AC1: `haro chat --send "hello"` 完成单轮对话并返回 assistant 响应；不进入 REPL（对应 R1）。
- AC2: `haro session list --json` 输出 NDJSON，每行一条 session 记录，含 id / status / createdAt（对应 R2、R6、R11）。
- AC3: `haro agent create my-agent --from-template default` 创建 yaml 文件 + 注册 agent，`haro agent list` 能看到（对应 R3）。
- AC4: `haro memory remember "X" --scope shared` 触发 `needs-approval`（FEAT-023），CLI 显示 prompt，确认后写入；FEAT-022 asset 表对应记录创建（对应 R4、R12）。
- AC5: `haro logs tail --session <id>` 实时跟随 session events；Ctrl+C 干净退出（对应 R5）。
- AC6: `haro workflow show <id> --json` 输出与 web-api `/api/v1/workflows/:id` 完全一致（对应 R6、R13）。
- AC7: `haro budget show --agent code-reviewer` 输出 token 使用 / 剩余 / 是否触发 hard limit（对应 R7）。
- AC8: `haro user create alice --role admin` 在 RBAC 表增加用户；`haro user role alice viewer` 降权；`haro user reset-token alice` 输出新 token（对应 R8）。
- AC9: `haro skill <name> run --input "..."` 执行 skill 一次；`haro skill <name> show events` 列出最近调用记录（对应 R9）。
- AC10: `haro config set providers.codex.defaultModel <model> --scope global` 写 `~/.haro/config.yaml`；写 secret 路径（如 `providers.codex.apiKey`）被拒绝（对应 R10、R14）。
- AC11: REPL `/sessions` / `/memory` / `/logs` / `/budget` 与对应 `haro <cmd>` 行为一致（对应 R15）。
- AC12: 全部命令 `--json` 输出结构由 `packages/core/src/types/cli-output.ts` 类型守门，CI 校验无 drift（对应 R11）。

## 7. Test Plan / 测试计划

- 单元测试：每个命令的参数解析 / 错误分支 / dry-run 预览。
- 集成测试：CLI subprocess 实际跑各命令，对比 stdout 与 web-api 等价 endpoint 的 payload。
- E2E：用脚本化方式跑一次完整自用 flow（create user → create agent → chat → session list → memory remember → logs tail → workflow show → budget show → schedule task → config set），断言每步 exit code 与状态。
- 性能：CLI 冷启动 + `haro session list` P95 < 500ms。
- 兼容：bash / zsh / fish 三 shell 下 `--json | jq` 链路无 escape 问题。

## 8. Open Questions / 待定问题

- Q1: `haro chat` 是否需要支持 piped input？倾向支持 `cat prompt.md | haro chat --send -`。
- Q2: `haro logs export` 输出 jsonl 还是 zip？倾向 jsonl + 自动 gzip（`.jsonl.gz`）。
- Q3: 命令补全（bash / zsh）是否纳入 FEAT-039？倾向不纳入，单独 follow-up spec。
- Q4: `haro user` 的 token 重置如何与 FEAT-029 ChatGPT auth 共存？倾向 user token 仅用于本地 RBAC，不动 Codex 凭据。
- Q5: REPL 内是否需要支持调用任意 `haro <cmd>`（如 `:cli session list`）？倾向不做，避免 REPL 状态混乱；用户切到普通 shell 即可。

## 9. Changelog / 变更记录

- 2026-05-01: whiteParachute — 初稿（Phase 1.5 架构调整批次 1）
- 2026-05-02: whiteParachute — 批次 0 落地：抽出 `@haro/core/services`（sessions / agents / memory / logs / workflows）+ `@haro/core/errors`（`HaroError` 目录）+ `@haro/core/types/cli-output` 输出契约；同步反向迁移上述 5 个 `@haro/web-api` routes 调用 service（R5/R13 基础就位）；新增 `packages/cli/src/output/`（json / human / confirm 渲染器，R11/R12）+ `packages/web-api/src/lib/route-query.ts`；442 测试全过。批次 1（chat / session / agent 命令族）待动手。
