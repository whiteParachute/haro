import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ManagedChannel } from '@haro/channel';
import { gatewayStart, gatewayStop, gatewayStatus, gatewayDoctor } from '../src/gateway.js';
import type { AppContext } from '../src/index.js';

function createMockApp(overrides: {
  root?: string;
  channels?: Array<{ id: string; enabled: boolean; healthy?: boolean }>;
} = {}): AppContext {
  const root = overrides.root ?? mkdtempSync(join(tmpdir(), 'haro-gateway-'));
  const stdout = new PassThrough();
  const channels = overrides.channels ?? [];

  const registry = {
    listEnabled: () =>
      channels
        .filter((c) => c.enabled)
        .map((c) => ({
          id: c.id,
          channel: createMockChannel(c.id, c.healthy ?? true),
          enabled: true,
          removable: true,
          source: 'package' as const,
          displayName: c.id,
        })),
    stop: vi.fn(async () => undefined),
  } as unknown as AppContext['channelRegistry'];

  return {
    paths: {
      root,
      configFile: join(root, 'config.yaml'),
      logFile: join(root, 'logs', 'haro.log'),
      dbFile: join(root, 'haro.db'),
      dirs: {
        agents: join(root, 'agents'),
        skills: join(root, 'skills'),
        channels: join(root, 'channels'),
        memory: join(root, 'memory'),
        logs: join(root, 'logs'),
        evolutionContext: join(root, 'evolution-context'),
        archive: join(root, 'archive'),
      },
    },
    stdout,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    loaded: {
      config: {},
      sources: [join(root, 'config.yaml')],
    },
    channelRegistry: registry,
    skills: { close: vi.fn() },
  } as unknown as AppContext;
}

function createMockChannel(id: string, healthy: boolean): ManagedChannel {
  return {
    id,
    async start() {
      return undefined;
    },
    async stop() {
      return undefined;
    },
    async send() {
      return undefined;
    },
    capabilities() {
      return {
        streaming: false,
        richText: false,
        attachments: false,
        threading: false,
        requiresWebhook: false,
      };
    },
    async healthCheck() {
      return healthy;
    },
  };
}

