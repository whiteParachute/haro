/**
 * Lightweight human-mode renderers. Avoids `cli-table3`/`@clack` so cold
 * start stays fast (FEAT-039 §7 perf bar: `haro session list` P95 < 500ms).
 */

import type { RenderTarget } from './render.js';

export interface ColumnDef<T> {
  key: string;
  label: string;
  /** Width hint; leave undefined to auto-size. */
  width?: number;
  /** Custom value renderer; defaults to String(value). */
  render?: (row: T) => string;
}

export function renderHumanTable<T>(
  rows: readonly T[],
  columns: readonly ColumnDef<T>[],
  target: RenderTarget = {},
): void {
  const out = target.stdout ?? process.stdout;
  if (rows.length === 0) {
    out.write('(no rows)\n');
    return;
  }
  const cellValues = rows.map((row) => columns.map((column) => column.render
    ? column.render(row)
    : String((row as Record<string, unknown>)[column.key] ?? '')));
  const widths = columns.map((column, idx) => {
    const max = Math.max(column.label.length, ...cellValues.map((cells) => visualLength(cells[idx]!)));
    return column.width ?? max;
  });
  const header = columns.map((column, idx) => padCell(column.label, widths[idx]!)).join('  ');
  const sep = widths.map((width) => '-'.repeat(width)).join('  ');
  out.write(`${header}\n${sep}\n`);
  for (const cells of cellValues) {
    out.write(`${cells.map((cell, idx) => padCell(cell, widths[idx]!)).join('  ')}\n`);
  }
}

export function renderHumanRecord(record: Record<string, unknown>, target: RenderTarget = {}): void {
  const out = target.stdout ?? process.stdout;
  const keys = Object.keys(record);
  const labelWidth = Math.max(...keys.map((k) => k.length));
  for (const key of keys) {
    const value = record[key];
    const rendered = value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
    out.write(`${padCell(key, labelWidth)}  ${rendered}\n`);
  }
}

export function renderHumanError(
  error: { code: string; message: string; remediation?: string },
  target: RenderTarget = {},
): void {
  const stderr = target.stderr ?? process.stderr;
  stderr.write(`error[${error.code}]: ${error.message}\n`);
  if (error.remediation) stderr.write(`  → ${error.remediation}\n`);
}

function padCell(text: string, width: number): string {
  const length = visualLength(text);
  return length >= width ? text : text + ' '.repeat(width - length);
}

function visualLength(text: string): number {
  // Treat non-ASCII (e.g. CJK) as width 2 — close enough for terminal output
  // without pulling in a wide-char dependency.
  let length = 0;
  for (const ch of text) {
    length += ch.codePointAt(0)! > 0xff ? 2 : 1;
  }
  return length;
}
