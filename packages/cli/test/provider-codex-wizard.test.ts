/**
 * FEAT-029 R11 — provider-codex-wizard.ts unit coverage.
 */
import type { SpawnOptions } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { runCodexAuthWizard, runChatGptLogin } from '../src/provider-codex-wizard.js';
import { CODEX_PROVIDER_CATALOG_ENTRY } from '../src/provider-catalog.js';
import type { LocalCodexAuth } from '@haro/provider-codex';

function fakeAuth(overrides: Partial<LocalCodexAuth> = {}): LocalCodexAuth {
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

function captureStdout(): { write: (chunk: string) => void; output: () => string } {
  let buffer = '';
  return {
    write: (chunk: string) => {
      buffer += chunk;
    },
    output: () => buffer,
  };
}

describe('runCodexAuthWizard [FEAT-029 R2]', () => {
  it('returns chatgpt result when picker chooses chatgpt and login succeeds', async () => {
    const stdout = captureStdout();
    const result = await runCodexAuthWizard(CODEX_PROVIDER_CATALOG_ENTRY, {
      promptChoice: async () => 'chatgpt',
      spawnCodexLogin: async () => ({ exitCode: 0 }),
      readAuth: () => fakeAuth({ detected: true, hasAuth: true, accountId: 'user_2…AaaA', lastRefresh: '2026-04-27T11:30:00Z' }),
      write: stdout.write,
    });
    expect(result.choice).toBe('chatgpt');
    expect(result.auth?.hasAuth).toBe(true);
    expect(stdout.output()).toContain('ChatGPT login detected');
  });

  it('returns env-api-key when picker chooses env without spawning codex login', async () => {
    let spawnCalled = 0;
    const result = await runCodexAuthWizard(CODEX_PROVIDER_CATALOG_ENTRY, {
      promptChoice: async () => 'env-api-key',
      spawnCodexLogin: async () => {
        spawnCalled += 1;
        return { exitCode: 0 };
      },
      readAuth: () => fakeAuth(),
    });
    expect(result.choice).toBe('env-api-key');
    expect(spawnCalled).toBe(0);
  });

  it('returns cancelled when picker is cancelled', async () => {
    const result = await runCodexAuthWizard(CODEX_PROVIDER_CATALOG_ENTRY, {
      promptChoice: async () => 'cancelled',
      readAuth: () => fakeAuth(),
    });
    expect(result.choice).toBe('cancelled');
  });

  it('returns cancelled when codex login exits non-zero', async () => {
    const stdout = captureStdout();
    const result = await runCodexAuthWizard(CODEX_PROVIDER_CATALOG_ENTRY, {
      promptChoice: async () => 'chatgpt',
      spawnCodexLogin: async () => ({ exitCode: 1 }),
      readAuth: () => fakeAuth(),
      write: stdout.write,
    });
    expect(result.choice).toBe('cancelled');
    expect(stdout.output()).toContain('exited with code 1');
  });

  it('returns cancelled when spawn rejects with binary-not-found', async () => {
    const stdout = captureStdout();
    const result = await runCodexAuthWizard(CODEX_PROVIDER_CATALOG_ENTRY, {
      promptChoice: async () => 'chatgpt',
      spawnCodexLogin: async (_b: string, _a: string[], _o: SpawnOptions) => {
        throw new Error('ENOENT');
      },
      readAuth: () => fakeAuth(),
      write: stdout.write,
    });
    expect(result.choice).toBe('cancelled');
    expect(stdout.output()).toContain('Failed to launch');
    expect(stdout.output()).toContain('ENOENT');
  });

  it('returns cancelled when codex login exits 0 but auth file remains empty', async () => {
    const stdout = captureStdout();
    const result = await runCodexAuthWizard(CODEX_PROVIDER_CATALOG_ENTRY, {
      promptChoice: async () => 'chatgpt',
      spawnCodexLogin: async () => ({ exitCode: 0 }),
      readAuth: () => fakeAuth({ authFilePath: '/x/.codex/auth.json' }),
      write: stdout.write,
    });
    expect(result.choice).toBe('cancelled');
    expect(stdout.output()).toContain('no ChatGPT credentials were detected at /x/.codex/auth.json');
  });

  it('does not echo full account_id', async () => {
    const stdout = captureStdout();
    await runChatGptLogin({
      promptChoice: async () => 'chatgpt',
      spawnCodexLogin: async () => ({ exitCode: 0 }),
      readAuth: () =>
        fakeAuth({ detected: true, hasAuth: true, accountId: 'user_2…AaaA', authFilePath: '/p/.codex/auth.json' }),
      write: stdout.write,
    });
    const out = stdout.output();
    expect(out).toContain('user_2…AaaA');
    // Make sure raw access tokens are never written; the helper only ever sees the LocalCodexAuth shape.
    expect(out).not.toContain('access_token');
  });
});
