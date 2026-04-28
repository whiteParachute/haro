/** AC2 — Zod schema rejects invalid types and reports dot-path of failure. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HaroConfigValidationError,
  parseHaroConfig,
} from '../src/config/schema.js';
import { loadHaroConfig } from '../src/config/loader.js';

describe('config schema [FEAT-001]', () => {
  it('AC2 rejects providers.codex.defaultModel when not a string and reports the exact path', () => {
    // Note: apiKey is specifically forbidden for provider credentials, so we use
    // defaultModel (which still accepts a string) to cover the generic
    // Zod-type-path reporting expectation of FEAT-001 AC2.
    const bad = { providers: { codex: { defaultModel: 123 } } };
    try {
      parseHaroConfig('test', bad);
      throw new Error('expected validation failure');
    } catch (err) {
      expect(err).toBeInstanceOf(HaroConfigValidationError);
      const issues = (err as HaroConfigValidationError).issues;
      expect(issues).toHaveLength(1);
      expect(issues[0]?.path).toBe('providers.codex.defaultModel');
      expect(issues[0]?.message).toMatch(/Expected string, received number/i);
      const msg = (err as Error).message;
      expect(msg).toContain('providers.codex.defaultModel');
      expect(msg).toMatch(/Expected string, received number/i);
    }
  });

  it('AC2 accepts a well-formed config with defaults', () => {
    const cfg = parseHaroConfig('test', {
      providers: { codex: { defaultModel: 'gpt-5-codex' } },
      logging: { level: 'info', stdout: true },
      defaultAgent: 'haro-assistant',
    });
    expect(cfg.providers?.codex?.defaultModel).toBe('gpt-5-codex');
    expect(cfg.logging?.level).toBe('info');
    expect(cfg.defaultAgent).toBe('haro-assistant');
  });

  it('AC2 reports enum mismatches (logging.level)', () => {
    const bad = { logging: { level: 'verbose' } };
    try {
      parseHaroConfig('test', bad);
      throw new Error('expected validation failure');
    } catch (err) {
      const issues = (err as HaroConfigValidationError).issues;
      expect(issues[0]?.path).toBe('logging.level');
    }
  });

  it('FEAT-029 accepts only env|chatgpt|auto for providers.codex.authMode', () => {
    expect(parseHaroConfig('test', { providers: { codex: { authMode: 'env' } } }).providers?.codex?.authMode).toBe('env');
    expect(parseHaroConfig('test', { providers: { codex: { authMode: 'chatgpt' } } }).providers?.codex?.authMode).toBe('chatgpt');
    expect(parseHaroConfig('test', { providers: { codex: { authMode: 'auto' } } }).providers?.codex?.authMode).toBe('auto');
    expect(() => parseHaroConfig('test', { providers: { codex: { authMode: 'oauth' } } })).toThrow(HaroConfigValidationError);
  });

  it.each(['access_token', 'refresh_token', 'id_token'])('FEAT-029 rejects providers.codex.tokens.%s', (tokenField) => {
    expect(() =>
      parseHaroConfig('test', {
        providers: {
          codex: {
            authMode: 'chatgpt',
            tokens: { [tokenField]: 'secret-token-value' },
          },
        },
      }),
    ).toThrow(HaroConfigValidationError);
  });
});

describe('config loader [FEAT-001]', () => {
  let globalRoot: string;
  let projectRoot: string;

  beforeEach(() => {
    globalRoot = mkdtempSync(join(tmpdir(), 'haro-cfg-'));
    projectRoot = mkdtempSync(join(tmpdir(), 'haro-proj-'));
  });

  afterEach(() => {
    rmSync(globalRoot, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('R3 project-level config overrides global (deep merge)', () => {
    writeFileSync(
      join(globalRoot, 'config.yaml'),
      'logging:\n  level: info\nproviders:\n  codex:\n    defaultModel: gpt-5-codex\n',
    );
    mkdirSync(join(projectRoot, '.haro'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.haro', 'config.yaml'),
      'logging:\n  level: debug\n',
    );
    const { config, sources } = loadHaroConfig({
      globalRoot,
      projectRoot,
    });
    expect(config.logging?.level).toBe('debug');
    expect(config.providers?.codex?.defaultModel).toBe('gpt-5-codex');
    expect(sources).toContain(join(globalRoot, 'config.yaml'));
    expect(sources).toContain(join(projectRoot, '.haro', 'config.yaml'));
  });

  it('AC2 end-to-end: loader surfaces Zod errors on malformed global config', () => {
    writeFileSync(
      join(globalRoot, 'config.yaml'),
      'providers:\n  codex:\n    defaultModel: 123\n',
    );
    expect(() => loadHaroConfig({ globalRoot })).toThrowError(HaroConfigValidationError);
  });

  it('R3 built-in defaults apply when no config files exist', () => {
    const { config } = loadHaroConfig({ globalRoot });
    expect(config.logging?.level).toBe('info');
    expect(config.channels?.cli?.enabled).toBe(true);
  });
});
