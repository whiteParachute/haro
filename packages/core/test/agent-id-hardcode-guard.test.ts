/**
 * FEAT-004 AC5 — development-time quick check that core/src does not contain
 * `agentId === 'literal'` style branches. The spec frames this as a grep
 * rather than an ESLint rule (R7: "不加护栏，靠设计纪律"), but we mirror it
 * as a single vitest case so regressions surface in the standard test run.
 *
 * Self-reference in THIS test file (the grep pattern itself) is deliberately
 * placed inside a string and scoped to `packages/core/src`, so the check
 * never trips on its own.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('FEAT-004 AC5 agent-id hardcode grep', () => {
  it('packages/core/src contains no `agentId === "literal"` branches', () => {
    const srcDir = resolve(__dirname, '..', 'src');
    const output = runGrep(srcDir);
    // Any hit is a regression: failing prints the offending lines so the
    // developer can pin-point the file in the BUG spec.
    expect(output).toBe('');
  });
});

function runGrep(srcDir: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-restricted-imports -- execFileSync is the safest shell-free call
    const out = execFileSync(
      'grep',
      ['-rE', '--include=*.ts', String.raw`agentId\s*===`, srcDir],
      { encoding: 'utf8' },
    );
    return out.trim();
  } catch (err) {
    // grep exits 1 when nothing matches — that is the success path.
    const code = (err as { status?: number }).status;
    if (code === 1) return '';
    throw err;
  }
}
