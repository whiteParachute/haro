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
  it('AC2 rejects providers.claude.defaultModel when not a string and reports the exact path', () => {
    // Note: apiKey is now specifically forbidden by FEAT-002, so we use
    // defaultModel (which still accepts a string) to cover the generic
    // Zod-type-path reporting expectation of FEAT-001 AC2.
    const bad = { providers: { claude: { defaultModel: 123 } } };
    try {
      parseHaroConfig('test', bad);
      throw new Error('expected validation failure');
    } catch (err) {
      expect(err).toBeInstanceOf(HaroConfigValidationError);
      const issues = (err as HaroConfigValidationError).issues;
      expect(issues).toHaveLength(1);
      expect(issues[0]?.path).toBe('providers.claude.defaultModel');
      expect(issues[0]?.message).toMatch(/Expected string, received number/i);
      const msg = (err as Error).message;
      expect(msg).toContain('providers.claude.defaultModel');
      expect(msg).toMatch(/Expected string, received number/i);
    }
  });

  it('AC2 accepts a well-formed config with defaults', () => {
    const cfg = parseHaroConfig('test', {
      providers: { claude: { defaultModel: 'claude-sonnet-4-5' } },
      logging: { level: 'info', stdout: true },
      defaultAgent: 'haro-assistant',
    });
    expect(cfg.providers?.claude?.defaultModel).toBe('claude-sonnet-4-5');
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
      'logging:\n  level: info\nproviders:\n  claude:\n    defaultModel: claude-sonnet-4-5\n',
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
    expect(config.providers?.claude?.defaultModel).toBe('claude-sonnet-4-5');
    expect(sources).toContain(join(globalRoot, 'config.yaml'));
    expect(sources).toContain(join(projectRoot, '.haro', 'config.yaml'));
  });

  it('AC2 end-to-end: loader surfaces Zod errors on malformed global config', () => {
    writeFileSync(
      join(globalRoot, 'config.yaml'),
      'providers:\n  claude:\n    defaultModel: 123\n',
    );
    expect(() => loadHaroConfig({ globalRoot })).toThrowError(HaroConfigValidationError);
  });

  it('R3 built-in defaults apply when no config files exist', () => {
    const { config } = loadHaroConfig({ globalRoot });
    expect(config.logging?.level).toBe('info');
    expect(config.channels?.cli?.enabled).toBe(true);
  });
});
