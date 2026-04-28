import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildHaroPaths, createMemoryFabric, db as haroDb } from '@haro/core';
import { createWebApp } from '../src/web/index.js';
import type { WebLogger } from '../src/web/types.js';

function createMockLogger(): WebLogger {
  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

function jsonRequest(body: unknown, token?: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  };
}

interface SessionEnvelope {
  data: { session: { token: string } };
}

interface PageEnvelope<T> {
  data: {
    items: T[];
    pageInfo: { page: number; pageSize: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean };
    total: number;
    limit?: number;
    offset?: number;
  };
}

describe('web pagination contract [FEAT-028]', () => {
  const tempRoots: string[] = [];
  const originalApiKey = process.env.HARO_WEB_API_KEY;

  afterEach(() => {
    process.env.HARO_WEB_API_KEY = originalApiKey;
    vi.restoreAllMocks();
    while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true });
  });

  async function setup() {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-page-'));
    tempRoots.push(root);
    const app = createWebApp({ logger: createMockLogger(), runtime: { root } });
    const bootstrap = await (await app.request('/api/v1/auth/bootstrap', jsonRequest({ username: 'owner', password: 'owner-password' }))).json() as SessionEnvelope;
    const token = bootstrap.data.session.token;
    seedCoreRows(root);
    await seedMemoryRows(root);
    await app.request('/api/v1/users', jsonRequest({ username: 'viewer', password: 'viewer-password', role: 'viewer', displayName: 'Viewer User' }, token));
    await app.request('/api/v1/users', jsonRequest({ username: 'admin2', password: 'admin2-password', role: 'admin', displayName: 'Admin Two' }, token));
    return { app, root, token };
  }

  it('returns unified pageInfo for sessions and preserves legacy limit/offset callers', async () => {
    const { app, token } = await setup();
    const response = await app.request('/api/v1/sessions?page=-3&pageSize=999&sort=invalid&order=side&q=agent', { headers: { authorization: `Bearer ${token}` } });
    const body = await response.json() as PageEnvelope<{ sessionId: string; createdAt: string }>;

    expect(response.status).toBe(200);
    expect(body.data.pageInfo).toMatchObject({ page: 1, pageSize: 100, hasPreviousPage: false });
    expect(body.data.total).toBe(3);
    expect(body.data.items[0].sessionId).toBe('session-3');

    const legacy = await (await app.request('/api/v1/sessions?limit=1&offset=1', { headers: { authorization: `Bearer ${token}` } })).json() as PageEnvelope<{ sessionId: string }>;
    expect(legacy.data.pageInfo).toMatchObject({ page: 2, pageSize: 1, hasPreviousPage: true, hasNextPage: true });
    expect(legacy.data.limit).toBe(1);
    expect(legacy.data.offset).toBe(1);
  });

  it('returns unified pageInfo for logs with allowlisted sort/order/q', async () => {
    const { app, token } = await setup();
    const response = await app.request('/api/v1/logs/session-events?page=1&pageSize=2&sort=eventType&order=asc&q=result', { headers: { authorization: `Bearer ${token}` } });
    const body = await response.json() as PageEnvelope<{ eventType: string }>;

    expect(response.status).toBe(200);
    expect(body.data.pageInfo).toMatchObject({ page: 1, pageSize: 2 });
    expect(body.data.total).toBe(2);
    expect(body.data.items.every((item) => item.eventType === 'result')).toBe(true);
  });

  it('returns unified pageInfo for memory knowledge query and clamps long q', async () => {
    const { app, token } = await setup();
    const longQ = `${'memory'.repeat(100)}`;
    const response = await app.request(`/api/v1/memory/query?page=1&pageSize=1&sort=topic&order=asc&q=${encodeURIComponent(longQ)}`, { headers: { authorization: `Bearer ${token}` } });
    const body = await response.json() as PageEnvelope<{ entry: { topic: string } }>;

    expect(response.status).toBe(200);
    expect(body.data.pageInfo.pageSize).toBe(1);
    expect(body.data).toHaveProperty('items');
    expect(body.data).toHaveProperty('total');
  });

  it('returns unified pageInfo for skills list even when q filters to empty', async () => {
    const { app, token } = await setup();
    const response = await app.request('/api/v1/skills?page=1&pageSize=5&sort=not_allowed&order=up&q=__no_such_skill__', { headers: { authorization: `Bearer ${token}` } });
    const body = await response.json() as PageEnvelope<{ id: string }>;

    expect(response.status).toBe(200);
    expect(body.data.pageInfo).toMatchObject({ page: 1, pageSize: 5 });
    expect(body.data.total).toBe(0);
    expect(body.data.items).toEqual([]);
  });

  it('returns unified pageInfo for users and q searches username/displayName/role', async () => {
    const { app, token } = await setup();
    const response = await app.request('/api/v1/users?page=1&pageSize=2&sort=username&order=asc&q=admin', { headers: { authorization: `Bearer ${token}` } });
    const body = await response.json() as PageEnvelope<{ username: string; role: string }>;

    expect(response.status).toBe(200);
    expect(body.data.pageInfo).toMatchObject({ page: 1, pageSize: 2, hasPreviousPage: false });
    expect(body.data.total).toBe(1);
    expect(body.data.items[0]).toMatchObject({ username: 'admin2', role: 'admin' });
  });
});

function seedCoreRows(root: string): void {
  const database = haroDb.initHaroDatabase({ root, keepOpen: true }).database!;
  try {
    for (let index = 1; index <= 3; index += 1) {
      database.prepare(`INSERT INTO sessions (id, agent_id, provider, model, started_at, ended_at, context_ref, status) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`).run(
        `session-${index}`,
        `agent-${index}`,
        'codex',
        `gpt-${index}`,
        `2026-04-2${index}T00:00:00.000Z`,
        index === 1 ? 'running' : 'completed',
      );
      database.prepare(`INSERT INTO session_events (session_id, event_type, event_data, created_at, latency_ms) VALUES (?, ?, ?, ?, ?)`).run(
        `session-${index}`,
        index === 1 ? 'text' : 'result',
        JSON.stringify({ index, kind: index === 1 ? 'text' : 'result' }),
        `2026-04-2${index}T00:00:01.000Z`,
        index * 10,
      );
    }
    database.prepare(`INSERT INTO provider_fallback_log (session_id, original_provider, original_model, fallback_provider, fallback_model, trigger, rule_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'session-2', 'codex', 'gpt-a', 'codex', 'gpt-b', 'rate_limit', 'rule-1', '2026-04-22T00:00:02.000Z',
    );
  } finally {
    database.close();
  }
}

async function seedMemoryRows(root: string): Promise<void> {
  const paths = buildHaroPaths(root);
  const fabric = createMemoryFabric({ root: paths.dirs.memory, dbFile: paths.dbFile });
  await fabric.writeEntry({
    layer: 'persistent',
    scope: 'shared',
    topic: 'dashboard memory alpha',
    summary: 'memory alpha summary',
    content: 'memory alpha content',
    sourceRef: 'test',
    tags: ['feat-028'],
  });
  await fabric.writeEntry({
    layer: 'persistent',
    scope: 'shared',
    topic: 'dashboard memory beta',
    summary: 'memory beta summary',
    content: 'memory beta content',
    sourceRef: 'test',
    tags: ['feat-028'],
  });
}
