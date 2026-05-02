/**
 * FEAT-039 batch 2 — memory / logs / workflow / budget / user / skill / config command-tree smoke tests.
 *
 * Each command-tree gets one happy-path JSON test plus the most surprising
 * edge case (e.g. config secret rejection, user list bootstrap shape).
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
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

function seedSession(root: string, id: string, agentId = 'haro-assistant'): void {
  const opened = haroDb.initHaroDatabase({ root, keepOpen: true }) as {
    database: { prepare(sql: string): { run(...args: unknown[]): unknown }; close(): void };
  };
  try {
    opened.database
      .prepare(
        `INSERT INTO sessions (id, agent_id, provider, model, started_at, status, context_ref) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(id, agentId, 'codex', 'codex-primary', '2026-05-02T00:00:00Z', 'completed');
    opened.database
      .prepare(`INSERT INTO session_events (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)`)
      .run(id, 'result', JSON.stringify({ ok: true }), '2026-05-02T00:01:00Z');
  } finally {
    opened.database.close();
  }
}

describe('FEAT-039 batch 2 — memory / logs / workflow / budget / user / skill / config', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it('haro logs show --json includes seeded session events', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-batch2-logs-'));
    roots.push(root);
    seedSession(root, 'sess-1');
    const stdoutCap = captureStream();
    const result = await runCli({
      argv: ['logs', 'show', '--json', '--page-size', '10'],
      root,
      stdout: stdoutCap.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).toBe(0);
    const lines = stdoutCap.read().trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const summary = JSON.parse(lines.at(-1)!);
    expect(summary).toMatchObject({ ok: true, summary: { total: 1 } });
  });

  it('haro workflow list --json returns empty result on a fresh root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-batch2-wf-'));
    roots.push(root);
    const stdoutCap = captureStream();
    const result = await runCli({
      argv: ['workflow', 'list', '--json'],
      root,
      stdout: stdoutCap.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).toBe(0);
    const last = stdoutCap.read().trim().split('\n').filter(Boolean).at(-1)!;
    expect(JSON.parse(last)).toMatchObject({ ok: true, summary: { total: 0 } });
  });

  it('haro budget audit --json returns empty array on a fresh root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-batch2-budget-'));
    roots.push(root);
    const stdoutCap = captureStream();
    const result = await runCli({
      argv: ['budget', 'audit', '--json', '--limit', '10'],
      root,
      stdout: stdoutCap.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).toBe(0);
    const last = stdoutCap.read().trim().split('\n').filter(Boolean).at(-1)!;
    expect(JSON.parse(last)).toMatchObject({ ok: true, summary: { total: 0 } });
  });

  it('haro user list --json reflects the empty bootstrap state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-batch2-user-empty-'));
    roots.push(root);
    const stdoutCap = captureStream();
    const result = await runCli({
      argv: ['user', 'list', '--json'],
      root,
      stdout: stdoutCap.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).toBe(0);
    const last = stdoutCap.read().trim().split('\n').filter(Boolean).at(-1)!;
    expect(JSON.parse(last)).toMatchObject({ ok: true, summary: { total: 0 } });
  });

  it('haro user create --role admin lands an admin row + audit event', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-batch2-user-create-'));
    roots.push(root);
    const stdoutCap = captureStream();
    const stderrCap = captureStream();
    const result = await runCli({
      argv: ['user', 'create', 'alice', '--role', 'admin', '--password', 'super-strong-password'],
      root,
      stdout: stdoutCap.stream,
      stderr: stderrCap.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    if (result.exitCode !== 0) {
      throw new Error(`exit ${result.exitCode}\nSTDOUT:\n${stdoutCap.read()}\nSTDERR:\n${stderrCap.read()}`);
    }
    expect(stdoutCap.read()).toContain("user 'alice' created");

    const users = services.users.listUsers({ root });
    expect(users).toHaveLength(1);
    expect(users[0]!.username).toBe('alice');
    expect(users[0]!.role).toBe('admin');
  });

  it('haro config set + get round-trips a non-secret key', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-batch2-cfg-'));
    roots.push(root);
    const projectRoot = mkdtempSync(join(tmpdir(), 'haro-batch2-cfg-project-'));
    roots.push(projectRoot);
    const stdoutSet = captureStream();
    const setResult = await runCli({
      argv: ['config', 'set', 'logging.level', 'debug', '--scope', 'project'],
      root,
      projectRoot,
      stdout: stdoutSet.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(setResult.exitCode).toBe(0);
    expect(stdoutSet.read()).toContain('logging.level');

    const stdoutGet = captureStream();
    const getResult = await runCli({
      argv: ['config', 'get', 'logging.level', '--json'],
      root,
      projectRoot,
      stdout: stdoutGet.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(getResult.exitCode).toBe(0);
    const parsed = JSON.parse(stdoutGet.read().trim().split('\n').filter(Boolean).at(-1)!);
    expect(parsed).toMatchObject({ ok: true, data: { key: 'logging.level', value: 'debug', source: 'project' } });
  });

  it('haro config set rejects secret-bearing keys', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-batch2-cfg-secret-'));
    roots.push(root);
    const projectRoot = mkdtempSync(join(tmpdir(), 'haro-batch2-cfg-secret-project-'));
    roots.push(projectRoot);
    const stderrCap = captureStream();
    const result = await runCli({
      argv: ['config', 'set', 'providers.codex.apiKey', 'sk-fake', '--scope', 'project'],
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
  });

  it('haro config unset removes the key when present', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-batch2-cfg-unset-'));
    roots.push(root);
    const projectRoot = mkdtempSync(join(tmpdir(), 'haro-batch2-cfg-unset-project-'));
    roots.push(projectRoot);
    const projectYaml = join(projectRoot, '.haro', 'config.yaml');
    mkdirSync(join(projectRoot, '.haro'), { recursive: true });
    writeFileSync(projectYaml, 'logging:\n  level: warn\n', 'utf8');

    const result = await runCli({
      argv: ['config', 'unset', 'logging.level', '--scope', 'project'],
      root,
      projectRoot,
      stdout: captureStream().stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
    });
    expect(result.exitCode).toBe(0);
    const after = readFileSync(projectYaml, 'utf8');
    expect(after).not.toContain('level: warn');
  });
});
