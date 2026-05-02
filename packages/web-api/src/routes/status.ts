import { access, constants } from 'node:fs/promises';
import { Hono } from 'hono';
import { buildHaroPaths, db as haroDb, config as haroConfig } from '@haro/core';
import { ProviderRegistry } from '@haro/core';
import { ChannelRegistry, type ChannelRegistryEntry } from '@haro/channel';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

interface SessionCountRow {
  status: string;
  count: number;
}

interface RecentSessionRow {
  id: string;
  agent_id: string;
  provider: string;
  model: string;
  status: string;
  started_at: string;
  ended_at: string | null;
}

interface SessionStatsRow {
  total: number;
  today: number;
  completed: number;
  failed: number;
  running: number;
}

export interface ChannelHealthSummary {
  id: string;
  displayName: string;
  enabled: boolean;
  source: string;
  health: 'healthy' | 'unhealthy' | 'disabled' | 'unknown';
  lastCheckedAt: string;
  config: Record<string, unknown>;
  error?: string;
}

export function createStatusRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/', async (c) => {
    const paths = buildHaroPaths(runtime.root);
    const dbFile = runtime.dbFile ?? paths.dbFile;
    const [database, providers, channels] = await Promise.all([
      readDatabaseStatus(runtime.root, dbFile),
      readProviderStatus(runtime.providerRegistry),
      readChannelSummaries(runtime),
    ]);

    return c.json({
      success: true,
      data: {
        ok: database.ok && providers.every((item) => item.healthy) && channels.every((item) => item.health !== 'unhealthy'),
        service: 'haro-web',
        startedAt: new Date(runtime.startedAt).toISOString(),
        uptimeMs: Date.now() - runtime.startedAt,
        database,
        providers,
        channels,
        sessions: database.sessions,
        recent: database.recent,
      },
    });
  });

  return route;
}

export function createDoctorRoute(runtime: WebRuntime): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/', async (c) => {
    const paths = buildHaroPaths(runtime.root);
    const dirChecks = await Promise.all(
      Object.entries(paths.dirs).map(async ([name, path]) => ({
        name,
        path,
        writable: await isWritable(path),
      })),
    );
    const sqlite = await readSqliteDoctor(runtime.root, runtime.dbFile ?? paths.dbFile);
    const providers = await readProviderStatus(runtime.providerRegistry);
    const channels = await readChannelSummaries(runtime);
    const loaded = loadConfig(runtime);
    const sources = loaded.sources;
    const ok =
      sqlite.ok &&
      dirChecks.every((item) => item.writable) &&
      providers.every((item) => item.healthy) &&
      channels.every((item) => item.health !== 'unhealthy');

    const diagnostics: Record<string, unknown> = runtime.runDiagnostics
      ? await runtime.runDiagnostics({
          mode: 'doctor',
          profile: 'global',
          paths,
          root: runtime.root,
          loaded,
          providerRegistry: runtime.providerRegistry ?? new ProviderRegistry(),
          channelRegistry: runtime.channelRegistry ?? new ChannelRegistry(),
        })
      : {
          // Host has not wired a diagnostics runner. The doctor view degrades
          // gracefully so the rest of the structured payload below still loads.
          ok: false,
          issues: [
            {
              code: 'WEB_DIAGNOSTICS_RUNNER_NOT_CONFIGURED',
              severity: 'warning',
              component: 'web',
              evidence: 'WebRuntime.runDiagnostics is not provided by the host',
              remediation: 'Wire a DiagnosticsRunner when starting @haro/web-api (see FEAT-038 §5.2)',
              fixable: false,
            },
          ],
          stages: [],
        };

    return c.json({
      success: true,
      data: {
        ...diagnostics,
        ok,
        config: { ok: true, sources },
        providers,
        channels,
        dataDir: { root: paths.root, checks: dirChecks },
        sqlite,
        groups: buildDoctorGroups({ dirChecks, sqlite, providers, channels, sources }),
      },
    });
  });

  return route;
}

export async function readChannelSummaries(runtime: WebRuntime): Promise<ChannelHealthSummary[]> {
  const loaded = loadConfig(runtime);
  const configuredChannels = Object.entries((loaded.config.channels ?? {}) as Record<string, unknown>);
  const registryEntries = runtime.channelRegistry?.list() ?? [];
  const registryIds = new Set(registryEntries.map((entry) => entry.id));
  const syntheticEntries = configuredChannels
    .filter(([id]) => !registryIds.has(id))
    .map(([id, value]) => ({ id, config: objectValue(value) }));
  const checkedAt = new Date().toISOString();

  const registered = await Promise.all(
    registryEntries.map(async (entry) => summarizeRegisteredChannel(entry, loaded.config, checkedAt)),
  );
  const synthetic = syntheticEntries.map(({ id, config }) => ({
    id,
    displayName: id,
    enabled: config.enabled !== false,
    source: 'config',
    health: config.enabled === false ? 'disabled' : 'unknown',
    lastCheckedAt: checkedAt,
    config,
  }) satisfies ChannelHealthSummary);

  return [...registered, ...synthetic].sort((left, right) => left.id.localeCompare(right.id));
}

