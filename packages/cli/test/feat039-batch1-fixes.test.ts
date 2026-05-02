/**
 * FEAT-039 batch 1 — adversarial review fix-ups.
 *
 * Each test covers one Codex finding:
 *   1. `chat --send --session` pins continuation to the named session id,
 *      not "latest completed".
 *   2. `agent test` runs in sandbox: the provider must NOT receive a
 *      previousResponseId carried over from the latest historical session.
 *   3. `chat --send --session <missing>` exits non-zero with a clear error.
 *   4. `chat --send --session <id>` rejects a session that belongs to a
 *      different agent.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { db as haroDb, AgentRegistry, ProviderRegistry } from '@haro/core';
import type { AgentEvent, AgentProvider, AgentQueryParams } from '@haro/core/provider';
import { runCli } from '../src/index.js';

class RecordingProvider implements AgentProvider {
  readonly id = 'codex';
  readonly seenContinuations: Array<string | undefined> = [];
  capabilities() {
    return { streaming: false, toolLoop: false, contextCompaction: false, contextContinuation: true } as const;
  }
  async healthCheck(): Promise<boolean> { return true; }
  async listModels(): Promise<readonly { id: string }[]> { return [{ id: 'codex-primary' }]; }
  async *query(params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
    this.seenContinuations.push(params.sessionContext?.previousResponseId);
    yield { type: 'text', content: 'hi' };
    yield { type: 'result', content: 'OK', responseId: `resp-${this.seenContinuations.length}` };
  }
}

function createAgentRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register({ id: 'haro-assistant', name: 'Haro Assistant', systemPrompt: 'helpful' });
  registry.register({ id: 'reviewer', name: 'Reviewer', systemPrompt: 'review' });
  return registry;
}

function createProviderRegistry(provider: AgentProvider): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(provider);
  return registry;
}

function captureStream(): { stream: NodeJS.WritableStream; read: () => string } {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk) => chunks.push(String(chunk)));
  return { stream, read: () => chunks.join('') };
}

function seedSession(
  root: string,
  args: { id: string; agentId?: string; status?: string; startedAt?: string; responseId?: string | null },
): void {
  const opened = haroDb.initHaroDatabase({ root, keepOpen: true }) as {
    database: { prepare(sql: string): { run(...args: unknown[]): unknown }; close(): void };
  };
  try {
    const contextRef = args.responseId ? JSON.stringify({ previousResponseId: args.responseId }) : null;
    opened.database
      .prepare(
        `INSERT INTO sessions (id, agent_id, provider, model, started_at, status, context_ref) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        args.id,
        args.agentId ?? 'haro-assistant',
        'codex',
        'codex-primary',
        args.startedAt ?? '2026-05-02T00:00:00Z',
        args.status ?? 'completed',
        contextRef,
      );
    if (args.responseId) {
      opened.database
        .prepare(`INSERT INTO session_events (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)`)
        .run(args.id, 'result', JSON.stringify({ responseId: args.responseId }), args.startedAt ?? '2026-05-02T00:01:00Z');
    }
  } finally {
    opened.database.close();
  }
}

describe('FEAT-039 batch 1 fix-ups (Codex adversarial findings)', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it('chat --send --session <old> pins continuation, ignoring the newer session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-feat039-fix-pin-'));
    roots.push(root);
    // Old session has responseId resp-old; latest has resp-latest.
    seedSession(root, { id: 'sess-old', startedAt: '2026-05-01T00:00:00Z', responseId: 'resp-old' });
    seedSession(root, { id: 'sess-latest', startedAt: '2026-05-02T12:00:00Z', responseId: 'resp-latest' });
    const provider = new RecordingProvider();
    const stdoutCap = captureStream();
    const result = await runCli({
      argv: ['chat', '--send', 'continue please', '--session', 'sess-old'],
      root,
      stdout: stdoutCap.stream,
      createProviderRegistry: async () => createProviderRegistry(provider),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).toBe(0);
    expect(provider.seenContinuations).toEqual(['resp-old']);
  });

  it('chat --send --session <missing> exits non-zero with a clear error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-feat039-fix-missing-'));
    roots.push(root);
    const stderrCap = captureStream();
    const result = await runCli({
      argv: ['chat', '--send', 'hello', '--session', 'sess-ghost'],
      root,
      stderr: stderrCap.stream,
      createProviderRegistry: async () => createProviderRegistry(new RecordingProvider()),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).not.toBe(0);
  });

  it('chat --send --session of another agent is rejected before runner runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-feat039-fix-agent-mismatch-'));
    roots.push(root);
    seedSession(root, { id: 'sess-reviewer', agentId: 'reviewer', responseId: 'resp-rev' });
    const provider = new RecordingProvider();
    const stderrCap = captureStream();
    const result = await runCli({
      argv: ['chat', '--send', 'hi', '--session', 'sess-reviewer'],
      root,
      stderr: stderrCap.stream,
      createProviderRegistry: async () => createProviderRegistry(provider),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).not.toBe(0);
    expect(provider.seenContinuations).toEqual([]);
  });

  it('agent test runs in sandbox without inheriting latest session continuation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-feat039-fix-sandbox-'));
    roots.push(root);
    seedSession(root, { id: 'sess-prior', startedAt: '2026-05-02T08:00:00Z', responseId: 'resp-prior' });
    const provider = new RecordingProvider();
    const stdoutCap = captureStream();
    const result = await runCli({
      argv: ['agent', 'test', 'haro-assistant', '--task', 'sandbox check'],
      root,
      stdout: stdoutCap.stream,
      createProviderRegistry: async () => createProviderRegistry(provider),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).toBe(0);
    expect(provider.seenContinuations).toEqual([undefined]);
  });
});
