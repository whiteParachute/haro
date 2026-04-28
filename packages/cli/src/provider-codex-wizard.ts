/**
 * FEAT-029 — Interactive Codex provider wizard.
 *
 * Two paths:
 *   - "Sign in with ChatGPT" — spawns `codex login --device-auth` with stdio inheritance
 *     so the official codex CLI's OAuth device-code flow runs in the user's
 *     TTY (URL + code prompt printed by codex itself). On success we read
 *     ~/.codex/auth.json to confirm and return authMode='chatgpt'.
 *   - "Use OPENAI_API_KEY" — falls back to the existing flag-driven flow
 *     handled by the caller (we just signal the choice).
 *
 * No OAuth implementation here. No token storage. The codex binary owns
 * everything and refreshes the token itself.
 */

import { spawn, type SpawnOptions } from 'node:child_process';
import { readLocalCodexAuth, type LocalCodexAuth } from '@haro/provider-codex';
import type { ProviderCatalogEntry } from './provider-catalog.js';
import type { ProviderScope } from './provider-onboarding.js';

export type CodexWizardChoice = 'chatgpt' | 'env-api-key' | 'cancelled';

export interface CodexWizardResult {
  choice: CodexWizardChoice;
  /** Present when choice === 'chatgpt' and login confirmed. */
  auth?: LocalCodexAuth;
}

export interface CodexWizardDeps {
  /** Spawn codex login subprocess. Tests inject a fake. */
  spawnCodexLogin?: (binary: string, args: string[], options: SpawnOptions) => Promise<{ exitCode: number | null }>;
  /** Read ~/.codex/auth.json to verify login. Tests inject a fake. */
  readAuth?: () => LocalCodexAuth;
  /** Override the codex binary path. Defaults to `codex` (resolved via PATH). */
  codexBinary?: string;
  /** Inject the prompt picker (tests stub clack). */
  promptChoice?: (message: string) => Promise<'chatgpt' | 'env-api-key' | 'cancelled'>;
  /** Output sink for status messages (defaults to process.stdout). */
  write?: (chunk: string) => void;
  /** Environment override for login mode. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export type ProviderSetupWizardResult =
  | { authMode: 'chatgpt' | 'env'; accountId?: string }
  | { cancelled: true };

export interface ProviderSetupWizardInput {
  entry: ProviderCatalogEntry;
  scope: ProviderScope;
  deps?: CodexWizardDeps & {
    /** Persist non-sensitive provider config; tests inject this to assert YAML-safe writes. */
    writeConfig?: (input: {
      scope: ProviderScope;
      entry: ProviderCatalogEntry;
      patch: { authMode: 'chatgpt' };
    }) => void | Promise<void>;
    logger?: Pick<Console, 'log'>;
  };
}

const CHATGPT_LABEL = 'Sign in with ChatGPT (recommended for Plus / Pro / Team)';
const API_KEY_LABEL = 'Use OPENAI_API_KEY (developer / org accounts)';

/**
 * Run the interactive picker + ChatGPT spawn flow. Caller is responsible for
 * post-success config writes (so non-interactive --auth-mode=chatgpt can
 * share the same config-write logic).
 */
export async function runCodexAuthWizard(
  entry: ProviderCatalogEntry,
  deps: CodexWizardDeps = {},
): Promise<CodexWizardResult> {
  const promptFn = deps.promptChoice ?? defaultPromptChoice;
  const choice = await promptFn(`Choose authentication method for ${entry.displayName}`);
  if (choice === 'cancelled') return { choice: 'cancelled' };
  if (choice === 'env-api-key') return { choice: 'env-api-key' };

  const auth = await runChatGptLogin(deps);
  if (!auth) return { choice: 'cancelled' };
  return { choice: 'chatgpt', auth };
}

/**
 * Spec-facing setup wizard entrypoint (FEAT-029 §5.1). It owns the ChatGPT
 * branch end-to-end: choose auth method, spawn `codex login --device-auth` by default, verify
 * auth.json, then write only `providers.codex.authMode = chatgpt`.
 *
 * The OPENAI_API_KEY branch deliberately returns `{ authMode: 'env' }` and
 * leaves secret-ref handling to the existing provider onboarding flow.
 */
export async function runProviderSetupWizard(input: ProviderSetupWizardInput): Promise<ProviderSetupWizardResult> {
  const result = await runCodexAuthWizard(input.entry, input.deps);
  if (result.choice === 'cancelled') return { cancelled: true };
  if (result.choice === 'env-api-key') return { authMode: 'env' };

  await input.deps?.writeConfig?.({
    scope: input.scope,
    entry: input.entry,
    patch: { authMode: 'chatgpt' },
  });
  input.deps?.logger?.log?.(
    `✓ ChatGPT login detected (account: ${result.auth?.accountId ?? '…'}` +
      (result.auth?.lastRefresh ? `, refreshed ${result.auth.lastRefresh}` : '') +
      ')',
  );
  return {
    authMode: 'chatgpt',
    ...(result.auth?.accountId ? { accountId: result.auth.accountId } : {}),
  };
}

