/**
 * FEAT-003 R4 / R8 — model list resolution.
 *
 * Source of truth for "what models are available right now" is the Codex /
 * OpenAI `/models` REST endpoint. The `@openai/codex-sdk` package is a CLI
 * wrapper and does not expose a typed models call, so we issue a plain
 * `fetch` against `${baseUrl}/models`. Results are cached per `(baseUrl,
 * apiKey)` tuple with a configurable TTL (default 10 min) so that we can
 * answer `capabilities()` synchronously most of the time without hammering
 * the upstream API.
 *
 * Why we never hardcode a fallback model id (AC6): the spec deliberately
 * forbids hardcoded model literals in this package; if `listModels()` fails
 * to populate, callers get an empty list / `undefined` context window
 * rather than a stale guess.
 */

export interface CodexModelInfo {
  /** Model id as returned by upstream. */
  id: string;
  /** When the model was created at upstream. Optional — passthrough. */
  created?: number;
  /** Owner / organization. Optional — passthrough. */
  owned_by?: string;
  /**
   * Context window in tokens. Codex's `/models` endpoint does not always
   * expose this directly; when omitted callers MUST treat
   * `capabilities().maxContextTokens` as `undefined` rather than guessing.
   */
  maxContextTokens?: number;
}

export interface ListModelsDeps {
  /** Replaces global `fetch` for tests. */
  fetchFn?: typeof fetch;
  /** Replaces `Date.now()` for cache-expiry tests. */
  now?: () => number;
  /** Reads `process.env.OPENAI_API_KEY`; tests inject a stub. */
  readApiKey?: () => string | undefined;
}

export interface ListModelsOptions {
  baseUrl?: string;
  ttlSeconds?: number;
}

interface CacheEntry {
  fetchedAt: number;
  models: readonly CodexModelInfo[];
}

const DEFAULT_TTL_SECONDS = 600;
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export interface ModelLister {
  listModels(): Promise<readonly CodexModelInfo[]>;
  /** Wipes the cache; mainly for tests. */
  invalidate(): void;
  /** Exposed for tests: returns the cache state without triggering a fetch. */
  inspectCache(): CacheEntry | null;
}

export function createModelLister(
  options: ListModelsOptions = {},
  deps: ListModelsDeps = {},
): ModelLister {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => Date.now());
  const readApiKey =
    deps.readApiKey ?? (() => process.env.OPENAI_API_KEY);
  const ttlMs = (options.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  let cache: CacheEntry | null = null;
  let inflight: Promise<readonly CodexModelInfo[]> | null = null;

  async function fetchOnce(): Promise<readonly CodexModelInfo[]> {
    const apiKey = readApiKey();
    if (!apiKey) {
      throw new Error(
        'Codex Provider: OPENAI_API_KEY is not set (FEAT-003 R5). Set the env var before listing models.',
      );
    }
    if (typeof fetchFn !== 'function') {
      throw new Error(
        'Codex Provider: no global fetch available; pass `fetchFn` in deps (Node ≥18 ships fetch by default).',
      );
    }
    const res = await fetchFn(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(
        `Codex Provider: GET ${baseUrl}/models -> HTTP ${res.status} ${res.statusText}`,
      );
    }
    const body = (await res.json()) as { data?: unknown };
    const data = Array.isArray(body?.data) ? body.data : [];
    const models: CodexModelInfo[] = [];
    for (const raw of data) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const id = typeof r.id === 'string' ? r.id : null;
      if (!id) continue;
      const info: CodexModelInfo = { id };
      if (typeof r.created === 'number') info.created = r.created;
      if (typeof r.owned_by === 'string') info.owned_by = r.owned_by;
      // Some Codex/OpenAI deployments return a `context_window` or
      // `max_context_tokens` field — pick whichever shows up; never invent.
      const ctx =
        typeof r.context_window === 'number'
          ? r.context_window
          : typeof r.max_context_tokens === 'number'
            ? r.max_context_tokens
            : undefined;
      if (ctx !== undefined) info.maxContextTokens = ctx;
      models.push(info);
    }
    return models;
  }

  return {
    async listModels(): Promise<readonly CodexModelInfo[]> {
      if (cache && now() - cache.fetchedAt < ttlMs) {
        return cache.models;
      }
      if (inflight) return inflight;
      inflight = fetchOnce()
        .then((models) => {
          cache = { fetchedAt: now(), models };
          return models;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    invalidate(): void {
      cache = null;
    },
    inspectCache(): CacheEntry | null {
      return cache;
    },
  };
}
