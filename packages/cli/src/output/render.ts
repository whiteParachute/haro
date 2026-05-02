import {
  haroErrorToWire,
  isHaroError,
  type CliErrorEnvelope,
  type CliListEnvelope,
  type CliRecordEnvelope,
  type HaroErrorCode,
} from '@haro/core';

export type OutputMode = 'json' | 'human';

export interface OutputModeFlags {
  json?: boolean;
  human?: boolean;
}

export interface RenderTarget {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

/**
 * Resolve effective output mode following FEAT-039 R11:
 * - explicit --json or --human always wins
 * - otherwise: TTY → human, non-TTY → json (so pipe-to-jq just works)
 */
export function resolveOutputMode(flags: OutputModeFlags, stdout: NodeJS.WritableStream = process.stdout): OutputMode {
  if (flags.json) return 'json';
  if (flags.human) return 'human';
  const isTty = (stdout as { isTTY?: boolean }).isTTY === true;
  return isTty ? 'human' : 'json';
}

export function renderJson<T>(data: T, target: RenderTarget = {}): void {
  const out = target.stdout ?? process.stdout;
  const envelope: CliRecordEnvelope<T> = { ok: true, data };
  out.write(`${JSON.stringify(envelope)}\n`);
}

/**
 * Render a list result as NDJSON (one record per line) — friendly to
 * `jq`, `grep`, `head -n`. The trailing line is the pageInfo summary.
 */
export function renderListJson<T>(
  result: { items: readonly T[]; total: number; limit?: number; offset?: number; pageInfo?: unknown },
  target: RenderTarget = {},
): void {
  const out = target.stdout ?? process.stdout;
  for (const item of result.items) {
    out.write(`${JSON.stringify({ ok: true, data: item })}\n`);
  }
  const summary: CliListEnvelope<T> = {
    ok: true,
    data: {
      items: result.items,
      total: result.total,
      ...(result.limit !== undefined ? { limit: result.limit } : {}),
      ...(result.offset !== undefined ? { offset: result.offset } : {}),
    },
  };
  // Final summary line: type-checked envelope. Consumers can take only the
  // last line for the count, or take all but the last for individual records.
  out.write(`${JSON.stringify({ ok: true, summary: summary.data })}\n`);
}

/**
 * Render a diagnostic report (doctor / health check) whose payload carries its
 * own top-level `ok` flag. When `ok === true`, we emit a normal record envelope
 * to stdout. When `ok === false`, we emit a `CliErrorEnvelope` to *stderr* so
 * scripts piping `--json` cannot read `.ok === true` from stdout and miss the
 * failure (FEAT-039 R11/AC12 — see doctor failure regression test).
 *
 * Callers should still throw `CommanderExit(1, ...)` after this so the process
 * exit code stays non-zero; this helper only handles the wire format.
 */
export function renderJsonDiagnostic<T extends { ok: boolean }>(
  report: T,
  target: RenderTarget = {},
  failure: { code: HaroErrorCode; message: string; remediation?: string },
): void {
  if (report.ok) {
    renderJson(report, target);
    return;
  }
  const stderr = target.stderr ?? process.stderr;
  const envelope: CliErrorEnvelope = {
    ok: false,
    error: {
      code: failure.code,
      message: failure.message,
      ...(failure.remediation ? { remediation: failure.remediation } : {}),
      details: { report: report as unknown as Record<string, unknown> },
    },
  };
  stderr.write(`${JSON.stringify(envelope)}\n`);
}

export function renderError(
  error: unknown,
  target: RenderTarget = {},
  options: { mode?: OutputMode } = {},
): number {
  const mode = options.mode ?? 'json';
  const stderr = target.stderr ?? process.stderr;
  const envelope: CliErrorEnvelope = isHaroError(error)
    ? { ok: false, error: haroErrorToWire(error) }
    : {
        ok: false,
        error: {
          code: 'UNKNOWN',
          message: error instanceof Error ? error.message : String(error),
        },
      };
  if (mode === 'json') {
    stderr.write(`${JSON.stringify(envelope)}\n`);
  } else {
    stderr.write(`error[${envelope.error.code}]: ${envelope.error.message}\n`);
    if (envelope.error.remediation) stderr.write(`  → ${envelope.error.remediation}\n`);
  }
  return 1;
}