describe('gateway commands [M3]', () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  describe('gateway start', () => {
    it('foreground mode starts enabled channels and blocks until signal', async () => {
      const root = mkdtempSync(join(tmpdir(), 'haro-gateway-fg-'));
      roots.push(root);
      const app = createMockApp({
        root,
        channels: [
          { id: 'feishu', enabled: true, healthy: true },
          { id: 'telegram', enabled: true, healthy: false },
        ],
      });
      const stdoutChunks: string[] = [];
      app.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(String(chunk)));

      let sigintHandler: (() => void) | undefined;
      vi.spyOn(process, 'once').mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
        if (event === 'SIGINT' || event === 'SIGTERM') {
          sigintHandler = handler as () => void;
        }
        return process;
      });

      const startPromise = gatewayStart(app, { pidFile: join(root, 'gateway.pid') });

      // Simulate signal to unblock
      setTimeout(() => {
        if (sigintHandler) sigintHandler();
      }, 10);

      const result = await startPromise;
      expect(result.exitCode).toBe(0);
      const written = stdoutChunks.join('');
      expect(written).toContain('foreground');
      expect(written).toContain('feishu: healthy');
      expect(written).toContain('telegram: unhealthy');
      expect(result.output).toContain('stopped');
      expect(app.channelRegistry.stop).toHaveBeenCalled();
      expect(existsSync(join(root, 'gateway.pid'))).toBe(false);
    });

    it('refuses to start if gateway is already running', async () => {
      const root = mkdtempSync(join(tmpdir(), 'haro-gateway-already-'));
      roots.push(root);
      const pidFile = join(root, 'gateway.pid');
      writeFileSync(pidFile, String(process.pid), 'utf8');

      const app = createMockApp({ root });
      const result = await gatewayStart(app, { pidFile });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('already running');
    });

    it('daemon mode spawns detached process and writes PID file', async () => {
      const root = mkdtempSync(join(tmpdir(), 'haro-gateway-daemon-'));
      roots.push(root);
      const app = createMockApp({
        root,
        channels: [{ id: 'feishu', enabled: true, healthy: true }],
      });
      const pidFile = join(root, 'gateway.pid');
      const logFile = join(root, 'gateway.log');

      const mockChild = {
        unref: vi.fn(),
        pid: 99999,
        on: vi.fn().mockReturnThis(),
      };
      const mockSpawn = vi.fn().mockReturnValue(mockChild);

      const result = await gatewayStart(
        app,
        { pidFile, logFile, daemon: true },
        { spawn: mockSpawn as unknown as typeof import('node:child_process').spawn, startupGraceMs: 0 },
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('background');
      expect(result.output).toContain('99999');
      expect(existsSync(pidFile)).toBe(true);
      expect(readFileSync(pidFile, 'utf8')).toBe('99999');
      expect(mockSpawn).toHaveBeenCalled();
    });

    it('daemon mode reports failure if child exits immediately', async () => {
      const root = mkdtempSync(join(tmpdir(), 'haro-gateway-daemon-fail-'));
      roots.push(root);
      const app = createMockApp({
        root,
        channels: [{ id: 'feishu', enabled: true, healthy: true }],
      });
      const pidFile = join(root, 'gateway.pid');
      const logFile = join(root, 'gateway.log');

      const mockChild = {
        unref: vi.fn(),
        pid: 99998,
        on: vi.fn().mockImplementation((event: string, handler: (code: number | null, signal: NodeJS.Signals | null) => void) => {
          if (event === 'exit') {
            // Simulate immediate exit
            setTimeout(() => handler(1, null), 0);
          }
          return mockChild;
        }),
      };
      const mockSpawn = vi.fn().mockReturnValue(mockChild);

      const result = await gatewayStart(
        app,
        { pidFile, logFile, daemon: true },
        { spawn: mockSpawn as unknown as typeof import('node:child_process').spawn, startupGraceMs: 0 },
      );
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('failed to start');
      expect(existsSync(pidFile)).toBe(false);
    });

    it('refuses to start with zero enabled external channels', async () => {
      const root = mkdtempSync(join(tmpdir(), 'haro-gateway-zero-'));
      roots.push(root);
      const app = createMockApp({ root, channels: [] });
      const result = await gatewayStart(app, { pidFile: join(root, 'gateway.pid') });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('No enabled external channels');
    });
  });

  describe('gateway stop', () => {
    it('reports not running when no PID file exists', () => {
      const root = mkdtempSync(join(tmpdir(), 'haro-gateway-stop-none-'));
      roots.push(root);
      const result = gatewayStop({ root });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('not running');
    });

    it('cleans up stale PID and reports not running', () => {
      const root = mkdtempSync(join(tmpdir(), 'haro-gateway-stop-stale-'));
      roots.push(root);
      const pidFile = join(root, 'gateway.pid');
      writeFileSync(pidFile, '99998', 'utf8');

      const result = gatewayStop({ pidFile });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Stale PID');
      expect(existsSync(pidFile)).toBe(false);
    });

    it('sends SIGTERM to running process and cleans up PID file', () => {
      const root = mkdtempSync(join(tmpdir(), 'haro-gateway-stop-live-'));
      roots.push(root);
      const pidFile = join(root, 'gateway.pid');
      const targetPid = 98765;

      writeFileSync(pidFile, String(targetPid), 'utf8');

      let sigtermSent = false;
      let processExited = false;

      vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
        if (pid === targetPid && signal === 'SIGTERM') {
          sigtermSent = true;
          return true;
        }
        if (pid === targetPid && (signal === 0 || signal === undefined)) {
          if (sigtermSent && !processExited) {
            processExited = true;
          }
          if (processExited) {
            const err = new Error('ESRCH') as NodeJS.ErrnoException;
            err.code = 'ESRCH';
            throw err;
          }
        }
        return true;
      });

      const result = gatewayStop({ pidFile });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('stopped');
      expect(existsSync(pidFile)).toBe(false);
      expect(sigtermSent).toBe(true);
    });
  });

  describe('gateway status', () => {
    it('reports not running when no PID file', async () => {
      const root = mkdtempSync(join(tmpdir(), 'haro-gateway-status-none-'));
      roots.push(root);
      const app = createMockApp({ root });
      const result = await gatewayStatus(app);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('not running');
    });

    it('reports running with channel health', async () => {
      const root = mkdtempSync(join(tmpdir(), 'haro-gateway-status-ok-'));
      roots.push(root);
      const pidFile = join(root, 'gateway.pid');
      writeFileSync(pidFile, String(process.pid), 'utf8');

      const app = createMockApp({
        root,
        channels: [
          { id: 'feishu', enabled: true, healthy: true },
          { id: 'telegram', enabled: false, healthy: true },
        ],
      });

      const result = await gatewayStatus(app, { pidFile });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain(`running (PID ${process.pid})`);
      expect(result.output).toContain('feishu: healthy');
      expect(result.output).not.toContain('telegram');
    });
  });

  describe('gateway doctor', () => {
    it('returns ok=true when no enabled channels and no running gateway', async () => {
      const root = mkdtempSync(join(tmpdir(), 'haro-gateway-doctor-empty-'));
      roots.push(root);
      const app = createMockApp({ root });
      const result = await gatewayDoctor(app);
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.output) as { ok: boolean; gateway: { running: boolean } };
      expect(report.ok).toBe(true);
      expect(report.gateway.running).toBe(false);
    });

    it('returns ok=false when an enabled channel is unhealthy', async () => {
      const root = mkdtempSync(join(tmpdir(), 'haro-gateway-doctor-bad-'));
      roots.push(root);
      const app = createMockApp({
        root,
        channels: [{ id: 'feishu', enabled: true, healthy: false }],
      });
      const result = await gatewayDoctor(app);
      expect(result.exitCode).toBe(1);
      const report = JSON.parse(result.output) as { ok: boolean; channels: Array<{ healthy: boolean }> };
      expect(report.ok).toBe(false);
      expect(report.channels[0]!.healthy).toBe(false);
    });
  });
});
