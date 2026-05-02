# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
