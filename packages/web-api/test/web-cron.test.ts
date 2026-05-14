/** FEAT-033 — /api/v1/cron HTTP route smoke tests. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebApp } from '../src/index.js';
import type { WebLogger } from '../src/types.js';

function createMockLogger(): WebLogger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe('web-api /api/v1/cron [FEAT-033]', () => {
  const originalApiKey = process.env.HARO_WEB_API_KEY;
  const tempRoots: string[] = [];

  afterEach(() => {
    process.env.HARO_WEB_API_KEY = originalApiKey;
    while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true });
  });

  function makeApp(): { app: ReturnType<typeof createWebApp>; root: string } {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-cron-'));
    tempRoots.push(root);
    const app = createWebApp({ logger: createMockLogger(), runtime: { root } });
    return { app, root };
  }

  it('POST /api/v1/cron/jobs creates a cron job and returns 201', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/cron/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 's-1',
        mode: 'cron',
        when: '*/5 * * * *',
        taskInput: 'roll up',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: { id: string; status: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toMatch(/^cron_/);
    expect(body.data.status).toBe('pending');
  });

  it('GET /api/v1/cron/jobs filters by sessionId', async () => {
    const { app } = makeApp();
    for (const sid of ['a', 'b', 'a']) {
      await app.request('/api/v1/cron/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, mode: 'cron', when: '*/5 * * * *', taskInput: 't' }),
      });
    }
    const res = await app.request('/api/v1/cron/jobs?sessionId=a');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { items: Array<{ sessionId: string }>; count: number } };
    expect(body.data.count).toBe(2);
    for (const item of body.data.items) expect(item.sessionId).toBe('a');
  });

  it('POST sub-minute cron returns 400 with code CRON_FREQUENCY_TOO_HIGH', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/cron/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 's-1',
        mode: 'cron',
        when: '* * * * * *',
        taskInput: 't',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; code: string };
    expect(body.success).toBe(false);
    expect(body.code).toBe('CRON_FREQUENCY_TOO_HIGH');
  });

  it('GET /api/v1/cron/jobs/:id returns 404 with code CRON_JOB_NOT_FOUND', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/cron/jobs/no-such');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; code: string };
    expect(body.code).toBe('CRON_JOB_NOT_FOUND');
  });

  it('DELETE cancels and returns updated record', async () => {
    const { app } = makeApp();
    const create = await app.request('/api/v1/cron/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's', mode: 'cron', when: '*/5 * * * *', taskInput: 't' }),
    });
    const created = (await create.json()) as { data: { id: string } };
    const del = await app.request(`/api/v1/cron/jobs/${created.data.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const body = (await del.json()) as { success: boolean; data: { enabled: boolean; status: string } };
    expect(body.data.enabled).toBe(false);
    expect(body.data.status).toBe('cancelled');
  });

  it('POST /api/v1/cron/jobs/:id/trigger sets next_run_at to now', async () => {
    const { app } = makeApp();
    const create = await app.request('/api/v1/cron/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's', mode: 'cron', when: '*/5 * * * *', taskInput: 't' }),
    });
    const created = (await create.json()) as { data: { id: string; nextRunAt: number } };
    const before = created.data.nextRunAt;
    const trig = await app.request(`/api/v1/cron/jobs/${created.data.id}/trigger`, { method: 'POST' });
    expect(trig.status).toBe(200);
    const body = (await trig.json()) as { data: { nextRunAt: number } };
    expect(body.data.nextRunAt).toBeLessThan(before);
  });

  it('POST with invalid status query returns 400', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/cron/jobs?status=bogus');
    expect(res.status).toBe(400);
  });

  it('rejects viewer cron create, cancel, and trigger mutations', async () => {
    const { app } = makeApp();
    const ownerBootstrap = await (await app.request('/api/v1/auth/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'owner-password' }),
    })).json() as { data: { session: { token: string } } };
    const ownerToken = ownerBootstrap.data.session.token;

    await app.request('/api/v1/users', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username: 'viewer',
        password: 'viewer-password',
        role: 'viewer',
      }),
    });
    const viewerLogin = await (await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer-password' }),
    })).json() as { data: { session: { token: string } } };
    const viewerToken = viewerLogin.data.session.token;

    const create = await app.request('/api/v1/cron/jobs', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: 's-owner',
        mode: 'cron',
        when: '*/5 * * * *',
        taskInput: 'owner task',
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { data: { id: string } };

    const viewerCreate = await app.request('/api/v1/cron/jobs', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${viewerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: 's-viewer',
        mode: 'cron',
        when: '*/5 * * * *',
        taskInput: 'viewer task',
      }),
    });
    expect(viewerCreate.status).toBe(403);

    const viewerTrigger = await app.request(`/api/v1/cron/jobs/${created.data.id}/trigger`, {
      method: 'POST',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(viewerTrigger.status).toBe(403);

    const viewerDelete = await app.request(`/api/v1/cron/jobs/${created.data.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(viewerDelete.status).toBe(403);

    const viewerList = await app.request('/api/v1/cron/jobs', {
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(viewerList.status).toBe(200);
  });
});
