import { create } from 'zustand';
import type { WebUser, WebUserRole } from '@/types';

export const AUTH_API_KEY_STORAGE_KEY = 'haro:web-api-key';

export type AuthStatus = 'initial' | 'needs-bootstrap' | 'logged-out' | 'authenticated';

interface AuthMeResponse {
  kind: 'session' | 'legacy-api-key' | 'anonymous-legacy';
  authenticated: boolean;
  role: WebUserRole;
  user: WebUser | null;
  permissions?: Record<string, boolean>;
}

interface AuthStatusResponse {
  userCount: number;
  hasOwner: boolean;
  requiresBootstrap: boolean;
  sessionAuthEnabled: boolean;
  legacyApiKeyEnabled: boolean;
}

interface AuthSessionResponse {
  user: WebUser;
  session: { token: string; sessionId: string; expiresAt: string };
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
  message?: string;
  code?: string;
}

export interface AuthState {
  status: AuthStatus;
  user?: WebUser;
  mustChangePassword?: boolean;
  apiKey: string | null;
  isAuthenticated: boolean;
  checking: boolean;
  checkAuth: () => Promise<void>;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  bootstrapOwner: (input: { username: string; displayName?: string; password: string }) => Promise<{ ok: boolean; error?: string }>;
  setApiKey: (apiKey: string) => void;
  clearAuth: () => void;
}

let inFlightCheck: Promise<void> | null = null;

export function readPersistedApiKey(): string | null {
  try {
    const value = globalThis.localStorage?.getItem(AUTH_API_KEY_STORAGE_KEY)?.trim();
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function persistApiKey(apiKey: string | null): void {
  try {
    if (apiKey) {
      globalThis.localStorage?.setItem(AUTH_API_KEY_STORAGE_KEY, apiKey);
      return;
    }
    globalThis.localStorage?.removeItem(AUTH_API_KEY_STORAGE_KEY);
  } catch {
    // Ignore storage failures (private browsing, disabled storage, SSR-like tests).
  }
}

function resolveApiBaseUrl() {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  return configuredBaseUrl && configuredBaseUrl.length > 0 ? configuredBaseUrl.replace(/\/$/, '') : '/api';
}

async function authFetch<T>(path: string, init: RequestInit = {}, apiKey = useAuthStore.getState().apiKey ?? readPersistedApiKey()): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (apiKey && !headers.has('x-api-key')) headers.set('x-api-key', apiKey);
  const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  const payload = await response.json().catch(() => ({ success: response.ok, data: null, error: response.statusText })) as ApiEnvelope<T>;
  if (!response.ok) {
    const error = new Error(payload.error ?? payload.message ?? `Request failed with status ${response.status}`);
    Object.assign(error, { status: response.status, code: payload.code });
    throw error;
  }
  return payload;
}

function fallbackLegacyUser(role: WebUserRole): WebUser {
  return {
    id: 'legacy-api-key',
    username: 'legacy-api-key',
    displayName: 'Legacy API Key',
    role,
    status: 'active',
  };
}

const initialApiKey = readPersistedApiKey();

export const useAuthStore = create<AuthState>((set, get) => ({
  status: initialApiKey ? 'authenticated' : 'initial',
  user: initialApiKey ? fallbackLegacyUser('owner') : undefined,
  mustChangePassword: false,
  isAuthenticated: initialApiKey !== null,
  apiKey: initialApiKey,
  checking: false,
  checkAuth: async () => {
    if (inFlightCheck) return inFlightCheck;
    inFlightCheck = (async () => {
      set({ checking: true });
      try {
        const response = await authFetch<AuthMeResponse>('/v1/auth/me');
        const auth = response.data;
        if (auth.authenticated) {
          const user = auth.user ?? fallbackLegacyUser(auth.role);
          set({ status: 'authenticated', user, isAuthenticated: true, mustChangePassword: false, checking: false });
          return;
        }
        const authStatus = await authFetch<AuthStatusResponse>('/v1/auth/status', {}, null);
        if (authStatus.data.userCount === 0 || authStatus.data.requiresBootstrap) {
          set({ status: 'needs-bootstrap', user: undefined, isAuthenticated: false, checking: false });
          return;
        }
        set({ status: 'logged-out', user: undefined, isAuthenticated: false, checking: false });
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 401) {
          try {
            const authStatus = await authFetch<AuthStatusResponse>('/v1/auth/status', {}, null);
            const nextStatus: AuthStatus = authStatus.data.userCount === 0 || authStatus.data.requiresBootstrap ? 'needs-bootstrap' : 'logged-out';
            set({ status: nextStatus, user: undefined, isAuthenticated: false, checking: false });
            return;
          } catch {
            // Fall through to logged-out.
          }
        }
        set({ status: 'logged-out', user: undefined, isAuthenticated: false, checking: false });
      } finally {
        inFlightCheck = null;
      }
    })();
    return inFlightCheck;
  },
  login: async (username, password) => {
    try {
      const response = await authFetch<AuthSessionResponse>('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }, null);
      set({ status: 'authenticated', user: response.data.user, isAuthenticated: true, mustChangePassword: false });
      return { ok: true };
    } catch (error) {
      set({ status: 'logged-out', user: undefined, isAuthenticated: false });
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  logout: async () => {
    try {
      await authFetch('/v1/auth/logout', { method: 'POST' });
    } catch {
      // A missing/expired session still leaves the browser logged out locally.
    }
    set({ status: 'logged-out', user: undefined, isAuthenticated: false, mustChangePassword: false });
  },
  bootstrapOwner: async ({ username, displayName, password }) => {
    try {
      const response = await authFetch<AuthSessionResponse>('/v1/auth/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ username, displayName, password }),
      }, null);
      set({ status: 'authenticated', user: response.data.user, isAuthenticated: true, mustChangePassword: false });
      return { ok: true };
    } catch (error) {
      set({ status: 'needs-bootstrap', user: undefined, isAuthenticated: false });
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  setApiKey: (apiKey) => {
    const normalizedApiKey = apiKey.trim();
    const nextApiKey = normalizedApiKey.length > 0 ? normalizedApiKey : null;
    persistApiKey(nextApiKey);
    set({
      apiKey: nextApiKey,
      user: nextApiKey ? fallbackLegacyUser('owner') : get().user,
      status: nextApiKey ? 'authenticated' : get().status,
      isAuthenticated: nextApiKey !== null || get().status === 'authenticated',
    });
  },
  clearAuth: () => {
    persistApiKey(null);
    set({
      apiKey: null,
      status: 'logged-out',
      user: undefined,
      isAuthenticated: false,
      mustChangePassword: false,
      checking: false,
    });
  },
}));
