/**
 * FEAT-039 batch 3 — REPL slash commands `/sessions` `/memory` `/logs` `/budget`.
 *
 * Each slash must reuse the underlying core service (R15/AC11). These tests
 * spin up a REPL with a stubbed provider, drive stdin, and assert the slash
 * output reflects what the corresponding `haro <cmd>` command would print.
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
  async *query(params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
    yield { type: 'result', content: `echo:${params.prompt}`, responseId: 'resp-1' };
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
      .run(id, 'cli.input', JSON.stringify({ task: 'hi' }), '2026-05-02T00:00:30Z');
    opened.database
      .prepare(`INSERT INTO session_events (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)`)
      .run(id, 'agent.result', JSON.stringify({ ok: true }), '2026-05-02T00:01:00Z');
  } finally {
    opened.database.close();
  }
}

interface RunOpts { argv?: string[]; root: string; stdinLines: string[] }

async function runRepl(opts: RunOpts): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  stdout.on('data', (chunk) => outChunks.push(String(chunk)));
  stderr.on('data', (chunk) => errChunks.push(String(chunk)));

  const promise = runCli({
    argv: opts.argv ?? [],
    root: opts.root,
    stdin,
    stdout,
    stderr,
    createProviderRegistry: async () => createProviderRegistry(),
    loadAgentRegistry: async () => createAgentRegistry(),
    createAdditionalChannels: async () => [],
  });
  for (const line of opts.stdinLines) {
    stdin.write(`${line}\n`);
  }
  stdin.end();
  const result = await promise;
  return { exitCode: result.exitCode, stdout: outChunks.join(''), stderr: errChunks.join('') };
}

describe('FEAT-039 batch 3 — REPL slash /sessions /memory /logs /budget', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it('AC11 — /sessions lists recent sessions reusing services.sessions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-slash-sessions-'));
    roots.push(root);
    seedSession(root, 'sess-A');
    seedSession(root, 'sess-B');

    const out = await runRepl({ root, stdinLines: ['/sessions'] });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('sess-A');
    expect(out.stdout).toContain('sess-B');
    expect(out.stdout).toContain('haro-assistant');
  });

  it('AC11 — /sessions reports empty state when no sessions exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-slash-empty-'));
    roots.push(root);

    const out = await runRepl({ root, stdinLines: ['/sessions'] });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('(no sessions yet)');
  });

  it('AC11 — /memory <q> hits services.memory.queryMemory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-slash-memory-'));
    roots.push(root);
    // Seed a memory entry directly through the service so the slash has
    // something to find — proves the slash and the haro memory remember
    // command share the same backing store.
    await services.memory.writeMemoryEntry(
      { root, dbFile: join(root, 'haro.db') },
      {
        scope: 'shared',
        layer: 'persistent',
        topic: 'pizza topping',
        content: 'pineapple is allowed',
        sourceRef: 'test',
      },
      { currentAgentId: 'haro-assistant' },
    );

    const out = await runRepl({ root, stdinLines: ['/memory pineapple'] });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('pizza topping');
  });

  it('AC11 — /memory without query prints usage', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-slash-memory-empty-'));
    roots.push(root);
    const out = await runRepl({ root, stdinLines: ['/memory'] });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('usage: /memory <query>');
  });

  it('AC11 — /logs warns when no session is active yet', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-slash-logs-empty-'));
    roots.push(root);
    const out = await runRepl({ root, stdinLines: ['/logs'] });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('(no session yet');
  });

  it('AC11 — /logs lists recent events for the most-recent session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-slash-logs-'));
    roots.push(root);
    // Drive one real REPL turn so lastSessionId is wired, then ask /logs.
    const out = await runRepl({ root, stdinLines: ['hello world', '/logs'] });
    expect(out.exitCode).toBe(0);
    // The runner emits event types like 'session_*' / 'agent_*'. We assert
    // that at least one tab-separated row landed.
    const lines = out.stdout.split('\n').filter((l) => /\d{4}-\d{2}-\d{2}T/.test(l) && l.includes('\t'));
    expect(lines.length).toBeGreaterThan(0);
  });

  it('AC11 — /budget reports the latest workflow summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-slash-budget-'));
    roots.push(root);
    const out = await runRepl({ root, stdinLines: ['hello world', '/budget'] });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toMatch(/workflow=.+ state=.+ used=\d+\/\d+ denied=\d+/);
  });

  it('AC11 — /help lists the four new slash commands', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-slash-help-'));
    roots.push(root);
    const out = await runRepl({ root, stdinLines: ['/help'] });
    expect(out.exitCode).toBe(0);
    for (const expected of ['/sessions [n]', '/memory <query>', '/logs [n]', '/budget']) {
      expect(out.stdout).toContain(expected);
    }
  });
});
