# Phase 0 audit — 2026-04-19

## Scope and source of truth

This audit is based on the current repository state plus the documented Phase 0 contract in:

- `roadmap/phases.md`
- `specs/README.md`
- `specs/design-principles.md`
- `specs/phase-0/*.md`
- `docs/architecture/overview.md`

Per `specs/README.md`, the `specs/` tree is the single source of truth. If high-level docs describe a broader target state than the codebase currently ships, this audit treats the spec status + repository evidence as authoritative.

## Repository snapshot

Current implementation surfaces in this tree are concentrated in four packages:

- `packages/core` (now including the FEAT-005 runtime under `src/runtime/`)
- `packages/cli`
- `packages/provider-codex`
- `packages/providers`

Notable Phase-0-ready code already checked in under `packages/core` includes:

- config / logger / fs / SQLite bootstrap
- agent schema + loader + registry
- memory fabric
- single-agent runtime (`src/runtime/{runner,selection,types}.ts`)

There are still **no** checked-in packages for external channels, skills, or manual eat/shit flows. The CLI entrypoint is also still explicitly marked as a Phase-0 scaffold placeholder in `packages/cli/src/index.ts`.

## Phase 0 delivery matrix

| Roadmap item | Spec status | Repo evidence | Audit verdict |
| --- | --- | --- | --- |
| P0-1 项目脚手架 | `done` | Monorepo root + config/logger/db/fs scaffolding exist under `packages/core`, `packages/cli`, `scripts/` | Delivered |
| P0-3 Codex Provider | `done` | `packages/provider-codex/src/*` implements provider, model listing, error mapping, health check | Delivered |
| P0-4 最小 Agent 定义 | `done` | `packages/core/src/agent/*` implements schema, loader, registry, default agent bootstrap | Delivered |
| P0-5 单 Agent 执行循环 | `done` | `packages/core/src/runtime/*` implements `AgentRunner`, selection rules, session persistence, fallback logging, continuation restore, timeout handling, and root/runtime exports; focused tests cover selection precedence, fallback, continuation, timeout, and state writes | Delivered |
| P0-6 CLI 入口（cli channel） | `approved` | `packages/cli/src/index.ts` is a placeholder bootstrap/version/help surface, not the FEAT-006 command/runtime surface | **Missing / not complete** |
| P0-7 Memory Fabric 独立能力 | `done` | `packages/core/src/memory/*` implements MemoryFabric, pending merge, maintenance, context lookup | Delivered |
| P0-8 Channel 抽象层 + 飞书 | `approved` | No checked-in channel package/registry/Feishu adapter surface found in current tree | **Missing / not complete** |
| P0-9 Telegram Channel | `approved` | No checked-in Telegram adapter/package found in current tree | **Missing / not complete** |
| P0-10 Skills 子系统 + 15 预装 | `approved` | No checked-in skills runtime/manifest/preinstalled packaging found in current tree | **Missing / not complete** |
| P0-11 手动 eat / shit | `approved` | No checked-in eat/shit CLI or skill runtime integration found in current tree | **Missing / not complete** |

## Evidence for the confirmed gaps

### 1. FEAT-005 is now delivered and verified

What exists now:

- `packages/core/src/runtime/runner.ts` implements the single-agent execution loop
- `packages/core/src/runtime/selection.ts` implements agent/project/global/default selection precedence
- `packages/core/src/runtime/types.ts` defines runtime contracts
- `packages/core/src/runtime/index.ts` plus `packages/core/src/index.ts` / `package.json` now export the runtime surface
- focused tests now cover:
  - selection precedence + live model resolution
  - session/event persistence
  - continuation restore
  - fallback logging
  - timeout failure handling
  - cross-session agent state updates

FEAT-005 is no longer a gap item in Phase 0. The remaining implementation gap starts at FEAT-006.

### 2. FEAT-006 CLI is still scaffold-only

`packages/cli/src/index.ts` explicitly says:

- “Phase-0 CLI placeholder. Real commands arrive in FEAT-006.”
- The current behavior only supports bootstrap/help/version/config validation and directory creation.

That is sufficient for FEAT-001 acceptance, but it is not the REPL + `haro run` + `doctor` + cli channel surface required by FEAT-006.

### 2. Channel layer work is not checked in yet

The current monorepo still only ships these packages:

- `packages/core`
- `packages/cli`
- `packages/provider-codex`
- `packages/providers`

No committed channel packages or adapters were found for:

- Feishu (`FEAT-008`)
- Telegram (`FEAT-009`)
- a generic `MessageChannel` / `ChannelRegistry` implementation tied to the approved specs

### 3. Skills + eat/shit are not checked in yet

No committed implementation was found for:

- a skills runtime/manifest/install flow (`FEAT-010`)
- preinstalled skill packaging
- manual `haro eat` / `haro shit` command paths (`FEAT-011`)

## What *is* already solid in this branch

The current tree already has a coherent Phase-0 foundation for the pieces that are either marked done or now clearly implemented in code:

- config schema + directory bootstrap + logger + SQLite init (`FEAT-001`)
- Codex provider abstraction with live model listing/error translation (`FEAT-003`)
- strict agent config loading/registry/bootstrap (`FEAT-004`)
- single-agent runtime with selection/fallback/continuation/state persistence (`FEAT-005`)
- Memory Fabric with same-session visibility and maintenance flows (`FEAT-007`)

So the gap is **not** “the project has no Phase 0 code”; the gap is that Phase 0 is only **partially delivered** relative to the roadmap/spec contract, with FEAT-006 / FEAT-008 / FEAT-009 / FEAT-010 / FEAT-011 still outstanding.

## Documentation decision log

### Confirmed mismatch

There is still a confirmed mismatch between:

- the roadmap/spec expectation that Phase 0 includes P0-5 through P0-11, and
- the current checked-in implementation, which still lacks FEAT-006 / FEAT-008 / FEAT-009 / FEAT-010 / FEAT-011

There is no remaining status mismatch inside P0-5 itself: the implementation is present in code and the source-of-truth spec now marks FEAT-005 as `done`.

### No unresolved design contradiction found yet

During this audit, I still did **not** find a clear case where two specs disagree and require immediate arbitration. The practical issue remains incomplete implementation plus some stale delivery documentation.

## Verification snapshot

Verification was rerun for this FEAT-005 closure slice in the current worktree after `pnpm install --frozen-lockfile`.

- `pnpm lint` ✅
- `pnpm test` ✅
- `pnpm build` ✅

These checks validate the checked-in subset, including the runtime exports/tests added in this slice, but they still do **not** imply all approved Phase 0 specs have been implemented.

## Recommended next steps

1. Replace the scaffold CLI with FEAT-006 command/runtime behavior.
2. Add the channel abstraction + Feishu/Telegram adapters.
3. Add the skills subsystem and then wire `eat` / `shit` through it.
4. After those land, rerun `pnpm build`, `pnpm test`, `pnpm lint`, and refresh this audit before marking Phase 0 complete.
