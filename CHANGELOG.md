# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- FEAT-035 done — Memory Fabric v2（Aria-Memory 文件存储对齐）。删除 v1 SQLite `memory_entries` / `memory_entries_fts` read model，改 aria-memory 风格的 `~/.haro/memory/<scope>/MEMORY.md + 散文件` 存储；公开 API 保留 v1 签名（`writeEntry / queryEntries / contextFor / markVerification / archiveEntry / stats`），新增 `searchMemoryFiles(query, options?)` 给 FEAT-031 / FEAT-032 等历史检索调用方使用，`runWrapup` / `runSleep` 钩子供 `aria-memory:memory-wrapup` / `memory-sleep` skill 调用。迁移：`MemoryFabric.migrateFromV1({ dbFile })` 把旧 SQLite 行幂等导入散文件并把源文件改名为 `<dbFile>.bak.<UTC ISO>`（30 天兜底，幂等可重跑）；兜底回滚：`MemoryFabric.recoverV1Snapshot({ dbFile?, bakFile? })` + `haro memory recover-snapshot` CLI 把指定快照 **copy** 到 `<dbFile>.recovered.<ISO>` 侧路径供 owner 用 sqlite3 forensic 检查或 selective re-import（不改名回 active 路径——bootstrap 永远先 initHaroDatabase 且 v2 已不读 SQLite）。codex 对抗性 review must-fix 全部修：（1）`bakFile` 严格校验后缀正则 `\.bak\.<UTC ISO>$` + 同目录 + statSync 是普通文件；（2）`mergePendingForWrapup` / `mergeAllPending` 在 wrapup/sleep 时**从磁盘 re-read .pending body**，并通过 `frontmatter.hash` 探测 body 改动后同步刷新 `summary`，避免 deposit 与 wrapup 之间外部编辑被静默丢弃。spec D8 收敛 FEAT-031 隐式偏离（Web Channel 会话历史走 `sessions.sqlite` 时间游标分页，长时记忆才走 `searchMemoryFiles`）。AC1-AC7 全部测试覆盖：memory-fabric-v2 18 用例（含 1000 entries P99 包络抗 O(n²) 退化、`HARO_PERF_STRICT=1` 走 spec R11 严格 300ms；canonical aria-memory frontmatter sparse hydration；deposit→runWrapup→pending 合并 lifecycle；deposit 后外部编辑保活回归；`recoverV1Snapshot` 三例覆盖 happy-path / 无快照 / 非法 `--from` 路径与后缀拒绝）。AC4 实证：web-api 72/72（含 FEAT-018/024/031）+ core 274/274（含 FEAT-022 evolution-asset-registry + FEAT-032 mcp-tools 56 用例）+ cli 151/151，`pnpm lint` / `pnpm -F @haro/{core,cli,web-api} build` clean。
- FEAT-034 done — 流式 UX 升级：新增 `@haro/core/stream` 12 类 `StreamEvent` 协议、`agentEventToStream` 翻译器与 bucket reducer；Web Channel WS 在 `channels.web.event` 上新增 structured `kind='stream'` envelope，同时保留 legacy `agent` envelope 迁移窗口；Dashboard Chat 接入 `MessageStream` / `MarkdownRenderer` / `ThinkingPanel` / `ToolTimeline` / `ImageLightbox`，覆盖 GFM 表格、代码高亮、未知语言纯文本 fallback、多图 lightbox、移动端抽屉式 timeline 与 react-window 虚拟化。Codex 对抗性 review 修复 structured/legacy 重复最终回答、CodeBlock fallback 假标签/行号、highlight spans 丢失与 ToolTimeline 状态色 token 偏离，并补 CLI final-content 去重、chat store handler、Markdown highlight/fallback 回归。验证：`pnpm lint`、`pnpm -F @haro/web lint`、`pnpm test`（12 包 725 用例）、`pnpm build`、`pnpm smoke` 全绿。
- FEAT-033 done — Cron 任务最小版（cron + 一次性，hermes-agent 风格 `tick()` + 三触发源）。命名 scheduled-tasks → cron 全量统一（包路径 / 表名 / CLI / 路由）。新增 `packages/core/src/cron/`（`types` / `cron-parser` / `storage` / `manager` / `runner` / `tick` / `host` / `inflight`）+ `services.cron`（list / get / create / cancel / trigger）。`AgentRunner.run` 新增 `signal?: AbortSignal` 协作取消通道；`CronRunner` 跑 advance → run → mark 链 + 三种 backoff retry（指数 / 线性 / 固定均按 5 分钟 cap 截断）。`tick()` 纯函数 + `cron_lease` 跨进程 SQLite advisory lock + 后台 `setInterval` 续约（TTL/2 间隔，try/catch 防 setInterval 回调抛出）；`createCronTickHost()` 长循环包装。三触发源任一在跑即可调度，**不强依赖 web-api**：`haro cron daemon` 守护进程 / `haro cron tick` 单次（系统 cron / launchd）/ web-api 进程内 60s ticker（`createWebApp` 自动挂 host，`startWebServer` 在 `ready` 后启动并 stop 时先 drain HTTP 再停 host）。落地 CLI `haro cron list/show/create/cancel/trigger/tick/daemon` 与 `/api/v1/cron/{jobs,jobs/:id,jobs/:id/trigger}`；HaroError → HTTP 400/404/409 映射；6 个新错误码（CRON_FREQUENCY_TOO_HIGH / CRON_QUOTA_EXCEEDED / CRON_INVALID_EXPRESSION / CRON_ONCE_IN_PAST / CRON_JOB_NOT_FOUND / CRON_TASK_INPUT_TOO_LARGE）。新依赖 `cron-parser ^5.5.0`（仅做解析 + `next_run_at` 计算，不引入 `node-schedule` 等常驻调度对象）。
  Codex adversarial review 共 3 轮全部修复：
  - **轮 1**（创建期校验）：配额按 `enabled=1 AND next_run_at IS NOT NULL` 计算（避免 recurring done 状态绕过配额）；once 严格 ISO-8601（必须 Z 或 ±HH:MM offset）；retryPolicy 在 create 时 normalize + 校验。
  - **轮 2**（4 high + 1 medium + 1 low）：`runInput` 加 `continueFromSessionId: record.sessionId`（违反 R5/G2）；`CronManager.cancel` 改 async + 进程内 `inflight` AbortController registry + `Promise.race(done, 30s)` graceful 超时 → `cancelled-forced`（违反 AC5/R10）；`tick()` 后台 `setInterval` 续约 lease（违反 AC8 长任务 lease 失效）；`storage.insertIfBelowQuota` 用 `db.transaction().immediate()` 包 count + insert（修 G7 TOCTOU race）；web-api `createWebApp`/`startWebServer` 自动挂 `CronTickHost`（违反 R12 第一条）；retry backoff 加 `MAX_RETRY_DELAY_MS = 5*60_000` cap。
  - **轮 3**（cancel 期 status 复活 race + 2 medium）：`cancel()` 立即 flip 'cancelled'，runner 所有 setStatus / advanceNextRun 加 `requireNotCancelled` SQL guard 防止 runner 写覆盖 cancel 意图；`runner.execute` 入口 re-read fresh，DB 已 cancel 直接 short-circuit；`tick.ts` re-read fresh 跳过 dispatch 队列里被 cancel 的 job；`tick.ts` renewer try/catch 防 `setInterval` 回调抛出炸进程；`server.stop` 改为先 drain HTTP 再停 cron host；测试加 `resetInflightForTest()` beforeEach/afterEach 防跨测试污染。
  - **已知限制**（spec §8 Q2 + `inflight.ts` 注释）：跨进程 cancel 无法 force-abort 另一进程的 in-flight job；只能在 DB 层 flip 'cancelled' 让对端下次 tick 跳过。
  测试：core 33 文件 / 223 测试 + cli 17/150 + web-api 11/65 + provider-codex 8/66 + web 13/38 + skills 3/19 + channel-* 8/9，全 monorepo 9 包 / 100 文件 / 570 测试全绿。
