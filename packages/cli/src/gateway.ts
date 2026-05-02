import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHaroPaths } from '@haro/core';
import type { AppContext } from './index.js';
import { handleExternalInbound, readChannelConfig } from './index.js';

export interface GatewayCommandResult {
  exitCode: number;
  output: string;
}

export interface GatewayStartOptions {
  daemon?: boolean;
  pidFile?: string;
  logFile?: string;
}

export interface GatewayDeps {
  spawn?: typeof nodeSpawn;
  startupGraceMs?: number;
}

export async function gatewayStart(
  app: AppContext,
  options: GatewayStartOptions = {},
  deps: GatewayDeps = {},
): Promise<GatewayCommandResult> {
  const pidFile = options.pidFile ?? join(app.paths.root, 'gateway.pid');
  const logFile = options.logFile ?? resolveGatewayLogFile(app.paths.root);

  const existingPid = readPidFile(pidFile);
  if (existingPid && isProcessAlive(existingPid)) {
    return { exitCode: 1, output: `Gateway already running (PID ${existingPid})\n` };
  }

  const enabled = app.channelRegistry.listEnabled().filter((e) => e.id !== 'cli');
  if (enabled.length === 0) {
    return {
      exitCode: 1,
      output:
        'No enabled external channels. Configure one first:\n  haro channel setup feishu\n  haro channel setup telegram\n',
    };
  }

  if (options.daemon) {
    return startDaemon(app, pidFile, logFile, deps.spawn, deps.startupGraceMs);
  }

  return startForeground(app, pidFile);
}

async function startDaemon(
  app: AppContext,
  pidFile: string,
  logFile: string,
  spawnFn?: typeof nodeSpawn,
  startupGraceMs = 500,
): Promise<GatewayCommandResult> {
  const binPath = process.argv[1] ?? join(process.cwd(), 'packages/cli/bin/haro.js');

  const outFd = openSync(logFile, 'a');
  const errFd = openSync(logFile, 'a');

  const spawn = spawnFn ?? nodeSpawn;
  const child = spawn(process.execPath, [binPath, 'gateway', 'start'], {
    detached: true,
    stdio: ['ignore', outFd, errFd],
    env: { ...process.env, HARO_HOME: app.paths.root },
  });

  child.unref();
  closeSync(outFd);
  closeSync(errFd);

  const settled = await Promise.race([
    new Promise<{ ok: false; code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('exit', (code, signal) => resolve({ ok: false, code, signal }));
    }),
    new Promise<{ ok: true }>((resolve) => setTimeout(() => resolve({ ok: true }), startupGraceMs)),
  ]);

  if (!settled.ok) {
    if (existsSync(pidFile)) {
      try {
        unlinkSync(pidFile);
      } catch {
        // ignore
      }
    }
    return {
      exitCode: 1,
      output: `Gateway failed to start (exit ${settled.code}, signal ${settled.signal}). Check logs: ${logFile}\n`,
    };
  }

  writeFileSync(pidFile, String(child.pid), 'utf8');

  return {
    exitCode: 0,
    output: `Gateway started in background (PID ${child.pid}). Logs: ${logFile}\n`,
  };
}

async function startForeground(app: AppContext, pidFile: string): Promise<GatewayCommandResult> {
  const enabled = app.channelRegistry.listEnabled().filter((e) => e.id !== 'cli');
  for (const entry of enabled) {
    await entry.channel.start({
      config: readChannelConfig(app.loaded.config, entry.id),
      logger: app.logger,
      onInbound: async (msg) => handleExternalInbound(app, entry.channel, msg),
    });
  }

  const healthChecks = await Promise.all(
    enabled.map(async (entry) => ({
      id: entry.id,
      healthy: await entry.channel.healthCheck(),
    })),
  );

  let output = `Gateway started in foreground. ${enabled.length} channel(s) active.\n`;
  for (const check of healthChecks) {
    output += `  ${check.id}: ${check.healthy ? 'healthy' : 'unhealthy'}\n`;
  }
  output += `Logs: ${resolveGatewayLogFile(app.paths.root)}\n`;
  output += `Press Ctrl+C to stop.\n`;

  app.stdout.write(output);
  writeFileSync(pidFile, String(process.pid), 'utf8');

  await new Promise<void>((resolve) => {
    const handler = async () => {
      process.removeListener('SIGINT', handler);
      process.removeListener('SIGTERM', handler);
      await app.channelRegistry.stop();
      app.skills.close();
      try {
        unlinkSync(pidFile);
      } catch {
        // ignore
      }
      resolve();
    };
    process.once('SIGINT', handler);
    process.once('SIGTERM', handler);
  });

  return { exitCode: 0, output: 'Gateway stopped.\n' };
}

