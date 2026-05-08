import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AssetEventSchema,
  EvolutionProposalSchema,
  ObservationBatchSchema,
  ValidationReportSchema,
} from '@haro/agentdock-contract';
import { ToolInvocationAuditWriter, createSidecarRegistry } from '../src/index.js';
import { McpServer } from '../src/server.js';
import { InMemoryTransport, type JsonRpcMessage } from '../src/transport.js';
import { setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv | null = null;
afterEach(() => {
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
    deps: e.buildDeps(),
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
  const response = message as { result: { isError: boolean; content: T } };
  expect(response.result.isError).toBe(false);
  return response.result.content;
}

describe('AgentDock read-only sidecar MCP tools [FEAT-044]', () => {
  it('lists only the four read-only Haro sidecar tools', async () => {
    const e = (env = setupEnv());
    const responses = await runSidecarWith(e, [
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    ]);

    const r = responses[0]! as { result: { tools: Array<{ name: string }> } };
    const names = r.result.tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      'haro_asset_query',
      'haro_observe',
      'haro_propose',
      'haro_validate',
    ]);
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

  it('queries assets as AgentDock contract AssetEvent summaries', async () => {
    const e = (env = setupEnv());
    e.evolution.recordEvent({
      type: 'proposed',
      actor: 'agent',
      asset: {
        id: 'mcp:haro-sidecar',
        kind: 'mcp',
        name: 'haro-sidecar',
        sourceRef: 'specs/sidecar/FEAT-044-read-only-mcp-sidecar.md',
        contentRef: 'haro-sidecar://mcp/haro',
        contentHash: 'sha256-sidecar',
        createdBy: 'agent',
      },
    });

    const responses = await runSidecarWith(e, [
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'haro_asset_query',
          arguments: { kind: 'mcp-tool-config', query: 'sidecar' },
        },
      },
    ]);
    const payload = callResult<{ assets: unknown[]; count: number }>(responses[0]!);
    expect(payload.count).toBe(1);
    const event = AssetEventSchema.parse(payload.assets[0]);
    expect(event.assetId).toBe('mcp:haro-sidecar');
    expect(event.kind).toBe('mcp-tool-config');
    expect(event.status).toBe('proposed');
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
    const r = responses[0]! as { result: { isError: boolean; error: { code: string } } };
    expect(r.result.isError).toBe(true);
    expect(r.result.error.code).toBe('INVALID_PARAMS');

    const jsonl = join(e.root, 'logs', 'mcp-invocations.jsonl');
    expect(existsSync(jsonl)).toBe(true);
    const line = readFileSync(jsonl, 'utf8').trim();
    expect(line).not.toContain('apply');
    const record = JSON.parse(line) as { toolName: string; paramsHash: string; resultStatus: string; errorCode: string };
    expect(record.toolName).toBe('haro_propose');
    expect(record.paramsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.resultStatus).toBe('error');
    expect(record.errorCode).toBe('INVALID_PARAMS');
  });
});
