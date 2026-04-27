/**
 * FEAT-029 R6 — CodexProvider.resolveAuth() priority matrix.
 */
import { describe, it, expect } from 'vitest';
import { CodexProvider } from '../src/codex-provider.js';
import type { LocalCodexAuth } from '../src/codex-auth.js';

function makeAuth(overrides: Partial<LocalCodexAuth> = {}): LocalCodexAuth {
  return {
    detected: false,
    hasAuth: false,
    authMode: null,
    accountId: null,
    lastRefresh: null,
    authFilePath: '/tmp/.codex/auth.json',
    ...overrides,
  };
}

describe('CodexProvider.resolveAuth() [FEAT-029 R6]', () => {
  it('returns env-api-key when authMode=auto and OPENAI_API_KEY is set (precedence rule 1)', () => {
    const provider = new CodexProvider(
      { authMode: 'auto' },
      { readApiKey: () => 'sk-secret', readCodexAuth: () => makeAuth({ hasAuth: true, accountId: 'user_2…XaxL' }) },
    );
    const auth = provider.resolveAuth();
    expect(auth.kind).toBe('env-api-key');
    if (auth.kind === 'env-api-key') expect(auth.token).toBe('sk-secret');
  });

  it('returns env-api-key when authMode=env and OPENAI_API_KEY is set', () => {
    const provider = new CodexProvider(
      { authMode: 'env' },
      { readApiKey: () => 'sk-secret', readCodexAuth: () => makeAuth() },
    );
    expect(provider.resolveAuth().kind).toBe('env-api-key');
  });

  it('throws when authMode=env but OPENAI_API_KEY is missing', () => {
    const provider = new CodexProvider(
      { authMode: 'env' },
      { readApiKey: () => undefined, readCodexAuth: () => makeAuth({ hasAuth: true }) },
    );
    expect(() => provider.resolveAuth()).toThrow(/authMode=env but OPENAI_API_KEY/);
  });

  it('returns chatgpt when authMode=chatgpt and ~/.codex/auth.json has access_token', () => {
    const provider = new CodexProvider(
      { authMode: 'chatgpt' },
      {
        readApiKey: () => 'sk-should-be-ignored',
        readCodexAuth: () =>
          makeAuth({ hasAuth: true, accountId: 'user_2…XaxL', lastRefresh: '2026-04-27T11:30:00Z' }),
      },
    );
    const auth = provider.resolveAuth();
    expect(auth.kind).toBe('chatgpt');
    if (auth.kind === 'chatgpt') {
      expect(auth.accountId).toBe('user_2…XaxL');
      expect(auth.lastRefresh).toBe('2026-04-27T11:30:00Z');
    }
  });

  it('throws when authMode=chatgpt but ~/.codex/auth.json is empty', () => {
    const provider = new CodexProvider(
      { authMode: 'chatgpt' },
      { readApiKey: () => undefined, readCodexAuth: () => makeAuth({ authFilePath: '/x/.codex/auth.json' }) },
    );
    expect(() => provider.resolveAuth()).toThrow(/no ChatGPT login was found at \/x\/\.codex\/auth\.json/);
  });

  it('falls back to chatgpt under authMode=auto when no env key but auth.json present', () => {
    const provider = new CodexProvider(
      { authMode: 'auto' },
      { readApiKey: () => undefined, readCodexAuth: () => makeAuth({ hasAuth: true, accountId: 'user_2…AaaA' }) },
    );
    const auth = provider.resolveAuth();
    expect(auth.kind).toBe('chatgpt');
  });

  it('throws under authMode=auto when neither env key nor auth.json exists', () => {
    const provider = new CodexProvider(
      {},
      { readApiKey: () => undefined, readCodexAuth: () => makeAuth() },
    );
    expect(() => provider.resolveAuth()).toThrow(/no auth available/);
  });
});
