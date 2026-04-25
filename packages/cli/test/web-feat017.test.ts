import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebApp } from '../src/web/index.js';
import type { WebLogger } from '../src/web/types.js';

function createMockLogger(): WebLogger {
  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

function jsonRequest(body: unknown, apiKey?: string) {
  return {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: JSON.stringify(body),
  };
}

describe('web dashboard system management REST [FEAT-017]', () => {
  const originalApiKey = process.env.HARO_WEB_API_KEY;
  const roots: string[] = [];

  afterEach(() => {
    process.env.HARO_WEB_API_KEY = originalApiKey;
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function tempRoot(prefix: string) {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
  }

  it('enforces web auth for status, doctor, and config endpoints', async () => {
    process.env.HARO_WEB_API_KEY = 'secret';
    const root = tempRoot('haro-feat017-auth-');
    const app = createWebApp({ logger: createMockLogger(), runtime: { root, projectRoot: root } });

    for (const path of ['/api/v1/status', '/api/v1/doctor', '/api/v1/config', '/api/v1/config/sources']) {
      const response = await app.request(path);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Unauthorized' });
    }
  });

  it('returns status and doctor JSON with embedded read-only channel summaries', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = tempRoot('haro-feat017-status-');
    const app = createWebApp({ logger: createMockLogger(), runtime: { root, projectRoot: root } });

    const statusResponse = await app.request('/api/v1/status');
    const status = await statusResponse.json();
    expect(statusResponse.status).toBe(200);
    expect(status.data).toMatchObject({ service: 'haro-web' });
    expect(status.data.database.ok).toBe(true);
    expect(status.data.sessions.total).toBe(0);
    expect(status.data.channels).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'cli', enabled: true })]));

    const doctorResponse = await app.request('/api/v1/doctor');
    const doctor = await doctorResponse.json();
    expect(doctorResponse.status).toBe(200);
    expect(doctor.data).toMatchObject({ config: { ok: true }, sqlite: { ok: true } });
    expect(doctor.data.groups.map((group: { id: string }) => group.id)).toEqual(['filesystem', 'database', 'config', 'providers', 'channels']);
    expect(doctor.data.channels[0]).toHaveProperty('lastCheckedAt');
  });

  it('gets config, sources, and writes only project-level .haro/config.yaml on valid PUT', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const haroHome = tempRoot('haro-feat017-home-');
    const projectRoot = tempRoot('haro-feat017-project-');
    const app = createWebApp({ logger: createMockLogger(), runtime: { root: haroHome, projectRoot } });

    const getResponse = await app.request('/api/v1/config');
    const getBody = await getResponse.json();
    expect(getResponse.status).toBe(200);
    expect(getBody.data.config.logging.level).toBe('info');
    expect(getBody.data.sources.map((source: { id: string }) => source.id)).toContain('project');
    expect(getBody.data.fieldSources['logging.level'].source).toBe('defaults');

    const putResponse = await app.request('/api/v1/config', jsonRequest({ config: { logging: { level: 'debug' }, runtime: { taskTimeoutMs: 1234 }, channels: { cli: { enabled: true } } } }));
    const putBody = await putResponse.json();
    expect(putResponse.status).toBe(200);
    expect(putBody.data.saved).toBe(true);
    const projectConfig = join(projectRoot, '.haro', 'config.yaml');
    expect(existsSync(projectConfig)).toBe(true);
    expect(readFileSync(projectConfig, 'utf8')).toContain('level: debug');

    const after = await (await app.request('/api/v1/config/sources')).json();
    expect(after.data.fieldSources['logging.level'].source).toBe('project');
  });

  it('returns field-level 400 issues for invalid config and does not overwrite project config', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = tempRoot('haro-feat017-invalid-');
    const app = createWebApp({ logger: createMockLogger(), runtime: { root, projectRoot: root } });

    expect((await app.request('/api/v1/config', jsonRequest({ config: { logging: { level: 'warn' } } }))).status).toBe(200);
    const projectConfig = join(root, '.haro', 'config.yaml');
    const before = readFileSync(projectConfig, 'utf8');

    const invalidResponse = await app.request('/api/v1/config', jsonRequest({ config: { logging: { level: 'verbose' }, runtime: { taskTimeoutMs: -1 } } }));
    const invalid = await invalidResponse.json();
    expect(invalidResponse.status).toBe(400);
    expect(invalid.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'logging.level' }), expect.objectContaining({ path: 'runtime.taskTimeoutMs' })]));
    expect(readFileSync(projectConfig, 'utf8')).toBe(before);
  });

  it('does not define independent /api/v1/channels routes for FEAT-017', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = tempRoot('haro-feat017-boundary-');
    const app = createWebApp({ logger: createMockLogger(), runtime: { root, projectRoot: root } });

    expect((await app.request('/api/v1/channels')).status).toBe(404);
    expect((await app.request('/api/v1/channels/cli/doctor')).status).toBe(404);
  });
});