async function summarizeRegisteredChannel(
  entry: ChannelRegistryEntry,
  config: haroConfig.HaroConfig,
  checkedAt: string,
): Promise<ChannelHealthSummary> {
  const channelConfig = readChannelConfig(config, entry.id);
  if (!entry.enabled) {
    return {
      id: entry.id,
      displayName: entry.displayName,
      enabled: false,
      source: entry.source,
      health: 'disabled',
      lastCheckedAt: checkedAt,
      config: channelConfig,
    };
  }
  try {
    const healthy = await entry.channel.healthCheck();
    return {
      id: entry.id,
      displayName: entry.displayName,
      enabled: true,
      source: entry.source,
      health: healthy ? 'healthy' : 'unhealthy',
      lastCheckedAt: checkedAt,
      config: channelConfig,
    };
  } catch (error) {
    return {
      id: entry.id,
      displayName: entry.displayName,
      enabled: true,
      source: entry.source,
      health: 'unhealthy',
      lastCheckedAt: checkedAt,
      config: channelConfig,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readDatabaseStatus(root: string | undefined, dbFile: string) {
  const opened = haroDb.initHaroDatabase({ root, dbFile, keepOpen: true });
  const db = opened.database!;
  try {
    const sessions = db
      .prepare('SELECT status, COUNT(*) AS count FROM sessions GROUP BY status ORDER BY status')
      .all() as SessionCountRow[];
    const recent = db
      .prepare('SELECT id, agent_id, provider, model, status, started_at, ended_at FROM sessions ORDER BY started_at DESC LIMIT 5')
      .all() as RecentSessionRow[];
    const stats = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN started_at >= date('now') THEN 1 ELSE 0 END) AS today,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
         FROM sessions`,
      )
      .get() as SessionStatsRow;
    return {
      ok: true,
      dbFile,
      journalMode: opened.journalMode,
      fts5Available: opened.fts5Available,
      sessions: {
        counts: sessions,
        total: stats.total ?? 0,
        today: stats.today ?? 0,
        completed: stats.completed ?? 0,
        failed: stats.failed ?? 0,
        running: stats.running ?? 0,
        successRate: stats.total > 0 ? (stats.completed ?? 0) / stats.total : null,
      },
      recent: recent.map((row) => ({
        sessionId: row.id,
        agentId: row.agent_id,
        provider: row.provider,
        model: row.model,
        status: row.status,
        startedAt: row.started_at,
        endedAt: row.ended_at,
      })),
    };
  } finally {
    db.close();
  }
}

async function readSqliteDoctor(root: string | undefined, dbFile: string): Promise<{ ok: boolean; dbFile: string; error?: string }> {
  try {
    haroDb.initHaroDatabase({ root, dbFile });
    return { ok: true, dbFile };
  } catch (error) {
    return { ok: false, dbFile, error: error instanceof Error ? error.message : String(error) };
  }
}

async function readProviderStatus(providerRegistry: ProviderRegistry | undefined): Promise<Array<{ id: string; healthy: boolean; error?: string }>> {
  if (!providerRegistry) return [];
  return Promise.all(
    providerRegistry.list().map(async (provider) => {
      try {
        return { id: provider.id, healthy: await provider.healthCheck() };
      } catch (error) {
        return { id: provider.id, healthy: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}

function buildDoctorGroups(input: {
  dirChecks: Array<{ name: string; path: string; writable: boolean }>;
  sqlite: { ok: boolean; dbFile: string; error?: string };
  providers: Array<{ id: string; healthy: boolean; error?: string }>;
  channels: ChannelHealthSummary[];
  sources: string[];
}) {
  return [
    {
      id: 'filesystem',
      title: 'Filesystem',
      items: input.dirChecks.map((check) => ({
        severity: check.writable ? 'info' : 'error',
        message: `${check.name} ${check.writable ? 'is writable' : 'is not writable'}`,
        path: check.path,
        suggestion: check.writable ? undefined : `检查目录权限：${check.path}`,
      })),
    },
    {
      id: 'database',
      title: 'Database',
      items: [
        {
          severity: input.sqlite.ok ? 'info' : 'error',
          message: input.sqlite.ok ? 'SQLite is available' : `SQLite failed: ${input.sqlite.error ?? 'unknown error'}`,
          path: input.sqlite.dbFile,
          suggestion: input.sqlite.ok ? undefined : '运行 haro doctor 查看本地 SQLite 依赖与权限',
        },
      ],
    },
    {
      id: 'config',
      title: 'Config',
      items: input.sources.map((source) => ({ severity: 'info', message: `Loaded config source: ${source}` })),
    },
    {
      id: 'providers',
      title: 'Providers',
      items: input.providers.map((provider) => ({
        severity: provider.healthy ? 'info' : 'error',
        message: `${provider.id} ${provider.healthy ? 'healthy' : 'unhealthy'}`,
        suggestion: provider.healthy ? undefined : '检查 provider 凭证、网络或模型配置',
      })),
    },
    {
      id: 'channels',
      title: 'Channels',
      items: input.channels.map((channel) => ({
        severity: channel.health === 'unhealthy' ? 'warn' : 'info',
        message: `${channel.id} ${channel.enabled ? channel.health : 'disabled'}`,
        suggestion: channel.health === 'unhealthy' ? 'Channel 生命周期操作属于 FEAT-019；此处仅展示诊断摘要' : undefined,
      })),
    },
  ];
}

function loadConfig(runtime: WebRuntime): haroConfig.LoadedConfig {
  return haroConfig.loadHaroConfig({
    globalRoot: runtime.root,
    projectRoot: runtime.projectRoot ?? process.cwd(),
  });
}

function readChannelConfig(config: { channels?: haroConfig.HaroConfig['channels'] }, id: string): Record<string, unknown> {
  const channels = (config.channels ?? {}) as Record<string, unknown>;
  return objectValue(channels[id]);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
