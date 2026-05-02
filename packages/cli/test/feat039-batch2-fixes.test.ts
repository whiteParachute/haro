/**
 * FEAT-039 batch 2 — Codex adversarial review fix-ups.
 *
 * Each test pins the contract for one finding so regressions are caught:
 *   1. Nested-object writes that contain secret-bearing children are rejected.
 *   2. `haro logs tail` cursor is `(createdAt, id)` — same-timestamp bursts
 *      are not dropped.
 *   3. CLI user mutations stamp `metadata.actorSource = 'cli'` even though
 *      actor_kind is collapsed to `system` for the schema CHECK constraint.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { db as haroDb, AgentRegistry, ProviderRegistry, services } from '@haro/core';
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

function captureStream(): { stream: NodeJS.WritableStream; read: () => string } {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk) => chunks.push(String(chunk)));
  return { stream, read: () => chunks.join('') };
}

describe('FEAT-039 batch 2 fix-ups (Codex adversarial findings)', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it('config set rejects an object value that contains a secret-bearing child path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-batch2-fix-secret-parent-'));
    roots.push(root);
    const projectRoot = mkdtempSync(join(tmpdir(), 'haro-batch2-fix-secret-parent-project-'));
    roots.push(projectRoot);
    const stderrCap = captureStream();
    const result = await runCli({
      argv: [
        'config',
        'set',
        'channels.feishu',
        JSON.stringify({ enabled: true, appSecret: 'sk-fake' }),
        '--scope',
        'project',
      ],
      root,
      projectRoot,
      stderr: stderrCap.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).not.toBe(0);
    const lines = stderrCap.read().trim().split('\n').filter(Boolean);
    const parsed = JSON.parse(lines.at(-1)!);
    expect(parsed).toMatchObject({ ok: false, error: { code: 'CONFIG_SECRET_REJECTED' } });
    expect(parsed.error.details?.offenders).toContain('channels.feishu.appSecret');
  });

  it('config set walks deeper objects too (provider apiKey buried two levels deep)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-batch2-fix-secret-deep-'));
    roots.push(root);
    const projectRoot = mkdtempSync(join(tmpdir(), 'haro-batch2-fix-secret-deep-project-'));
    roots.push(projectRoot);
    const stderrCap = captureStream();
    const result = await runCli({
      argv: [
        'config',
        'set',
        'providers',
        JSON.stringify({ codex: { enabled: true, apiKey: 'sk-leak' } }),
        '--scope',
        'project',
      ],
      root,
      projectRoot,
      stderr: stderrCap.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).not.toBe(0);
    const parsed = JSON.parse(stderrCap.read().trim().split('\n').filter(Boolean).at(-1)!);
    expect(parsed.error.code).toBe('CONFIG_SECRET_REJECTED');
    expect(parsed.error.details?.offenders).toContain('providers.codex.apiKey');
  });

  it('logs tail cursor uses (createdAt, id) so same-timestamp bursts are not dropped', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-batch2-fix-tail-'));
    roots.push(root);
    const opened = haroDb.initHaroDatabase({ root, keepOpen: true }) as {
      database: { prepare(sql: string): { run(...args: unknown[]): unknown }; close(): void };
    };
    try {
      opened.database
        .prepare(
          `INSERT INTO sessions (id, agent_id, provider, model, started_at, status, context_ref) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run('sess-burst', 'haro-assistant', 'codex', 'codex-primary', '2026-05-02T00:00:00Z', 'completed');
      const insertEvent = opened.database.prepare(
        `INSERT INTO session_events (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)`,
      );
      // Three events at the SAME timestamp — only the (id) tie-breaker
      // separates them. With a timestamp-only cursor, the second and third
      // would be dropped.
      for (let i = 0; i < 3; i += 1) {
        insertEvent.run('sess-burst', `result.${i}`, JSON.stringify({ idx: i }), '2026-05-02T00:01:00Z');
      }
    } finally {
      opened.database.close();
    }

    // Service is what `logs tail` calls; assert ordering matches the
    // compound cursor expectation.
    const page = services.logs.listSessionEventLogs(
      { root },
      { sessionId: 'sess-burst', from: '2026-05-02T00:01:00Z', sort: 'createdAt', order: 'asc' },
    );
    expect(page.items.map((row) => row.eventType)).toEqual(['result.0', 'result.1', 'result.2']);
    // After consuming the first event, advancing the cursor by id (not by
    // timestamp) yields the remaining two with the same createdAt.
    const firstId = page.items[0]!.id;
    const remaining = page.items.filter((row) =>
      row.createdAt > '2026-05-02T00:01:00Z'
        || (row.createdAt === '2026-05-02T00:01:00Z' && row.id > firstId),
    );
    expect(remaining.map((row) => row.eventType)).toEqual(['result.1', 'result.2']);
  });

  it('CLI user create stamps audit metadata.actorSource = "cli"', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-batch2-fix-audit-'));
    roots.push(root);
    const stdoutCap = captureStream();
    const result = await runCli({
      argv: ['user', 'create', 'auditee', '--role', 'admin', '--password', 'super-strong-password'],
      root,
      stdout: stdoutCap.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).toBe(0);

    const events = services.users.listAuditEvents({ root }, { limit: 50 });
    const created = events.find((event) => event.operation === 'users.create');
    expect(created).toBeDefined();
    expect(created!.actorKind).toBe('system');
    expect(created!.metadata).toMatchObject({ actorSource: 'cli', role: 'admin' });
  });

  it('CLI user reset-token stamps actorSource = "cli" too', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-batch2-fix-audit-reset-'));
    roots.push(root);
    services.users.createUser(
      { root },
      { username: 'bob', password: 'super-strong-password', role: 'admin' },
      { kind: 'cli', role: 'owner' },
    );
    const result = await runCli({
      argv: ['user', 'reset-token', 'bob', '--password', 'another-strong-password'],
      root,
      stdout: captureStream().stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).toBe(0);

    const events = services.users.listAuditEvents({ root }, { limit: 50 });
    const reset = events.find((event) => event.operation === 'users.reset-password');
    expect(reset).toBeDefined();
    expect(reset!.metadata).toMatchObject({ actorSource: 'cli', username: 'bob' });
  });
});
