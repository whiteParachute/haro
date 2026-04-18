#!/usr/bin/env node
/**
 * Integration smoke test for FEAT-001. Validates the full Phase-0 scaffold:
 *   AC1: all workspace packages produced build artifacts (dist/index.js)
 *   AC3: dual-output logger writes same JSON to stdout + log file
 *   AC4: SQLite init is idempotent, WAL + FTS5 enabled
 *   AC5: first invocation creates the seven required data subdirectories
 * Run via `pnpm build && pnpm smoke`.
 */
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initHaroDatabase } from '../packages/core/src/db/init.js';
import { ensureHaroDirectories, REQUIRED_HARO_SUBDIRS } from '../packages/core/src/fs/ensure-dirs.js';
import { createLogger } from '../packages/core/src/logger/index.js';

const REPO_ROOT = resolve(__dirname, '..');
const EXPECTED_DIST = [
  'packages/core/dist/index.js',
  'packages/core/dist/logger/index.js',
  'packages/core/dist/config/index.js',
  'packages/core/dist/db/index.js',
  'packages/core/dist/fs/index.js',
  'packages/core/dist/paths.js',
  'packages/cli/dist/index.js',
  'packages/providers/dist/index.js',
];

function fail(msg: string): never {
  process.stderr.write(`SMOKE FAIL: ${msg}\n`);
  process.exit(1);
}

function checkBuildArtifacts(): void {
  for (const rel of EXPECTED_DIST) {
    const abs = join(REPO_ROOT, rel);
    if (!existsSync(abs)) {
      fail(`AC1: missing build artifact ${rel} (run \`pnpm build\` first)`);
    }
  }
}

function checkDirs(root: string): void {
  const dirResult = ensureHaroDirectories(root);
  for (const sub of REQUIRED_HARO_SUBDIRS) {
    const dir = join(root, sub);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      fail(`AC5: missing data subdirectory ${dir}`);
    }
  }
  if (dirResult.created.length < REQUIRED_HARO_SUBDIRS.length) {
    fail(
      `AC5: expected ${REQUIRED_HARO_SUBDIRS.length} newly created dirs, got ${dirResult.created.length}`,
    );
  }
}

function checkLogger(root: string): void {
  const logFile = join(root, 'logs', 'haro.log');
  // Use sync (non-rolling) mode so the smoke check can read the file right
  // after logger.info. The rolling transport path is verified separately by
  // the subprocess AC3 check below, which awaits natural process exit.
  const logger = createLogger({ root, file: logFile, stdout: false, rolling: false });
  logger.info({ step: 'smoke' }, 'hello from smoke');
  if (!existsSync(logFile)) fail(`AC3: logger did not create ${logFile}`);
  const parsed = JSON.parse(readFileSync(logFile, 'utf8').trim().split('\n').pop()!);
  if (parsed.msg !== 'hello from smoke') fail(`AC3: log file did not capture msg, got ${parsed.msg}`);
}

function checkDatabase(root: string): void {
  const dbFile = join(root, 'haro.db');
  const first = initHaroDatabase({ dbFile });
  if (first.journalMode.toLowerCase() !== 'wal') fail(`AC4: journal mode not WAL: ${first.journalMode}`);
  if (!first.fts5Available) fail('AC4: FTS5 not available');
  const second = initHaroDatabase({ dbFile });
  if (second.tables.length !== first.tables.length) fail('AC4: tables changed on second init');
}

function checkSubprocessAc3(): void {
  const distLogger = join(REPO_ROOT, 'packages/core/dist/logger/index.js');
  if (!existsSync(distLogger)) fail('AC3 subprocess: built logger missing');
  const home = mkdtempSync(join(tmpdir(), 'haro-smoke-ac3-'));
  try {
    const res = spawnSync(
      process.execPath,
      ['-e', "require('./packages/core/dist/logger').info({smoke: true}, 'hi')"],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, HARO_HOME: home },
        encoding: 'utf8',
      },
    );
    if (res.status !== 0) fail(`AC3 subprocess exited ${res.status}: ${res.stderr}`);
    const stdoutLast = res.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .pop();
    if (!stdoutLast) fail('AC3 subprocess produced no stdout');
    const logFile = join(home, 'logs', 'haro.log');
    if (!existsSync(logFile)) fail('AC3 subprocess did not write log file');
    const fileLast = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).pop();
    if (stdoutLast !== fileLast) fail('AC3 subprocess stdout != file line');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function main(): void {
  checkBuildArtifacts();
  const root = mkdtempSync(join(tmpdir(), 'haro-smoke-'));
  try {
    checkDirs(root);
    checkLogger(root);
    checkDatabase(root);
    checkSubprocessAc3();
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          checks: ['AC1-dist', 'AC3-dual', 'AC3-subprocess', 'AC4-idempotent', 'AC5-dirs'],
          root,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main();
