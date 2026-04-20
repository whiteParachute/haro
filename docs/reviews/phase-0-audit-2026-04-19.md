# Phase 0 audit — 2026-04-19

_Last refreshed: 2026-04-20 after the FEAT-010 implementation slice._

## Scope and source of truth

This audit is based on the current repository state plus the documented Phase 0 contract in:

- `roadmap/phases.md`
- `specs/README.md`
- `specs/design-principles.md`
- `specs/phase-0/*.md`
- `docs/architecture/overview.md`

Per `specs/README.md`, the `specs/` tree is the single source of truth. This refresh assumes the approved FEAT-006 contract has now been fully implemented and the spec metadata has been advanced to match the repository evidence.

## Repository snapshot

Current implementation surfaces in this tree are concentrated in eight packages:

- `packages/core`
- `packages/channel`
- `packages/channel-feishu`
- `packages/channel-telegram`
- `packages/skills`
- `packages/cli`
- `packages/provider-codex`
- `packages/providers`

Notable Phase-0-ready code now checked in under these packages includes:

- config / logger / fs / SQLite bootstrap
- agent schema + loader + registry
- memory fabric
- single-agent runtime (`packages/core/src/runtime/*`)
- shared channel protocol / registry / session store (`packages/channel/src/*`)
- Feishu adapter (`packages/channel-feishu/src/*`)
- Telegram adapter (`packages/channel-telegram/src/*`)
- skills subsystem (`packages/skills/src/*` + `packages/skills/resources/*`)
- CLI runtime surface (`packages/cli/src/{index,channel}.ts`) wired to the FEAT-005 runner and FEAT-008/009/010 command families

There are still **no** checked-in packages for manual eat/shit flows.

## Phase 0 delivery matrix

| Roadmap item | Spec status | Repo evidence | Audit verdict |
| --- | --- | --- | --- |
| P0-1 项目脚手架 | `done` | Monorepo root + config/logger/db/fs scaffolding exist under `packages/core`, `packages/cli`, `scripts/` | Delivered |
| P0-3 Codex Provider | `done` | `packages/provider-codex/src/*` implements provider, model listing, error mapping, health check | Delivered |
| P0-4 最小 Agent 定义 | `done` | `packages/core/src/agent/*` implements schema, loader, registry, default agent bootstrap | Delivered |
| P0-5 单 Agent 执行循环 | `done` | `packages/core/src/runtime/*` implements `AgentRunner`, selection rules, session persistence, fallback logging, continuation restore, timeout handling, and runtime exports | Delivered |
| P0-6 CLI 入口（cli channel） | `done` | `packages/cli/src/index.ts` implements commander-based `haro` / `haro run` / `haro model` / `haro config` / `haro doctor` / `haro status`; `packages/cli/src/channel.ts` implements a `CliChannel` + local `ChannelRegistry`; tests cover REPL slash commands, retry synthetic event, doctor, no-memory, `/new` continuation reset, and CLI-local model state | Delivered |
| P0-7 Memory Fabric 独立能力 | `done` | `packages/core/src/memory/*` implements MemoryFabric, pending merge, maintenance, context lookup | Delivered |
| P0-8 Channel 抽象层 + 飞书 | `done` | `packages/channel/src/*` implements shared channel protocol / registry / session store; `packages/channel-feishu/src/*` implements the Feishu adapter; `packages/cli/src/index.ts` exposes `haro channel list/enable/disable/remove/doctor/setup` | Delivered |
| P0-9 Telegram Channel | `done` | `packages/channel-telegram/src/*` implements the Telegram adapter with long polling, private-stream draft support, attachment metadata preservation, and CLI wiring through the FEAT-008 channel command family | Delivered |
| P0-10 Skills 子系统 + 15 预装 | `done` | `packages/skills/src/*` implements the skills runtime/manifest/install/usage flow; `packages/skills/resources/preinstalled/*` vendors 15 preinstalled skills; `packages/cli/src/index.ts` exposes `haro skills list/install/uninstall/info/enable/disable` | Delivered |
| P0-11 手动 eat / shit | `approved` | No checked-in eat/shit CLI or skill runtime integration found in current tree | **Missing / not complete** |

## Evidence for FEAT-006 landing

