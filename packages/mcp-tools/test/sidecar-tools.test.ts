import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AssetEventSchema,
  EvolutionProposalSchema,
  ObservationBatchSchema,
  ValidationReportSchema,
} from '@haro/agentdock-contract';
import {
  SidecarAssetManifestSchema,
  ToolInvocationAuditWriter,
  createSidecarAssetRegistry,
  createSidecarRegistry,
} from '../src/index.js';
import { McpServer } from '../src/server.js';
import { InMemoryTransport, type JsonRpcMessage } from '../src/transport.js';
import { setupEnv, type TestEnv } from './helpers.js';

const AGENTDOCK_ENV_KEYS = [
  'HARO_AGENTDOCK_BASE_URL',
  'HARO_AGENTDOCK_SOURCE',
  'HARO_AGENTDOCK_CONNECTION_ID',
  'HARO_AGENTDOCK_AUTH_HEADER',
] as const;

let env: TestEnv | null = null;
let previousFetch: typeof globalThis.fetch;
let previousAgentDockEnv: Record<(typeof AGENTDOCK_ENV_KEYS)[number], string | undefined>;

beforeEach(() => {
  previousFetch = globalThis.fetch;
  previousAgentDockEnv = Object.fromEntries(
    AGENTDOCK_ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof AGENTDOCK_ENV_KEYS)[number], string | undefined>;
  for (const key of AGENTDOCK_ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of AGENTDOCK_ENV_KEYS) {
    const value = previousAgentDockEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = previousFetch;
  env?.cleanup();
  env = null;
});

async function runSidecarWith(e: TestEnv, requests: JsonRpcMessage[]): Promise<JsonRpcMessage[]> {
  const transport = new InMemoryTransport();
  for (const req of requests) transport.push(req);
  const audit = new ToolInvocationAuditWriter({
    dbFile: e.dbFile,
    jsonlFile: join(e.root, 'logs', 'mcp-invocations.jsonl'),
    now: () => new Date('2026-05-08T06:00:00.000Z'),
  });
  const registry = createSidecarRegistry({
    audit,
    now: () => new Date('2026-05-08T06:00:00.000Z'),
  });
  const server = new McpServer({
    transport,
    registry,
    session: e.buildSession({ agentId: 'haro-sidecar' }),
    deps: { ...e.buildDeps(), memory: undefined },
  });
  const runPromise = server.run();
  const responses: JsonRpcMessage[] = [];
  for (let i = 0; i < requests.length; i += 1) {
    responses.push(...(await transport.drain()));
  }
  await server.stop();
  await runPromise;
  audit.close();
  return responses;
}

function callResult<T>(message: JsonRpcMessage): T {
  const response = message as {
    result: {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
      structuredContent: T;
    };
  };
  expect(response.result.isError).toBe(false);
  expect(response.result.content[0]).toMatchObject({ type: 'text' });
  expect(response.result.content[0]!.text).toBe(
    JSON.stringify(response.result.structuredContent, null, 2),
  );
  return response.result.structuredContent;
}

describe('AgentDock read-only sidecar MCP tools [FEAT-044]', () => {
  it('lists only the four read-only Haro sidecar tools', async () => {
    const e = (env = setupEnv());
    const responses = await runSidecarWith(e, [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);

    const r = responses[0]! as { result: { tools: Array<{ name: string }> } };
    const names = r.result.tools.map((tool) => tool.name).sort();
    expect(names).toEqual(['haro_asset_query', 'haro_observe', 'haro_propose', 'haro_validate']);
    expect(names).not.toContain('haro_apply');
    expect(names).not.toContain('haro_rollback');
    expect(names).not.toContain('memory_query');
    expect(names).not.toContain('send_message');
    expect(names).not.toContain('schedule_task');
  });

  it('observes fake AgentDock source and returns ObservationBatch contract payload', async () => {
    const e = (env = setupEnv());
    const responses = await runSidecarWith(e, [
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'haro_observe',
          arguments: { connectionId: 'fake-agentdock-test', limit: 1 },
        },
      },
    ]);

    const batch = ObservationBatchSchema.parse(callResult(responses[0]!));
    expect(batch.connectionId).toBe('fake-agentdock-test');
    expect(batch.sessions).toHaveLength(1);
    expect(batch.rawRefs).toEqual(['fake://agentdock/raw/session-001']);
  });

  it('uses AgentDock HTTP observation source when HARO_AGENTDOCK_BASE_URL is configured', async () => {
    const e = (env = setupEnv());
    process.env.HARO_AGENTDOCK_BASE_URL = 'http://agentdock.local';
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      const path = `${new URL(url).pathname}${new URL(url).search}`;
      const payloadByPath: Record<string, unknown> = {
        '/api/health': { status: 'healthy' },
        '/api/status': { activeRuntimes: 1, queueLength: 0, sessions: [] },
        '/api/sessions': {
          sessions: {
            'main:flow-1': {
              id: 'main:flow-1',
              backing_jid: 'feishu:oc_test',
              runner_id: 'codex',
              created_at: '2026-05-08T05:59:00.000Z',
            },
          },
        },
        '/api/sessions/main%3Aflow-1/messages?limit=1': {
          messages: [
            {
              id: 'm1',
              is_from_me: false,
              content: 'real AgentDock message',
              timestamp: '2026-05-08T05:59:30.000Z',
            },
          ],
        },
        '/api/sessions/main%3Aflow-1/turns?limit=1': { turns: [] },
        '/api/tasks': { tasks: [] },
      };
      const payload = payloadByPath[path];
      if (!payload) throw new Error(`unexpected path: ${path}`);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async json(): Promise<unknown> {
          return payload;
        },
      } as Response;
    }) as typeof fetch;

    const responses = await runSidecarWith(e, [
      {
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: {
          name: 'haro_observe',
          arguments: { limit: 1 },
        },
      },
    ]);

    const batch = ObservationBatchSchema.parse(callResult(responses[0]!));
    expect(batch.source).toBe('agentdock-http');
    expect(batch.connectionId).toBe('agentdock-local');
    expect(batch.sessions[0]?.id).toBe('main:flow-1');
    expect(batch.turns[0]?.contentExcerpt).toBe('real AgentDock message');
    expect(batch.rawRefs[0]).toBe('http://agentdock.local/api/health');
  });

  it('maps AgentDock HTTP source failures to classified MCP errors', async () => {
    const e = (env = setupEnv());
    process.env.HARO_AGENTDOCK_BASE_URL = 'http://agentdock.local';
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        async json(): Promise<unknown> {
          return { error: 'forbidden' };
        },
      }) as Response) as typeof fetch;

    const responses = await runSidecarWith(e, [
      {
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: { name: 'haro_observe', arguments: {} },
      },
    ]);
    const forbidden = responses[0]! as {
      result: {
        isError: boolean;
        error: { code: string; retryable: boolean; remediation: string };
        structuredContent: { error: { code: string } };
      };
    };
    expect(forbidden.result.isError).toBe(true);
    expect(forbidden.result.error.code).toBe('PERMISSION_DENIED');
    expect(forbidden.result.error.retryable).toBe(false);
    expect(forbidden.result.structuredContent.error.code).toBe('PERMISSION_DENIED');

    globalThis.fetch = (async () => {
      throw new Error('connection refused');
    }) as typeof fetch;

    const networkResponses = await runSidecarWith(e, [
      {
        jsonrpc: '2.0',
        id: 22,
        method: 'tools/call',
        params: { name: 'haro_observe', arguments: {} },
      },
    ]);
    const network = networkResponses[0]! as {
      result: { isError: boolean; error: { code: string; retryable: boolean } };
    };
    expect(network.result.isError).toBe(true);
    expect(network.result.error.code).toBe('INTERNAL_ERROR');
    expect(network.result.error.retryable).toBe(true);
  });

  it('generates dry-run proposal and validates without writing asset events', async () => {
    const e = (env = setupEnv());
    const beforeEvents = e.evolution.listEvents();
    const proposeResponses = await runSidecarWith(e, [
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'haro_propose',
          arguments: {
            mode: 'dry-run',
            observationRefs: [
              {
                id: 'obs-1',
                kind: 'observation-batch',
                uri: 'fake://agentdock/observation/obs-1',
              },
            ],
          },
        },
      },
    ]);
    const proposal = EvolutionProposalSchema.parse(callResult(proposeResponses[0]!));
    expect(proposal.status).toBe('dry-run');
    expect(proposal.targetKind).toBe('mcp-tool-config');

    const validateResponses = await runSidecarWith(e, [
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'haro_validate',
          arguments: { proposalId: proposal.id },
        },
      },
    ]);
    const report = ValidationReportSchema.parse(callResult(validateResponses[0]!));
    expect(report.proposalId).toBe(proposal.id);
    expect(report.applyEligible).toBe(false);
    expect(e.evolution.listEvents()).toEqual(beforeEvents);
  });

  it('writes sidecar asset manifests/events and queries them as AgentDock contract summaries', async () => {
    const e = (env = setupEnv());
    const registry = createSidecarAssetRegistry(e.root);
    registry.recordEvent(AssetEventSchema.parse({
      id: 'asset-event-frontier-source-proposed',
      assetId: 'frontier-source:openai-release-notes',
      kind: 'frontier-source-ref',
      version: '1',
      sourceRef: {
        id: 'frontier-signal-openai-release-notes',
        kind: 'frontier-signal',
        uri: 'haro-sidecar://frontier-signals/frontier-signal-openai-release-notes',
      },
      contentRef: {
        id: 'source-config-openai-release-notes',
        kind: 'frontier-source-ref',
        uri: 'https://openai.com/news/',
      },
      contentHash: 'sha256-frontier-source',
      status: 'proposed',
      eventType: 'proposed',
      actor: 'agent',
      createdAt: '2026-05-08T05:59:00.000Z',
    }));
    const recorded = registry.recordEvent(AssetEventSchema.parse({
      id: 'asset-event-frontier-source-1',
      assetId: 'frontier-source:openai-release-notes',
      kind: 'frontier-source-ref',
      version: '1',
      sourceRef: {
        id: 'frontier-signal-openai-release-notes',
        kind: 'frontier-signal',
        uri: 'haro-sidecar://frontier-signals/frontier-signal-openai-release-notes',
      },
      contentRef: {
        id: 'source-config-openai-release-notes',
        kind: 'frontier-source-ref',
        uri: 'https://openai.com/news/',
      },
      contentHash: 'sha256-frontier-source',
      status: 'validated',
      eventType: 'validated',
      actor: 'haro',
      proposalRef: {
        id: 'proposal-frontier-source',
        kind: 'evolution-proposal',
        uri: 'haro-sidecar://proposals/proposal-frontier-source',
      },
      validationRef: {
        id: 'validation-frontier-source',
        kind: 'validation-report',
        uri: 'haro-sidecar://validations/validation-frontier-source',
      },
      createdAt: '2026-05-08T06:00:00.000Z',
    }));
    registry.recordEvent(AssetEventSchema.parse({
      id: 'asset-event-skill-1',
      assetId: 'skill:unrelated',
      kind: 'skill',
      version: '1',
      sourceRef: { id: 'proposal-skill', kind: 'evolution-proposal' },
      contentRef: { id: 'skill-unrelated', kind: 'skill', uri: 'haro-sidecar://skills/unrelated' },
      contentHash: 'sha256-skill',
      status: 'proposed',
      eventType: 'proposed',
      actor: 'agent',
      createdAt: '2026-05-08T05:59:00.000Z',
    }));

    expect(existsSync(recorded.eventPath)).toBe(true);
    expect(existsSync(recorded.manifestPath)).toBe(true);
    const manifest = SidecarAssetManifestSchema.parse(
      JSON.parse(readFileSync(recorded.manifestPath, 'utf8')),
    );
    expect(manifest.id).toBe('frontier-source:openai-release-notes');
    expect(manifest.status).toBe('validated');
    expect(manifest.latestEventRef.id).toBe('asset-event-frontier-source-1');

    const responses = await runSidecarWith(e, [
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'haro_asset_query',
          arguments: { kind: 'frontier-source-ref', status: 'validated', query: 'openai' },
        },
      },
    ]);
    const payload = callResult<{ assets: unknown[]; count: number }>(responses[0]!);
    expect(payload.count).toBe(1);
    const event = AssetEventSchema.parse(payload.assets[0]);
    expect(event.assetId).toBe('frontier-source:openai-release-notes');
    expect(event.kind).toBe('frontier-source-ref');
    expect(event.status).toBe('validated');

    const allFrontierResponses = await runSidecarWith(e, [
      {
        jsonrpc: '2.0',
        id: 50,
        method: 'tools/call',
        params: {
          name: 'haro_asset_query',
          arguments: { kind: 'frontier-source-ref', query: 'openai' },
        },
      },
    ]);
    const allFrontierPayload = callResult<{ assets: unknown[]; count: number }>(allFrontierResponses[0]!);
    expect(allFrontierPayload.count).toBe(1);
    expect(AssetEventSchema.parse(allFrontierPayload.assets[0]).status).toBe('validated');

    e.evolution.recordEvent({
      type: 'proposed',
      actor: 'agent',
      asset: {
        id: 'mcp:legacy-core-sidecar',
        kind: 'mcp',
        name: 'legacy-core-sidecar',
        sourceRef: 'legacy-core-registry',
        contentRef: 'haro-sidecar://mcp/legacy-core-sidecar',
        contentHash: 'sha256-legacy-core',
        createdBy: 'agent',
      },
    });
    const legacyResponses = await runSidecarWith(e, [
      {
        jsonrpc: '2.0',
        id: 51,
        method: 'tools/call',
        params: {
          name: 'haro_asset_query',
          arguments: { kind: 'mcp-tool-config', query: 'legacy-core-sidecar' },
        },
      },
    ]);
    expect(callResult<{ assets: unknown[]; count: number }>(legacyResponses[0]!).count).toBe(0);
  });

  it('audits failed calls to JSONL with hashed params', async () => {
    const e = (env = setupEnv());
    const responses = await runSidecarWith(e, [
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'haro_propose',
          arguments: { mode: 'apply' },
        },
      },
    ]);
    const r = responses[0]! as {
      result: {
        content: Array<{ type: string; text: string }>;
        isError: boolean;
        structuredContent: { error: { code: string } };
        error: { code: string };
      };
    };
    expect(r.result.isError).toBe(true);
    expect(r.result.error.code).toBe('INVALID_PARAMS');
    expect(r.result.structuredContent.error.code).toBe('INVALID_PARAMS');
    expect(r.result.content[0]!.text).toContain('INVALID_PARAMS');

    const jsonl = join(e.root, 'logs', 'mcp-invocations.jsonl');
    expect(existsSync(jsonl)).toBe(true);
    const line = readFileSync(jsonl, 'utf8').trim();
    expect(line).not.toContain('apply');
    const record = JSON.parse(line) as {
      toolName: string;
      paramsHash: string;
      resultStatus: string;
      errorCode: string;
    };
    expect(record.toolName).toBe('haro_propose');
    expect(record.paramsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.resultStatus).toBe('error');
    expect(record.errorCode).toBe('INVALID_PARAMS');
  });
});
