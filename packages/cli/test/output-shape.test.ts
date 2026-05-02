/**
 * FEAT-039 AC12 — `--json` output type-shape gate.
 *
 * Each list/record CLI command must emit envelopes that match
 * `@haro/core/types/cli-output`. A shape regression here is the smoking
 * gun for an envelope drift between CLI and web-api consumers.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentRegistry,
  ProviderRegistry,
  db as haroDb,
  services,
} from '@haro/core';
import type { AgentEvent, AgentProvider, AgentQueryParams } from '@haro/core/provider';
import { runCli } from '../src/index.js';

class StubProvider implements AgentProvider {
  readonly id = 'codex';
  capabilities() {
    return { streaming: false, toolLoop: false, contextCompaction: false, contextContinuation: true } as const;
  }
  async healthCheck(): Promise<boolean> { return true; }
  async listModels(): Promise<readonly { id: string }[]> { return [{ id: 'codex-primary' }]; }
  async *query(_params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
    yield { type: 'result', content: 'OK', responseId: 'resp-1' };
  }
}

function createAgentRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register({ id: 'haro-assistant', name: 'Haro Assistant', systemPrompt: 'helpful' });
  return registry;
}

function createProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new StubProvider());
  return registry;
}

interface CapStream { stream: NodeJS.WritableStream; read: () => string }
function captureStream(): CapStream {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk) => chunks.push(String(chunk)));
  return { stream, read: () => chunks.join('') };
}

interface RunResult { exitCode: number; stdoutLines: string[]; stderrLines: string[] }
async function runJson(root: string, argv: string[]): Promise<RunResult> {
  const stdout = captureStream();
  const stderr = captureStream();
  const result = await runCli({
    argv,
    root,
    stdout: stdout.stream,
    stderr: stderr.stream,
    createProviderRegistry: async () => createProviderRegistry(),
    loadAgentRegistry: async () => createAgentRegistry(),
    createAdditionalChannels: async () => [],
  });
  return {
    exitCode: result.exitCode,
    stdoutLines: stdout.read().split('\n').filter(Boolean),
    stderrLines: stderr.read().split('\n').filter(Boolean),
  };
}

interface RecordEnvelope { ok: true; data: unknown }
interface ListSummary { ok: true; summary: { total: number; limit?: number; offset?: number } }
interface ErrorEnvelope { ok: false; error: { code: string; message: string; remediation?: string } }

function isRecord(parsed: unknown): parsed is RecordEnvelope {
  return typeof parsed === 'object' && parsed !== null
    && (parsed as { ok?: unknown }).ok === true
    && 'data' in (parsed as Record<string, unknown>);
}
function isListSummary(parsed: unknown): parsed is ListSummary {
  return typeof parsed === 'object' && parsed !== null
    && (parsed as { ok?: unknown }).ok === true
    && 'summary' in (parsed as Record<string, unknown>);
}
function isError(parsed: unknown): parsed is ErrorEnvelope {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const candidate = parsed as { ok?: unknown; error?: { code?: unknown; message?: unknown } };
  return candidate.ok === false
    && typeof candidate.error === 'object' && candidate.error !== null
    && typeof candidate.error.code === 'string'
    && typeof candidate.error.message === 'string';
}

function seedSession(root: string, id: string): void {
  const opened = haroDb.initHaroDatabase({ root, keepOpen: true }) as {
    database: { prepare(sql: string): { run(...args: unknown[]): unknown }; close(): void };
  };
  try {
    opened.database
      .prepare(
        `INSERT INTO sessions (id, agent_id, provider, model, started_at, status, context_ref) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(id, 'haro-assistant', 'codex', 'codex-primary', '2026-05-02T00:00:00Z', 'completed');
    opened.database
      .prepare(`INSERT INTO session_events (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)`)
      .run(id, 'agent.result', JSON.stringify({ ok: true }), '2026-05-02T00:01:00Z');
  } finally {
    opened.database.close();
  }
}

describe('FEAT-039 AC12 — --json envelope shape gate', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it('session list --json: every line is a record envelope, last line is a list summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-shape-sess-'));
    roots.push(root);
    seedSession(root, 'sess-shape-a');
    seedSession(root, 'sess-shape-b');

    const out = await runJson(root, ['session', 'list', '--json']);
    expect(out.exitCode).toBe(0);
    expect(out.stdoutLines.length).toBeGreaterThanOrEqual(3);

    for (const line of out.stdoutLines.slice(0, -1)) {
      const parsed = JSON.parse(line);
      expect(isRecord(parsed)).toBe(true);
    }
    const summary = JSON.parse(out.stdoutLines.at(-1)!);
    expect(isListSummary(summary)).toBe(true);
    expect((summary as ListSummary).summary.total).toBeGreaterThanOrEqual(2);
  });

  it('session show <id> --json: single record envelope', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-shape-show-'));
    roots.push(root);
    seedSession(root, 'sess-shape-show');

    const out = await runJson(root, ['session', 'show', 'sess-shape-show', '--json']);
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdoutLines.at(-1)!);
    expect(isRecord(parsed)).toBe(true);
  });

  it('session show <missing> --json: stderr error envelope', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-shape-missing-'));
    roots.push(root);
    seedSession(root, 'sess-real');

    const out = await runJson(root, ['session', 'show', 'sess-missing', '--json']);
    expect(out.exitCode).not.toBe(0);
    const parsed = JSON.parse(out.stderrLines.at(-1)!);
    expect(isError(parsed)).toBe(true);
    expect((parsed as ErrorEnvelope).error.code).toBe('SESSION_NOT_FOUND');
  });

  it('agent list --json: every record envelope', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-shape-agent-'));
    roots.push(root);
    const out = await runJson(root, ['agent', 'list', '--json']);
    expect(out.exitCode).toBe(0);
    expect(out.stdoutLines.length).toBeGreaterThan(0);
    for (const line of out.stdoutLines) {
      const parsed = JSON.parse(line);
      expect(isRecord(parsed)).toBe(true);
    }
  });

  it('agent show <id> --json: single record envelope', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-shape-agent-show-'));
    roots.push(root);
    const out = await runJson(root, ['agent', 'show', 'haro-assistant', '--json']);
    expect(out.exitCode).toBe(0);
    expect(isRecord(JSON.parse(out.stdoutLines.at(-1)!))).toBe(true);
  });

  it('memory query --json: NDJSON records + summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-shape-mem-'));
    roots.push(root);
    await services.memory.writeMemoryEntry(
      { root, dbFile: join(root, 'haro.db') },
      { scope: 'shared', layer: 'persistent', topic: 'shape topic', content: 'shape body', sourceRef: 'test' },
      { currentAgentId: 'haro-assistant' },
    );

    const out = await runJson(root, ['memory', 'query', 'shape', '--json']);
    expect(out.exitCode).toBe(0);
    expect(out.stdoutLines.length).toBeGreaterThanOrEqual(2);
    for (const line of out.stdoutLines.slice(0, -1)) {
      expect(isRecord(JSON.parse(line))).toBe(true);
    }
    expect(isListSummary(JSON.parse(out.stdoutLines.at(-1)!))).toBe(true);
  });

  it('logs show --json: NDJSON records + summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-shape-logs-'));
    roots.push(root);
    seedSession(root, 'sess-shape-logs');

    const out = await runJson(root, ['logs', 'show', '--session', 'sess-shape-logs', '--json']);
    expect(out.exitCode).toBe(0);
    expect(out.stdoutLines.length).toBeGreaterThanOrEqual(1);
    for (const line of out.stdoutLines.slice(0, -1)) {
      expect(isRecord(JSON.parse(line))).toBe(true);
    }
    const last = JSON.parse(out.stdoutLines.at(-1)!);
    expect(isListSummary(last) || isRecord(last)).toBe(true);
  });

  it('workflow list --json: NDJSON records + summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-shape-wf-'));
    roots.push(root);
    const out = await runJson(root, ['workflow', 'list', '--json']);
    expect(out.exitCode).toBe(0);
    // Empty store still yields a summary line.
    expect(out.stdoutLines.length).toBeGreaterThanOrEqual(1);
    expect(isListSummary(JSON.parse(out.stdoutLines.at(-1)!))).toBe(true);
  });

  it('budget show --json: NDJSON records + summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-shape-budget-'));
    roots.push(root);
    const out = await runJson(root, ['budget', 'show', '--json']);
    expect(out.exitCode).toBe(0);
    expect(out.stdoutLines.length).toBeGreaterThanOrEqual(1);
    expect(isListSummary(JSON.parse(out.stdoutLines.at(-1)!))).toBe(true);
  });

  it('user list --json: NDJSON records', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-shape-user-'));
    roots.push(root);
    // Users start empty until bootstrap; list should still emit a valid envelope.
    const out = await runJson(root, ['user', 'list', '--json']);
    expect(out.exitCode).toBe(0);
    if (out.stdoutLines.length > 0) {
      const last = JSON.parse(out.stdoutLines.at(-1)!);
      expect(isRecord(last) || isListSummary(last)).toBe(true);
    }
  });

  it('config get <key> --json: record envelope (absent key still ok)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-shape-cfg-'));
    roots.push(root);
    const out = await runJson(root, ['config', 'get', 'defaultAgent', '--json']);
    expect(out.exitCode).toBe(0);
    expect(isRecord(JSON.parse(out.stdoutLines.at(-1)!))).toBe(true);
  });
});
