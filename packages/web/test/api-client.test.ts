import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { get } from '../src/api/client';
import { AUTH_API_KEY_STORAGE_KEY, useAuthStore } from '../src/stores/auth';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  });
}

describe('API client auth header [FEAT-015/W2]', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: { ok: true } })),
    );
    useAuthStore.getState().clearAuth();
  });

  afterEach(() => {
    useAuthStore.getState().clearAuth();
    vi.unstubAllGlobals();
  });

  it('injects x-api-key from the auth store', async () => {
    useAuthStore.getState().setApiKey('secret');

    await get('/health');

    const fetchMock = vi.mocked(fetch);
    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.any(Object));
    expect(new Headers(init?.headers).get('x-api-key')).toBe('secret');
  });

  it('falls back to the documented localStorage key when store state is empty', async () => {
    storage.setItem(AUTH_API_KEY_STORAGE_KEY, 'persisted-secret');

    await get('/health');

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(init?.headers).get('x-api-key')).toBe('persisted-secret');
  });

  it('throws a diagnostic 401 message that points to the recoverable API key setting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' })),
    );

    await expect(get('/health')).rejects.toThrow(
      `Dashboard API key is missing or invalid. Set the key in the Dashboard auth card or localStorage key "${AUTH_API_KEY_STORAGE_KEY}"`,
    );
  });
});
