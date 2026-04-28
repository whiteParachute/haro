/**
 * FEAT-029 — Read-only adapter over the official Codex CLI's auth file.
 *
 * The file is owned by the `codex` binary (written by `codex login`); haro
 * never writes to it and never copies it elsewhere. We only read it to (a)
 * confirm a ChatGPT login exists, (b) surface a redacted account_id in
 * doctor / dashboard, and (c) decide whether to require OPENAI_API_KEY.
 *
 * Token / refresh_token / id_token must never be returned from public
 * helpers — that lives entirely inside the codex binary's process.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_CODEX_HOME = join(homedir(), '.codex');

export interface LocalCodexAuth {
  /** Whether the codex auth.json file exists. */
  detected: boolean;
  /** Whether tokens.access_token is present and non-empty. */
  hasAuth: boolean;
  /** OAuth grant type — 'chatgpt' for `codex login` ChatGPT. */
  authMode?: 'chatgpt' | null;
  /** Redacted form of account_id (FEAT-029 R5). */
  accountId?: string | null;
  /** Last refresh timestamp (ISO) if the file declares one. */
  lastRefresh?: string | null;
  /** Resolved file path used for the read. */
  authFilePath: string;
}

export interface ReadLocalCodexAuthOptions {
  /** Override `process.env` lookups (tests, sandboxed runtimes). */
  env?: Record<string, string | undefined>;
  /** Override `os.homedir()` for tests. */
  homeDir?: string;
}

function resolveCodexHomeFile(options: ReadLocalCodexAuthOptions, fileName: string): string {
  const env = options.env;
  const envCodexHome = env?.CODEX_HOME;
  if (envCodexHome) return join(envCodexHome, fileName);
  if (env !== undefined) {
    const explicitHome = options.homeDir ?? env.HOME ?? '/nonexistent';
    return join(explicitHome, '.codex', fileName);
  }
  const fallbackCodexHome = process.env.CODEX_HOME ?? (options.homeDir ? join(options.homeDir, '.codex') : DEFAULT_CODEX_HOME);
  return join(fallbackCodexHome, fileName);
}

/**
 * Resolve the codex auth file path using the same precedence rules as the
 * codex CLI: `$CODEX_HOME` if set, otherwise `~/.codex`.
 */
export function resolveCodexAuthPath(options: ReadLocalCodexAuthOptions = {}): string {
  return resolveCodexHomeFile(options, 'auth.json');
}

/**
 * Resolve `models_cache.json` — the codex CLI persists the live, login-scoped
 * model list here (including ChatGPT-subscription-only slugs that the OpenAI
 * `/v1/models` REST endpoint never returns). FEAT-003 R4 reads this when an
 * API key is unavailable so the dashboard dropdown reflects what the user
 * actually has access to.
 */
export function resolveCodexModelsCachePath(options: ReadLocalCodexAuthOptions = {}): string {
  return resolveCodexHomeFile(options, 'models_cache.json');
}

export interface LocalCodexModelEntry {
  slug: string;
  displayName?: string;
  description?: string;
  priority?: number;
  defaultReasoningLevel?: string;
  supportedReasoningLevels?: readonly string[];
}

/**
 * Read and shape the codex CLI models cache. IO failures, malformed JSON,
 * and entries with `visibility !== 'list'` collapse silently to `[]` so
 * callers can use this as a soft fallback alongside `listModels()`.
 */
export function readLocalCodexModels(options: ReadLocalCodexAuthOptions = {}): readonly LocalCodexModelEntry[] {
  const cachePath = resolveCodexModelsCachePath(options);
  if (!existsSync(cachePath)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(cachePath, 'utf-8'));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const root = parsed as Record<string, unknown>;
  const rawModels = Array.isArray(root.models) ? root.models : [];
  const out: LocalCodexModelEntry[] = [];
  for (const raw of rawModels) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const slug = typeof r.slug === 'string' && r.slug.length > 0 ? r.slug : null;
    if (!slug) continue;
    if (typeof r.visibility === 'string' && r.visibility !== 'list') continue;
    const entry: LocalCodexModelEntry = { slug };
    if (typeof r.display_name === 'string' && r.display_name.length > 0) entry.displayName = r.display_name;
    if (typeof r.description === 'string' && r.description.length > 0) entry.description = r.description;
    if (typeof r.priority === 'number') entry.priority = r.priority;
    if (typeof r.default_reasoning_level === 'string') entry.defaultReasoningLevel = r.default_reasoning_level;
    if (Array.isArray(r.supported_reasoning_levels)) {
      const efforts = r.supported_reasoning_levels
        .map((level) => (level && typeof level === 'object' && typeof (level as { effort?: unknown }).effort === 'string'
          ? (level as { effort: string }).effort
          : null))
        .filter((eff): eff is string => eff !== null);
      if (efforts.length > 0) entry.supportedReasoningLevels = efforts;
    }
    out.push(entry);
  }
  out.sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER));
  return out;
}

/**
 * Read and shape the codex CLI auth file. IO failures and malformed JSON
 * collapse to `{ hasAuth: false, ... }` — callers must not throw on a
 * missing/corrupt auth file.
 */
export function readLocalCodexAuth(options: ReadLocalCodexAuthOptions = {}): LocalCodexAuth {
  const authFilePath = resolveCodexAuthPath(options);
  const detected = existsSync(authFilePath);
  if (!detected) {
    return { detected: false, hasAuth: false, authFilePath };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(authFilePath, 'utf-8'));
  } catch {
    return { detected: true, hasAuth: false, authFilePath };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { detected: true, hasAuth: false, authFilePath };
  }
  const auth = parsed as Record<string, unknown>;
  const tokens = (auth.tokens && typeof auth.tokens === 'object' && !Array.isArray(auth.tokens))
    ? (auth.tokens as Record<string, unknown>)
    : null;
  const accessToken = tokens && typeof tokens.access_token === 'string' && tokens.access_token.length > 0
    ? tokens.access_token
    : null;
  const accountIdRaw =
    stringField(tokens, 'account_id') ??
    stringField(tokens, 'accountId') ??
    stringField(auth, 'account_id') ??
    stringField(auth, 'accountId');
  const lastRefresh =
    stringField(auth, 'last_refresh') ??
    stringField(auth, 'lastRefresh') ??
    stringField(tokens, 'last_refresh') ??
    stringField(tokens, 'lastRefresh');
  const hasAuth = accessToken !== null;
  return {
    detected: true,
    hasAuth,
    ...(hasAuth ? { authMode: 'chatgpt' as const } : {}),
    ...(accountIdRaw ? { accountId: redactAccountId(accountIdRaw) } : {}),
    ...(lastRefresh ? { lastRefresh } : {}),
    authFilePath,
  };
}

/**
 * Mask an account id keeping the first 6 and last 4 characters with an
 * ellipsis in between. Missing or shorter-than-11 ids collapse to `…`.
 * FEAT-029 R5 — never echo full account id.
 */
export function redactAccountId(value?: string): string {
  if (typeof value !== 'string' || value.length < 11) return '…';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
