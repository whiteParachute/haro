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

/**
 * Resolve the codex auth file path using the same precedence rules as the
 * codex CLI: `$CODEX_HOME` if set, otherwise `~/.codex`.
 */
export function resolveCodexAuthPath(options: ReadLocalCodexAuthOptions = {}): string {
  const env = options.env;
  const envCodexHome = env?.CODEX_HOME;
  if (envCodexHome) return join(envCodexHome, 'auth.json');
  // FEAT-029 — when callers inject an explicit env (tests, sandboxed runtimes),
  // treat `env.HOME` as authoritative. Fall back to a non-existent path rather
  // than os.homedir() so developer-machine credentials never leak into tests.
  if (env !== undefined) {
    const explicitHome = options.homeDir ?? env.HOME ?? '/nonexistent';
    return join(explicitHome, '.codex', 'auth.json');
  }
  // Production / default path: real homedir.
  const fallbackCodexHome = process.env.CODEX_HOME ?? (options.homeDir ? join(options.homeDir, '.codex') : DEFAULT_CODEX_HOME);
  return join(fallbackCodexHome, 'auth.json');
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
