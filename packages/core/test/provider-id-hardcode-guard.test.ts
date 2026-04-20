import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('FEAT-005 AC8 provider-id hardcode grep', () => {
  it('packages/core/src contains no provider hard-coded equality branches', () => {
    const srcDir = resolve(__dirname, '..', 'src');
    const output = runGrep(srcDir);
    expect(output).toBe('');
  });
});

function runGrep(srcDir: string): string {
  try {
    const out = execFileSync(
      'grep',
      ['-rE', '--include=*.ts', String.raw`providerId\s*===|provider\.id\s*===`, srcDir],
      { encoding: 'utf8' },
    );
    return out.trim();
  } catch (err) {
    const code = (err as { status?: number }).status;
    if (code === 1) return '';
    throw err;
  }
}
