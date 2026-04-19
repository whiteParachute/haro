/** AC1/AC2/AC5 — CLI placeholder exits cleanly and triggers directory bootstrap. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { runCli } from '../src/index.js';
import { REQUIRED_HARO_SUBDIRS, config as haroConfig } from '@haro/core';

describe('runCli [FEAT-001]', () => {
  let root: string;

  beforeEach(() => {
    root = join(mkdtempSync(join(tmpdir(), 'haro-cli-')), 'home');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC1 --version exits 0 without touching filesystem', () => {
    const res = runCli({ argv: ['--version'], root });
    expect(res.exitCode).toBe(0);
    expect(res.action).toBe('version');
    expect(existsSync(root)).toBe(false);
  });

  it('AC5 first bootstrap creates all required subdirectories', () => {
    const res = runCli({ argv: [], root });
    expect(res.exitCode).toBe(0);
    expect(res.action).toBe('bootstrap');
    for (const sub of REQUIRED_HARO_SUBDIRS) {
      expect(existsSync(join(root, sub))).toBe(true);
    }
  });

  it('AC2 malformed global config causes non-zero exit with Zod path in stderr', () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'config.yaml'),
      'providers:\n  claude:\n    defaultModel: 123\n',
    );
    const stderr = new PassThrough();
    const chunks: string[] = [];
    stderr.on('data', (c) => chunks.push(String(c)));
    const res = runCli({ argv: [], root, stderr });
    expect(res.exitCode).toBe(1);
    expect(res.action).toBe('config-error');
    expect(res.error).toBeInstanceOf(haroConfig.HaroConfigValidationError);
    const output = chunks.join('');
    expect(output).toContain('providers.claude.defaultModel');
    expect(output).toMatch(/Expected string, received number/i);
  });

  it('FEAT-002 AC3: apiKey in providers.claude causes startup exit referencing FEAT-002', () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'config.yaml'),
      'providers:\n  claude:\n    apiKey: "sk-xxx"\n',
    );
    const stderr = new PassThrough();
    const chunks: string[] = [];
    stderr.on('data', (c) => chunks.push(String(c)));
    const res = runCli({ argv: [], root, stderr });
    expect(res.exitCode).toBe(1);
    expect(res.action).toBe('config-error');
    const output = chunks.join('');
    expect(output).toContain('providers.claude.apiKey');
    expect(output).toContain('FEAT-002');
    expect(output).toContain('不应配置 apiKey');
  });
});
