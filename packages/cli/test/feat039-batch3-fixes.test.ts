/**
 * FEAT-039 batch 3 — Codex adversarial review fixes (2026-05-02 round 2).
 *
 * Two regressions Codex caught and we fixed:
 *
 *   1. provider/channel/gateway `doctor --json` previously emitted an
 *      `ok:true` record envelope to stdout even when the underlying
 *      diagnostic report had `ok:false`. A consumer reading `.ok` from
 *      stdout would mis-classify the failure as success. Now the failing
 *      branch writes a `CliErrorEnvelope` to **stderr** and stdout stays
 *      empty for `--json` (callers also still get a non-zero exit code).
 *
 *   2. REPL `/budget` previously called `listWorkflowBudgets({limit:1})`
 *      which returns the most-recently-touched workflow across the whole
 *      Haro home — including ones touched by background gateway / external
 *      channels. Now `executeTask` returns `workflowId`, the REPL stores
 *      it in `replState.lastWorkflowId`, and `/budget` looks up that
 *      specific workflow.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentRegistry,
  PermissionBudgetStore,
  ProviderRegistry,
  db as haroDb,
} from '@haro/core';
import type { AgentEvent, AgentProvider, AgentQueryParams } from '@haro/core/provider';
import { runCli } from '../src/index.js';
import type { ChannelRegistration } from '../src/channel.js';

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

interface CapStream { stream: NodeJS.WritableStream; read: () => string }
function captureStream(): CapStream {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk) => chunks.push(String(chunk)));
  return { stream, read: () => chunks.join('') };
}

describe('FEAT-039 batch 3 — Codex adversarial fixes', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it('failing channel doctor --json: stdout is empty, stderr carries CliErrorEnvelope, exit 1', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-fix-doctor-fail-'));
    roots.push(root);
    const stdout = captureStream();
    const stderr = captureStream();

    const failingChannel: ChannelRegistration = {
      channel: {
        id: 'feishu',
        capabilities() { return { streaming: false, attachments: false } as const; },
        async healthCheck() { return false; },
        async start() { return; },
        async stop() { return; },
        async send() { return; },
        async doctor() {
          return { ok: false, code: '401', message: 'Unauthorized' };
        },
      },
      enabled: true,
      removable: true,
      source: 'package',
      displayName: 'Feishu',
    };

    const result = await runCli({
      argv: ['channel', 'doctor', 'feishu', '--json'],
      root,
      stdout: stdout.stream,
      stderr: stderr.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
      createAdditionalChannels: async () => [failingChannel],
    });

    expect(result.exitCode).toBe(1);
    expect(stdout.read().trim()).toBe('');
    const lastErrLine = stderr.read().trim().split('\n').filter(Boolean).at(-1)!;
    const envelope = JSON.parse(lastErrLine) as {
      ok: boolean;
      error: { code: string; message: string; details?: { report?: { ok: boolean } } };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('CHANNEL_DOCTOR_FAILED');
    expect(envelope.error.details?.report?.ok).toBe(false);
  });

  it('successful provider doctor --json still emits ok:true record envelope on stdout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-fix-doctor-ok-'));
    roots.push(root);
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli({
      argv: ['provider', 'doctor', 'codex', '--json'],
      root,
      stdout: stdout.stream,
      stderr: stderr.stream,
      setupDeps: { env: { OPENAI_API_KEY: 'sk-test-12345', HOME: root }, runCommand: () => ({ status: 0, stdout: '' }) },
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
      createAdditionalChannels: async () => [],
    });

    expect(result.exitCode).toBe(0);
    const lastLine = stdout.read().trim().split('\n').filter(Boolean).at(-1)!;
    const envelope = JSON.parse(lastLine) as { ok: boolean; data: { ok: boolean } };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.ok).toBe(true);
  });

  it('REPL /budget reports the budget for the workflow created by the current REPL turn, not the global latest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-fix-budget-'));
    roots.push(root);
    const stdout = captureStream();
    const stderr = captureStream();
    const stdin = new PassThrough();

    const opened = haroDb.initHaroDatabase({ root, keepOpen: true }) as {
      database: { close(): void };
    };
    opened.database.close();

    // Spin up the REPL, run a real turn, then inject an UNRELATED workflow
    // budget that touches the DB AFTER the REPL turn (it now has a newer
    // updated_at than the REPL's workflow), then ask /budget. Before the
    // fix, /budget would return this unrelated workflow because it called
    // `listWorkflowBudgets({limit:1})`. After the fix, it pins to the REPL
    // turn's workflow id.
    const runPromise = runCli({
      argv: [],
      root,
      stdin,
      stdout: stdout.stream,
      stderr: stderr.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
      createAdditionalChannels: async () => [],
    });

    stdin.write('hello world\n');
    // Tiny pause so the turn lands a workflow row before we inject ours.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Inject an unrelated workflow budget directly via the store. It will
    // be the most-recently-touched row in `workflow_permission_budgets`.
    const store = new PermissionBudgetStore({ root, dbFile: join(root, 'haro.db') });
    try {
      store.ensureWorkflowBudget({
        workflowId: 'unrelated-bg-task-from-feishu',
        estimate: { limitTokens: 100_000, softLimitRatio: 0.8 },
      });
    } finally {
      store.close();
    }

    stdin.write('/budget\n');
    stdin.end();
    const result = await runPromise;

    expect(result.exitCode).toBe(0);
    const out = stdout.read();
    // The /budget output must NOT name the unrelated workflow. The fix
    // pins to the workflow id the REPL turn created via executeTask.
    expect(out).not.toContain('unrelated-bg-task-from-feishu');
    // It must reference *some* workflow id (the REPL turn's), proving the
    // command did actually find the right row.
    expect(out).toMatch(/workflow=.+ state=.+ used=\d+\/\d+ denied=\d+/);
  }, 15_000);
});
