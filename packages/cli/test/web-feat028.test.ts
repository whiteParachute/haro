import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db as haroDb } from '@haro/core';
import { createWebApp } from '../src/web/index.js';
import type { WebLogger } from '../src/web/types.js';

function createMockLogger(): WebLogger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function jsonRequest(body: unknown, token?: string) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  };
}

interface SessionEnvelope {
  data: {
    user: { id: string; username: string; role: string; status: string };
    session: { token: string; sessionId: string; expiresAt: string };
  };
}

interface UsersEnvelope {
  data: {
    items: Array<{ id: string; username: string; role: string; status: string }>;
    total: number;
  };
}

describe('web dashboard local auth [FEAT-028]', () => {
  const originalApiKey = process.env.HARO_WEB_API_KEY;
  const tempRoots: string[] = [];

  afterEach(() => {
    process.env.HARO_WEB_API_KEY = originalApiKey;
    vi.restoreAllMocks();
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it('reports owner bootstrap status before the first web user exists', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-auth-status-'));
    tempRoots.push(root);
    const app = createWebApp({ logger: createMockLogger(), runtime: { root } });

    const response = await app.request('/api/v1/auth/status');
    const body = await response.json() as { data: { requiresBootstrap: boolean; sessionAuthEnabled: boolean; roles: string[] } };

    expect(response.status).toBe(200);
    expect(body.data.requiresBootstrap).toBe(true);
    expect(body.data.sessionAuthEnabled).toBe(false);
    expect(body.data.roles).toEqual(['owner', 'admin', 'operator', 'viewer']);
  });

  it('bootstraps the first owner, stores only a password hash, and authenticates with a web session token', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-auth-bootstrap-'));
    tempRoots.push(root);
    const app = createWebApp({ logger: createMockLogger(), runtime: { root } });

    const bootstrapResponse = await app.request('/api/v1/auth/bootstrap', jsonRequest({
      username: 'owner',
      displayName: 'Owner User',
      password: 'owner-password',
    }));
    const bootstrapBody = await bootstrapResponse.json() as SessionEnvelope;

    expect(bootstrapResponse.status).toBe(201);
    expect(bootstrapBody.data.user).toMatchObject({ username: 'owner', role: 'owner', status: 'active' });
    expect(bootstrapBody.data.session.token).toEqual(expect.any(String));

    const database = haroDb.initHaroDatabase({ root, keepOpen: true }).database!;
    try {
      const row = database.prepare(`SELECT password_hash FROM web_users WHERE username = ?`).get('owner') as { password_hash: string };
      const auditCount = (database.prepare(`SELECT COUNT(*) AS count FROM web_audit_events`).get() as { count: number }).count;
      expect(row.password_hash).toMatch(/^scrypt\$/);
      expect(row.password_hash).not.toContain('owner-password');
      expect(auditCount).toBe(1);
    } finally {
      database.close();
    }

    const meResponse = await app.request('/api/v1/auth/me', {
      headers: { authorization: `Bearer ${bootstrapBody.data.session.token}` },
    });
    const meBody = await meResponse.json() as { data: { role: string; user: { username: string } } };

    expect(meResponse.status).toBe(200);
    expect(meBody.data.role).toBe('owner');
    expect(meBody.data.user.username).toBe('owner');
  });

  it('enforces role guards for user management while preserving read-only viewer access', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-auth-rbac-'));
    tempRoots.push(root);
    const app = createWebApp({ logger: createMockLogger(), runtime: { root } });

    const bootstrap = await (await app.request('/api/v1/auth/bootstrap', jsonRequest({
      username: 'owner',
      password: 'owner-password',
    }))).json() as SessionEnvelope;
    const ownerToken = bootstrap.data.session.token;

    const createViewerResponse = await app.request('/api/v1/users', jsonRequest({
      username: 'viewer',
      displayName: 'Viewer User',
      password: 'viewer-password',
      role: 'viewer',
    }, ownerToken));
    expect(createViewerResponse.status).toBe(201);

    const viewerLogin = await (await app.request('/api/v1/auth/login', jsonRequest({
      username: 'viewer',
      password: 'viewer-password',
    }))).json() as SessionEnvelope;
    const viewerToken = viewerLogin.data.session.token;

    const viewerListResponse = await app.request('/api/v1/users', {
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    const viewerList = await viewerListResponse.json() as UsersEnvelope;
    expect(viewerListResponse.status).toBe(200);
    expect(viewerList.data.total).toBe(2);

    const viewerCreateResponse = await app.request('/api/v1/users', jsonRequest({
      username: 'blocked',
      password: 'blocked-password',
      role: 'viewer',
    }, viewerToken));
    expect(viewerCreateResponse.status).toBe(403);
  });

  // FEAT-028 critical adversarial-review fixes (CRIT-1/CRIT-2/HIGH-3/HIGH-4).
  it('CRIT-1: bootstrap is rejected when HARO_WEB_API_KEY is configured and the caller has no key', async () => {
    process.env.HARO_WEB_API_KEY = 'legacy-secret';
    const root = mkdtempSync(join(tmpdir(), 'haro-web-feat028-bootstrap-gate-'));
    tempRoots.push(root);
    const app = createWebApp({ logger: createMockLogger(), runtime: { root } });

    // Either the auth middleware (path no longer public) or the route-level
    // guard must reject; both are defense-in-depth and either is acceptable.
    const anonymousBootstrap = await app.request('/api/v1/auth/bootstrap', jsonRequest({
      username: 'attacker',
      password: 'attacker-password',
    }));
    expect(anonymousBootstrap.status).toBe(401);
    const body = await anonymousBootstrap.json() as { error: string; code?: string };
    expect(body.error).toMatch(/Unauthorized|Bootstrap requires/);

    // wrong api key still rejected
    const wrongKeyBootstrap = await app.request('/api/v1/auth/bootstrap', {
      method: 'POST',
      headers: { 'x-api-key': 'wrong-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'attacker', password: 'attacker-password' }),
    });
    expect(wrongKeyBootstrap.status).toBe(401);

    // Correct legacy key passes through both gates and creates the owner.
    const legacyBootstrap = await app.request('/api/v1/auth/bootstrap', {
      method: 'POST',
      headers: { 'x-api-key': 'legacy-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'owner-password' }),
    });
    expect(legacyBootstrap.status).toBe(201);
  });

  it('CRIT-2: admin cannot create or promote owner accounts (owner-transfer guard)', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-feat028-owner-transfer-'));
    tempRoots.push(root);
    const app = createWebApp({ logger: createMockLogger(), runtime: { root } });

    const ownerBootstrap = await (await app.request('/api/v1/auth/bootstrap', jsonRequest({
      username: 'owner',
      password: 'owner-password',
    }))).json() as SessionEnvelope;
    const ownerToken = ownerBootstrap.data.session.token;

    const adminCreate = await app.request('/api/v1/users', jsonRequest({
      username: 'admin',
      password: 'admin-password',
      role: 'admin',
    }, ownerToken));
    expect(adminCreate.status).toBe(201);
    const adminUserId = (await adminCreate.json() as { data: { id: string } }).data.id;

    const adminLogin = await (await app.request('/api/v1/auth/login', jsonRequest({
      username: 'admin',
      password: 'admin-password',
    }))).json() as SessionEnvelope;
    const adminToken = adminLogin.data.session.token;

    // admin tries to create an owner account → 403 owner_transfer_required
    const promotionAttempt = await app.request('/api/v1/users', jsonRequest({
      username: 'second-owner',
      password: 'pwned-password',
      role: 'owner',
    }, adminToken));
    expect(promotionAttempt.status).toBe(403);
    const promBody = await promotionAttempt.json() as { code: string };
    expect(promBody.code).toBe('owner_transfer_required');

    // admin tries to PATCH self.role = 'owner' → 403 owner_transfer_required
    const selfPromote = await app.request(`/api/v1/users/${adminUserId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    });
    expect(selfPromote.status).toBe(403);
    expect((await selfPromote.json() as { code: string }).code).toBe('owner_transfer_required');

    // owner can do both — guard does not block legitimate transfer.
    const ownerPromote = await app.request(`/api/v1/users/${adminUserId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    });
    expect(ownerPromote.status).toBe(200);
  });

  it('HIGH-3: viewer is rejected on guarded write surfaces (config PUT, agent CRUD, channel mutations)', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-feat028-rbac-matrix-'));
    tempRoots.push(root);
    const app = createWebApp({ logger: createMockLogger(), runtime: { root } });

    const ownerBootstrap = await (await app.request('/api/v1/auth/bootstrap', jsonRequest({
      username: 'owner',
      password: 'owner-password',
    }))).json() as SessionEnvelope;
    const ownerToken = ownerBootstrap.data.session.token;

    await app.request('/api/v1/users', jsonRequest({
      username: 'viewer',
      password: 'viewer-password',
      role: 'viewer',
    }, ownerToken));

    const viewerLogin = await (await app.request('/api/v1/auth/login', jsonRequest({
      username: 'viewer',
      password: 'viewer-password',
    }))).json() as SessionEnvelope;
    const viewerToken = viewerLogin.data.session.token;

    const guardedPaths: Array<{ method: string; path: string; body?: unknown }> = [
      { method: 'PUT', path: '/api/v1/config', body: { rawYaml: 'logging:\n  level: info\n' } },
      { method: 'POST', path: '/api/v1/agents', body: { yaml: 'id: x\nname: x\nsystemPrompt: hi\n' } },
      { method: 'DELETE', path: '/api/v1/agents/anything' },
      { method: 'POST', path: '/api/v1/channels/cli/disable' },
      { method: 'POST', path: '/api/v1/skills/foo/disable' },
      { method: 'POST', path: '/api/v1/gateway/start' },
      { method: 'POST', path: '/api/v1/memory/maintenance', body: { agentId: 'haro-assistant' } },
    ];
    for (const probe of guardedPaths) {
      const init: RequestInit = {
        method: probe.method,
        headers: {
          authorization: `Bearer ${viewerToken}`,
          ...(probe.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(probe.body !== undefined ? { body: JSON.stringify(probe.body) } : {}),
      };
      const response = await app.request(probe.path, init);
      expect(response.status, `${probe.method} ${probe.path} should be 403 for viewer`).toBe(403);
    }
  });

  it('HIGH-4: session DELETE rolls back when audit insert fails (atomic audit)', async () => {
    delete process.env.HARO_WEB_API_KEY;
    const root = mkdtempSync(join(tmpdir(), 'haro-web-feat028-atomic-audit-'));
    tempRoots.push(root);

    const opened = haroDb.initHaroDatabase({ root, keepOpen: true });
    const db = opened.database!;
    db.prepare(`INSERT INTO sessions (id, agent_id, provider, model, started_at, status, context_ref) VALUES (?, ?, ?, ?, ?, ?, NULL)`).run('s-atomic', 'assistant', 'codex', 'gpt-test', '2026-04-28T00:00:00.000Z', 'completed');
    db.prepare(`INSERT INTO session_events (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)`).run('s-atomic', 'text', JSON.stringify({ type: 'text', content: 'keep me' }), '2026-04-28T00:00:01.000Z');
    // Install a BEFORE INSERT trigger that always fails — initHaroDatabase
    // re-creates tables idempotently but does not touch this trigger, so the
    // audit INSERT inside the delete tx is guaranteed to throw.
    db.exec(`CREATE TRIGGER IF NOT EXISTS audit_block_atomic
             BEFORE INSERT ON operation_audit_log
             BEGIN SELECT RAISE(FAIL, 'audit_block_atomic'); END`);
    db.close();

    const app = createWebApp({ logger: createMockLogger(), runtime: { root } });
    const bootstrap = await (await app.request('/api/v1/auth/bootstrap', jsonRequest({
      username: 'owner',
      password: 'owner-password',
    }))).json() as SessionEnvelope;
    const ownerToken = bootstrap.data.session.token;

    const deleteResponse = await app.request('/api/v1/sessions/s-atomic', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(deleteResponse.status).toBe(500);
    const body = await deleteResponse.json() as { code: string };
    expect(body.code).toBe('SESSION_DELETE_FAILED');

    // Session and its events must still exist — the tx was rolled back.
    const verifyDb = haroDb.initHaroDatabase({ root, keepOpen: true }).database!;
    const sessionRow = verifyDb.prepare(`SELECT id FROM sessions WHERE id = ?`).get('s-atomic') as { id: string } | undefined;
    const eventCount = (verifyDb.prepare(`SELECT COUNT(*) AS count FROM session_events WHERE session_id = ?`).get('s-atomic') as { count: number }).count;
    verifyDb.close();
    expect(sessionRow).toBeDefined();
    expect(sessionRow?.id).toBe('s-atomic');
    expect(eventCount).toBe(1);
  });

  it('keeps HARO_WEB_API_KEY as a legacy owner-compatible access path after local users exist', async () => {
    process.env.HARO_WEB_API_KEY = 'legacy-secret';
    const root = mkdtempSync(join(tmpdir(), 'haro-web-auth-legacy-'));
    tempRoots.push(root);
    const app = createWebApp({ logger: createMockLogger(), runtime: { root } });

    await app.request('/api/v1/auth/bootstrap', jsonRequest({
      username: 'owner',
      password: 'owner-password',
    }));

    const denied = await app.request('/api/v1/users');
    expect(denied.status).toBe(401);

    const legacyList = await app.request('/api/v1/users', {
      headers: { 'x-api-key': 'legacy-secret' },
    });
    expect(legacyList.status).toBe(200);

    const legacyCreate = await app.request('/api/v1/users', {
      method: 'POST',
      headers: { 'x-api-key': 'legacy-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-password', role: 'admin' }),
    });
    expect(legacyCreate.status).toBe(201);
  });
});
