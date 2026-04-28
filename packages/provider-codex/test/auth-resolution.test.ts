/**
 * FEAT-029 R6 — CodexProvider.resolveAuth() priority matrix.
 */
import { describe, it, expect } from 'vitest';
import { CodexProvider } from '../src/codex-provider.js';
import type { LocalCodexAuth } from '../src/codex-auth.js';
import type { SdkCodexOptions } from '../src/sdk-types.js';

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
  const authModes = [
    { label: 'env', value: 'env' as const },
    { label: 'chatgpt', value: 'chatgpt' as const },
    { label: 'auto', value: 'auto' as const },
    { label: 'undefined', value: undefined },
  ];

  for (const mode of authModes) {
    it(`returns env-api-key when authMode=${mode.label} and OPENAI_API_KEY is set (env always wins)`, () => {
      const provider = new CodexProvider(
        mode.value ? { authMode: mode.value } : {},
        { readApiKey: () => 'sk-secret', readCodexAuth: () => makeAuth({ hasAuth: true, accountId: 'user_2…XaxL' }) },
      );
      const auth = provider.resolveAuth();
      expect(auth.kind).toBe('env-api-key');
      if (auth.kind === 'env-api-key') expect(auth.token).toBe('sk-secret');
    });
  }

  it('throws when authMode=env but OPENAI_API_KEY is missing', () => {
    const provider = new CodexProvider(
      { authMode: 'env' },
      { readApiKey: () => undefined, readCodexAuth: () => makeAuth({ hasAuth: true }) },
    );
    expect(() => provider.resolveAuth()).toThrow(/authMode=env but OPENAI_API_KEY/);
  });

  it('returns chatgpt when authMode=chatgpt even without OPENAI_API_KEY', () => {
    const provider = new CodexProvider(
      { authMode: 'chatgpt' },
      {
        readApiKey: () => undefined,
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

  it('authMode=chatgpt does not throw missing key while auth.json is empty (SDK/codex binary owns the final auth check)', () => {
    const provider = new CodexProvider(
      { authMode: 'chatgpt' },
      { readApiKey: () => undefined, readCodexAuth: () => makeAuth({ authFilePath: '/x/.codex/auth.json' }) },
    );
    expect(provider.resolveAuth()).toEqual({ kind: 'chatgpt', authFilePath: '/x/.codex/auth.json' });
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

  it('throws under undefined authMode when neither env key nor auth.json exists', () => {
    const provider = new CodexProvider(
      {},
      { readApiKey: () => undefined, readCodexAuth: () => makeAuth() },
    );
    expect(() => provider.resolveAuth()).toThrow(/no auth available/);
  });

  it('chatgpt SDK construction passes neither apiKey nor baseUrl', async () => {
    let captured: SdkCodexOptions | undefined;
    const provider = new CodexProvider(
      { authMode: 'chatgpt', baseUrl: 'https://api.example.test/v1' },
      {
        readApiKey: () => undefined,
        readCodexAuth: () => makeAuth({ authFilePath: '/x/.codex/auth.json' }),
        codexFactory: (options) => {
          captured = options;
          return {
            startThread: () => ({
              runStreamed: async () => ({
                events: (async function* () {})(),
              }),
            }),
            resumeThread: () => {
              throw new Error('not used');
            },
          };
        },
      },
    );

    for await (const _event of provider.query({ prompt: 'hello' })) {
      // Drain query to force lazy SDK construction.
    }
    expect(captured).toEqual({});
  });

  it('env-api-key SDK construction keeps apiKey injection and baseUrl override', async () => {
    let captured: SdkCodexOptions | undefined;
    const provider = new CodexProvider(
      { authMode: 'env', baseUrl: 'https://api.example.test/v1' },
      {
        readApiKey: () => 'sk-secret',
        readCodexAuth: () => makeAuth({ hasAuth: true }),
        codexFactory: (options) => {
          captured = options;
          return {
            startThread: () => ({
              runStreamed: async () => ({
                events: (async function* () {})(),
              }),
            }),
            resumeThread: () => {
              throw new Error('not used');
            },
          };
        },
      },
    );

    for await (const _event of provider.query({ prompt: 'hello' })) {
      // Drain query to force lazy SDK construction.
    }
    expect(captured).toEqual({ apiKey: 'sk-secret', baseUrl: 'https://api.example.test/v1' });
  });
});
