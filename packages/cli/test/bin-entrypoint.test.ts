/**
 * AC2 end-to-end — invoke the shipped bin/haro.js binary with a malformed
 * global `config.yaml` and assert it exits non-zero with the Zod validation
 * path on stderr. Requires `pnpm build` to have produced packages/cli/dist.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const bin = resolve(__dirname, '..', 'bin', 'haro.js');
const dist = resolve(__dirname, '..', 'dist', 'index.js');

describe.skipIf(!existsSync(dist))('bin/haro.js [FEAT-001]', () => {
  it('AC2 shipped binary exits 1 with Zod path on invalid config', () => {
    const home = mkdtempSync(join(tmpdir(), 'haro-bin-bad-'));
    try {
      mkdirSync(home, { recursive: true });
      // Use a non-Claude field to exercise the generic Zod type-path reporting.
      // (Claude's apiKey is now hard-rejected by FEAT-002 with a different
      // message — see packages/cli/test/cli.test.ts for that dedicated AC.)
      writeFileSync(join(home, 'config.yaml'), 'providers:\n  claude:\n    defaultModel: 123\n');
      const res = spawnSync(process.execPath, [bin], {
        env: { ...process.env, HARO_HOME: home },
        encoding: 'utf8',
      });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('providers.claude.defaultModel');
      expect(res.stderr).toMatch(/Expected string, received number/i);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('AC1 shipped binary --version exits 0', () => {
    const res = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe('0.0.0');
  });
});
