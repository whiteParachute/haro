import { create } from 'zustand';

export const AUTH_API_KEY_STORAGE_KEY = 'haro:web-api-key';

interface AuthState {
  isAuthenticated: boolean;
  apiKey: string | null;
  setApiKey: (apiKey: string) => void;
  clearAuth: () => void;
}

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

const initialApiKey = readPersistedApiKey();

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: initialApiKey !== null,
  apiKey: initialApiKey,
  setApiKey: (apiKey) => {
    const normalizedApiKey = apiKey.trim();
    const nextApiKey = normalizedApiKey.length > 0 ? normalizedApiKey : null;
    persistApiKey(nextApiKey);
    set({
      apiKey: nextApiKey,
      isAuthenticated: nextApiKey !== null,
    });
  },
  clearAuth: () => {
    persistApiKey(null);
    set({
      apiKey: null,
      isAuthenticated: false,
    });
  },
}));
