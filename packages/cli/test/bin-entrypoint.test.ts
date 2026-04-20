import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const bin = resolve(__dirname, '..', 'bin', 'haro.js');
const dist = resolve(__dirname, '..', 'dist', 'index.js');

describe.skipIf(!existsSync(dist))('bin/haro.js [FEAT-006]', () => {
  it('shipped binary --version exits 0', () => {
    const res = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe('0.0.0');
  });

  it('shipped binary reports config validation paths on startup errors', () => {
    const home = mkdtempSync(join(tmpdir(), 'haro-bin-bad-'));
    try {
      mkdirSync(home, { recursive: true });
      writeFileSync(
        join(home, 'config.yaml'),
        'providers:\n  codex:\n    defaultModel: 123\n',
      );
      const res = spawnSync(process.execPath, [bin, 'run', 'hello'], {
        env: { ...process.env, HARO_HOME: home },
        encoding: 'utf8',
      });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('providers.codex.defaultModel');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
