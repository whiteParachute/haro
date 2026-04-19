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

- `packages/core`
- `packages/cli`
- `packages/provider-codex`
- `packages/providers`

There are currently **no** checked-in packages for external channels, skills, or manual eat/shit flows. The CLI entrypoint is also still explicitly marked as a Phase-0 scaffold placeholder in `packages/cli/src/index.ts`.

## Phase 0 delivery matrix

| Roadmap item | Spec status | Repo evidence | Audit verdict |
| --- | --- | --- | --- |
| P0-1 项目脚手架 | `done` | Monorepo root + config/logger/db/fs scaffolding exist under `packages/core`, `packages/cli`, `scripts/` | Delivered |
| P0-3 Codex Provider | `done` | `packages/provider-codex/src/*` implements provider, model listing, error mapping, health check | Delivered |
| P0-4 最小 Agent 定义 | `done` | `packages/core/src/agent/*` implements schema, loader, registry, default agent bootstrap | Delivered |
| P0-5 单 Agent 执行循环 | `approved` | Spec exists, but no checked-in `AgentRunner`/session execution loop implementation matching FEAT-005 requirements | **Missing / not complete** |
| P0-6 CLI 入口（cli channel） | `approved` | `packages/cli/src/index.ts` is a placeholder bootstrap/version/help surface, not the FEAT-006 command/runtime surface | **Missing / not complete** |
| P0-7 Memory Fabric 独立能力 | `done` | `packages/core/src/memory/*` implements MemoryFabric, pending merge, maintenance, context lookup | Delivered |
| P0-8 Channel 抽象层 + 飞书 | `approved` | No checked-in channel package/registry/Feishu adapter surface found in current tree | **Missing / not complete** |
| P0-9 Telegram Channel | `approved` | No checked-in Telegram adapter/package found in current tree | **Missing / not complete** |
| P0-10 Skills 子系统 + 15 预装 | `approved` | No checked-in skills runtime/manifest/preinstalled packaging found in current tree | **Missing / not complete** |
| P0-11 手动 eat / shit | `approved` | No checked-in eat/shit CLI or skill runtime integration found in current tree | **Missing / not complete** |

## Evidence for the confirmed gaps

### 1. FEAT-005 runner is not present in the current tree

- `specs/phase-0/FEAT-005-single-agent-execution-loop.md` is still `status: approved`, not `done`.
- Current `packages/core/src/agent/` contains config/bootstrap/loader/registry helpers, but no committed `AgentRunner` implementation or session execution loop matching FEAT-005.

### 2. FEAT-006 CLI is still scaffold-only

`packages/cli/src/index.ts` explicitly says:

- “Phase-0 CLI placeholder. Real commands arrive in FEAT-006.”
- The current behavior only supports bootstrap/help/version/config validation and directory creation.

That is sufficient for FEAT-001 acceptance, but it is not the REPL + `haro run` + `doctor` + cli channel surface required by FEAT-006.

### 3. Channel layer work is not checked in yet

The current monorepo only contains:

- `packages/core`
- `packages/cli`
- `packages/provider-codex`
- `packages/providers`

No committed channel packages or adapters were found for:

- Feishu (`FEAT-008`)
- Telegram (`FEAT-009`)
- a generic `MessageChannel` / `ChannelRegistry` implementation tied to the approved specs

### 4. Skills + eat/shit are not checked in yet

No committed implementation was found for:

- a skills runtime/manifest/install flow (`FEAT-010`)
- preinstalled skill packaging
- manual `haro eat` / `haro shit` command paths (`FEAT-011`)

## What *is* already solid in this branch

The current tree already has a coherent Phase-0 foundation for the pieces that are marked done:

- config schema + directory bootstrap + logger + SQLite init (`FEAT-001`)
- Codex provider abstraction with live model listing/error translation (`FEAT-003`)
- strict agent config loading/registry/bootstrap (`FEAT-004`)
- Memory Fabric with same-session visibility and maintenance flows (`FEAT-007`)

So the gap is **not** “the project has no Phase 0 code”; the gap is that Phase 0 is only **partially delivered** relative to the roadmap/spec contract.

## Documentation decision log

### Confirmed mismatch

There is a confirmed mismatch between:

- the roadmap/spec expectation that Phase 0 includes P0-5 through P0-11, and
- the current checked-in implementation, which only fully covers FEAT-001 / FEAT-003 / FEAT-004 / FEAT-007.

This is a delivery-status mismatch, not a design-document contradiction.

### No unresolved design contradiction found yet

During this audit, I did **not** find a clear case where two specs disagree and require immediate arbitration. The practical issue is incomplete implementation, not spec inconsistency.

If future work lands implementations for FEAT-005/006/008/009/010/011, this audit should be updated in the same PR so the status trail remains explicit.

## Verification snapshot

Verification was run against the current repository state in this worktree after installing locked dependencies with `pnpm install --frozen-lockfile`.

- `pnpm lint` ✅
- `pnpm test` ✅
- `pnpm build` ✅

These checks confirm that the currently checked-in subset is internally green, but they do **not** change the delivery-gap conclusion above: passing verification only proves the existing subset is healthy, not that all approved Phase 0 specs have been implemented.

## Recommended next steps

1. Land FEAT-005 (`AgentRunner`, session persistence, fallback loop, continuation handling).
2. Replace the scaffold CLI with FEAT-006 command/runtime behavior.
3. Add the channel abstraction + Feishu/Telegram adapters.
4. Add the skills subsystem and then wire `eat` / `shit` through it.
5. After those land, rerun `pnpm build`, `pnpm test`, `pnpm lint`, and refresh this audit before marking Phase 0 complete.