### 1. CLI command/runtime surface now exists

What exists now:

- `packages/cli/src/index.ts` implements the FEAT-006 command surface:
  - default `haro` REPL entry
  - `haro run "..."`
  - `haro model`
  - `haro config`
  - `haro doctor`
  - `haro status`
- `packages/cli/src/channel.ts` implements a CLI-local `MessageChannel` shape plus `CliChannel` / `ChannelRegistry`
- `packages/cli/bin/haro.js` now awaits the async CLI entry instead of assuming a synchronous placeholder
- `packages/cli/package.json` now declares the FEAT-006 command/runtime dependencies (`commander`, `@clack/prompts`, `@haro/provider-codex`)

### 2. FEAT-006 is correctly wired into the FEAT-005 runtime foundation

The new CLI surface is not a parallel execution stack. It uses the existing FEAT-005 foundation:

- `AgentRunner.run(...)` remains the execution path for `haro run` and REPL text input
- `/retry` uses FEAT-005's existing `retryOfSessionId` path and writes the required `session_retry` synthetic event into `session_events`
- `haro run --no-memory` passes the FEAT-006 session override into the FEAT-005 runner so memory read/write + wrapup are skipped for that session
- `/new` now clears continuation for the next REPL turn through a runner input override instead of forking a second runtime path

### 3. FEAT-006 test coverage is now present

Current checked-in CLI coverage now includes:

- `packages/cli/test/cli.test.ts`
  - AC1 `haro run`
  - AC2 `/help`
  - AC3 REPL natural-language path
  - AC4 `haro doctor`
  - AC6 `/compress` unsupported message for Codex
  - AC7 `/retry` synthetic event + new session
  - AC8 `--no-memory`
  - `/new` continuation reset regression
  - CLI-local model state persistence
- manual REPL validation on 2026-04-20 confirmed the Ctrl-C shutdown path required by AC5
- `packages/cli/test/bin-entrypoint.test.ts`
  - shipped binary version path
  - shipped binary config validation failure path

## Evidence for FEAT-008 landing

### 1. Shared channel layer is now checked in

What exists now:

- `packages/channel/src/protocol.ts` defines the shared `MessageChannel` contract
- `packages/channel/src/registry.ts` implements `ChannelRegistry` with `register/get/list/enable/disable/remove`
- `packages/channel/src/session-store.ts` persists channel session mapping to `~/.haro/channels/<id>/sessions.sqlite`, attempts WAL, and warns when SQLite falls back
- `packages/cli/src/channel.ts` now re-exports the shared channel layer instead of carrying a CLI-only copy

### 2. Feishu adapter is now checked in

What exists now:

- `packages/channel-feishu/src/client.ts` adapts the lark-bridge websocket client pattern around the official Feishu Node SDK
- `packages/channel-feishu/src/feishu-channel.ts` implements `FeishuChannel` with:
  - websocket event intake
  - `per-chat` / `per-user` session mapping
  - stable attachment metadata in `meta.attachments`
  - `state.json` redaction (no `tenant_access_token` / `appSecret`)
  - `doctor()` / `setup()` support for the CLI channel command family

### 3. FEAT-008 CLI surface is now wired

What exists now:

- `packages/cli/src/index.ts` exposes `haro channel list/enable/disable/remove/doctor/setup`
- startup uses the shared registry and only starts enabled external channels
- the Feishu package is treated as optional at startup, preserving CLI-only execution when the package is unavailable

### 4. FEAT-008 verification coverage is now present

Current checked-in FEAT-008 coverage now includes:

- `packages/channel/test/channel-registry.test.ts`
- `packages/channel-feishu/test/feishu-inbound-mapping.test.ts`
- `packages/channel-feishu/test/session-mapping.test.ts`
- `packages/channel-feishu/test/state-redaction.test.ts`
- `packages/cli/test/cli.test.ts`
  - `channel list`
  - `channel setup feishu`
  - `channel doctor feishu`
  - CLI-only pluggability when no external channel package is registered

## Evidence for FEAT-009 landing

### 1. Telegram adapter is now checked in

What exists now:

- `packages/channel-telegram/src/telegram-channel.ts` implements `TelegramChannel`
- `packages/channel-telegram/src/transport.ts` wraps `grammy` long polling, `@grammyjs/auto-retry`, and `@grammyjs/stream`
- `packages/channel-telegram/src/config.ts` resolves env-interpolated `botToken`, transport, allowed updates, and session scope

### 2. Private-stream / group-fallback behavior is now encoded

What exists now:

- private chats accept text deltas and feed them into the Telegram stream plugin
- group chats ignore delta drafts and only receive the final response
- non-streaming providers still yield a single final message path

### 3. FEAT-009 verification coverage is now present

Current checked-in FEAT-009 coverage now includes:

- `packages/channel-telegram/test/telegram-inbound.test.ts`
- `packages/channel-telegram/test/session-scope.test.ts`
- `packages/channel-telegram/test/stream-mode.test.ts`
- `packages/channel-telegram/test/attachment-meta.test.ts`
- `packages/cli/test/cli.test.ts`
  - `channel setup telegram`
  - `channel doctor telegram`
  - pluggability when Telegram is absent but Feishu remains registered
- `packages/core/test/runtime-runner.test.ts`
  - event callback ordering for streaming-capable channels

## Evidence for FEAT-010 landing

### 1. Skills runtime is now checked in

What exists now:

- `packages/skills/src/manager.ts` implements preinstalled expansion, installed manifest reconciliation, git/path install, uninstall guards, enable/disable, and trigger preparation
- `packages/skills/src/usage-tracker.ts` persists `usage.sqlite` counters
- `packages/skills/src/frontmatter.ts` parses Claude Code compatible `SKILL.md` metadata

### 2. Fifteen preinstalled skills are now vendored

What exists now:

- `packages/skills/resources/preinstalled/*` contains 15 preinstalled skill snapshots
- `packages/skills/resources/preinstalled-manifest.json` records `source / pinnedCommit / license / keywords / handler`
- first launch expands these snapshots into `~/.haro/skills/preinstalled/`

### 3. Skill routing is now encoded

What exists now:

- explicit slash triggers are resolved before provider execution
- description matching selects at most one enabled skill using manifest keywords
- memory-class handlers route through `MemoryFabric` instead of touching memory files directly

### 4. FEAT-010 verification coverage is now present

Current checked-in FEAT-010 coverage now includes:

- `packages/skills/test/preinstall-expand.test.ts`
  - first-launch preinstall expansion
  - uninstall guard
  - usage tracking
  - description routing
  - symlink install
  - git install
- `packages/cli/test/cli.test.ts`
  - `skills list`
  - uninstall guard via CLI
  - explicit `/memory` trigger
  - description match preferring `remember` over `eat`

## Remaining confirmed gaps

The remaining implementation gap now starts at FEAT-011.

### 1. Manual eat/shit are still not checked in

No committed implementation was found for:

- a skills runtime/manifest/install flow (`FEAT-010`)
- preinstalled skill packaging
- manual `haro eat` / `haro shit` command paths (`FEAT-011`)

## Documentation decision log

### FEAT-006 status is now reconciled

`specs/phase-0/FEAT-010-skills-subsystem.md` now matches the shipped repo evidence and has been advanced to `done`. The next material delivery gap in Phase 0 therefore starts at FEAT-011.

### No new cross-spec contradiction found

I still did **not** find a clear case where two specs disagree and require immediate arbitration. The practical issue is now narrowed further: FEAT-010 has landed in code, while FEAT-011 remains unimplemented.

## Verification snapshot

Verification was rerun in the current worktree after the FEAT-010 changes landed.

- `pnpm lint` ✅
- `pnpm test` ✅
- `pnpm build` ✅
- manual REPL Ctrl-C shutdown validation ✅

These checks cover the FEAT-010 skills slice plus the existing FEAT-001 / FEAT-003 / FEAT-004 / FEAT-005 / FEAT-006 / FEAT-007 / FEAT-008 / FEAT-009 foundations already present in this branch.

## Recommended next steps

1. Wire `eat` / `shit` through the FEAT-010 skill runtime under FEAT-011.
2. After the final slice lands, rerun `pnpm lint`, `pnpm test`, and `pnpm build`, then refresh this audit before marking Phase 0 complete.
