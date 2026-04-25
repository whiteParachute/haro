import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { put } from '../src/api/client';
import { ConfigEditor } from '../src/components/settings/ConfigEditor';
import { ConfigSources } from '../src/components/settings/ConfigSources';
import { DoctorReport } from '../src/components/status/DoctorReport';
import { StatusPage } from '../src/pages/StatusPage';
import { SettingsPage } from '../src/pages/SettingsPage';
import { useConfigStore } from '../src/stores/config';
import { useSystemStore } from '../src/stores/system';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

describe('FEAT-017 web system management client', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    useSystemStore.setState({ status: null, doctor: null, loading: false, error: null });
    useConfigStore.setState({ config: null, rawYaml: '', sources: [], fieldSources: {}, channels: [], loading: false, saving: false, saved: false, error: null, issues: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('api client exposes PUT with JSON body and auth behavior', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: { saved: true } })));

    await put('/v1/config', { config: { logging: { level: 'debug' } } });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/v1/config');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe(JSON.stringify({ config: { logging: { level: 'debug' } } }));
  });

  it('system and config stores load REST data and preserve validation issues', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/status')) return jsonResponse({ success: true, data: statusFixture });
      if (url.endsWith('/api/v1/doctor')) return jsonResponse({ success: true, data: doctorFixture });
      if (url.endsWith('/api/v1/config') && init?.method !== 'PUT') return jsonResponse({ success: true, data: configFixture });
      if (url.endsWith('/api/v1/config/sources')) return jsonResponse({ success: true, data: { sources: configFixture.sources, fieldSources: configFixture.fieldSources } });
      if (url.endsWith('/api/v1/config') && init?.method === 'PUT') return jsonResponse({ error: 'invalid', issues: [{ path: 'logging.level', message: 'Invalid enum value' }] }, { status: 400 });
      return jsonResponse({ error: 'missing' }, { status: 404 });
    }));

    await useSystemStore.getState().refresh();
    expect(useSystemStore.getState().status?.channels[0].id).toBe('cli');
    expect(useSystemStore.getState().doctor?.groups[0].id).toBe('filesystem');

    await useConfigStore.getState().loadConfig();
    expect(useConfigStore.getState().fieldSources['logging.level'].source).toBe('project');
    expect(await useConfigStore.getState().saveConfig({ config: { logging: { level: 'verbose' } } })).toBe(false);
    expect(useConfigStore.getState().issues[0]).toEqual({ path: 'logging.level', message: 'Invalid enum value' });
  });

  it('renders Status and Settings key states without channel lifecycle controls', () => {
    useSystemStore.setState({ status: statusFixture, doctor: doctorFixture, loading: false, error: null });
    useConfigStore.setState({ ...configFixture, config: configFixture.config, loading: false, saving: false, saved: true, error: null, issues: [] });

    const statusHtml = renderToString(<StatusPage />);
    expect(statusHtml).toContain('Doctor Report');
    expect(statusHtml).toContain('FEAT-019 owns actions');
    expect(statusHtml).not.toContain('enable');
    expect(statusHtml).not.toContain('remove');

    const settingsHtml = renderToString(<SettingsPage />);
    expect(settingsHtml).toContain('项目级 .haro/config.yaml');
    expect(settingsHtml).toContain('Channel 配置摘要');
    expect(settingsHtml).not.toContain('/api/v1/channels');
  });

  it('renders doctor groups, config sources, and local validation errors', () => {
    expect(renderToString(<DoctorReport groups={doctorFixture.groups} />)).toContain('Filesystem');
    expect(renderToString(<ConfigSources sources={configFixture.sources} fieldSources={configFixture.fieldSources} />)).toContain('logging.level');
    expect(renderToString(
      <ConfigEditor
        config={configFixture.config}
        rawYaml={configFixture.rawYaml}
        issues={[{ path: 'runtime.taskTimeoutMs', message: 'taskTimeoutMs must be positive' }]}
        saving={false}
        onSaveConfig={async () => true}
        onSaveYaml={async () => true}
        validate={() => []}
      />,
    )).toContain('taskTimeoutMs must be positive');
  });
});

const statusFixture = {
  ok: true,
  service: 'haro-web',
  startedAt: '2026-04-25T00:00:00.000Z',
  uptimeMs: 100,
  database: { ok: true, dbFile: '/tmp/haro.db', journalMode: 'wal', fts5Available: true },
  providers: [{ id: 'codex', healthy: true }],
  channels: [{ id: 'cli', displayName: 'CLI', enabled: true, source: 'builtin', health: 'healthy' as const, lastCheckedAt: '2026-04-25T00:00:00.000Z', config: { enabled: true } }],
  sessions: { counts: [], total: 0, today: 0, completed: 0, failed: 0, running: 0, successRate: null },
  recent: [],
};

const doctorFixture = {
  ok: true,
  config: { ok: true, sources: ['defaults'] },
  providers: statusFixture.providers,
  channels: statusFixture.channels,
  dataDir: { root: '/tmp/haro', checks: [{ name: 'logs', path: '/tmp/haro/logs', writable: true }] },
  sqlite: { ok: true, dbFile: '/tmp/haro.db' },
  groups: [
    { id: 'filesystem', title: 'Filesystem', items: [{ severity: 'info' as const, message: 'logs is writable', path: '/tmp/haro/logs' }] },
    { id: 'channels', title: 'Channels', items: [{ severity: 'info' as const, message: 'cli healthy' }] },
  ],
};

const configFixture = {
  config: { logging: { level: 'info' }, runtime: { taskTimeoutMs: 600000 }, channels: { cli: { enabled: true } } },
  rawYaml: 'logging:\n  level: info\n',
  sources: [{ id: 'project', label: 'Project config', path: '/repo/.haro/config.yaml', present: true, active: true }],
  fieldSources: { 'logging.level': { source: 'project', path: '/repo/.haro/config.yaml', value: 'info' } },
  channels: statusFixture.channels,
};