export function gatewayStop(options: { pidFile?: string; root?: string } = {}): GatewayCommandResult {
  const pidFile = options.pidFile ?? join(options.root ?? buildHaroPaths().root, 'gateway.pid');

  const pid = readPidFile(pidFile);
  if (!pid) {
    return { exitCode: 0, output: 'Gateway is not running\n' };
  }

  if (!isProcessAlive(pid)) {
    unlinkSync(pidFile);
    return { exitCode: 0, output: `Stale PID ${pid} removed. Gateway was not running.\n` };
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: `Failed to signal gateway (PID ${pid}): ${message}\n` };
  }

  const start = Date.now();
  while (isProcessAlive(pid) && Date.now() - start < 5000) {
    const t = Date.now();
    while (Date.now() - t < 100) {
      /* busy wait */
    }
  }

  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }

  if (existsSync(pidFile)) {
    unlinkSync(pidFile);
  }

  return { exitCode: 0, output: `Gateway stopped (PID ${pid})\n` };
}

export interface GatewayStatusReport {
  running: boolean;
  pid?: number;
  paths: {
    root: string;
    logFile: string;
    channelData: string;
  };
  channels: ReadonlyArray<{ id: string; healthy: boolean }>;
}

export async function gatewayStatus(
  app: AppContext,
  options: { pidFile?: string } = {},
): Promise<GatewayCommandResult & { report: GatewayStatusReport }> {
  const pidFile = options.pidFile ?? join(app.paths.root, 'gateway.pid');
  const pid = readPidFile(pidFile);
  const running = pid ? isProcessAlive(pid) : false;

  const enabled = app.channelRegistry.listEnabled().filter((e) => e.id !== 'cli');
  const healthChecks = await Promise.all(
    enabled.map(async (entry) => ({
      id: entry.id,
      healthy: await entry.channel.healthCheck(),
    })),
  );

  let output = `Gateway: ${running ? `running (PID ${pid})` : 'not running'}\n`;
  output += `Data directory: ${app.paths.root}\n`;
  output += `Log file: ${resolveGatewayLogFile(app.paths.root)}\n`;
  output += `Channel data: ${app.paths.dirs.channels}\n`;
  output += 'Channels:\n';
  if (enabled.length === 0) {
    output += '  (none enabled)\n';
  }
  for (const check of healthChecks) {
    output += `  ${check.id}: ${check.healthy ? 'healthy' : 'unhealthy'}\n`;
  }

  const report: GatewayStatusReport = {
    running,
    ...(pid ? { pid } : {}),
    paths: {
      root: app.paths.root,
      logFile: resolveGatewayLogFile(app.paths.root),
      channelData: app.paths.dirs.channels,
    },
    channels: healthChecks,
  };

  return { exitCode: 0, output, report };
}

export interface GatewayDoctorReport {
  ok: boolean;
  gateway: { running: boolean; pid?: number };
  channels: ReadonlyArray<{ id: string; healthy: boolean }>;
  paths: {
    root: string;
    logFile: string;
    channelData: string;
  };
}

export async function gatewayDoctor(
  app: AppContext,
  options: { pidFile?: string } = {},
): Promise<GatewayCommandResult & { report: GatewayDoctorReport }> {
  const pidFile = options.pidFile ?? join(app.paths.root, 'gateway.pid');
  const pid = readPidFile(pidFile);
  const running = pid ? isProcessAlive(pid) : false;

  const enabled = app.channelRegistry.listEnabled().filter((e) => e.id !== 'cli');
  const channelChecks = await Promise.all(
    enabled.map(async (entry) => {
      const healthy = await entry.channel.healthCheck();
      return { id: entry.id, healthy };
    }),
  );

  const ok = channelChecks.every((c) => c.healthy);

  const report: GatewayDoctorReport = {
    ok,
    gateway: { running, ...(pid ? { pid } : {}) },
    channels: channelChecks,
    paths: {
      root: app.paths.root,
      logFile: resolveGatewayLogFile(app.paths.root),
      channelData: app.paths.dirs.channels,
    },
  };

  return { exitCode: ok ? 0 : 1, output: `${JSON.stringify(report, null, 2)}\n`, report };
}

function readPidFile(path: string): number | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, 'utf8').trim();
  const n = Number.parseInt(text, 10);
  return Number.isNaN(n) ? undefined : n;
}

function resolveGatewayLogFile(root: string): string {
  return join(root, 'logs', 'gateway.log');
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
