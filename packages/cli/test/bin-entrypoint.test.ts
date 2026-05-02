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
    expect(res.stdout.trim()).toBe('0.1.0');
  });

  it('shipped binary exposes web command help', () => {
    const home = mkdtempSync(join(tmpdir(), 'haro-bin-web-help-'));
    try {
      const res = spawnSync(process.execPath, [bin, 'web', '--help'], {
        env: { ...process.env, HARO_HOME: home },
        encoding: 'utf8',
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('Usage: haro web [options]');
      expect(res.stdout).toContain('--port <port>');
      expect(res.stdout).toContain('--host <host>');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
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

  it('shipped binary status emits clean JSON without bootstrap log noise', () => {
    const home = mkdtempSync(join(tmpdir(), 'haro-bin-status-'));
    try {
      const res = spawnSync(process.execPath, [bin, 'status'], {
        env: { ...process.env, HARO_HOME: home },
        encoding: 'utf8',
      });
      expect(res.status).toBe(0);
      expect(() => JSON.parse(res.stdout)).not.toThrow();
      expect(res.stdout).not.toContain('Created default Agent');
      expect(res.stderr).toBe('');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('root pnpm script haro --version exits 0', () => {
    const repoRoot = resolve(__dirname, '..', '..', '..');
    const res = spawnSync('pnpm', ['haro', '--version'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    const lastLine = res.stdout.trim().split('\n').pop()?.trim();
    expect(lastLine).toBe('0.1.0');
  });

  it('shipped binary channel list includes optional adapters on a clean home', () => {
    const home = mkdtempSync(join(tmpdir(), 'haro-bin-channel-list-'));
    try {
      // FEAT-039 R11: piped (non-TTY) stdout defaults to JSON envelope.
      // Force --human so the assertion can match the legacy text rows.
      const res = spawnSync(process.execPath, [bin, 'channel', 'list', '--human'], {
        env: { ...process.env, HARO_HOME: home },
        encoding: 'utf8',
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('cli\tenabled\tbuiltin');
      expect(res.stdout).toContain('feishu\tdisabled\tpackage');
      expect(res.stdout).toContain('telegram\tdisabled\tpackage');
      expect(res.stdout).not.toContain('Created default Agent');
      expect(res.stderr).not.toContain('Created default Agent');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
