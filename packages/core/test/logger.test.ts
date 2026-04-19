/** AC3 — pino logger writes JSON to stdout and appends the same line to the log file. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../src/logger/index.js';

describe('logger [FEAT-001]', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'haro-log-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC3 emits JSON to file when stdout disabled', () => {
    const logFile = join(root, 'logs', 'haro.log');
    const logger = createLogger({ root, stdout: false, file: logFile, rolling: false });
    logger.info({ marker: 'ac3' }, 'hi');
    expect(existsSync(logFile)).toBe(true);
    const text = readFileSync(logFile, 'utf8').trim();
    expect(text.length).toBeGreaterThan(0);
    const lines = text.split('\n').filter(Boolean);
    const parsed = JSON.parse(lines[lines.length - 1]!);
    expect(parsed.msg).toBe('hi');
    expect(parsed.marker).toBe('ac3');
    expect(typeof parsed.time).toBe('number');
  });

  it('AC3 emits the same JSON line to stdout and the log file', () => {
    const logFile = join(root, 'logs', 'haro.log');
    const logger = createLogger({ root, stdout: true, file: logFile, rolling: false });
    const originalWrite = process.stdout.write.bind(process.stdout);
    let captured = '';
    process.stdout.write = ((chunk: Buffer | string, ...rest: unknown[]) => {
      captured += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      return (originalWrite as unknown as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write;
    try {
      logger.info({ marker: 'ac3-dual' }, 'hi');
    } finally {
      process.stdout.write = originalWrite as typeof process.stdout.write;
    }
    const fileLines = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
    const fileLine = fileLines[fileLines.length - 1]!;
    const stdoutLine = captured
      .split('\n')
      .filter((l) => l.includes('"marker":"ac3-dual"'))
      .pop()!;
    expect(stdoutLine).toBe(fileLine);
    const parsed = JSON.parse(fileLine);
    expect(parsed.msg).toBe('hi');
    expect(parsed.marker).toBe('ac3-dual');
  });

  it('AC3 advertises both stdout + file streams in haroStreams', () => {
    const logFile = join(root, 'logs', 'haro.log');
    const logger = createLogger({ root, stdout: true, file: logFile, rolling: false });
    const streams = logger.haroStreams;
    expect(streams.map((s) => s.destination)).toEqual(['stdout', logFile]);
  });

  it('R4 redacts secret-like fields', () => {
    const logFile = join(root, 'logs', 'redact.log');
    const logger = createLogger({ root, stdout: false, file: logFile, rolling: false });
    logger.info(
      {
        providers: { codex: { apiKey: 'sk-live-should-not-appear' } },
        channels: { feishu: { appSecret: 'topsecret' } },
        headers: { authorization: 'Bearer xyz' },
        token: 'top-level-token-leak',
        nested: { inner: { password: 'hunter2' } },
      },
      'redaction check',
    );
    const text = readFileSync(logFile, 'utf8');
    expect(text).not.toContain('sk-live-should-not-appear');
    expect(text).not.toContain('topsecret');
    expect(text).not.toContain('Bearer xyz');
    expect(text).not.toContain('top-level-token-leak');
    expect(text).not.toContain('hunter2');
    expect(text).toContain('[REDACTED]');
  });

  it('R4 respects configured level', () => {
    const logFile = join(root, 'logs', 'level.log');
    const logger = createLogger({ root, stdout: false, file: logFile, level: 'warn', rolling: false });
    logger.info('should-not-appear');
    logger.warn('should-appear');
    const text = readFileSync(logFile, 'utf8');
    expect(text).not.toContain('should-not-appear');
    expect(text).toContain('should-appear');
  });
});
