/** FEAT-003 R4 / R8 / AC6 — listModels TTL cache + no hardcoded model id. */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createModelLister } from '../src/list-models.js';
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createModelLister TTL cache [FEAT-003 R4]', () => {
  it('returns cached results inside the TTL window', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: 'gpt-5-codex', context_window: 128_000 },
          { id: 'gpt-5', max_context_tokens: 256_000 },
        ],
      }),
    );
    let now = 1_000_000;
    const lister = createModelLister(
      { ttlSeconds: 60 },
      { fetchFn: fetchFn as unknown as typeof fetch, now: () => now, readApiKey: () => 'sk' },
    );
    const first = await lister.listModels();
    const second = await lister.listModels();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({ id: 'gpt-5-codex', maxContextTokens: 128_000 });
    expect(first[1]).toMatchObject({ id: 'gpt-5', maxContextTokens: 256_000 });
    now += 30_000;
    await lister.listModels();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('AC6: refetches once the TTL window expires', async () => {
    let counter = 0;
    const fetchFn = vi.fn(async () =>
      jsonResponse({ data: [{ id: `dynamic-${++counter}` }] }),
    );
    let now = 0;
    const lister = createModelLister(
      { ttlSeconds: 1 },
      { fetchFn: fetchFn as unknown as typeof fetch, now: () => now, readApiKey: () => 'sk' },
    );
    const first = await lister.listModels();
    expect(first.map((m) => m.id)).toEqual(['dynamic-1']);
    now += 1_500;
    const second = await lister.listModels();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(second.map((m) => m.id)).toEqual(['dynamic-2']);
  });

  it('returns empty list when OPENAI_API_KEY is missing and no codex models cache (FEAT-029 soft-fail)', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const lister = createModelLister(
      {},
      {
        fetchFn,
        now: () => 0,
        readApiKey: () => undefined,
        readLocalModels: () => [],
      },
    );
    await expect(lister.listModels()).resolves.toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('falls back to ~/.codex/models_cache.json when OPENAI_API_KEY is missing (FEAT-029 chatgpt-mode)', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const lister = createModelLister(
      {},
      {
        fetchFn,
        now: () => 0,
        readApiKey: () => undefined,
        readLocalModels: () => [
          { slug: 'gpt-5.5', priority: 0 },
          { slug: 'gpt-5.4', priority: 2 },
        ],
      },
    );
    const result = await lister.listModels();
    expect(result.map((m) => m.id)).toEqual(['gpt-5.5', 'gpt-5.4']);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('surfaces non-2xx responses as errors', async () => {
    const fetchFn = vi.fn(async () =>
      new Response('forbidden', { status: 403, statusText: 'Forbidden' }),
    );
    const lister = createModelLister(
      {},
      { fetchFn: fetchFn as unknown as typeof fetch, now: () => 0, readApiKey: () => 'sk' },
    );
    await expect(lister.listModels()).rejects.toThrow(/HTTP 403/);
  });

  it('invalidate() forces a refetch', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ data: [{ id: 'a' }] }));
    const lister = createModelLister(
      { ttlSeconds: 600 },
      { fetchFn: fetchFn as unknown as typeof fetch, now: () => 1, readApiKey: () => 'sk' },
    );
    await lister.listModels();
    lister.invalidate();
    await lister.listModels();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('CodexProvider.listModels() routes through resolveAuth() [FEAT-029 follow-up]', () => {
  it('throws when authMode=env and OPENAI_API_KEY is missing (no soft-fall to local cache)', async () => {
    const provider = new CodexProvider(
      { authMode: 'env' },
      {
        readApiKey: () => undefined,
        readCodexAuth: () => makeAuth({ hasAuth: true }),
        modelListerDeps: {
          fetchFn: vi.fn() as unknown as typeof fetch,
          readLocalModels: () => [{ slug: 'gpt-5.5' }],
        },
      },
    );
    await expect(provider.listModels()).rejects.toThrow(/authMode=env but OPENAI_API_KEY/);
  });

  it('reads local cache under authMode=chatgpt without env key (no fetch attempted)', async () => {
    const fetchFn = vi.fn();
    const provider = new CodexProvider(
      { authMode: 'chatgpt' },
      {
        readApiKey: () => undefined,
        readCodexAuth: () => makeAuth({ hasAuth: true, authFilePath: '/x/.codex/auth.json' }),
        modelListerDeps: {
          fetchFn: fetchFn as unknown as typeof fetch,
          readLocalModels: () => [{ slug: 'gpt-5.5' }, { slug: 'gpt-5.4' }],
        },
      },
    );
    const result = await provider.listModels();
    expect(result.map((m) => m.id)).toEqual(['gpt-5.5', 'gpt-5.4']);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws under authMode=auto when neither env key nor local auth.json present', async () => {
    const provider = new CodexProvider(
      {},
      {
        readApiKey: () => undefined,
        readCodexAuth: () => makeAuth(),
        modelListerDeps: {
          fetchFn: vi.fn() as unknown as typeof fetch,
          readLocalModels: () => [{ slug: 'gpt-5.5' }],
        },
      },
    );
    await expect(provider.listModels()).rejects.toThrow(/no auth available/);
  });

  it('uses HTTP fetch with token when OPENAI_API_KEY is set (env path unchanged)', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'gpt-5-codex', context_window: 128_000 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const provider = new CodexProvider(
      {},
      {
        readApiKey: () => 'sk-secret',
        readCodexAuth: () => makeAuth(),
        modelListerDeps: {
          fetchFn: fetchFn as unknown as typeof fetch,
          readLocalModels: () => [{ slug: 'should-not-be-used' }],
        },
      },
    );
    const result = await provider.listModels();
    expect(result.map((m) => m.id)).toEqual(['gpt-5-codex']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('AC6: no hardcoded codex-N model ids in source', () => {
  function walk(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full, out);
      else if (entry.endsWith('.ts')) out.push(full);
    }
  }

  it('grep -rE "codex-[0-9][^ \'\\"]*" packages/provider-codex/src returns 0 hits', () => {
    const srcDir = resolve(__dirname, '..', 'src');
    const files: string[] = [];
    walk(srcDir, files);
    const re = /codex-[0-9][^ '"]*/g;
    const offenders: { file: string; matches: string[] }[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const matches = text.match(re);
      if (matches && matches.length > 0) {
        offenders.push({ file, matches });
      }
    }
    expect(offenders).toEqual([]);
  });
});
