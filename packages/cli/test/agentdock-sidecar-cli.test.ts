import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRegistry, ProviderRegistry } from '@haro/core';
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

interface Capture { stream: NodeJS.WritableStream; read: () => string }

function captureStream(): Capture {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk) => chunks.push(String(chunk)));
  return { stream, read: () => chunks.join('') };
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

function commonOpts(root: string, stdout: Capture, stderr: Capture, argv: string[]) {
  return {
    argv,
    root,
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => new Date('2026-05-08T12:00:00.000Z'),
    createProviderRegistry: async () => createProviderRegistry(),
    loadAgentRegistry: async () => createAgentRegistry(),
    createAdditionalChannels: async () => [],
  };
}

function jsonResponse(value: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    async json() {
      return value;
    },
  };
}

describe('haro AgentDock sidecar CLI [FEAT-045]', () => {
  const roots: string[] = [];
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalFetch === undefined) {
      Reflect.deleteProperty(globalThis, 'fetch');
    } else {
      globalThis.fetch = originalFetch;
    }
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function newHome(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), `haro-${prefix}-`));
    roots.push(root);
    return root;
  }

  it('connect agent-dock saves sanitized connection config without creating memory', async () => {
    const root = newHome('agentdock-connect');
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'connect',
      'agent-dock',
      '--base-url',
      'http://agentdock.local/',
      '--id',
      'agentdock-local',
      '--auth-ref',
      'env:AGENTDOCK_AUTH_HEADER',
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(result.action).toBe('connect');
    expect(stderr.read()).toBe('');
    const payload = JSON.parse(stdout.read()) as { data: { connection: { id: string; baseUrl: string; authRef: string } } };
    expect(payload.data.connection).toMatchObject({
      id: 'agentdock-local',
      baseUrl: 'http://agentdock.local',
      authRef: 'env:AGENTDOCK_AUTH_HEADER',
    });
    const file = JSON.parse(readFileSync(join(root, 'agentdock-connections.json'), 'utf8')) as {
      defaultConnectionId: string;
      connections: Record<string, { baseUrl: string }>;
    };
    expect(file.defaultConnectionId).toBe('agentdock-local');
    expect(file.connections['agentdock-local']?.baseUrl).toBe('http://agentdock.local');
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('connect agent-dock preserves unknown connection fields when updating an existing record', async () => {
    const root = newHome('agentdock-connect-extra-fields');
    writeFileSync(join(root, 'agentdock-connections.json'), JSON.stringify({
      defaultConnectionId: 'agentdock-local',
      connections: {
        'agentdock-local': {
          id: 'agentdock-local',
          baseUrl: 'http://old-agentdock.local',
          authRef: 'env:OLD_AUTH_HEADER',
          tenant: 'prod',
          region: 'us',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
      },
    }));
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'connect',
      'agent-dock',
      '--base-url',
      'http://agentdock.local/',
      '--id',
      'agentdock-local',
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const file = JSON.parse(readFileSync(join(root, 'agentdock-connections.json'), 'utf8')) as {
      connections: Record<string, { baseUrl: string; tenant?: string; region?: string; authRef?: string; createdAt: string }>;
    };
    expect(file.connections['agentdock-local']).toMatchObject({
      baseUrl: 'http://agentdock.local',
      tenant: 'prod',
      region: 'us',
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    expect(file.connections['agentdock-local']?.authRef).toBeUndefined();
  });

  it('observe --source fake writes an observation and is idempotent on repeat', async () => {
    const root = newHome('agentdock-observe-fake');
    const stdout = captureStream();
    const stderr = captureStream();

    const first = await runCli(commonOpts(root, stdout, stderr, [
      'observe',
      '--source',
      'fake',
      '--connection',
      'fake-agentdock',
      '--since',
      'last',
      '--json',
    ]));

    expect(first.exitCode).toBe(0);
    const firstPayload = (JSON.parse(stdout.read()) as { data: {
      source: string;
      observationCount: number;
      wroteObservation: boolean;
      cursor: string;
      observationPath: string;
    } }).data;
    expect(firstPayload.source).toBe('fake');
    expect(firstPayload.observationCount).toBeGreaterThan(0);
    expect(firstPayload.wroteObservation).toBe(true);
    expect(firstPayload.cursor).toBe('fake-cursor-001');
    expect(existsSync(firstPayload.observationPath)).toBe(true);
    expect(readdirSync(join(root, 'evolution', 'observations'))).toHaveLength(1);
    expect(existsSync(join(root, 'memory'))).toBe(false);

    const stdout2 = captureStream();
    const stderr2 = captureStream();
    const second = await runCli(commonOpts(root, stdout2, stderr2, [
      'observe',
      '--source',
      'fake',
      '--connection',
      'fake-agentdock',
      '--since',
      'last',
      '--json',
    ]));

    expect(second.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    expect(stderr2.read()).toBe('');
    const secondPayload = (JSON.parse(stdout2.read()) as { data: {
      observationCount: number;
      wroteObservation: boolean;
    } }).data;
    expect(secondPayload.observationCount).toBe(0);
    expect(secondPayload.wroteObservation).toBe(false);
    expect(readdirSync(join(root, 'evolution', 'observations'))).toHaveLength(1);
  });

  it('propose --auto-dry-run writes one proposal from unconsumed observations and is idempotent', async () => {
    const root = newHome('agentdock-propose');
    const observeOut = captureStream();
    const observeErr = captureStream();

    const observe = await runCli(commonOpts(root, observeOut, observeErr, [
      'observe',
      '--source',
      'fake',
      '--connection',
      'fake-agentdock',
      '--since',
      'last',
      '--json',
    ]));
    expect(observe.exitCode).toBe(0);
    const observePayload = (JSON.parse(observeOut.read()) as { data: { batchId: string } }).data;

    const proposeOut = captureStream();
    const proposeErr = captureStream();
    const propose = await runCli(commonOpts(root, proposeOut, proposeErr, [
      'propose',
      '--auto-dry-run',
      '--json',
    ]));

    expect(propose.exitCode).toBe(0);
    expect(propose.action).toBe('propose');
    expect(proposeErr.read()).toBe('');
    const payload = (JSON.parse(proposeOut.read()) as { data: {
      proposalCount: number;
      consumedObservationCount: number;
      pendingObservationCount: number;
      wroteProposal: boolean;
      proposalId: string;
      proposalPath: string;
      proposal: { status: string; sourceObservationRefs: Array<{ id: string; kind: string }> };
    } }).data;
    expect(payload.proposalCount).toBe(1);
    expect(payload.consumedObservationCount).toBe(1);
    expect(payload.pendingObservationCount).toBe(0);
    expect(payload.wroteProposal).toBe(true);
    expect(payload.proposal.status).toBe('dry-run');
    expect(payload.proposal.sourceObservationRefs).toEqual([
      { id: observePayload.batchId, kind: 'observation-batch', uri: `haro-sidecar://observations/${encodeURIComponent(observePayload.batchId)}` },
    ]);
    expect(existsSync(payload.proposalPath)).toBe(true);
    expect(readdirSync(join(root, 'evolution', 'proposals'))).toHaveLength(1);
    expect(existsSync(join(root, 'memory'))).toBe(false);

    const repeatOut = captureStream();
    const repeatErr = captureStream();
    const repeat = await runCli(commonOpts(root, repeatOut, repeatErr, [
      'propose',
      '--auto-dry-run',
      '--json',
    ]));
    expect(repeat.exitCode).toBe(0);
    expect(repeatErr.read()).toBe('');
    const repeatPayload = (JSON.parse(repeatOut.read()) as { data: {
      proposalCount: number;
      consumedObservationCount: number;
      wroteProposal: boolean;
    } }).data;
    expect(repeatPayload.proposalCount).toBe(0);
    expect(repeatPayload.consumedObservationCount).toBe(0);
    expect(repeatPayload.wroteProposal).toBe(false);
    expect(readdirSync(join(root, 'evolution', 'proposals'))).toHaveLength(1);
  });

  it('propose --auto-dry-run reports corrupt proposals and repairs deterministic proposal files', async () => {
    const root = newHome('agentdock-propose-repair-corrupt');
    const observeOut = captureStream();
    const observeErr = captureStream();

    const observe = await runCli(commonOpts(root, observeOut, observeErr, [
      'observe',
      '--source',
      'fake',
      '--connection',
      'fake-agentdock',
      '--since',
      'last',
      '--json',
    ]));
    expect(observe.exitCode).toBe(0);

    const proposeOut = captureStream();
    const proposeErr = captureStream();
    const propose = await runCli(commonOpts(root, proposeOut, proposeErr, [
      'propose',
      '--auto-dry-run',
      '--json',
    ]));
    expect(propose.exitCode).toBe(0);
    expect(proposeErr.read()).toBe('');
    const firstPayload = (JSON.parse(proposeOut.read()) as { data: { proposalPath: string; proposalId: string } }).data;
    writeFileSync(firstPayload.proposalPath, '{}\n');

    const repairOut = captureStream();
    const repairErr = captureStream();
    const repair = await runCli(commonOpts(root, repairOut, repairErr, [
      'propose',
      '--auto-dry-run',
      '--json',
    ]));

    expect(repair.exitCode).toBe(0);
    expect(repairErr.read()).toContain('skipped 1 corrupt AgentDock proposal');
    const repairPayload = (JSON.parse(repairOut.read()) as { data: {
      proposalCount: number;
      wroteProposal: boolean;
      skippedCorruptProposalCount: number;
      proposalId: string;
      proposal: { sourceObservationRefs: Array<{ kind: string }> };
    } }).data;
    expect(repairPayload.proposalCount).toBe(1);
    expect(repairPayload.wroteProposal).toBe(true);
    expect(repairPayload.skippedCorruptProposalCount).toBe(1);
    expect(repairPayload.proposalId).toBe(firstPayload.proposalId);
    expect(repairPayload.proposal.sourceObservationRefs[0]?.kind).toBe('observation-batch');
    const repairedFile = JSON.parse(readFileSync(firstPayload.proposalPath, 'utf8')) as { id: string; status: string };
    expect(repairedFile).toMatchObject({ id: firstPayload.proposalId, status: 'dry-run' });
  });

  it('propose --auto-dry-run reports corrupt observation files without silently ignoring them', async () => {
    const root = newHome('agentdock-propose-corrupt-observation');
    const observationDir = join(root, 'evolution', 'observations');
    mkdirSync(observationDir, { recursive: true });
    writeFileSync(join(observationDir, 'broken.json'), '{ broken json');
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'propose',
      '--auto-dry-run',
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toContain('skipped 1 corrupt AgentDock observation');
    const payload = (JSON.parse(stdout.read()) as { data: {
      proposalCount: number;
      wroteProposal: boolean;
      skippedCorruptObservationCount: number;
    } }).data;
    expect(payload.proposalCount).toBe(0);
    expect(payload.wroteProposal).toBe(false);
    expect(payload.skippedCorruptObservationCount).toBe(1);
  });

  it('propose --auto-dry-run is a no-op when no observations exist', async () => {
    const root = newHome('agentdock-propose-empty');
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'propose',
      '--auto-dry-run',
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(result.action).toBe('propose');
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      proposalCount: number;
      wroteProposal: boolean;
      pendingObservationCount: number;
    } }).data;
    expect(payload.proposalCount).toBe(0);
    expect(payload.wroteProposal).toBe(false);
    expect(payload.pendingObservationCount).toBe(0);
    expect(existsSync(join(root, 'evolution', 'proposals'))).toBe(false);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('observe uses saved AgentDock HTTP connection, cursor, and stored-id dedupe', async () => {
    const root = newHome('agentdock-observe-http');
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      const path = `${parsed.pathname}${parsed.search}`;
      if (path === '/api/health') return jsonResponse({ status: 'healthy' });
      if (path === '/api/status') return jsonResponse({ activeRuntimes: 1, queueLength: 0, sessions: [] });
      if (path === '/api/sessions') {
        return jsonResponse({
          sessions: {
            'main:flow-1': {
              id: 'main:flow-1',
              backing_jid: 'web:main',
              runner_id: 'codex',
              model: 'gpt-5.5',
              created_at: '2026-05-08T09:00:00.000Z',
            },
          },
        });
      }
      if (path === '/api/sessions/main%3Aflow-1/messages?limit=20') {
        return jsonResponse({
          messages: [
            { id: 'm1', is_from_me: false, content: 'hello', timestamp: '2026-05-08T10:01:00.000Z' },
          ],
        });
      }
      if (path === '/api/sessions/main%3Aflow-1/turns?limit=20') return jsonResponse({ turns: [] });
      if (path === '/api/tasks') return jsonResponse({ tasks: [] });
      throw new Error(`unexpected path: ${path}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const connectOut = captureStream();
    const connectErr = captureStream();
    const connect = await runCli(commonOpts(root, connectOut, connectErr, [
      'connect',
      'agent-dock',
      '--base-url',
      'http://agentdock.local',
      '--json',
    ]));
    expect(connect.exitCode).toBe(0);

    const firstOut = captureStream();
    const firstErr = captureStream();
    const first = await runCli(commonOpts(root, firstOut, firstErr, [
      'observe',
      '--since',
      'last',
      '--json',
    ]));
    expect(first.exitCode).toBe(0);
    const firstPayload = (JSON.parse(firstOut.read()) as { data: {
      source: string;
      cursor: string;
      observationCount: number;
      wroteObservation: boolean;
    } }).data;
    expect(firstPayload.source).toBe('agentdock-http');
    expect(firstPayload.cursor).toBe('2026-05-08T10:01:00.000Z');
    expect(firstPayload.observationCount).toBe(2);
    expect(firstPayload.wroteObservation).toBe(true);

    const secondOut = captureStream();
    const secondErr = captureStream();
    const second = await runCli(commonOpts(root, secondOut, secondErr, [
      'observe',
      '--since',
      'last',
      '--json',
    ]));
    expect(second.exitCode).toBe(0);
    const secondPayload = (JSON.parse(secondOut.read()) as { data: {
      since: string;
      observationCount: number;
      wroteObservation: boolean;
    } }).data;
    expect(secondPayload.since).toBe('2026-05-08T10:01:00.000Z');
    expect(secondPayload.observationCount).toBe(0);
    expect(secondPayload.wroteObservation).toBe(false);
    expect(readdirSync(join(root, 'evolution', 'observations'))).toHaveLength(1);
    expect(connectErr.read()).toBe('');
    expect(firstErr.read()).toBe('');
    expect(secondErr.read()).toBe('');
  });

  it('dedupes observations and cursor files per connection id without path collisions', async () => {
    const root = newHome('agentdock-observe-multi-connection');

    for (const connection of ['prod:us', 'prod-us']) {
      const stdout = captureStream();
      const stderr = captureStream();
      const result = await runCli(commonOpts(root, stdout, stderr, [
        'observe',
        '--source',
        'fake',
        '--connection',
        connection,
        '--since',
        'last',
        '--json',
      ]));
      expect(result.exitCode).toBe(0);
      const payload = (JSON.parse(stdout.read()) as { data: { observationCount: number; wroteObservation: boolean } }).data;
      expect(payload.observationCount).toBeGreaterThan(0);
      expect(payload.wroteObservation).toBe(true);
      expect(stderr.read()).toBe('');
    }

    expect(readdirSync(join(root, 'evolution', 'observations'))).toHaveLength(2);
    expect(readdirSync(join(root, 'evolution', 'cursors')).sort()).toEqual([
      `${Buffer.from('prod-us').toString('base64url')}.json`,
      `${Buffer.from('prod:us').toString('base64url')}.json`,
    ].sort());
  });

  it('fails fast with a friendly error when the connection file is invalid', async () => {
    const root = newHome('agentdock-invalid-connection');
    writeFileSync(join(root, 'agentdock-connections.json'), '{ broken json');
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'observe',
      '--since',
      'last',
      '--json',
    ]));

    expect(result.exitCode).toBe(1);
    expect(stdout.read()).toBe('');
    const error = JSON.parse(stderr.read()) as { ok: boolean; error: { message: string } };
    expect(error.ok).toBe(false);
    expect(error.error.message).toContain('Invalid AgentDock connections file');
  });

  it('rejects invalid saved authRef values before observation', async () => {
    const root = newHome('agentdock-invalid-authref');
    writeFileSync(join(root, 'agentdock-connections.json'), JSON.stringify({
      defaultConnectionId: 'agentdock-local',
      connections: {
        'agentdock-local': {
          id: 'agentdock-local',
          baseUrl: 'http://agentdock.local',
          authRef: 'plain-token',
          createdAt: '2026-05-08T12:00:00.000Z',
          updatedAt: '2026-05-08T12:00:00.000Z',
        },
      },
    }));
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'observe',
      '--json',
    ]));

    expect(result.exitCode).toBe(1);
    expect(stdout.read()).toBe('');
    const error = JSON.parse(stderr.read()) as { error: { message: string } };
    expect(error.error.message).toContain('authRef must be env:VARNAME');
  });

  it('rejects cursor files that belong to a different connection', async () => {
    const root = newHome('agentdock-invalid-cursor');
    const cursorDir = join(root, 'evolution', 'cursors');
    mkdirSync(cursorDir, { recursive: true });
    writeFileSync(join(cursorDir, `${Buffer.from('fake-agentdock').toString('base64url')}.json`), JSON.stringify({
      connectionId: 'other-agentdock',
      cursor: 'fake-cursor-001',
      updatedAt: '2026-05-08T12:00:00.000Z',
    }));
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'observe',
      '--source',
      'fake',
      '--connection',
      'fake-agentdock',
      '--json',
    ]));

    expect(result.exitCode).toBe(1);
    expect(stdout.read()).toBe('');
    const error = JSON.parse(stderr.read()) as { error: { message: string } };
    expect(error.error.message).toContain("does not match 'fake-agentdock'");
  });

  it('rejects concurrent observe for the same connection via a lock directory', async () => {
    const root = newHome('agentdock-observe-lock');
    const lockParent = join(root, 'evolution', 'locks');
    mkdirSync(lockParent, { recursive: true });
    mkdirSync(join(lockParent, `${Buffer.from('fake-agentdock').toString('base64url')}.lock`));
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'observe',
      '--source',
      'fake',
      '--connection',
      'fake-agentdock',
      '--json',
    ]));

    expect(result.exitCode).toBe(1);
    expect(stdout.read()).toBe('');
    const error = JSON.parse(stderr.read()) as { error: { message: string } };
    expect(error.error.message).toContain('already running');
  });
});
