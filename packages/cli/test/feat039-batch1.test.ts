/**
 * FEAT-039 batch 1 — chat / session / agent command-tree smoke tests.
 *
 * Covers the contract bits the spec calls out (AC1 / AC2 / AC3, plus a
 * sanity check that `haro session delete` runs the destructive flow with
 * the cli-side audit event-type).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { db as haroDb, AgentRegistry, ProviderRegistry } from '@haro/core';
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
    yield { type: 'text', content: 'hi' };
    yield { type: 'result', content: 'OK', responseId: 'resp-1' };
  }
}

function createAgentRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register({ id: 'haro-assistant', name: 'Haro Assistant', systemPrompt: 'helpful' });
  registry.register({ id: 'reviewer', name: 'Reviewer', systemPrompt: 'review' });
  return registry;
}

function createProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new StubProvider());
  return registry;
}

function captureStream(): { stream: NodeJS.WritableStream; read: () => string } {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk) => chunks.push(String(chunk)));
  return { stream, read: () => chunks.join('') };
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
      .run(id, 'result', JSON.stringify({ ok: true }), '2026-05-02T00:01:00Z');
  } finally {
    opened.database.close();
  }
}

describe('FEAT-039 batch 1 — session / agent / chat commands', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it('AC2 — `haro session list --json` emits NDJSON with session records', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-feat039-list-'));
    roots.push(root);
    seedSession(root, 'sess-1');
    seedSession(root, 'sess-2');
    const stdoutCap = captureStream();
    const result = await runCli({
      argv: ['session', 'list', '--json'],
      root,
      stdout: stdoutCap.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).toBe(0);
    const lines = stdoutCap.read().trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines.slice(0, -1)) {
      const parsed = JSON.parse(line);
      expect(parsed).toMatchObject({ ok: true });
      expect(parsed.data).toHaveProperty('sessionId');
    }
    const summary = JSON.parse(lines.at(-1)!);
    expect(summary).toMatchObject({ ok: true, summary: { total: 2 } });
  });

  it('`haro session show <id> --json` returns the detail envelope', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-feat039-show-'));
    roots.push(root);
    seedSession(root, 'sess-show');
    const stdoutCap = captureStream();
    const result = await runCli({
      argv: ['session', 'show', 'sess-show', '--json'],
      root,
      stdout: stdoutCap.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(stdoutCap.read().trim().split('\n').filter(Boolean).at(-1)!);
    expect(parsed).toMatchObject({ ok: true, data: { sessionId: 'sess-show', agentId: 'haro-assistant' } });
  });

  it('`haro session show <missing> --json` exits non-zero with structured error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-feat039-missing-'));
    roots.push(root);
    seedSession(root, 'sess-real');
    const stderrCap = captureStream();
    const result = await runCli({
      argv: ['session', 'show', 'sess-missing', '--json'],
      root,
      stderr: stderrCap.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).not.toBe(0);
    const parsed = JSON.parse(stderrCap.read().trim().split('\n').filter(Boolean).at(-1)!);
    expect(parsed).toMatchObject({ ok: false, error: { code: 'SESSION_NOT_FOUND' } });
  });

  it('`haro session delete <id> --yes` writes a cli.session.delete audit row', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-feat039-delete-'));
    roots.push(root);
    seedSession(root, 'sess-del');
    const stdoutCap = captureStream();
    const result = await runCli({
      argv: ['session', 'delete', 'sess-del', '--yes', '--quiet'],
      root,
      stdout: stdoutCap.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).toBe(0);
    const opened = haroDb.initHaroDatabase({ root, keepOpen: true }) as {
      database: { prepare(sql: string): { all(...args: unknown[]): unknown[] }; close(): void };
    };
    try {
      const events = opened.database
        .prepare(`SELECT event_type FROM operation_audit_log WHERE target_ref = 'sess-del'`)
        .all() as Array<{ event_type: string }>;
      expect(events).toEqual([{ event_type: 'cli.session.delete' }]);
    } finally {
      opened.database.close();
    }
  });

  it('AC3 — `haro agent list --json` emits NDJSON of registered agents', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-feat039-agents-'));
    roots.push(root);
    const stdoutCap = captureStream();
    const result = await runCli({
      argv: ['agent', 'list', '--json'],
      root,
      stdout: stdoutCap.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).toBe(0);
    const ids = stdoutCap.read().trim().split('\n').filter(Boolean).map((line) => JSON.parse(line).data.id);
    expect(ids).toEqual(expect.arrayContaining(['haro-assistant', 'reviewer']));
  });

  it('`haro agent show <id> --json` returns the registry detail', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-feat039-agent-show-'));
    roots.push(root);
    const stdoutCap = captureStream();
    const result = await runCli({
      argv: ['agent', 'show', 'reviewer', '--json'],
      root,
      stdout: stdoutCap.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(stdoutCap.read().trim().split('\n').filter(Boolean).at(-1)!);
    expect(parsed).toMatchObject({ ok: true, data: { id: 'reviewer', name: 'Reviewer' } });
  });

  it('AC1 — `haro chat --send "<msg>"` runs one-shot through the runner and exits 0', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-feat039-chat-send-'));
    roots.push(root);
    const stdoutCap = captureStream();
    const result = await runCli({
      argv: ['chat', '--send', 'hello'],
      root,
      stdout: stdoutCap.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).toBe(0);
    expect(stdoutCap.read()).toContain('OK');
  });
});
