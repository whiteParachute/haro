import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Hono } from 'hono';
import { buildHaroPaths } from '@haro/core';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

export interface GatewayStatusReadModel {
  status: 'running' | 'stopped';
  running: boolean;
  pid?: number;
  startedAt?: string;
  connectedChannelCount: number;
  enabledChannels: Array<{ id: string; healthy: boolean }>;
  pidFile: string;
  logFile: string;
}

export function createGatewayRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/', async (c) => c.json({ success: true, data: await readGatewayStatus(runtime) }));

  route.post('/start', async (c) => {
    const status = await readGatewayStatus(runtime);
    if (status.running) return c.json({ error: `Gateway already running (PID ${status.pid})` }, 409);
    const externalChannels = (runtime.channelRegistry?.listEnabled() ?? []).filter((entry) => entry.id !== 'cli');
    if (externalChannels.length === 0) {
      return c.json({
        error: 'No enabled external channels. Configure one first: haro channel setup feishu',
      }, 400);
    }

    const started = await startGatewayDaemon(runtime);
    if (!started.ok) return c.json({ error: started.error }, 500);
    return c.json({ success: true, data: await readGatewayStatus(runtime) });
  });

  route.post('/stop', async (c) => {
    const stopped = await stopGateway(runtime);
    if (!stopped.ok) return c.json({ error: stopped.error }, 500);
    return c.json({ success: true, data: await readGatewayStatus(runtime) });
  });

  route.get('/doctor', async (c) => {
    const status = await readGatewayStatus(runtime);
    const ok = status.enabledChannels.every((channel) => channel.healthy);
    return c.json({
      success: true,
      data: {
        ok,
        gateway: {
          running: status.running,
          ...(status.pid ? { pid: status.pid } : {}),
          ...(status.startedAt ? { startedAt: status.startedAt } : {}),
        },
        channels: status.enabledChannels,
        paths: {
          root: buildHaroPaths(runtime.root).root,
          pidFile: status.pidFile,
          logFile: status.logFile,
          channelData: buildHaroPaths(runtime.root).dirs.channels,
        },
      },
    });
  });

  route.get('/logs', async (c) => {
    const lines = clampNumber(Number.parseInt(c.req.query('lines') ?? '100', 10), 1, 1000);
    const since = c.req.query('since');
    const logFile = resolveGatewayLogFile(runtime);
    if (!existsSync(logFile)) return c.json({ success: true, data: { logFile, lines: [] } });
    const content = await readFile(logFile, 'utf8');
    const allLines = content.split(/\r?\n/).filter((line) => line.length > 0);
    const filtered = since ? allLines.filter((line) => line >= since) : allLines;
    return c.json({ success: true, data: { logFile, lines: filtered.slice(-lines) } });
  });

  return route;
}

async function readGatewayStatus(runtime: WebRuntime): Promise<GatewayStatusReadModel> {
  const pidFile = resolveGatewayPidFile(runtime);
  const logFile = resolveGatewayLogFile(runtime);
  const pid = readPidFile(pidFile);
  const running = pid ? isProcessAlive(pid) : false;
  const enabled = (runtime.channelRegistry?.listEnabled() ?? []).filter((entry) => entry.id !== 'cli');
  const enabledChannels = await Promise.all(
    enabled.map(async (entry) => {
      try {
        return { id: entry.id, healthy: await entry.channel.healthCheck() };
      } catch {
        return { id: entry.id, healthy: false };
      }
    }),
  );
  const startedAt = running && existsSync(pidFile) ? (await stat(pidFile)).mtime.toISOString() : undefined;

  return {
    status: running ? 'running' : 'stopped',
    running,
    ...(running && pid ? { pid } : {}),
    ...(startedAt ? { startedAt } : {}),
    connectedChannelCount: enabledChannels.length,
    enabledChannels,
    pidFile,
    logFile,
  };
}

async function startGatewayDaemon(runtime: WebRuntime): Promise<{ ok: true } | { ok: false; error: string }> {
  const pidFile = resolveGatewayPidFile(runtime);
  const logFile = resolveGatewayLogFile(runtime);
  await mkdir(dirname(logFile), { recursive: true });
  await mkdir(dirname(pidFile), { recursive: true });

  const binPath = process.argv[1] ?? join(process.cwd(), 'packages/cli/bin/haro.js');
  const child = nodeSpawn(process.execPath, [binPath, 'gateway', 'start'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, HARO_HOME: buildHaroPaths(runtime.root).root },
  });
  child.unref();

  const settled = await Promise.race([
    new Promise<{ ok: false; code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('exit', (code, signal) => resolve({ ok: false, code, signal }));
    }),
    new Promise<{ ok: true }>((resolve) => setTimeout(() => resolve({ ok: true }), 500)),
  ]);
  if (!settled.ok) {
    return { ok: false, error: `Gateway failed to start (exit ${settled.code}, signal ${settled.signal}). Check logs: ${logFile}` };
  }
  writeFileSync(pidFile, String(child.pid), 'utf8');
  return { ok: true };
}

async function stopGateway(runtime: WebRuntime): Promise<{ ok: true } | { ok: false; error: string }> {
  const pidFile = resolveGatewayPidFile(runtime);
  const pid = readPidFile(pidFile);
  if (!pid) return { ok: true };
  if (!isProcessAlive(pid)) {
    await rm(pidFile, { force: true });
    return { ok: true };
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const started = Date.now();
  while (isProcessAlive(pid) && Date.now() - started < 5000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }
  await rm(pidFile, { force: true });
  return { ok: true };
}

function resolveGatewayPidFile(runtime: WebRuntime): string {
  return join(buildHaroPaths(runtime.root).root, 'gateway.pid');
}

function resolveGatewayLogFile(runtime: WebRuntime): string {
  return join(buildHaroPaths(runtime.root).root, 'logs', 'gateway.log');
}

function readPidFile(path: string): number | undefined {
  if (!existsSync(path)) return undefined;
  const n = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
  return Number.isNaN(n) ? undefined : n;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
