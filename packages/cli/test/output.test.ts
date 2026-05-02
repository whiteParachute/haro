import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { HaroError } from '@haro/core';
import {
  renderError,
  renderHumanRecord,
  renderHumanTable,
  renderJson,
  renderListJson,
  resolveOutputMode,
} from '../src/output/index.js';

function captureStream(): { stream: NodeJS.WritableStream; read: () => string } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk) => chunks.push(Buffer.from(chunk as Buffer)));
  return { stream, read: () => Buffer.concat(chunks).toString('utf8') };
}

describe('output/render', () => {
  it('resolveOutputMode prefers explicit flags then falls back to TTY detection', () => {
    expect(resolveOutputMode({ json: true })).toBe('json');
    expect(resolveOutputMode({ human: true })).toBe('human');
    expect(resolveOutputMode({}, { isTTY: true } as unknown as NodeJS.WritableStream)).toBe('human');
    expect(resolveOutputMode({}, { isTTY: false } as unknown as NodeJS.WritableStream)).toBe('json');
  });

  it('renderJson emits an envelope per call', () => {
    const out = captureStream();
    renderJson({ foo: 'bar' }, { stdout: out.stream });
    expect(JSON.parse(out.read().trim())).toEqual({ ok: true, data: { foo: 'bar' } });
  });

  it('renderListJson emits NDJSON + summary', () => {
    const out = captureStream();
    renderListJson({ items: [{ id: 'a' }, { id: 'b' }], total: 2, limit: 20, offset: 0 }, { stdout: out.stream });
    const lines = out.read().trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toEqual({ ok: true, data: { id: 'a' } });
    expect(JSON.parse(lines[1]!)).toEqual({ ok: true, data: { id: 'b' } });
    expect(JSON.parse(lines[2]!)).toMatchObject({ ok: true, summary: { total: 2 } });
  });

  it('renderError preserves HaroError shape on json mode', () => {
    const err = new HaroError('SESSION_NOT_FOUND', 'Session abc missing', {
      remediation: 'Run haro session list',
    });
    const target = captureStream();
    const exit = renderError(err, { stderr: target.stream });
    expect(exit).toBe(1);
    const parsed = JSON.parse(target.read().trim());
    expect(parsed).toEqual({
      ok: false,
      error: {
        code: 'SESSION_NOT_FOUND',
        message: 'Session abc missing',
        remediation: 'Run haro session list',
      },
    });
  });

  it('renderError on human mode prints code + remediation', () => {
    const err = new HaroError('CONFLICT', 'Already there', { remediation: 'Try again' });
    const target = captureStream();
    renderError(err, { stderr: target.stream }, { mode: 'human' });
    expect(target.read()).toContain('error[CONFLICT]: Already there');
    expect(target.read()).toContain('→ Try again');
  });
});

describe('output/human', () => {
  it('renders a table with auto-sized columns', () => {
    const out = captureStream();
    renderHumanTable(
      [{ id: 'a', count: 1 }, { id: 'beta', count: 22 }],
      [
        { key: 'id', label: 'ID' },
        { key: 'count', label: 'Count' },
      ],
      { stdout: out.stream },
    );
    const text = out.read();
    expect(text).toContain('ID');
    expect(text).toContain('beta');
    expect(text).toContain('22');
  });

  it('shows (no rows) for empty input', () => {
    const out = captureStream();
    renderHumanTable([], [{ key: 'id', label: 'ID' }], { stdout: out.stream });
    expect(out.read().trim()).toBe('(no rows)');
  });

  it('renderHumanRecord writes key/value lines', () => {
    const out = captureStream();
    renderHumanRecord({ name: 'haro', tools: ['eat', 'shit'] }, { stdout: out.stream });
    const text = out.read();
    expect(text).toContain('name');
    expect(text).toContain('haro');
    expect(text).toContain('["eat","shit"]');
  });
});
