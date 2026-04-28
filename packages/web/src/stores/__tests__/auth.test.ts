import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_API_KEY_STORAGE_KEY, useAuthStore } from '../auth';

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
  return new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
}

function resetAuth() {
  useAuthStore.setState({ status: 'initial', user: undefined, mustChangePassword: false, apiKey: null, isAuthenticated: false, checking: false });
}

describe('FEAT-028 auth store', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    resetAuth();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetAuth();
  });

  it('checkAuth authenticates /me user-session state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: { authenticated: true, kind: 'session', role: 'admin', user: { id: 'u1', username: 'admin', displayName: 'Admin', role: 'admin' } } })));

    await useAuthStore.getState().checkAuth();

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.role).toBe('admin');
    expect(vi.mocked(fetch).mock.calls[0][1]?.credentials).toBe('include');
  });

  it('checkAuth falls back to status and detects needs-bootstrap', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/api/v1/auth/me')
      ? jsonResponse({ error: 'Unauthorized' }, { status: 401 })
      : jsonResponse({ success: true, data: { userCount: 0, requiresBootstrap: true, hasOwner: false, sessionAuthEnabled: false, legacyApiKeyEnabled: false } })));

    await useAuthStore.getState().checkAuth();

    expect(useAuthStore.getState().status).toBe('needs-bootstrap');
  });

  it('checkAuth handles anonymous bootstrap-compatible /me response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/api/v1/auth/me')
      ? jsonResponse({ success: true, data: { authenticated: false, kind: 'anonymous-legacy', role: 'owner', user: null } })
      : jsonResponse({ success: true, data: { userCount: 0, requiresBootstrap: true, hasOwner: false, sessionAuthEnabled: false, legacyApiKeyEnabled: false } })));

    await useAuthStore.getState().checkAuth();

    expect(useAuthStore.getState().status).toBe('needs-bootstrap');
  });

  it('checkAuth falls back to logged-out when users already exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/api/v1/auth/me')
      ? jsonResponse({ error: 'Unauthorized' }, { status: 401 })
      : jsonResponse({ success: true, data: { userCount: 2, requiresBootstrap: false, hasOwner: true, sessionAuthEnabled: true, legacyApiKeyEnabled: false } })));

    await useAuthStore.getState().checkAuth();

    expect(useAuthStore.getState().status).toBe('logged-out');
  });

  it('login, logout, bootstrap and legacy api key update state', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/login') || url.endsWith('/api/v1/auth/bootstrap')) {
        return jsonResponse({ success: true, data: { user: { id: 'owner', username: 'owner', displayName: 'Owner', role: 'owner' }, session: { token: 'tok', sessionId: 'sid', expiresAt: '2026-05-01T00:00:00.000Z' } } });
      }
      return jsonResponse({ success: true, data: { loggedOut: true } });
    }));

    await expect(useAuthStore.getState().login('owner', 'password')).resolves.toEqual({ ok: true });
    expect(useAuthStore.getState().status).toBe('authenticated');
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().status).toBe('logged-out');
    await expect(useAuthStore.getState().bootstrapOwner({ username: 'owner', password: 'password' })).resolves.toEqual({ ok: true });
    expect(useAuthStore.getState().user?.username).toBe('owner');

    useAuthStore.getState().setApiKey('legacy-secret');
    expect(localStorage.getItem(AUTH_API_KEY_STORAGE_KEY)).toBe('legacy-secret');
    expect(useAuthStore.getState().user?.role).toBe('owner');
    useAuthStore.getState().clearAuth();
    expect(localStorage.getItem(AUTH_API_KEY_STORAGE_KEY)).toBeNull();
  });
});
