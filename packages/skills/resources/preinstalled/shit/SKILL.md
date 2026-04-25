---
name: shit
description: "Counterpart to eat: dry-run-first archival/rollback workflow for stale Haro skills and rules."
---

Use this skill to review stale Haro skills, rules, MCP surfaces, and memory assets for archival through the Haro metabolism flow.

## Safety contract

- This is a dry-run-first workflow. Start with `haro shit --dry-run` and present the candidate list before any state-changing command.
- Perform all archive and rollback state changes through `haro shit`, `haro shit rollback`, or Haro APIs only.
- Do not modify files directly and do not invent a parallel cleanup algorithm.
- Keep high-risk candidates excluded unless the user explicitly requests the high-risk path.
- Show the archive id and manifest summary.

## Standard flow

1. Check that the Haro CLI is available and that the current repository or configured Haro home is the intended target.
2. Run a dry-run scan first:

   ```bash
   haro shit --dry-run --scope skills --days 30
   ```

3. Summarize candidate paths, risk levels, reasons, and any protected preinstalled assets.
4. Ask for explicit confirmation before a state-changing archive command. For ordinary candidates use:

   ```bash
   haro shit --scope skills --days 30
   ```

5. For high-risk candidates, require the user to explicitly choose the high-risk path and pass:

   ```bash
   haro shit --scope skills --days 30 --confirm-high
   ```

6. After completion, report the archive id, archive manifest path, candidate count, archived count, skipped count, and rollback command.

## Scope examples

```bash
haro shit --dry-run --scope skills --days 30
haro shit --dry-run --scope rules --days 60
haro shit --dry-run --scope memory --days 90
```

Use a narrower scope when the user named a specific asset family. Keep preinstalled skills and agent-referenced skills protected unless Haro itself classifies a safe archival candidate.

## Rollback

Treat rollback as a first-class flow. If the user asks to restore an archive, start with the archive id and use Haro rollback commands:

```bash
haro shit rollback <archive-id>
haro shit rollback <archive-id> --item <path>
```

Show the archive id and manifest summary. Summarize restored items and any skipped items.

## No-Haro fallback

If `haro` is unavailable, the Haro project home cannot be found, or the archive manifest location is unclear:

- Do not execute cleanup.
- Do not modify files.
- Provide a manual review checklist instead.
- Explain that destructive execution requires Haro CLI availability so that archive manifests and rollback remain auditable.

manual review checklist:

1. Identify the candidate asset path and owning Haro feature/spec.
2. Check last usage, references from agent configs, and whether the asset is preinstalled.
3. Record the reason it may be stale.
4. Re-run this skill after Haro CLI access is restored.

## Boundary

This skill is the Codex runtime wrapper for the FEAT-011 Haro `shit` command. It does not change Runner, Provider, AgentRunner, archive manifest, or rollback semantics.
