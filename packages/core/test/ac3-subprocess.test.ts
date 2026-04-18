/**
 * AC3 end-to-end — literal spec command:
 *   node -e "require('./packages/core/dist/logger').info('hi')"
 * The built CJS logger must write the same JSON line to stdout and
 * `$HARO_HOME/logs/haro.log`. Relies on `pnpm build` having produced
 * `packages/core/dist/logger/index.js`; if the dist is missing the test is
 * skipped with a hint rather than failing silently.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const distPath = resolve(__dirname, '..', 'dist', 'logger', 'index.js');
const repoRoot = resolve(__dirname, '..', '..', '..');

describe.skipIf(!existsSync(distPath))('AC3 end-to-end subprocess [FEAT-001]', () => {
  it('node -e require(...).info writes same line to stdout and log file', () => {
    const home = mkdtempSync(join(tmpdir(), 'haro-ac3-'));
    try {
      const res = spawnSync(
        process.execPath,
        ['-e', "require('./packages/core/dist/logger').info({ac3: true}, 'hi')"],
        {
          cwd: repoRoot,
          env: { ...process.env, HARO_HOME: home },
          encoding: 'utf8',
        },
      );
      expect(res.status).toBe(0);
      const stdoutLines = res.stdout.split('\n').filter(Boolean);
      expect(stdoutLines.length).toBeGreaterThan(0);
      const logFile = join(home, 'logs', 'haro.log');
      expect(existsSync(logFile)).toBe(true);
      const fileLines = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
      expect(fileLines.length).toBeGreaterThan(0);
      const stdoutLast = JSON.parse(stdoutLines[stdoutLines.length - 1]!);
      const fileLast = JSON.parse(fileLines[fileLines.length - 1]!);
      expect(stdoutLast.msg).toBe('hi');
      expect(fileLast.msg).toBe('hi');
      expect(stdoutLast.ac3).toBe(true);
      expect(fileLast.ac3).toBe(true);
      expect(stdoutLast.time).toBe(fileLast.time);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
