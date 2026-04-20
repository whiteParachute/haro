# Phase 0 audit — 2026-04-19

_Last refreshed: 2026-04-20 after the FEAT-006 implementation slice._

## Scope and source of truth

This audit is based on the current repository state plus the documented Phase 0 contract in:

- `roadmap/phases.md`
- `specs/README.md`
- `specs/design-principles.md`
- `specs/phase-0/*.md`
- `docs/architecture/overview.md`

Per `specs/README.md`, the `specs/` tree is the single source of truth. This refresh assumes the approved FEAT-006 contract has now been fully implemented and the spec metadata has been advanced to match the repository evidence.

## Repository snapshot

Current implementation surfaces in this tree are concentrated in four packages:

- `packages/core`
- `packages/cli`
- `packages/provider-codex`
- `packages/providers`

Notable Phase-0-ready code now checked in under these packages includes:

- config / logger / fs / SQLite bootstrap
- agent schema + loader + registry
- memory fabric
- single-agent runtime (`packages/core/src/runtime/*`)
- CLI runtime surface (`packages/cli/src/{index,channel}.ts`) wired to the FEAT-005 runner

There are still **no** checked-in packages for external channels, skills, or manual eat/shit flows.

## Phase 0 delivery matrix

| Roadmap item | Spec status | Repo evidence | Audit verdict |
| --- | --- | --- | --- |
| P0-1 项目脚手架 | `done` | Monorepo root + config/logger/db/fs scaffolding exist under `packages/core`, `packages/cli`, `scripts/` | Delivered |
| P0-3 Codex Provider | `done` | `packages/provider-codex/src/*` implements provider, model listing, error mapping, health check | Delivered |
| P0-4 最小 Agent 定义 | `done` | `packages/core/src/agent/*` implements schema, loader, registry, default agent bootstrap | Delivered |
| P0-5 单 Agent 执行循环 | `done` | `packages/core/src/runtime/*` implements `AgentRunner`, selection rules, session persistence, fallback logging, continuation restore, timeout handling, and runtime exports | Delivered |
| P0-6 CLI 入口（cli channel） | `done` | `packages/cli/src/index.ts` implements commander-based `haro` / `haro run` / `haro model` / `haro config` / `haro doctor` / `haro status`; `packages/cli/src/channel.ts` implements a `CliChannel` + local `ChannelRegistry`; tests cover REPL slash commands, retry synthetic event, doctor, no-memory, `/new` continuation reset, and CLI-local model state | Delivered |
| P0-7 Memory Fabric 独立能力 | `done` | `packages/core/src/memory/*` implements MemoryFabric, pending merge, maintenance, context lookup | Delivered |
| P0-8 Channel 抽象层 + 飞书 | `approved` | No checked-in Feishu adapter / generic shared channel package beyond the FEAT-006 CLI-local surface | **Missing / not complete** |
| P0-9 Telegram Channel | `approved` | No checked-in Telegram adapter/package found in current tree | **Missing / not complete** |
| P0-10 Skills 子系统 + 15 预装 | `approved` | No checked-in skills runtime/manifest/preinstalled packaging found in current tree | **Missing / not complete** |
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

## Remaining confirmed gaps

The remaining implementation gap now starts at FEAT-008.

### 1. Shared channel layer + external adapters are still not checked in

The current monorepo still has no committed implementation for:

- the broader shared channel abstraction / registry expected to serve Feishu and Telegram (`FEAT-008`)
- Feishu adapter code
- Telegram adapter code

The FEAT-006 CLI-local channel surface is enough to satisfy the approved CLI contract, but it is **not** the rest of P0-8/P0-9.

### 2. Skills + eat/shit are still not checked in

No committed implementation was found for:

- a skills runtime/manifest/install flow (`FEAT-010`)
- preinstalled skill packaging
- manual `haro eat` / `haro shit` command paths (`FEAT-011`)

## Documentation decision log

### FEAT-006 status is now reconciled

`specs/phase-0/FEAT-006-cli-entry-and-cli-channel.md` now matches the shipped repo evidence and has been advanced to `done`. The next material delivery gap in Phase 0 therefore starts at FEAT-008.

### No new cross-spec contradiction found

I still did **not** find a clear case where two specs disagree and require immediate arbitration. The practical issue is now narrowed further: FEAT-006 has landed in code, while FEAT-008 through FEAT-011 remain unimplemented.

## Verification snapshot

Verification was rerun in the current worktree after the FEAT-006 changes landed.

- `pnpm lint` ✅
- `pnpm test` ✅
- `pnpm build` ✅
- manual REPL Ctrl-C shutdown validation ✅

These checks cover the FEAT-006 CLI surface plus the existing FEAT-001 / FEAT-003 / FEAT-004 / FEAT-005 / FEAT-007 foundations already present in this branch.

## Recommended next steps

1. Advance the shared channel abstraction and Feishu adapter work under FEAT-008.
2. Add the Telegram adapter under FEAT-009.
3. Add the skills subsystem and then wire `eat` / `shit` through it.
4. After FEAT-008+ land, rerun `pnpm lint`, `pnpm test`, and `pnpm build`, then refresh this audit before marking Phase 0 complete.