- FEAT-039 batch 2 — round out the FEAT-039 command surface with `haro memory` / `haro logs` / `haro workflow` / `haro budget` / `haro user` / `haro skill <id>` (singular) / `haro config get-set-unset`. New core services (`@haro/core/services/budget,config,users,skills`) backing them; `@haro/web-api/auth-store` collapses to a 121-line adapter (752 lines of user CRUD + audit + password handling moved into core), `web-api/src/lib/pagination.ts` shim deleted now that all routes call `services.normalizePageQuery`. Codex adversarial review fix-ups: `config set` recursively rejects secret-bearing children of object writes (e.g. `set channels.feishu '{"appSecret":"..."}'`); `haro logs tail` uses a `(createdAt, id)` compound cursor and drains pages within a tick so same-timestamp bursts are not dropped; CLI user mutations stamp `metadata.actorSource = 'cli'` (still `actor_kind='system'` because the audit table CHECK constraint only allows the four legacy kinds), bootstrap rows stamp `actorSource='bootstrap'` for parity. 5 new fix-up regression tests + 8 batch-2 smoke tests (468 passing total).
- FEAT-039 batch 1 — `haro chat` / `haro session` / `haro agent` command trees land on top of the batch-0 service layer. New runner contract: `RunAgentInput.continueFromSessionId` pins continuation to a specific prior session id (looked up by id alone, ignoring the latest-completed heuristic). `runRepl` now honors a pre-seeded `app.replState` so `chat --agent <id>` / `chat --session <id>` / `session resume <id>` actually take effect. `session resume` enters the same REPL path as `chat --session`. `session export` paginates `session_events` to completion (no silent 500-event truncation) and reports `exportedCount`. `agent test` runs as a true sandbox (`noMemory: true` + `continueLatestSession: false`). CLI-side session deletes log `cli.session.delete` to keep audit trails distinct from the dashboard's `web.session.delete`.
- FEAT-039 batch 0 — service-layer foundation: introduce `@haro/core/services` (sessions / agents / memory / logs / workflows), `@haro/core/errors` (`HaroError` catalog), and `@haro/core/types/cli-output`; reverse-migrate the same five `@haro/web-api` routes to call the shared services so CLI and Web API share one business-logic surface (FEAT-039 R5/R13). Adds `packages/cli/src/output/` (json / human / confirm renderers) for FEAT-039 R11/R12 and 14 new tests (442 passing total).
- FEAT-018: Web Dashboard Orchestration Debugger adds read-only workflow checkpoint REST APIs and a Dispatch page for fork-and-merge graph, branch ledger, merge envelope, checkpoint debug drawer, and budget/permission intervention summaries (implementation commit `c914dce`).
- FEAT-017: Web Dashboard System Management adds Status/Doctor/Config REST APIs, Status and Settings pages, project-level config save/validation, and embedded read-only channel summaries while preserving FEAT-019 ownership of `/api/v1/channels*`.
- FEAT-016: Web Dashboard Agent Interaction is closed as done, covering Chat, Sessions, WebSocket streaming, and Agent/Sessions REST surfaces.
- FEAT-020: Codex runtime `shit` skill sync is closed as done, pairing `eat` / `shit` in `$CODEX_HOME/skills` through `haro skills sync-runtime`.

### Changed

- FEAT-020 scope is Codex-only; non-Codex runtime sync and discovery work are no longer part of Haro.

## [0.1.0] - 2026-04-21

### Added

- **Release artifacts**
  - Publish `@haro/cli` and all workspace packages as versioned npm packages.
  - macOS / Linux one-liner install script (`scripts/install.sh`).
  - Windows PowerShell install script (`scripts/install.ps1`).
- **CLI**
  - `haro update` — check npm registry for newer versions and print upgrade instructions.
  - `haro update --check` — preview-only mode, no install prompt.
- **Docs**
  - README quick-install section promoted to top of page.
  - `docs/cli-design.md` updated with `haro update` specification.

### Changed

- Version bump from `0.0.0` → `0.1.0` across all workspace packages.
- Removed `private: true` from all publishable workspace packages.
- Added `engines.node: ">=22.0.0"` to all package manifests.

[Unreleased]: https://github.com/haro-ai/haro/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/haro-ai/haro/releases/tag/v0.1.0
