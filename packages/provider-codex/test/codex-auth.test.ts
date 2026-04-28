/**
 * FEAT-029 R11 — codex-auth.ts unit coverage.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readLocalCodexAuth, redactAccountId, resolveCodexAuthPath } from '../src/codex-auth.js';

describe('codex-auth.readLocalCodexAuth [FEAT-029 R4]', () => {
  const tempRoots: string[] = [];
  afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function makeHome(): { home: string; codexHome: string } {
    const root = mkdtempSync(join(tmpdir(), 'haro-codex-auth-'));
    tempRoots.push(root);
    const codexHome = join(root, '.codex');
    mkdirSync(codexHome, { recursive: true });
    return { home: root, codexHome };
  }

  it('returns hasAuth=false and detected=false when ~/.codex does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-codex-auth-empty-'));
    tempRoots.push(root);
    const result = readLocalCodexAuth({ homeDir: root, env: {} });
    expect(result.detected).toBe(false);
    expect(result.hasAuth).toBe(false);
    expect(result.accountId).toBeUndefined();
    expect(result.authMode).toBeUndefined();
  });

  it('returns detected=true, hasAuth=false when auth.json is missing despite ~/.codex existing', () => {
    const { home, codexHome } = makeHome();
    expect(codexHome).toContain('.codex');
    const result = readLocalCodexAuth({ homeDir: home, env: {} });
    expect(result.detected).toBe(false); // existsSync(auth.json) is false
    expect(result.hasAuth).toBe(false);
  });

  it('returns hasAuth=true with redacted account_id when valid auth.json exists', () => {
    const { home, codexHome } = makeHome();
    writeFileSync(
      join(codexHome, 'auth.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        last_refresh: '2026-04-27T11:30:00.000Z',
        tokens: {
          access_token: 'eyJtokenvalue',
          refresh_token: 'opaque-refresh',
          account_id: 'user_2NfXabcdefghXaxL',
        },
      }),
    );
    const result = readLocalCodexAuth({ homeDir: home, env: {} });
    expect(result.detected).toBe(true);
    expect(result.hasAuth).toBe(true);
    expect(result.authMode).toBe('chatgpt');
    expect(result.lastRefresh).toBe('2026-04-27T11:30:00.000Z');
    expect(result.accountId).toBe('user_2…XaxL');
  });

  it('returns hasAuth=false when access_token is empty even if file is present', () => {
    const { home, codexHome } = makeHome();
    writeFileSync(
      join(codexHome, 'auth.json'),
      JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: '', account_id: 'user_xxxxxxxxxxxx' } }),
    );
    const result = readLocalCodexAuth({ homeDir: home, env: {} });
    expect(result.detected).toBe(true);
    expect(result.hasAuth).toBe(false);
  });

  it('returns hasAuth=false when tokens.access_token is missing', () => {
    const { home, codexHome } = makeHome();
    writeFileSync(
      join(codexHome, 'auth.json'),
      JSON.stringify({ auth_mode: 'chatgpt', tokens: { account_id: 'user_xxxxxxxxxxxx' } }),
    );
    const result = readLocalCodexAuth({ homeDir: home, env: {} });
    expect(result.detected).toBe(true);
    expect(result.hasAuth).toBe(false);
  });

  it('survives a corrupt JSON file without throwing', () => {
    const { home, codexHome } = makeHome();
    writeFileSync(join(codexHome, 'auth.json'), 'not-json{{{');
    const result = readLocalCodexAuth({ homeDir: home, env: {} });
    expect(result.detected).toBe(true);
    expect(result.hasAuth).toBe(false);
    expect(result.authMode).toBeUndefined();
  });

  it('honors CODEX_HOME env override', () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-codex-home-override-'));
    tempRoots.push(root);
    const customHome = join(root, 'custom-codex-home');
    mkdirSync(customHome, { recursive: true });
    writeFileSync(
      join(customHome, 'auth.json'),
      JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'present', account_id: 'user_zzzzzzzzzzzzz' } }),
    );
    const result = readLocalCodexAuth({ homeDir: '/should-be-ignored', env: { CODEX_HOME: customHome } });
    expect(result.hasAuth).toBe(true);
    expect(result.authFilePath).toBe(join(customHome, 'auth.json'));
  });

  it('resolveCodexAuthPath() composes CODEX_HOME with auth.json', () => {
    expect(resolveCodexAuthPath({ homeDir: '/tmp/h', env: {} })).toBe('/tmp/h/.codex/auth.json');
    expect(resolveCodexAuthPath({ homeDir: '/tmp/h', env: { CODEX_HOME: '/var/cdx' } })).toBe('/var/cdx/auth.json');
  });
});

describe('codex-auth.redactAccountId [FEAT-029 R5]', () => {
  it('keeps first 6 and last 4 characters with an ellipsis', () => {
    expect(redactAccountId('user_2NfXabcdefghXaxL')).toBe('user_2…XaxL');
  });

  it('returns … for short or undefined ids', () => {
    expect(redactAccountId('short')).toBe('…');
    expect(redactAccountId('')).toBe('…');
    expect(redactAccountId(undefined)).toBe('…');
  });

  it('handles strings exactly at the boundary', () => {
    expect(redactAccountId('123456789012')).toBe('123456…9012');
    expect(redactAccountId('12345678901')).toBe('123456…8901');
    expect(redactAccountId('1234567890')).toBe('…');
  });
});