/**
 * Spawn the official codex CLI's `login` subcommand with full stdio
 * inheritance so the OAuth device-code prompt is printed and consumed in
 * the same TTY the user invoked us from. After exit we re-read the auth
 * file to confirm — protects against ctrl-C, network failure, etc.
 */
export async function runChatGptLogin(deps: CodexWizardDeps = {}): Promise<LocalCodexAuth | null> {
  const binary = deps.codexBinary ?? 'codex';
  const spawnFn = deps.spawnCodexLogin ?? defaultSpawnCodexLogin;
  const readAuth = deps.readAuth ?? readLocalCodexAuth;
  const write = deps.write ?? ((chunk: string) => process.stdout.write(chunk));
  const loginMode = (deps.env ?? process.env).HARO_CODEX_LOGIN_MODE;
  const loginArgs = loginMode === 'browser' ? ['login'] : ['login', '--device-auth'];
  const loginCommand = [binary, ...loginArgs].join(' ');

  if (loginMode === 'browser') {
    write(
      `\nLaunching \`${loginCommand}\` — complete the OAuth flow in this terminal (a local browser window will open), then return here.\n\n`,
    );
  } else {
    write(
      `\nLaunching \`${loginCommand}\` — open the URL printed below in any browser, enter the code, then return here.\n\n`,
    );
  }

  let exitCode: number | null;
  try {
    const result = await spawnFn(binary, loginArgs, {
      stdio: 'inherit',
    });
    exitCode = result.exitCode;
  } catch (error) {
    write(
      `\n[error] Failed to launch \`${loginCommand}\`: ${error instanceof Error ? error.message : String(error)}\n` +
        '  Install the codex CLI (https://github.com/openai/codex) and ensure `codex` is on PATH, or rerun with --auth-mode env to use OPENAI_API_KEY.\n',
    );
    return null;
  }

  if (exitCode !== 0) {
    write(`\n[error] \`${loginCommand}\` exited with code ${exitCode ?? 'unknown'}; ChatGPT login was not completed.\n`);
    return null;
  }

  const after = readAuth();
  if (!after.hasAuth) {
    write(
      `\n[error] \`${loginCommand}\` finished but no ChatGPT credentials were detected at ${after.authFilePath}. ` +
        `Re-run the wizard or rerun \`${loginCommand}\` directly to retry.\n`,
    );
    return null;
  }

  write(
    `\n✓ ChatGPT login detected (account: ${after.accountId ?? '…'}` +
      (after.lastRefresh ? `, refreshed ${after.lastRefresh}` : '') +
      `, auth file: ${after.authFilePath}).\n`,
  );
  return after;
}

/**
 * Default prompt — uses @clack/prompts via dynamic import (clack is ESM-only,
 * cli package builds as CJS). Returns 'cancelled' on ctrl-C.
 */
async function defaultPromptChoice(message: string): Promise<'chatgpt' | 'env-api-key' | 'cancelled'> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const clack = await loadClack();
  const result = await clack.select({
    message,
    options: [
      { value: 'chatgpt' as const, label: CHATGPT_LABEL, hint: 'Runs the codex login flow in this terminal' },
      { value: 'env-api-key' as const, label: API_KEY_LABEL, hint: 'Reads OPENAI_API_KEY from env / providers.env' },
    ],
  });
  if (typeof result === 'symbol' || clack.isCancel(result)) return 'cancelled';
  return result as 'chatgpt' | 'env-api-key';
}

interface ClackPromptsModule {
  select: (opts: {
    message: string;
    options: ReadonlyArray<{ value: string; label: string; hint?: string }>;
  }) => Promise<string | symbol>;
  isCancel: (value: unknown) => boolean;
}

let cachedClack: ClackPromptsModule | undefined;

async function loadClack(): Promise<ClackPromptsModule> {
  if (cachedClack) return cachedClack;
  const mod = (await import('@clack/prompts')) as unknown as ClackPromptsModule;
  cachedClack = mod;
  return mod;
}

function defaultSpawnCodexLogin(
  binary: string,
  args: string[],
  options: SpawnOptions,
): Promise<{ exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, options);
    child.once('error', (err) => reject(err));
    child.once('exit', (code) => resolve({ exitCode: code }));
  });
}

export function summarizeAuth(auth: LocalCodexAuth): string {
  if (!auth.hasAuth) return `no ChatGPT login (${auth.authFilePath})`;
  return [
    'ChatGPT subscription auth',
    auth.accountId ? `account=${auth.accountId}` : null,
    auth.authMode ? `mode=${auth.authMode}` : null,
    auth.lastRefresh ? `last_refresh=${auth.lastRefresh}` : null,
  ]
    .filter(Boolean)
    .join(', ');
}
