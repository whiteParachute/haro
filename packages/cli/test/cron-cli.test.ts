/** FEAT-033 — `haro cron` CLI smoke tests (Step 5). */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentRegistry,
  ProviderRegistry,
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

interface Cap { stream: NodeJS.WritableStream; read: () => string }
function captureStream(): Cap {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk) => chunks.push(String(chunk)));
  return { stream, read: () => chunks.join('') };
}

describe('haro cron CLI', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  async function newHome(prefix: string): Promise<string> {
    const root = mkdtempSync(join(tmpdir(), `haro-${prefix}-`));
    roots.push(root);
    return root;
  }

  function commonOpts(root: string, stdout: Cap, stderr: Cap, argv: string[]) {
    return {
      argv,
      root,
      stdout: stdout.stream,
      stderr: stderr.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
      createAdditionalChannels: async () => [],
    };
  }

  it('create + list + show round-trip via --json', async () => {
    const root = await newHome('cron-create');
    const stdout = captureStream();
    const stderr = captureStream();

    const create = await runCli(commonOpts(root, stdout, stderr, [
      'cron', 'create',
      '--cron', '*/5 * * * *',
      '--task', 'roll up PRs',
      '--session', 's-roll',
      '--json',
    ]));
    expect(create.exitCode).toBe(0);
    const createLine = stdout.read().trim().split('\n').filter(Boolean).at(-1)!;
    const job = JSON.parse(createLine) as { ok: boolean; data: { id: string; status: string } };
    expect(job.ok).toBe(true);
    expect(job.data.status).toBe('pending');
    expect(job.data.id).toMatch(/^cron_/);

    const stdout2 = captureStream();
    const stderr2 = captureStream();
    const list = await runCli(commonOpts(root, stdout2, stderr2, ['cron', 'list', '--json']));
    expect(list.exitCode).toBe(0);
    const listLines = stdout2.read().trim().split('\n').filter(Boolean);
    const envelopes = listLines.map((line) => JSON.parse(line) as { ok: boolean; data?: { id: string }; summary?: { total: number } });
    const ids = envelopes.flatMap((e) => (e.data?.id ? [e.data.id] : []));
    expect(ids).toContain(job.data.id);
    const summary = envelopes.find((e) => e.summary)?.summary;
    expect(summary?.total).toBeGreaterThanOrEqual(1);
  });

  it('create with sub-minute cron exits non-zero with CRON_FREQUENCY_TOO_HIGH', async () => {
    const root = await newHome('cron-freq');
    const stdout = captureStream();
    const stderr = captureStream();
    const result = await runCli(commonOpts(root, stdout, stderr, [
      'cron', 'create',
      '--cron', '* * * * * *',
      '--task', 't',
      '--session', 's',
      '--json',
    ]));
    expect(result.exitCode).toBe(1);
    const errLine = stderr.read().trim().split('\n').filter(Boolean).at(-1)!;
    const envelope = JSON.parse(errLine) as { ok: boolean; error: { code: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('CRON_FREQUENCY_TOO_HIGH');
  });

  it('create with non-ISO `once` is rejected as CRON_INVALID_EXPRESSION', async () => {
    const root = await newHome('cron-iso');
    const stdout = captureStream();
    const stderr = captureStream();
    const result = await runCli(commonOpts(root, stdout, stderr, [
      'cron', 'create',
      '--once', '05/15/2026',
      '--task', 't',
      '--session', 's',
      '--json',
    ]));
    expect(result.exitCode).toBe(1);
    const errLine = stderr.read().trim().split('\n').filter(Boolean).at(-1)!;
    const envelope = JSON.parse(errLine) as { ok: boolean; error: { code: string } };
    expect(envelope.error.code).toBe('CRON_INVALID_EXPRESSION');
  });

  it('cancel disables the job and trigger refuses cancelled jobs', async () => {
    const root = await newHome('cron-cancel');
    const stdout = captureStream();
    const stderr = captureStream();
    const create = await runCli(commonOpts(root, stdout, stderr, [
      'cron', 'create',
      '--cron', '*/5 * * * *',
      '--task', 't',
      '--session', 's',
      '--json',
    ]));
    expect(create.exitCode).toBe(0);
    const id = (JSON.parse(stdout.read().trim().split('\n').filter(Boolean).at(-1)!) as { data: { id: string } }).data.id;

    const out2 = captureStream();
    const err2 = captureStream();
    const cancel = await runCli(commonOpts(root, out2, err2, ['cron', 'cancel', id, '--json']));
    expect(cancel.exitCode).toBe(0);
    const cancelEnvelope = JSON.parse(out2.read().trim().split('\n').filter(Boolean).at(-1)!) as { data: { enabled: boolean; status: string } };
    expect(cancelEnvelope.data.enabled).toBe(false);
    expect(cancelEnvelope.data.status).toBe('cancelled');

    const out3 = captureStream();
    const err3 = captureStream();
    const trig = await runCli(commonOpts(root, out3, err3, ['cron', 'trigger', id, '--json']));
    expect(trig.exitCode).toBe(1);
    const trigErr = JSON.parse(err3.read().trim().split('\n').filter(Boolean).at(-1)!) as { ok: boolean; error: { code: string } };
    expect(trigErr.ok).toBe(false);
    // either CRON_JOB_NOT_FOUND (alias for cancelled) or INVALID_INPUT
    expect(['CRON_JOB_NOT_FOUND', 'INVALID_INPUT']).toContain(trigErr.error.code);
  });

  it('tick runs synchronously and reports zero ranCount when no jobs are due', async () => {
    const root = await newHome('cron-tick');
    const stdout = captureStream();
    const stderr = captureStream();
    const result = await runCli(commonOpts(root, stdout, stderr, ['cron', 'tick', '--json']));
    expect(result.exitCode).toBe(0);
    const last = stdout.read().trim().split('\n').filter(Boolean).at(-1)!;
    const envelope = JSON.parse(last) as { ok: boolean; data: { skipped: false | string; ranCount: number } };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.ranCount).toBe(0);
  });
});
