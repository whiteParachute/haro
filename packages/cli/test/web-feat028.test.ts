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
