import { create } from 'zustand';

interface AuthState {
  isAuthenticated: boolean;
  apiKey: string | null;
  setApiKey: (apiKey: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  apiKey: null,
  setApiKey: (apiKey) =>
    set({
      apiKey,
      isAuthenticated: apiKey.trim().length > 0,
    }),
  clearAuth: () =>
    set({
      apiKey: null,
      isAuthenticated: false,
    }),
}));
