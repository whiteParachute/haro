import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApplicationRecordSchema,
  ApprovalDecisionRecordSchema,
  ApprovalRequestRecordSchema,
  AssetSnapshotRecordSchema,
  AssetEventSchema,
  PatchBranchPlanRecordSchema,
  RollbackRecordSchema,
  type ApplicationRecord,
  type ApprovalDecisionRecord,
  type ApprovalRequestRecord,
  type AssetSnapshotRecord,
  type AssetEvent,
  type PatchBranchPlanRecord,
  type RollbackRecord,
} from '@haro/agentdock-contract';
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

function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function humanApprovalRef(id = 'approval-human-review-001') {
  return {
    id,
    kind: 'human-approval',
    uri: `agentdock://approvals/${id}`,
  };
}

function approvedProposalFields(id?: string) {
  return {
    humanReviewRequired: true,
    humanApprovalRefs: [humanApprovalRef(id)],
  };
}

function readAssetEvents(root: string): AssetEvent[] {
  const dir = join(root, 'assets', 'events');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => AssetEventSchema.parse(readJson(join(dir, name))));
}

function readAssetManifests(root: string): Array<{
  id: string;
  status: string;
  contentHash: string;
  latestEventRef: { id: string };
}> {
  const dir = join(root, 'assets', 'manifests');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readJson<{
      id: string;
      status: string;
      contentHash: string;
      latestEventRef: { id: string };
    }>(join(dir, name)));
}

function readApplicationRecords(root: string): ApplicationRecord[] {
  const dir = join(root, 'evolution', 'applications');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ApplicationRecordSchema.parse(readJson(join(dir, name))));
}

function readApprovalRequestRecords(root: string): ApprovalRequestRecord[] {
  const dir = join(root, 'evolution', 'approval-requests');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ApprovalRequestRecordSchema.parse(readJson(join(dir, name))));
}

function writeApprovalDecisionRecord(root: string, record: ApprovalDecisionRecord): void {
  const dir = join(root, 'evolution', 'approval-decisions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${record.id}.json`),
    `${JSON.stringify(ApprovalDecisionRecordSchema.parse(record), null, 2)}\n`,
  );
}

function writeValidatedMcpToolConfigProposal(root: string, proposalId: string, validationId: string): void {
  const proposalDir = join(root, 'evolution', 'proposals');
  const validationDir = join(root, 'evolution', 'validations');
  mkdirSync(proposalDir, { recursive: true });
  mkdirSync(validationDir, { recursive: true });
  writeFileSync(join(proposalDir, `${proposalId}.json`), `${JSON.stringify({
    id: proposalId,
    title: `Review ${proposalId}`,
    status: 'validated',
    level: 'L0',
    targetKind: 'mcp-tool-config',
    riskLevel: 'low',
    sourceObservationRefs: [{ id: `obs_${proposalId}`, kind: 'observation-batch' }],
    changeSet: [
      {
        op: 'update',
        targetRef: { id: 'tools/review.json', kind: 'mcp-tool-config' },
        contentRef: `haro-sidecar://proposals/${proposalId}/content/tools-review.json`,
        contentHash: sha256(`${proposalId}:content`),
        summary: 'Update sidecar MCP tool review config.',
      },
    ],
    testPlan: {
      requiredCommands: ['git diff --check'],
      manualChecks: ['Human reviewer confirms approval decision.'],
      regressionRisks: ['Decision artifacts may be ignored by apply gate.'],
    },
    rollbackPlan: {
      strategy: 'Restore previous tool config content.',
      snapshotRequired: false,
      rollbackRefs: [],
    },
    humanReviewRequired: true,
    humanApprovalRefs: [],
    createdAt: '2026-05-08T12:00:00.000Z',
    updatedAt: '2026-05-08T12:00:00.000Z',
  }, null, 2)}\n`);
  writeFileSync(join(validationDir, `${validationId}.json`), `${JSON.stringify({
    id: validationId,
    proposalId,
    riskVerdict: 'low',
    requiredTests: ['git diff --check'],
    rollbackReady: true,
    applyEligible: true,
    blockingReasons: [],
    evidenceRefs: [{ id: proposalId, kind: 'evolution-proposal' }],
    createdAt: '2026-05-08T12:01:00.000Z',
  }, null, 2)}\n`);
}

function readPatchBranchPlanRecords(root: string): PatchBranchPlanRecord[] {
  const dir = join(root, 'evolution', 'patch-branches');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => PatchBranchPlanRecordSchema.parse(readJson(join(dir, name))));
}

function readSnapshotRecords(root: string): AssetSnapshotRecord[] {
  const dir = join(root, 'evolution', 'snapshots');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => AssetSnapshotRecordSchema.parse(readJson(join(dir, name))));
}

function readRollbackRecords(root: string): RollbackRecord[] {
  const dir = join(root, 'evolution', 'rollbacks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => RollbackRecordSchema.parse(readJson(join(dir, name))));
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

  function frontierSignal(id = 'frontier-signal-001', overrides: Record<string, unknown> = {}) {
    return {
      id,
      sourceType: 'official-doc',
      sourceRef: {
        id: 'mcp-changelog-2026-05-08',
        kind: 'official-doc',
        uri: 'https://modelcontextprotocol.io/changelog',
      },
      title: 'MCP tool capability update',
      publishedAt: '2026-05-08T10:00:00.000Z',
      collectedAt: '2026-05-08T12:00:00.000Z',
      summary: 'A curated frontier signal relevant to Haro sidecar MCP tool configuration.',
      claims: ['Tool metadata can improve agent orchestration safety.'],
      targetDomains: ['mcp-tools', 'haro-sidecar'],
      confidence: 'high',
      rawRef: {
        id: 'mcp-changelog-html',
        kind: 'html',
        uri: 'https://modelcontextprotocol.io/changelog',
      },
      status: 'active',
      ...overrides,
    };
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
      assetEventCount: number;
      assetEventIds: string[];
      proposalId: string;
      proposalPath: string;
      proposal: {
        status: string;
        targetKind: string;
        humanReviewRequired: boolean;
        humanApprovalRefs: Array<{ id: string; kind: string }>;
        sourceObservationRefs: Array<{ id: string; kind: string }>;
        changeSet: Array<{ targetRef: { id: string }; contentHash?: string }>;
      };
    } }).data;
    expect(payload.proposalCount).toBe(1);
    expect(payload.consumedObservationCount).toBe(1);
    expect(payload.pendingObservationCount).toBe(0);
    expect(payload.wroteProposal).toBe(true);
    expect(payload.assetEventCount).toBe(1);
    expect(payload.assetEventIds).toHaveLength(1);
    expect(payload.proposal.status).toBe('dry-run');
    expect(payload.proposal.humanReviewRequired).toBe(true);
    expect(payload.proposal.humanApprovalRefs).toEqual([]);
    expect(payload.proposal.sourceObservationRefs).toEqual([
      { id: observePayload.batchId, kind: 'observation-batch', uri: `haro-sidecar://observations/${encodeURIComponent(observePayload.batchId)}` },
    ]);
    expect(existsSync(payload.proposalPath)).toBe(true);
    expect(readdirSync(join(root, 'evolution', 'proposals'))).toHaveLength(1);
    const proposedEvents = readAssetEvents(root);
    expect(proposedEvents).toHaveLength(1);
    expect(proposedEvents[0]).toMatchObject({
      id: payload.assetEventIds[0],
      assetId: payload.proposal.changeSet[0]?.targetRef.id,
      kind: payload.proposal.targetKind,
      status: 'proposed',
      eventType: 'proposed',
      actor: 'haro',
      proposalRef: { id: payload.proposalId, kind: 'evolution-proposal' },
    });
    expect(proposedEvents[0]?.validationRef).toBeUndefined();
    expect(readAssetManifests(root)).toEqual([
      expect.objectContaining({
        id: payload.proposal.changeSet[0]?.targetRef.id,
        status: 'proposed',
        latestEventRef: expect.objectContaining({ id: payload.assetEventIds[0] }),
      }),
    ]);
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
      assetEventCount: number;
    } }).data;
    expect(repeatPayload.proposalCount).toBe(0);
    expect(repeatPayload.consumedObservationCount).toBe(0);
    expect(repeatPayload.wroteProposal).toBe(false);
    expect(repeatPayload.assetEventCount).toBe(0);
    expect(readdirSync(join(root, 'evolution', 'proposals'))).toHaveLength(1);
    expect(readAssetEvents(root)).toHaveLength(1);
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

  it('propose --auto-dry-run --include-frontier cites active frontier signals only', async () => {
    const root = newHome('agentdock-propose-frontier');
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

    const frontierDir = join(root, 'evolution', 'frontier-signals');
    mkdirSync(frontierDir, { recursive: true });
    writeFileSync(join(frontierDir, 'active.json'), `${JSON.stringify(frontierSignal(), null, 2)}\n`);
    writeFileSync(join(frontierDir, 'rejected.json'), `${JSON.stringify(frontierSignal('frontier-signal-rejected', {
      sourceRef: { id: 'rejected-source', kind: 'blog-post', uri: 'https://example.com/rejected' },
      sourceType: 'blog-post',
      status: 'rejected',
    }), null, 2)}\n`);
    writeFileSync(join(frontierDir, 'superseded.json'), `${JSON.stringify(frontierSignal('frontier-signal-superseded', {
      sourceRef: { id: 'superseded-source', kind: 'paper', uri: 'https://example.com/superseded' },
      sourceType: 'paper',
      status: 'superseded',
    }), null, 2)}\n`);

    const proposeOut = captureStream();
    const proposeErr = captureStream();
    const propose = await runCli(commonOpts(root, proposeOut, proposeErr, [
      'propose',
      '--auto-dry-run',
      '--include-frontier',
      '--json',
    ]));

    expect(propose.exitCode).toBe(0);
    expect(proposeErr.read()).toBe('');
    const payload = (JSON.parse(proposeOut.read()) as { data: {
      includeFrontier: boolean;
      proposalCount: number;
      consumedObservationCount: number;
      includedFrontierSignalCount: number;
      availableFrontierSignalCount: number;
      skippedCorruptFrontierSignalCount: number;
      proposal: {
        title: string;
        sourceObservationRefs: Array<{ id: string; kind: string; uri?: string }>;
        changeSet: Array<{ summary: string }>;
        testPlan: { manualChecks: string[]; regressionRisks: string[] };
      };
    } }).data;
    expect(payload.includeFrontier).toBe(true);
    expect(payload.proposalCount).toBe(1);
    expect(payload.consumedObservationCount).toBe(1);
    expect(payload.includedFrontierSignalCount).toBe(1);
    expect(payload.availableFrontierSignalCount).toBe(1);
    expect(payload.skippedCorruptFrontierSignalCount).toBe(0);
    expect(payload.proposal.title).toContain('1 条前沿信号');
    expect(payload.proposal.sourceObservationRefs).toContainEqual({
      id: observePayload.batchId,
      kind: 'observation-batch',
      uri: `haro-sidecar://observations/${encodeURIComponent(observePayload.batchId)}`,
    });
    expect(payload.proposal.sourceObservationRefs).toContainEqual({
      id: 'frontier-signal-001',
      kind: 'frontier-signal',
      uri: 'haro-sidecar://frontier-signals/frontier-signal-001',
    });
    expect(payload.proposal.sourceObservationRefs.some((ref) => ref.id === 'frontier-signal-rejected')).toBe(false);
    expect(payload.proposal.sourceObservationRefs.some((ref) => ref.id === 'frontier-signal-superseded')).toBe(false);
    expect(payload.proposal.changeSet[0]?.summary).toContain('前沿信号=1');
    expect(payload.proposal.testPlan.manualChecks).toContain('信任外部证据前，必须复核引用的 frontier-signal source refs。');
    expect(payload.proposal.testPlan.regressionRisks.join('\n')).toContain('外部 frontier signals 可能过期');
    expect(observeErr.read()).toBe('');
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('propose --auto-dry-run --include-frontier reports corrupt frontier signals', async () => {
    const root = newHome('agentdock-propose-frontier-corrupt');
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

    const frontierDir = join(root, 'evolution', 'frontier-signals');
    mkdirSync(frontierDir, { recursive: true });
    writeFileSync(join(frontierDir, 'broken.json'), '{ broken json');
    const proposeOut = captureStream();
    const proposeErr = captureStream();
    const propose = await runCli(commonOpts(root, proposeOut, proposeErr, [
      'propose',
      '--auto-dry-run',
      '--include-frontier',
      '--json',
    ]));

    expect(propose.exitCode).toBe(0);
    expect(proposeErr.read()).toContain('skipped 1 corrupt frontier signal');
    const payload = (JSON.parse(proposeOut.read()) as { data: {
      proposalCount: number;
      includedFrontierSignalCount: number;
      skippedCorruptFrontierSignalCount: number;
    } }).data;
    expect(payload.proposalCount).toBe(1);
    expect(payload.includedFrontierSignalCount).toBe(0);
    expect(payload.skippedCorruptFrontierSignalCount).toBe(1);
    expect(observeErr.read()).toBe('');
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('validate --pending writes validation reports for pending proposals and is idempotent', async () => {
    const root = newHome('agentdock-validate');
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
    const proposalPayload = (JSON.parse(proposeOut.read()) as { data: { proposalId: string } }).data;
    expect(readAssetEvents(root).filter((event) => event.status === 'proposed')).toHaveLength(1);

    const validateOut = captureStream();
    const validateErr = captureStream();
    const validate = await runCli(commonOpts(root, validateOut, validateErr, [
      'validate',
      '--pending',
      '--json',
    ]));

    expect(validate.exitCode).toBe(0);
    expect(validate.action).toBe('validate');
    expect(validateErr.read()).toBe('');
    const payload = (JSON.parse(validateOut.read()) as { data: {
      validationCount: number;
      validatedProposalCount: number;
      pendingProposalCount: number;
      wroteValidations: boolean;
      assetEventCount: number;
      assetEventIds: string[];
      validationIds: string[];
      validationPaths: string[];
      validations: Array<{
        proposalId: string;
        riskVerdict: string;
        rollbackReady: boolean;
        applyEligible: boolean;
        blockingReasons: string[];
        evidenceRefs: Array<{ id: string; kind: string }>;
      }>;
    } }).data;
    expect(payload.validationCount).toBe(1);
    expect(payload.validatedProposalCount).toBe(1);
    expect(payload.pendingProposalCount).toBe(0);
    expect(payload.wroteValidations).toBe(true);
    expect(payload.assetEventCount).toBe(1);
    expect(payload.assetEventIds).toHaveLength(1);
    expect(payload.validations[0]).toMatchObject({
      proposalId: proposalPayload.proposalId,
      riskVerdict: 'medium',
      rollbackReady: true,
      applyEligible: false,
    });
    expect(payload.validations[0]?.blockingReasons[0]).toContain('FEAT-045');
    expect(payload.validations[0]?.evidenceRefs[0]).toMatchObject({
      id: proposalPayload.proposalId,
      kind: 'evolution-proposal',
    });
    expect(existsSync(payload.validationPaths[0]!)).toBe(true);
    expect(readdirSync(join(root, 'evolution', 'validations'))).toHaveLength(1);
    const assetEvents = readAssetEvents(root);
    expect(assetEvents).toHaveLength(2);
    const validatedEvent = assetEvents.find((event) => event.status === 'validated');
    expect(validatedEvent).toMatchObject({
      id: payload.assetEventIds[0],
      eventType: 'validated',
      proposalRef: { id: proposalPayload.proposalId, kind: 'evolution-proposal' },
      validationRef: { id: payload.validationIds[0], kind: 'validation-report' },
    });
    expect(readAssetManifests(root)).toEqual([
      expect.objectContaining({
        id: validatedEvent?.assetId,
        status: 'validated',
        latestEventRef: expect.objectContaining({ id: payload.assetEventIds[0] }),
      }),
    ]);
    expect(existsSync(join(root, 'memory'))).toBe(false);

    const repeatOut = captureStream();
    const repeatErr = captureStream();
    const repeat = await runCli(commonOpts(root, repeatOut, repeatErr, [
      'validate',
      '--pending',
      '--json',
    ]));
    expect(repeat.exitCode).toBe(0);
    expect(repeatErr.read()).toBe('');
    const repeatPayload = (JSON.parse(repeatOut.read()) as { data: {
      validationCount: number;
      validatedProposalCount: number;
      wroteValidations: boolean;
      assetEventCount: number;
    } }).data;
    expect(repeatPayload.validationCount).toBe(0);
    expect(repeatPayload.validatedProposalCount).toBe(0);
    expect(repeatPayload.wroteValidations).toBe(false);
    expect(repeatPayload.assetEventCount).toBe(0);
    expect(readdirSync(join(root, 'evolution', 'validations'))).toHaveLength(1);
    expect(readAssetEvents(root)).toHaveLength(2);
    expect(observeErr.read()).toBe('');
    expect(proposeErr.read()).toBe('');
  });

  it('approval-request --pending writes human-review artifacts with why how and benefits', async () => {
    const root = newHome('agentdock-approval-request');
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
    const proposalPayload = (JSON.parse(proposeOut.read()) as { data: { proposalId: string } }).data;

    const validateOut = captureStream();
    const validateErr = captureStream();
    const validate = await runCli(commonOpts(root, validateOut, validateErr, [
      'validate',
      '--pending',
      '--json',
    ]));
    expect(validate.exitCode).toBe(0);
    const validationPayload = (JSON.parse(validateOut.read()) as { data: { validationIds: string[] } }).data;

    const approvalOut = captureStream();
    const approvalErr = captureStream();
    const approval = await runCli(commonOpts(root, approvalOut, approvalErr, [
      'approval-request',
      '--pending',
      '--json',
    ]));

    expect(approval.exitCode).toBe(0);
    expect(approval.action).toBe('approval-request');
    expect(approvalErr.read()).toBe('');
    const payload = (JSON.parse(approvalOut.read()) as { data: {
      approvalRequestCount: number;
      requestedProposalCount: number;
      pendingProposalCount: number;
      wroteApprovalRequests: boolean;
      approvalRequestIds: string[];
      approvalRequestPaths: string[];
      approvalRequests: Array<{
        proposalId: string;
        validationId: string;
        whyChange: string[];
        howChange: string[];
        expectedBenefits: string[];
        decisionOptions: string[];
        humanReviewRequired: boolean;
      }>;
    } }).data;
    expect(payload.approvalRequestCount).toBe(1);
    expect(payload.requestedProposalCount).toBe(1);
    expect(payload.pendingProposalCount).toBe(0);
    expect(payload.wroteApprovalRequests).toBe(true);
    expect(payload.approvalRequestIds).toHaveLength(1);
    expect(existsSync(payload.approvalRequestPaths[0]!)).toBe(true);
    expect(payload.approvalRequests[0]).toMatchObject({
      proposalId: proposalPayload.proposalId,
      validationId: validationPayload.validationIds[0],
      humanReviewRequired: true,
      decisionOptions: ['approve', 'reject', 'request-changes'],
    });
    expect(payload.approvalRequests[0]?.whyChange.join('\n')).toContain('提案基于');
    expect(payload.approvalRequests[0]?.howChange[0]).toContain('更新');
    expect(payload.approvalRequests[0]?.expectedBenefits.join('\n')).toContain('可审查');
    expect(readApprovalRequestRecords(root)).toHaveLength(1);
    expect(existsSync(join(root, 'memory'))).toBe(false);

    const repeatOut = captureStream();
    const repeatErr = captureStream();
    const repeat = await runCli(commonOpts(root, repeatOut, repeatErr, [
      'approval-request',
      '--pending',
      '--json',
    ]));
    expect(repeat.exitCode).toBe(0);
    expect(repeatErr.read()).toBe('');
    const repeatPayload = (JSON.parse(repeatOut.read()) as { data: {
      approvalRequestCount: number;
      requestedProposalCount: number;
      wroteApprovalRequests: boolean;
    } }).data;
    expect(repeatPayload.approvalRequestCount).toBe(0);
    expect(repeatPayload.requestedProposalCount).toBe(0);
    expect(repeatPayload.wroteApprovalRequests).toBe(false);
    expect(readApprovalRequestRecords(root)).toHaveLength(1);
    expect(observeErr.read()).toBe('');
    expect(proposeErr.read()).toBe('');
    expect(validateErr.read()).toBe('');
  });

  it('approval-request --pending skips proposals that already have a decision artifact', async () => {
    const root = newHome('agentdock-approval-request-decided');
    writeValidatedMcpToolConfigProposal(root, 'proposal_already_decided', 'validation_already_decided');
    writeApprovalDecisionRecord(root, {
      id: 'approval_decision_existing',
      approvalRequestId: 'approval_request_existing',
      proposalId: 'proposal_already_decided',
      validationId: 'validation_already_decided',
      decision: 'request-changes',
      direction: 'Rework this into a narrower proposal first.',
      reviewer: {
        source: 'agentdock',
        username: 'reviewer',
        role: 'owner',
      },
      sourceRef: {
        id: 'approval_request_existing',
        kind: 'approval-request',
      },
      createdAt: '2026-05-08T12:02:00.000Z',
      updatedAt: '2026-05-08T12:02:00.000Z',
    });
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'approval-request',
      '--pending',
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      approvalRequestCount: number;
      requestedProposalCount: number;
      skippedCorruptApprovalDecisionCount: number;
      wroteApprovalRequests: boolean;
    } }).data;
    expect(payload.approvalRequestCount).toBe(0);
    expect(payload.requestedProposalCount).toBe(0);
    expect(payload.skippedCorruptApprovalDecisionCount).toBe(0);
    expect(payload.wroteApprovalRequests).toBe(false);
    expect(readApprovalRequestRecords(root)).toHaveLength(0);
  });

  it('validate --pending --limit only validates the selected pending proposal count', async () => {
    const root = newHome('agentdock-validate-limit');
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
    const proposalPayload = (JSON.parse(proposeOut.read()) as { data: {
      proposalPath: string;
      proposal: Record<string, unknown>;
    } }).data;
    const secondProposal = {
      ...proposalPayload.proposal,
      id: 'proposal_zzzz_limit_fixture',
      title: 'Second pending proposal for limit coverage',
      updatedAt: '2026-05-08T12:01:00.000Z',
    };
    writeFileSync(
      join(root, 'evolution', 'proposals', 'proposal_zzzz_limit_fixture.json'),
      `${JSON.stringify(secondProposal, null, 2)}\n`,
    );

    const validateOut = captureStream();
    const validateErr = captureStream();
    const validate = await runCli(commonOpts(root, validateOut, validateErr, [
      'validate',
      '--pending',
      '--limit',
      '1',
      '--json',
    ]));

    expect(validate.exitCode).toBe(0);
    expect(validateErr.read()).toBe('');
    const payload = (JSON.parse(validateOut.read()) as { data: {
      validationCount: number;
      validatedProposalCount: number;
      pendingProposalCount: number;
      validations: Array<{ proposalId: string }>;
    } }).data;
    expect(payload.validationCount).toBe(1);
    expect(payload.validatedProposalCount).toBe(1);
    expect(payload.pendingProposalCount).toBe(1);
    expect(payload.validations[0]?.proposalId).not.toBe('proposal_zzzz_limit_fixture');

    const remainingOut = captureStream();
    const remainingErr = captureStream();
    const remaining = await runCli(commonOpts(root, remainingOut, remainingErr, [
      'validate',
      '--pending',
      '--json',
    ]));
    expect(remaining.exitCode).toBe(0);
    expect(remainingErr.read()).toBe('');
    const remainingPayload = (JSON.parse(remainingOut.read()) as { data: {
      validationCount: number;
      pendingProposalCount: number;
      validations: Array<{ proposalId: string }>;
    } }).data;
    expect(remainingPayload.validationCount).toBe(1);
    expect(remainingPayload.pendingProposalCount).toBe(0);
    expect(remainingPayload.validations[0]?.proposalId).toBe('proposal_zzzz_limit_fixture');
    expect(readdirSync(join(root, 'evolution', 'validations'))).toHaveLength(2);
    expect(observeErr.read()).toBe('');
    expect(proposeErr.read()).toBe('');
  });

  it('validate --pending reports corrupt validations and repairs deterministic validation files', async () => {
    const root = newHome('agentdock-validate-repair-corrupt');
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

    const firstValidateOut = captureStream();
    const firstValidateErr = captureStream();
    const firstValidate = await runCli(commonOpts(root, firstValidateOut, firstValidateErr, [
      'validate',
      '--pending',
      '--json',
    ]));
    expect(firstValidate.exitCode).toBe(0);
    const firstPayload = (JSON.parse(firstValidateOut.read()) as { data: {
      validationIds: string[];
      validationPaths: string[];
    } }).data;
    writeFileSync(firstPayload.validationPaths[0]!, '{}\n');

    const repairOut = captureStream();
    const repairErr = captureStream();
    const repair = await runCli(commonOpts(root, repairOut, repairErr, [
      'validate',
      '--pending',
      '--json',
    ]));

    expect(repair.exitCode).toBe(0);
    expect(repairErr.read()).toContain('skipped 1 corrupt AgentDock validation');
    const repairPayload = (JSON.parse(repairOut.read()) as { data: {
      validationCount: number;
      wroteValidations: boolean;
      skippedCorruptValidationCount: number;
      validationIds: string[];
      validations: Array<{ id: string; proposalId: string }>;
    } }).data;
    expect(repairPayload.validationCount).toBe(1);
    expect(repairPayload.wroteValidations).toBe(true);
    expect(repairPayload.skippedCorruptValidationCount).toBe(1);
    expect(repairPayload.validationIds[0]).toBe(firstPayload.validationIds[0]);
    expect(repairPayload.validations[0]?.proposalId).toBeDefined();
    const repairedFile = JSON.parse(readFileSync(firstPayload.validationPaths[0]!, 'utf8')) as {
      id: string;
      proposalId: string;
    };
    expect(repairedFile.id).toBe(firstPayload.validationIds[0]);
    expect(repairedFile.proposalId).toBe(repairPayload.validations[0]?.proposalId);
    expect(observeErr.read()).toBe('');
    expect(proposeErr.read()).toBe('');
    expect(firstValidateErr.read()).toBe('');
  });

  it('validate --pending reports corrupt proposal files without silently ignoring them', async () => {
    const root = newHome('agentdock-validate-corrupt-proposal');
    const proposalDir = join(root, 'evolution', 'proposals');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'broken.json'), '{ broken json');
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'validate',
      '--pending',
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toContain('skipped 1 corrupt AgentDock proposal');
    const payload = (JSON.parse(stdout.read()) as { data: {
      validationCount: number;
      wroteValidations: boolean;
      skippedCorruptProposalCount: number;
    } }).data;
    expect(payload.validationCount).toBe(0);
    expect(payload.wroteValidations).toBe(false);
    expect(payload.skippedCorruptProposalCount).toBe(1);
  });

  it('apply --proposal-id blocks unvalidated proposals without writing application records', async () => {
    const root = newHome('agentdock-apply-unvalidated');
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
    const proposalPayload = (JSON.parse(proposeOut.read()) as { data: { proposalId: string } }).data;

    const applyOut = captureStream();
    const applyErr = captureStream();
    const apply = await runCli(commonOpts(root, applyOut, applyErr, [
      'apply',
      '--proposal-id',
      proposalPayload.proposalId,
      '--json',
    ]));

    expect(apply.exitCode).toBe(0);
    expect(apply.action).toBe('apply');
    expect(applyErr.read()).toBe('');
    const payload = (JSON.parse(applyOut.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      gatePassed: boolean;
      applied: boolean;
      applicationRecordCount: number;
      blockingReasons: string[];
    } }).data;
    expect(payload).toMatchObject({
      gateStatus: 'blocked',
      gateCode: 'VALIDATION_REQUIRED',
      gatePassed: false,
      applied: false,
      applicationRecordCount: 0,
    });
    expect(payload.blockingReasons.join('\n')).toContain('No validation report');
    expect(readApplicationRecords(root)).toHaveLength(0);
    expect(existsSync(join(root, 'memory'))).toBe(false);
    expect(observeErr.read()).toBe('');
    expect(proposeErr.read()).toBe('');
  });

  it('apply --proposal-id refuses L2/L3 proposals before validation lookup', async () => {
    const root = newHome('agentdock-apply-l2');
    const proposalDir = join(root, 'evolution', 'proposals');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal_l2_fixture.json'), `${JSON.stringify({
      id: 'proposal_l2_fixture',
      title: 'Code change that must use patch branch',
      status: 'validated',
      level: 'L2',
      targetKind: 'haro-code',
      riskLevel: 'medium',
      sourceObservationRefs: [{ id: 'obs-001', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'update',
          targetRef: { id: 'packages/cli/src/index.ts', kind: 'haro-code' },
          contentRef: 'haro-sidecar://proposals/proposal_l2_fixture/patch',
          contentHash: 'sha256:l2',
          summary: 'Modify Haro code directly',
        },
      ],
      testPlan: {
        requiredCommands: ['pnpm test'],
        manualChecks: [],
        regressionRisks: ['runtime regression'],
      },
      rollbackPlan: {
        strategy: 'revert patch branch',
        snapshotRequired: true,
        rollbackRefs: [
          { id: 'snapshot-l2', kind: 'asset-snapshot' },
          { id: 'rollback-l2', kind: 'rollback-ref' },
        ],
      },
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    }, null, 2)}\n`);
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'apply',
      '--proposal-id',
      'proposal_l2_fixture',
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      applicationRecordCount: number;
      blockingReasons: string[];
    } }).data;
    expect(payload.gateStatus).toBe('blocked');
    expect(payload.gateCode).toBe('DIRECT_APPLY_FORBIDDEN');
    expect(payload.applicationRecordCount).toBe(0);
    expect(payload.blockingReasons.join('\n')).toContain('patch branch');
    expect(readApplicationRecords(root)).toHaveLength(0);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('patch-branch --proposal-id writes a deterministic L2/L3 patch plan without applying content', async () => {
    const root = newHome('agentdock-patch-branch-l2');
    const proposalDir = join(root, 'evolution', 'proposals');
    const validationDir = join(root, 'evolution', 'validations');
    mkdirSync(proposalDir, { recursive: true });
    mkdirSync(validationDir, { recursive: true });
    const proposal = {
      id: 'proposal_l2_patch_plan',
      title: 'Code change that must use patch branch',
      status: 'validated',
      level: 'L2',
      targetKind: 'haro-code',
      riskLevel: 'medium',
      sourceObservationRefs: [{ id: 'obs-l2-plan', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'update',
          targetRef: { id: 'packages/cli/src/index.ts', kind: 'haro-code' },
          contentRef: 'haro-sidecar://proposals/proposal_l2_patch_plan/patch',
          contentHash: 'sha256:l2-plan',
          summary: 'Modify Haro code through a patch branch',
        },
      ],
      testPlan: {
        requiredCommands: ['pnpm lint', 'pnpm test'],
        manualChecks: ['Review patch diff'],
        regressionRisks: ['runtime regression'],
      },
      rollbackPlan: {
        strategy: 'revert patch branch',
        snapshotRequired: true,
        rollbackRefs: [{ id: 'rollback-l2-plan', kind: 'rollback-ref' }],
      },
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    };
    writeFileSync(join(proposalDir, 'proposal_l2_patch_plan.json'), `${JSON.stringify(proposal, null, 2)}\n`);
    writeFileSync(join(validationDir, 'validation_l2_patch_plan.json'), `${JSON.stringify({
      id: 'validation_l2_patch_plan',
      proposalId: proposal.id,
      riskVerdict: 'blocked',
      requiredTests: ['pnpm lint', 'pnpm test', 'git diff --check'],
      rollbackReady: true,
      applyEligible: false,
      blockingReasons: ['Direct apply is forbidden for L2/L3 proposals; generate a patch branch.'],
      evidenceRefs: [{ id: proposal.id, kind: 'evolution-proposal' }],
      createdAt: '2026-05-08T12:01:00.000Z',
    }, null, 2)}\n`);
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'patch-branch',
      '--proposal-id',
      proposal.id,
      '--base-branch',
      'main',
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(result.action).toBe('patch-branch');
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      gatePassed: boolean;
      planCount: number;
      validationId: string;
      branchName: string;
      planPath: string;
      plan: {
        id: string;
        level: string;
        baseBranch: string;
        branchName: string;
        humanReviewRequired: boolean;
        requiredTests: string[];
        rollbackPlan: { strategy: string; snapshotRequired: boolean };
        changeRefs: Array<{ kind: string }>;
      };
    } }).data;
    expect(payload).toMatchObject({
      gateStatus: 'planned',
      gateCode: 'READY',
      gatePassed: true,
      planCount: 1,
      validationId: 'validation_l2_patch_plan',
      branchName: 'haro/evolution/proposal_l2_patch_plan',
    });
    expect(payload.plan).toMatchObject({
      level: 'L2',
      baseBranch: 'main',
      branchName: payload.branchName,
      humanReviewRequired: true,
    });
    expect(payload.plan.requiredTests).toEqual(['pnpm lint', 'pnpm test', 'git diff --check']);
    expect(payload.plan.rollbackPlan).toMatchObject({
      strategy: 'revert patch branch',
      snapshotRequired: false,
    });
    expect(payload.plan.changeRefs).toEqual([expect.objectContaining({ kind: 'proposal-change' })]);
    expect(existsSync(payload.planPath)).toBe(true);
    expect(readPatchBranchPlanRecords(root)).toHaveLength(1);
    expect(readApplicationRecords(root)).toHaveLength(0);
    expect(existsSync(join(root, 'memory'))).toBe(false);

    const repeatOut = captureStream();
    const repeatErr = captureStream();
    const repeat = await runCli(commonOpts(root, repeatOut, repeatErr, [
      'patch-branch',
      '--proposal-id',
      proposal.id,
      '--base-branch',
      'main',
      '--json',
    ]));
    expect(repeat.exitCode).toBe(0);
    expect(repeatErr.read()).toBe('');
    const repeatPayload = (JSON.parse(repeatOut.read()) as { data: { plan: { id: string } } }).data;
    expect(repeatPayload.plan.id).toBe(payload.plan.id);
    expect(readPatchBranchPlanRecords(root)).toHaveLength(1);
  });

  it('patch-branch --proposal-id blocks L0/L1 proposals without writing a patch plan', async () => {
    const root = newHome('agentdock-patch-branch-l0');
    const proposalDir = join(root, 'evolution', 'proposals');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal_l0_patch_blocked.json'), `${JSON.stringify({
      id: 'proposal_l0_patch_blocked',
      title: 'Prompt change belongs to gated apply',
      status: 'validated',
      level: 'L0',
      targetKind: 'prompt',
      riskLevel: 'low',
      sourceObservationRefs: [{ id: 'obs-l0-plan', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'update',
          targetRef: { id: 'prompt-default', kind: 'prompt' },
          summary: 'Clarify prompt wording',
        },
      ],
      testPlan: { requiredCommands: ['git diff --check'], manualChecks: [], regressionRisks: [] },
      rollbackPlan: { strategy: 'restore prompt', snapshotRequired: true, rollbackRefs: [] },
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    }, null, 2)}\n`);
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'patch-branch',
      '--proposal-id',
      'proposal_l0_patch_blocked',
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      planCount: number;
      blockingReasons: string[];
    } }).data;
    expect(payload.gateStatus).toBe('blocked');
    expect(payload.gateCode).toBe('PATCH_BRANCH_NOT_REQUIRED');
    expect(payload.planCount).toBe(0);
    expect(payload.blockingReasons.join('\n')).toContain('L0/L1 apply');
    expect(readPatchBranchPlanRecords(root)).toHaveLength(0);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('apply --proposal-id blocks validated proposals when validation is not apply eligible', async () => {
    const root = newHome('agentdock-apply-not-eligible');
    const proposalDir = join(root, 'evolution', 'proposals');
    const validationDir = join(root, 'evolution', 'validations');
    mkdirSync(proposalDir, { recursive: true });
    mkdirSync(validationDir, { recursive: true });
    const proposal = {
      id: 'proposal_not_eligible',
      title: 'Prompt change missing approval',
      status: 'validated',
      level: 'L0',
      targetKind: 'prompt',
      riskLevel: 'low',
      sourceObservationRefs: [{ id: 'obs-not-eligible', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'update',
          targetRef: { id: 'prompt-default', kind: 'prompt' },
          contentRef: 'haro-sidecar://proposals/proposal_not_eligible/content',
          contentHash: 'sha256:not-eligible',
          summary: 'Clarify prompt wording',
        },
      ],
      testPlan: { requiredCommands: ['git diff --check'], manualChecks: [], regressionRisks: [] },
      rollbackPlan: {
        strategy: 'restore previous prompt content',
        snapshotRequired: true,
        rollbackRefs: [
          { id: 'snapshot-not-eligible', kind: 'asset-snapshot' },
          { id: 'rollback-not-eligible', kind: 'rollback-ref' },
        ],
      },
      ...approvedProposalFields('approval-not-eligible'),
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    };
    writeFileSync(join(proposalDir, 'proposal_not_eligible.json'), `${JSON.stringify(proposal, null, 2)}\n`);
    writeFileSync(join(validationDir, 'validation_not_eligible.json'), `${JSON.stringify({
      id: 'validation_not_eligible',
      proposalId: proposal.id,
      riskVerdict: 'low',
      requiredTests: ['git diff --check'],
      rollbackReady: true,
      applyEligible: false,
      blockingReasons: ['Manual approval is required before apply.'],
      evidenceRefs: [{ id: proposal.id, kind: 'evolution-proposal' }],
      createdAt: '2026-05-08T12:01:00.000Z',
    }, null, 2)}\n`);
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'apply',
      '--proposal-id',
      proposal.id,
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      validationId: string;
      blockingReasons: string[];
      applicationRecordCount: number;
    } }).data;
    expect(payload.gateStatus).toBe('blocked');
    expect(payload.gateCode).toBe('APPLY_NOT_ELIGIBLE');
    expect(payload.validationId).toBe('validation_not_eligible');
    expect(payload.blockingReasons).toContain('Manual approval is required before apply.');
    expect(payload.blockingReasons).toContain('Validation report has applyEligible=false.');
    expect(payload.applicationRecordCount).toBe(0);
    expect(readApplicationRecords(root)).toHaveLength(0);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('apply --proposal-id blocks automatic proposals until human approval is attached', async () => {
    const root = newHome('agentdock-apply-human-review');
    const proposalDir = join(root, 'evolution', 'proposals');
    const validationDir = join(root, 'evolution', 'validations');
    mkdirSync(proposalDir, { recursive: true });
    mkdirSync(validationDir, { recursive: true });
    const proposal = {
      id: 'proposal_needs_human_review',
      title: 'Automatic prompt change requires human review',
      status: 'validated',
      level: 'L0',
      targetKind: 'prompt',
      riskLevel: 'low',
      sourceObservationRefs: [{ id: 'obs-human-review', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'update',
          targetRef: { id: 'prompt-human-review', kind: 'prompt' },
          contentHash: 'sha256:human-review',
          summary: 'Clarify prompt wording',
        },
      ],
      testPlan: { requiredCommands: ['git diff --check'], manualChecks: [], regressionRisks: [] },
      rollbackPlan: {
        strategy: 'restore previous prompt content',
        snapshotRequired: true,
        rollbackRefs: [],
      },
      humanReviewRequired: true,
      humanApprovalRefs: [],
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    };
    writeFileSync(join(proposalDir, 'proposal_needs_human_review.json'), `${JSON.stringify(proposal, null, 2)}\n`);
    writeFileSync(join(validationDir, 'validation_human_review.json'), `${JSON.stringify({
      id: 'validation_human_review',
      proposalId: proposal.id,
      riskVerdict: 'low',
      requiredTests: ['git diff --check'],
      rollbackReady: true,
      applyEligible: true,
      blockingReasons: [],
      evidenceRefs: [{ id: proposal.id, kind: 'evolution-proposal' }],
      createdAt: '2026-05-08T12:01:00.000Z',
    }, null, 2)}\n`);
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'apply',
      '--proposal-id',
      proposal.id,
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      validationId: string;
      gatePassed: boolean;
      applied: boolean;
      applicationRecordCount: number;
      blockingReasons: string[];
    } }).data;
    expect(payload).toMatchObject({
      gateStatus: 'blocked',
      gateCode: 'HUMAN_REVIEW_REQUIRED',
      validationId: 'validation_human_review',
      gatePassed: false,
      applied: false,
      applicationRecordCount: 0,
    });
    expect(payload.blockingReasons.join('\n')).toContain('Startup policy requires a human approval ref');
    expect(readSnapshotRecords(root)).toHaveLength(0);
    expect(readRollbackRecords(root)).toHaveLength(0);
    expect(readApplicationRecords(root)).toHaveLength(0);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('apply --proposal-id consumes approve decision artifacts as human approval evidence', async () => {
    const root = newHome('agentdock-apply-approval-decision');
    writeValidatedMcpToolConfigProposal(root, 'proposal_decision_approved', 'validation_decision_approved');
    writeApprovalDecisionRecord(root, {
      id: 'approval_decision_approved',
      approvalRequestId: 'approval_request_decision_approved',
      proposalId: 'proposal_decision_approved',
      validationId: 'validation_decision_approved',
      decision: 'approve',
      reviewer: {
        source: 'haro-web',
        username: 'reviewer',
        role: 'owner',
      },
      sourceRef: {
        id: 'approval_request_decision_approved',
        kind: 'approval-request',
        uri: 'haro-sidecar://approval-requests/approval_request_decision_approved',
      },
      createdAt: '2026-05-08T12:02:00.000Z',
      updatedAt: '2026-05-08T12:02:00.000Z',
    });
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'apply',
      '--proposal-id',
      'proposal_decision_approved',
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      gateCode: string;
      blockingReasons: string[];
    } }).data;
    expect(payload.gateCode).toBe('APPLY_CONTENT_REQUIRED');
    expect(payload.blockingReasons.join('\n')).not.toContain('human approval ref');
    const proposal = readJson<{
      humanApprovalRefs: Array<{ id: string; kind: string; uri?: string }>;
    }>(join(root, 'evolution', 'proposals', 'proposal_decision_approved.json'));
    expect(proposal.humanApprovalRefs).toEqual([
      {
        id: 'approval_decision_approved',
        kind: 'human-approval',
        uri: 'haro-sidecar://approval-decisions/approval_decision_approved',
      },
    ]);
    expect(readApplicationRecords(root)).toHaveLength(0);
  });

  it('apply --proposal-id blocks rejected decision artifacts and syncs proposal status', async () => {
    const root = newHome('agentdock-apply-rejected-decision');
    writeValidatedMcpToolConfigProposal(root, 'proposal_decision_rejected', 'validation_decision_rejected');
    writeApprovalDecisionRecord(root, {
      id: 'approval_decision_rejected',
      approvalRequestId: 'approval_request_decision_rejected',
      proposalId: 'proposal_decision_rejected',
      validationId: 'validation_decision_rejected',
      decision: 'reject',
      reviewer: {
        source: 'agentdock',
        username: 'reviewer',
        role: 'owner',
      },
      sourceRef: {
        id: 'approval_request_decision_rejected',
        kind: 'approval-request',
      },
      createdAt: '2026-05-08T12:02:00.000Z',
      updatedAt: '2026-05-08T12:02:00.000Z',
    });
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'apply',
      '--proposal-id',
      'proposal_decision_rejected',
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      gateCode: string;
      blockingReasons: string[];
    } }).data;
    expect(payload.gateCode).toBe('APPROVAL_REJECTED');
    expect(payload.blockingReasons.join('\n')).toContain('rejected by human review');
    const proposal = readJson<{ status: string }>(
      join(root, 'evolution', 'proposals', 'proposal_decision_rejected.json'),
    );
    expect(proposal.status).toBe('rejected');
    expect(readApplicationRecords(root)).toHaveLength(0);
  });

  it('apply --proposal-id blocks request-changes decisions with reviewer direction', async () => {
    const root = newHome('agentdock-apply-request-changes-decision');
    writeValidatedMcpToolConfigProposal(root, 'proposal_decision_changes', 'validation_decision_changes');
    writeApprovalDecisionRecord(root, {
      id: 'approval_decision_changes',
      approvalRequestId: 'approval_request_decision_changes',
      proposalId: 'proposal_decision_changes',
      validationId: 'validation_decision_changes',
      decision: 'request-changes',
      direction: 'Narrow the change to a read-only AgentDock MCP registration plan first.',
      reviewer: {
        source: 'haro-web',
        username: 'reviewer',
        role: 'owner',
      },
      sourceRef: {
        id: 'approval_request_decision_changes',
        kind: 'approval-request',
      },
      createdAt: '2026-05-08T12:02:00.000Z',
      updatedAt: '2026-05-08T12:02:00.000Z',
    });
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'apply',
      '--proposal-id',
      'proposal_decision_changes',
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      gateCode: string;
      blockingReasons: string[];
    } }).data;
    expect(payload.gateCode).toBe('CHANGES_REQUESTED');
    expect(payload.blockingReasons.join('\n')).toContain('Narrow the change');
    const proposal = readJson<{ status: string }>(
      join(root, 'evolution', 'proposals', 'proposal_decision_changes.json'),
    );
    expect(proposal.status).toBe('superseded');
    expect(readApplicationRecords(root)).toHaveLength(0);
  });

  it('snapshot --proposal-id writes deterministic snapshot and rollback metadata without applying content', async () => {
    const root = newHome('agentdock-snapshot');
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
    const proposalPayload = (JSON.parse(proposeOut.read()) as { data: { proposalId: string } }).data;

    const snapshotOut = captureStream();
    const snapshotErr = captureStream();
    const snapshot = await runCli(commonOpts(root, snapshotOut, snapshotErr, [
      'snapshot',
      '--proposal-id',
      proposalPayload.proposalId,
      '--json',
    ]));

    expect(snapshot.exitCode).toBe(0);
    expect(snapshot.action).toBe('snapshot');
    expect(snapshotErr.read()).toBe('');
    const payload = (JSON.parse(snapshotOut.read()) as { data: {
      proposalId: string;
      snapshotId: string;
      rollbackId: string;
      snapshotPath: string;
      rollbackPath: string;
      snapshot: { entries: Array<{ existed: boolean; assetId: string; snapshotSource?: string }> };
      rollback: { entries: Array<{ action: string; existedBefore: boolean }> };
    } }).data;
    expect(payload.proposalId).toBe(proposalPayload.proposalId);
    expect(payload.snapshotId).toMatch(/^snapshot_/);
    expect(payload.rollbackId).toMatch(/^rollback_/);
    expect(existsSync(payload.snapshotPath)).toBe(true);
    expect(existsSync(payload.rollbackPath)).toBe(true);
    expect(payload.snapshot.entries[0]).toMatchObject({ existed: false, snapshotSource: 'absent' });
    expect(payload.rollback.entries[0]).toMatchObject({
      action: 'delete-created-asset',
      existedBefore: false,
    });
    expect(readSnapshotRecords(root)).toHaveLength(1);
    expect(readRollbackRecords(root)).toHaveLength(1);
    expect(readApplicationRecords(root)).toHaveLength(0);
    expect(readAssetEvents(root).filter((event) => event.status === 'applied')).toHaveLength(0);
    expect(existsSync(join(root, 'memory'))).toBe(false);

    const repeatOut = captureStream();
    const repeatErr = captureStream();
    const repeat = await runCli(commonOpts(root, repeatOut, repeatErr, [
      'snapshot',
      '--proposal-id',
      proposalPayload.proposalId,
      '--json',
    ]));
    expect(repeat.exitCode).toBe(0);
    expect(repeatErr.read()).toBe('');
    const repeatPayload = (JSON.parse(repeatOut.read()) as { data: { snapshotId: string; rollbackId: string } }).data;
    expect(repeatPayload.snapshotId).toBe(payload.snapshotId);
    expect(repeatPayload.rollbackId).toBe(payload.rollbackId);
    expect(readSnapshotRecords(root)).toHaveLength(1);
    expect(readRollbackRecords(root)).toHaveLength(1);
    expect(observeErr.read()).toBe('');
    expect(proposeErr.read()).toBe('');
  });

  it('snapshot --proposal-id copies sidecar-local prompt content into snapshot-content', async () => {
    const root = newHome('agentdock-snapshot-content');
    const proposalDir = join(root, 'evolution', 'proposals');
    const currentPromptDir = join(root, 'assets', 'current', 'prompt');
    mkdirSync(proposalDir, { recursive: true });
    mkdirSync(currentPromptDir, { recursive: true });
    const assetId = 'prompt-default';
    const encodedAssetId = Buffer.from(assetId, 'utf8').toString('base64url');
    writeFileSync(join(currentPromptDir, `${encodedAssetId}.md`), 'old prompt\n');
    const proposal = {
      id: 'proposal_prompt_content_snapshot',
      title: 'Tune prompt wording with content snapshot',
      status: 'validated',
      level: 'L0',
      targetKind: 'prompt',
      riskLevel: 'low',
      sourceObservationRefs: [{ id: 'obs-prompt-content', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'update',
          targetRef: { id: assetId, kind: 'prompt' },
          contentRef: 'haro-sidecar://proposals/proposal_prompt_content_snapshot/content',
          contentHash: 'sha256:new-prompt',
          summary: 'Clarify prompt wording',
        },
      ],
      testPlan: {
        requiredCommands: ['git diff --check'],
        manualChecks: ['Review prompt wording'],
        regressionRisks: ['prompt drift'],
      },
      rollbackPlan: {
        strategy: 'restore previous prompt content',
        snapshotRequired: true,
        rollbackRefs: [],
      },
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    };
    writeFileSync(join(proposalDir, 'proposal_prompt_content_snapshot.json'), `${JSON.stringify(proposal, null, 2)}\n`);
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'snapshot',
      '--proposal-id',
      proposal.id,
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      snapshotId: string;
      snapshotPath: string;
      rollbackPath: string;
      snapshot: {
        entries: Array<{
          existed: boolean;
          snapshotSource?: string;
          sourceContentRef?: { uri: string };
          contentRef?: { uri: string };
          contentHash?: string;
        }>;
      };
      rollback: {
        entries: Array<{
          action: string;
          existedBefore: boolean;
          restoreContentRef?: { uri: string };
          restoreContentHash?: string;
        }>;
      };
    } }).data;
    const entry = payload.snapshot.entries[0]!;
    expect(entry).toMatchObject({
      existed: true,
      snapshotSource: 'target-content',
    });
    expect(entry.sourceContentRef?.uri).toBe(`haro-sidecar://assets/current/prompt/${encodedAssetId}.md`);
    expect(entry.contentRef?.uri).toContain(`haro-sidecar://snapshot-content/${payload.snapshotId}/`);
    expect(entry.contentHash).toBeDefined();
    const contentDir = join(root, 'evolution', 'snapshot-content', payload.snapshotId);
    const contentFiles = readdirSync(contentDir);
    expect(contentFiles).toEqual([`0000-${encodedAssetId}.md`]);
    expect(readFileSync(join(contentDir, contentFiles[0]!), 'utf8')).toBe('old prompt\n');
    expect(payload.rollback.entries[0]).toMatchObject({
      action: 'restore-latest-event',
      existedBefore: true,
      restoreContentHash: entry.contentHash,
    });
    expect(payload.rollback.entries[0]?.restoreContentRef?.uri).toBe(entry.contentRef?.uri);
    expect(existsSync(payload.snapshotPath)).toBe(true);
    expect(existsSync(payload.rollbackPath)).toBe(true);
    expect(readSnapshotRecords(root)).toHaveLength(1);
    expect(readRollbackRecords(root)).toHaveLength(1);
    expect(readApplicationRecords(root)).toHaveLength(0);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('snapshot --proposal-id does not follow sidecar current content symlinks', async () => {
    const root = newHome('agentdock-snapshot-symlink');
    const proposalDir = join(root, 'evolution', 'proposals');
    const currentPromptDir = join(root, 'assets', 'current', 'prompt');
    mkdirSync(proposalDir, { recursive: true });
    mkdirSync(currentPromptDir, { recursive: true });
    const assetId = 'prompt-symlink';
    const encodedAssetId = Buffer.from(assetId, 'utf8').toString('base64url');
    const outsidePath = join(root, 'outside-secret.md');
    writeFileSync(outsidePath, 'must not be snapshotted\n');
    symlinkSync(outsidePath, join(currentPromptDir, `${encodedAssetId}.md`));
    const proposal = {
      id: 'proposal_prompt_symlink_snapshot',
      title: 'Reject symlinked prompt snapshot source',
      status: 'dry-run',
      level: 'L0',
      targetKind: 'prompt',
      riskLevel: 'low',
      sourceObservationRefs: [{ id: 'obs-prompt-symlink', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'update',
          targetRef: { id: assetId, kind: 'prompt' },
          summary: 'Clarify prompt wording',
        },
      ],
      testPlan: {
        requiredCommands: ['git diff --check'],
        manualChecks: [],
        regressionRisks: ['prompt drift'],
      },
      rollbackPlan: {
        strategy: 'restore previous prompt content',
        snapshotRequired: true,
        rollbackRefs: [],
      },
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    };
    writeFileSync(join(proposalDir, 'proposal_prompt_symlink_snapshot.json'), `${JSON.stringify(proposal, null, 2)}\n`);
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'snapshot',
      '--proposal-id',
      proposal.id,
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      snapshotId: string;
      snapshot: { entries: Array<{ existed: boolean; snapshotSource?: string; contentRef?: { uri: string } }> };
      rollback: { entries: Array<{ action: string; existedBefore: boolean; restoreContentRef?: { uri: string } }> };
    } }).data;
    expect(payload.snapshot.entries[0]).toMatchObject({
      existed: false,
      snapshotSource: 'absent',
    });
    expect(payload.snapshot.entries[0]?.contentRef).toBeUndefined();
    expect(payload.rollback.entries[0]).toMatchObject({
      action: 'delete-created-asset',
      existedBefore: false,
    });
    expect(payload.rollback.entries[0]?.restoreContentRef).toBeUndefined();
    expect(existsSync(join(root, 'evolution', 'snapshot-content', payload.snapshotId))).toBe(false);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('apply --proposal-id auto-generates snapshot and rollback metadata before applying sidecar-local content', async () => {
    const root = newHome('agentdock-apply-autosnapshot');
    const proposalDir = join(root, 'evolution', 'proposals');
    const validationDir = join(root, 'evolution', 'validations');
    const proposalContentDir = join(root, 'evolution', 'proposal-content', 'proposal_autosnapshot_l0');
    mkdirSync(proposalDir, { recursive: true });
    mkdirSync(validationDir, { recursive: true });
    mkdirSync(proposalContentDir, { recursive: true });
    const assetId = 'prompt-autosnapshot';
    const encodedAssetId = Buffer.from(assetId, 'utf8').toString('base64url');
    const nextContent = 'new autosnapshot prompt\n';
    writeFileSync(join(proposalContentDir, `0000-${encodedAssetId}.md`), nextContent);
    const proposal = {
      id: 'proposal_autosnapshot_l0',
      title: 'Tune prompt wording with generated snapshot',
      status: 'validated',
      level: 'L0',
      targetKind: 'prompt',
      riskLevel: 'low',
      sourceObservationRefs: [{ id: 'obs-autosnapshot-l0', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'update',
          targetRef: { id: assetId, kind: 'prompt' },
          contentRef: `haro-sidecar://proposal-content/proposal_autosnapshot_l0/0000-${encodedAssetId}.md`,
          contentHash: sha256(nextContent),
          summary: 'Clarify prompt wording',
        },
      ],
      testPlan: {
        requiredCommands: ['git diff --check'],
        manualChecks: ['Review prompt wording'],
        regressionRisks: ['prompt drift'],
      },
      rollbackPlan: {
        strategy: 'restore previous prompt content',
        snapshotRequired: true,
        rollbackRefs: [],
      },
      ...approvedProposalFields('approval-autosnapshot-l0'),
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    };
    writeFileSync(join(proposalDir, 'proposal_autosnapshot_l0.json'), `${JSON.stringify(proposal, null, 2)}\n`);
    writeFileSync(join(validationDir, 'validation_autosnapshot_l0.json'), `${JSON.stringify({
      id: 'validation_autosnapshot_l0',
      proposalId: proposal.id,
      riskVerdict: 'low',
      requiredTests: ['git diff --check'],
      rollbackReady: true,
      applyEligible: true,
      blockingReasons: [],
      evidenceRefs: [{ id: proposal.id, kind: 'evolution-proposal' }],
      createdAt: '2026-05-08T12:01:00.000Z',
    }, null, 2)}\n`);
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'apply',
      '--proposal-id',
      proposal.id,
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      generatedSnapshot: boolean;
      applied: boolean;
      assetEventCount: number;
      assetEventIds: string[];
      snapshotId: string;
      rollbackId: string;
      snapshotPath: string;
      rollbackPath: string;
      appliedContentRefs: Array<{ uri: string }>;
      applicationRecord: {
        status: string;
        applied: boolean;
        snapshotRef: { id: string };
        rollbackRef: { id: string };
        assetEventRefs: Array<{ id: string }>;
      };
    } }).data;
    expect(payload).toMatchObject({
      gateStatus: 'applied',
      gateCode: 'READY',
      applied: true,
      generatedSnapshot: true,
      assetEventCount: 1,
    });
    expect(payload.snapshotId).toMatch(/^snapshot_/);
    expect(payload.rollbackId).toMatch(/^rollback_/);
    expect(existsSync(payload.snapshotPath)).toBe(true);
    expect(existsSync(payload.rollbackPath)).toBe(true);
    expect(payload.appliedContentRefs[0]?.uri).toBe(`haro-sidecar://assets/current/prompt/${encodedAssetId}.md`);
    expect(payload.applicationRecord).toMatchObject({
      status: 'applied',
      applied: true,
      snapshotRef: { id: payload.snapshotId },
      rollbackRef: { id: payload.rollbackId },
    });
    expect(payload.applicationRecord.assetEventRefs[0]?.id).toBe(payload.assetEventIds[0]);
    expect(readFileSync(join(root, 'assets', 'current', 'prompt', `${encodedAssetId}.md`), 'utf8')).toBe(nextContent);
    expect(readSnapshotRecords(root)).toHaveLength(1);
    expect(readRollbackRecords(root)).toHaveLength(1);
    expect(readApplicationRecords(root)).toHaveLength(1);
    expect(readAssetEvents(root).filter((event) => event.status === 'applied')).toHaveLength(1);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('apply --proposal-id writes an applied record and mutates only sidecar-local prompt content', async () => {
    const root = newHome('agentdock-apply-ready-l0');
    const proposalDir = join(root, 'evolution', 'proposals');
    const validationDir = join(root, 'evolution', 'validations');
    const proposalContentDir = join(root, 'evolution', 'proposal-content', 'proposal_ready_l0');
    const currentPromptDir = join(root, 'assets', 'current', 'prompt');
    mkdirSync(proposalDir, { recursive: true });
    mkdirSync(validationDir, { recursive: true });
    mkdirSync(proposalContentDir, { recursive: true });
    mkdirSync(currentPromptDir, { recursive: true });
    const assetId = 'prompt-default';
    const encodedAssetId = Buffer.from(assetId, 'utf8').toString('base64url');
    const previousContent = 'old prompt\n';
    const nextContent = 'new prompt\n';
    writeFileSync(join(currentPromptDir, `${encodedAssetId}.txt`), 'stale alternate prompt\n');
    writeFileSync(join(currentPromptDir, `${encodedAssetId}.md`), previousContent);
    writeFileSync(join(proposalContentDir, `0000-${encodedAssetId}.md`), nextContent);
    const proposal = {
      id: 'proposal_ready_l0',
      title: 'Tune prompt wording',
      status: 'validated',
      level: 'L0',
      targetKind: 'prompt',
      riskLevel: 'low',
      sourceObservationRefs: [{ id: 'obs-ready-l0', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'update',
          targetRef: { id: assetId, kind: 'prompt' },
          contentRef: `haro-sidecar://proposal-content/proposal_ready_l0/0000-${encodedAssetId}.md`,
          contentHash: `sha256:${sha256(nextContent)}`,
          summary: 'Clarify prompt wording',
        },
      ],
      testPlan: {
        requiredCommands: ['git diff --check'],
        manualChecks: ['Review prompt wording'],
        regressionRisks: ['prompt drift'],
      },
      rollbackPlan: {
        strategy: 'restore previous prompt content',
        snapshotRequired: true,
        rollbackRefs: [],
      },
      ...approvedProposalFields('approval-ready-l0'),
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    };
    writeFileSync(join(proposalDir, 'proposal_ready_l0.json'), `${JSON.stringify(proposal, null, 2)}\n`);
    writeFileSync(join(validationDir, 'validation_ready_l0.json'), `${JSON.stringify({
      id: 'validation_ready_l0',
      proposalId: proposal.id,
      riskVerdict: 'low',
      requiredTests: ['git diff --check'],
      rollbackReady: true,
      applyEligible: true,
      blockingReasons: [],
      evidenceRefs: [{ id: proposal.id, kind: 'evolution-proposal' }],
      createdAt: '2026-05-08T12:01:00.000Z',
    }, null, 2)}\n`);
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'apply',
      '--proposal-id',
      proposal.id,
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      gatePassed: boolean;
      applied: boolean;
      applicationRecordCount: number;
      assetEventCount: number;
      assetEventIds: string[];
      validationId: string;
      snapshotId: string;
      rollbackId: string;
      generatedSnapshot: boolean;
      applicationRecordPath: string;
      applicationRecord: {
        proposalId: string;
        validationId: string;
        status: string;
        gateCode: string;
        applied: boolean;
        snapshotRef: { id: string };
        rollbackRef: { id: string };
        assetEventRefs: Array<{ id: string }>;
      };
    } }).data;
    expect(payload).toMatchObject({
      gateStatus: 'applied',
      gateCode: 'READY',
      gatePassed: true,
      applied: true,
      applicationRecordCount: 1,
      assetEventCount: 1,
      validationId: 'validation_ready_l0',
      generatedSnapshot: true,
    });
    expect(payload.applicationRecord).toMatchObject({
      proposalId: proposal.id,
      validationId: 'validation_ready_l0',
      status: 'applied',
      gateCode: 'READY',
      applied: true,
      snapshotRef: { id: payload.snapshotId },
      rollbackRef: { id: payload.rollbackId },
    });
    expect(payload.applicationRecord.assetEventRefs[0]?.id).toBe(payload.assetEventIds[0]);
    expect(existsSync(payload.applicationRecordPath)).toBe(true);
    expect(readFileSync(join(currentPromptDir, `${encodedAssetId}.md`), 'utf8')).toBe(nextContent);
    expect(existsSync(join(currentPromptDir, `${encodedAssetId}.txt`))).toBe(false);
    const snapshot = readSnapshotRecords(root)[0]!;
    expect(snapshot.entries[0]).toMatchObject({
      snapshotSource: 'target-content',
      contentHash: sha256(previousContent),
    });
    expect(readApplicationRecords(root)).toHaveLength(1);
    const appliedEvents = readAssetEvents(root).filter((event) => event.status === 'applied');
    expect(appliedEvents).toHaveLength(1);
    expect(appliedEvents[0]).toMatchObject({
      assetId,
      contentHash: sha256(nextContent),
      rollbackMetadata: {
        snapshotRef: { id: payload.snapshotId },
        rollbackRef: { id: payload.rollbackId },
        reversible: true,
      },
    });
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('rollback --application-id restores sidecar-local prompt snapshot content and records rollback events', async () => {
    const root = newHome('agentdock-rollback-restore-l0');
    const proposalDir = join(root, 'evolution', 'proposals');
    const validationDir = join(root, 'evolution', 'validations');
    const proposalContentDir = join(root, 'evolution', 'proposal-content', 'proposal_rollback_restore_l0');
    const currentPromptDir = join(root, 'assets', 'current', 'prompt');
    mkdirSync(proposalDir, { recursive: true });
    mkdirSync(validationDir, { recursive: true });
    mkdirSync(proposalContentDir, { recursive: true });
    mkdirSync(currentPromptDir, { recursive: true });
    const assetId = 'prompt-rollback-restore';
    const encodedAssetId = Buffer.from(assetId, 'utf8').toString('base64url');
    const previousContent = 'old rollback prompt\n';
    const nextContent = 'new rollback prompt\n';
    writeFileSync(join(currentPromptDir, `${encodedAssetId}.md`), previousContent);
    writeFileSync(join(proposalContentDir, `0000-${encodedAssetId}.md`), nextContent);
    const proposal = {
      id: 'proposal_rollback_restore_l0',
      title: 'Tune prompt then roll it back',
      status: 'validated',
      level: 'L0',
      targetKind: 'prompt',
      riskLevel: 'low',
      sourceObservationRefs: [{ id: 'obs-rollback-restore-l0', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'update',
          targetRef: { id: assetId, kind: 'prompt' },
          contentHash: sha256(nextContent),
          summary: 'Clarify prompt wording',
        },
      ],
      testPlan: {
        requiredCommands: ['git diff --check'],
        manualChecks: ['Review prompt wording'],
        regressionRisks: ['prompt drift'],
      },
      rollbackPlan: {
        strategy: 'restore previous prompt content',
        snapshotRequired: true,
        rollbackRefs: [],
      },
      ...approvedProposalFields('approval-rollback-restore-l0'),
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    };
    writeFileSync(join(proposalDir, 'proposal_rollback_restore_l0.json'), `${JSON.stringify(proposal, null, 2)}\n`);
    writeFileSync(join(validationDir, 'validation_rollback_restore_l0.json'), `${JSON.stringify({
      id: 'validation_rollback_restore_l0',
      proposalId: proposal.id,
      riskVerdict: 'low',
      requiredTests: ['git diff --check'],
      rollbackReady: true,
      applyEligible: true,
      blockingReasons: [],
      evidenceRefs: [{ id: proposal.id, kind: 'evolution-proposal' }],
      createdAt: '2026-05-08T12:01:00.000Z',
    }, null, 2)}\n`);
    const applyOut = captureStream();
    const applyErr = captureStream();

    const apply = await runCli(commonOpts(root, applyOut, applyErr, [
      'apply',
      '--proposal-id',
      proposal.id,
      '--json',
    ]));

    expect(apply.exitCode).toBe(0);
    expect(applyErr.read()).toBe('');
    const appliedPayload = (JSON.parse(applyOut.read()) as { data: {
      applicationRecord: { id: string };
      snapshotId: string;
      rollbackId: string;
    } }).data;
    expect(readFileSync(join(currentPromptDir, `${encodedAssetId}.md`), 'utf8')).toBe(nextContent);
    const rollbackOut = captureStream();
    const rollbackErr = captureStream();

    const rollback = await runCli(commonOpts(root, rollbackOut, rollbackErr, [
      'rollback',
      '--application-id',
      appliedPayload.applicationRecord.id,
      '--json',
    ]));

    expect(rollback.exitCode).toBe(0);
    expect(rollback.action).toBe('rollback');
    expect(rollbackErr.read()).toBe('');
    const payload = (JSON.parse(rollbackOut.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      gatePassed: boolean;
      rolledBack: boolean;
      applicationRecordCount: number;
      assetEventCount: number;
      assetEventIds: string[];
      snapshotId: string;
      rollbackId: string;
      rolledBackContentRefs: Array<{ uri: string }>;
      applicationRecord: { status: string; applied: boolean; assetEventRefs: Array<{ id: string }> };
    } }).data;
    expect(payload).toMatchObject({
      gateStatus: 'rolled-back',
      gateCode: 'READY',
      gatePassed: true,
      rolledBack: true,
      applicationRecordCount: 1,
      assetEventCount: 1,
      snapshotId: appliedPayload.snapshotId,
      rollbackId: appliedPayload.rollbackId,
    });
    expect(payload.rolledBackContentRefs[0]?.uri).toBe(`haro-sidecar://assets/current/prompt/${encodedAssetId}.md`);
    expect(payload.applicationRecord).toMatchObject({
      status: 'rolled-back',
      applied: false,
    });
    expect(payload.applicationRecord.assetEventRefs.map((ref) => ref.id)).toEqual(expect.arrayContaining(payload.assetEventIds));
    expect(readFileSync(join(currentPromptDir, `${encodedAssetId}.md`), 'utf8')).toBe(previousContent);
    const records = readApplicationRecords(root);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: 'rolled-back', applied: false });
    const events = readAssetEvents(root);
    expect(events.filter((event) => event.status === 'applied')).toHaveLength(1);
    const rolledBackEvents = events.filter((event) => event.status === 'rolled-back');
    expect(rolledBackEvents).toHaveLength(1);
    expect(rolledBackEvents[0]).toMatchObject({
      assetId,
      contentHash: sha256(previousContent),
      rollbackMetadata: {
        snapshotRef: { id: appliedPayload.snapshotId },
        rollbackRef: { id: appliedPayload.rollbackId },
        reversible: true,
      },
    });
    const manifest = readAssetManifests(root).find((item) => item.id === assetId);
    expect(manifest).toMatchObject({
      status: 'rolled-back',
      contentHash: sha256(previousContent),
      latestEventRef: { id: payload.assetEventIds[0] },
    });
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('rollback --application-id deletes sidecar-local content for assets created by apply', async () => {
    const root = newHome('agentdock-rollback-delete-created-l0');
    const proposalDir = join(root, 'evolution', 'proposals');
    const validationDir = join(root, 'evolution', 'validations');
    const proposalContentDir = join(root, 'evolution', 'proposal-content', 'proposal_rollback_delete_l0');
    mkdirSync(proposalDir, { recursive: true });
    mkdirSync(validationDir, { recursive: true });
    mkdirSync(proposalContentDir, { recursive: true });
    const assetId = 'prompt-rollback-delete';
    const encodedAssetId = Buffer.from(assetId, 'utf8').toString('base64url');
    const nextContent = 'brand new prompt\n';
    writeFileSync(join(proposalContentDir, `0000-${encodedAssetId}.md`), nextContent);
    const proposal = {
      id: 'proposal_rollback_delete_l0',
      title: 'Create prompt then roll it back',
      status: 'validated',
      level: 'L0',
      targetKind: 'prompt',
      riskLevel: 'low',
      sourceObservationRefs: [{ id: 'obs-rollback-delete-l0', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'create',
          targetRef: { id: assetId, kind: 'prompt' },
          contentHash: sha256(nextContent),
          summary: 'Create prompt content',
        },
      ],
      testPlan: {
        requiredCommands: ['git diff --check'],
        manualChecks: ['Review prompt wording'],
        regressionRisks: ['prompt drift'],
      },
      rollbackPlan: {
        strategy: 'delete created prompt content',
        snapshotRequired: true,
        rollbackRefs: [],
      },
      ...approvedProposalFields('approval-rollback-delete-l0'),
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    };
    writeFileSync(join(proposalDir, 'proposal_rollback_delete_l0.json'), `${JSON.stringify(proposal, null, 2)}\n`);
    writeFileSync(join(validationDir, 'validation_rollback_delete_l0.json'), `${JSON.stringify({
      id: 'validation_rollback_delete_l0',
      proposalId: proposal.id,
      riskVerdict: 'low',
      requiredTests: ['git diff --check'],
      rollbackReady: true,
      applyEligible: true,
      blockingReasons: [],
      evidenceRefs: [{ id: proposal.id, kind: 'evolution-proposal' }],
      createdAt: '2026-05-08T12:01:00.000Z',
    }, null, 2)}\n`);
    const applyOut = captureStream();
    const applyErr = captureStream();

    const apply = await runCli(commonOpts(root, applyOut, applyErr, [
      'apply',
      '--proposal-id',
      proposal.id,
      '--json',
    ]));

    expect(apply.exitCode).toBe(0);
    expect(applyErr.read()).toBe('');
    const appliedPayload = (JSON.parse(applyOut.read()) as { data: {
      applicationRecord: { id: string };
      snapshotId: string;
      rollbackId: string;
    } }).data;
    expect(readFileSync(join(root, 'assets', 'current', 'prompt', `${encodedAssetId}.md`), 'utf8')).toBe(nextContent);
    const rollbackOut = captureStream();
    const rollbackErr = captureStream();

    const rollback = await runCli(commonOpts(root, rollbackOut, rollbackErr, [
      'rollback',
      '--application-id',
      appliedPayload.applicationRecord.id,
      '--json',
    ]));

    expect(rollback.exitCode).toBe(0);
    expect(rollbackErr.read()).toBe('');
    const payload = (JSON.parse(rollbackOut.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      rolledBack: boolean;
      assetEventCount: number;
      assetEventIds: string[];
      applicationRecord: { status: string; applied: boolean };
    } }).data;
    expect(payload).toMatchObject({
      gateStatus: 'rolled-back',
      gateCode: 'READY',
      rolledBack: true,
      assetEventCount: 1,
    });
    expect(payload.applicationRecord).toMatchObject({ status: 'rolled-back', applied: false });
    expect(existsSync(join(root, 'assets', 'current', 'prompt', `${encodedAssetId}.md`))).toBe(false);
    const rolledBackEvents = readAssetEvents(root).filter((event) => event.status === 'rolled-back');
    expect(rolledBackEvents).toHaveLength(1);
    expect(rolledBackEvents[0]).toMatchObject({
      assetId,
      contentRef: { id: appliedPayload.rollbackId, kind: 'rollback-ref' },
      rollbackMetadata: {
        snapshotRef: { id: appliedPayload.snapshotId },
        rollbackRef: { id: appliedPayload.rollbackId },
      },
    });
    expect(readAssetManifests(root).find((item) => item.id === assetId)).toMatchObject({
      status: 'rolled-back',
      latestEventRef: { id: payload.assetEventIds[0] },
    });
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('rollback --application-id blocks non-applied application records without side effects', async () => {
    const root = newHome('agentdock-rollback-not-applied');
    const applicationDir = join(root, 'evolution', 'applications');
    mkdirSync(applicationDir, { recursive: true });
    const application = ApplicationRecordSchema.parse({
      id: 'application_not_applied',
      proposalId: 'proposal_not_applied',
      validationId: 'validation_not_applied',
      status: 'ready',
      gateCode: 'READY',
      level: 'L0',
      targetKind: 'prompt',
      applied: false,
      snapshotRef: { id: 'snapshot_not_applied', kind: 'asset-snapshot' },
      rollbackRef: { id: 'rollback_not_applied', kind: 'rollback-ref' },
      assetEventRefs: [],
      evidenceRefs: [{ id: 'proposal_not_applied', kind: 'evolution-proposal' }],
      blockingReasons: [],
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    });
    writeFileSync(join(applicationDir, 'application_not_applied.json'), `${JSON.stringify(application, null, 2)}\n`);
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'rollback',
      '--application-id',
      application.id,
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      rolledBack: boolean;
      applicationRecordCount: number;
      assetEventCount: number;
      blockingReasons: string[];
    } }).data;
    expect(payload).toMatchObject({
      gateStatus: 'blocked',
      gateCode: 'APPLICATION_NOT_APPLIED',
      rolledBack: false,
      applicationRecordCount: 0,
      assetEventCount: 0,
    });
    expect(payload.blockingReasons.join('\n')).toContain('status=ready');
    expect(readApplicationRecords(root)[0]).toMatchObject({ status: 'ready', applied: false });
    expect(readAssetEvents(root)).toHaveLength(0);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('apply and rollback support sidecar-local L1 runner-profile content', async () => {
    const root = newHome('agentdock-l1-runner-profile');
    const proposalDir = join(root, 'evolution', 'proposals');
    const validationDir = join(root, 'evolution', 'validations');
    const proposalContentDir = join(root, 'evolution', 'proposal-content', 'proposal_l1_runner_profile');
    const currentProfileDir = join(root, 'assets', 'current', 'runner-profile');
    mkdirSync(proposalDir, { recursive: true });
    mkdirSync(validationDir, { recursive: true });
    mkdirSync(proposalContentDir, { recursive: true });
    mkdirSync(currentProfileDir, { recursive: true });
    const assetId = 'runner-profile-default';
    const encodedAssetId = Buffer.from(assetId, 'utf8').toString('base64url');
    const previousContent = `${JSON.stringify({ model: 'stable', maxTurns: 4 }, null, 2)}\n`;
    const nextContent = `${JSON.stringify({ model: 'stable', maxTurns: 6 }, null, 2)}\n`;
    writeFileSync(join(currentProfileDir, `${encodedAssetId}.json`), previousContent);
    writeFileSync(join(proposalContentDir, `0000-${encodedAssetId}.json`), nextContent);
    const proposal = {
      id: 'proposal_l1_runner_profile',
      title: 'Tune runner profile max turns',
      status: 'validated',
      level: 'L1',
      targetKind: 'runner-profile',
      riskLevel: 'medium',
      sourceObservationRefs: [{ id: 'obs-l1-runner-profile', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'update',
          targetRef: { id: assetId, kind: 'runner-profile' },
          contentHash: sha256(nextContent),
          summary: 'Adjust bounded runner turn count',
        },
      ],
      testPlan: {
        requiredCommands: ['git diff --check'],
        manualChecks: ['Review runner profile bounds'],
        regressionRisks: ['runner behavior drift'],
      },
      rollbackPlan: {
        strategy: 'restore previous runner profile',
        snapshotRequired: true,
        rollbackRefs: [],
      },
      ...approvedProposalFields('approval-l1-runner-profile'),
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    };
    writeFileSync(join(proposalDir, 'proposal_l1_runner_profile.json'), `${JSON.stringify(proposal, null, 2)}\n`);
    writeFileSync(join(validationDir, 'validation_l1_runner_profile.json'), `${JSON.stringify({
      id: 'validation_l1_runner_profile',
      proposalId: proposal.id,
      riskVerdict: 'medium',
      requiredTests: ['git diff --check'],
      rollbackReady: true,
      applyEligible: true,
      blockingReasons: [],
      evidenceRefs: [{ id: proposal.id, kind: 'evolution-proposal' }],
      createdAt: '2026-05-08T12:01:00.000Z',
    }, null, 2)}\n`);
    const applyOut = captureStream();
    const applyErr = captureStream();

    const apply = await runCli(commonOpts(root, applyOut, applyErr, [
      'apply',
      '--proposal-id',
      proposal.id,
      '--json',
    ]));

    expect(apply.exitCode).toBe(0);
    expect(applyErr.read()).toBe('');
    const appliedPayload = (JSON.parse(applyOut.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      applicationRecord: { id: string; level: string; targetKind: string; status: string; applied: boolean };
      snapshotId: string;
      rollbackId: string;
      appliedContentRefs: Array<{ uri: string }>;
    } }).data;
    expect(appliedPayload).toMatchObject({
      gateStatus: 'applied',
      gateCode: 'READY',
      applicationRecord: {
        level: 'L1',
        targetKind: 'runner-profile',
        status: 'applied',
        applied: true,
      },
    });
    expect(appliedPayload.appliedContentRefs[0]?.uri).toBe(`haro-sidecar://assets/current/runner-profile/${encodedAssetId}.json`);
    expect(readFileSync(join(currentProfileDir, `${encodedAssetId}.json`), 'utf8')).toBe(nextContent);
    const snapshot = readSnapshotRecords(root)[0]!;
    expect(snapshot).toMatchObject({ level: 'L1', targetKind: 'runner-profile' });
    expect(snapshot.entries[0]).toMatchObject({
      snapshotSource: 'target-content',
      contentHash: sha256(previousContent),
    });
    const appliedEvents = readAssetEvents(root).filter((event) => event.status === 'applied');
    expect(appliedEvents).toHaveLength(1);
    expect(appliedEvents[0]).toMatchObject({
      kind: 'runner-profile',
      contentHash: sha256(nextContent),
    });
    const rollbackOut = captureStream();
    const rollbackErr = captureStream();

    const rollback = await runCli(commonOpts(root, rollbackOut, rollbackErr, [
      'rollback',
      '--application-id',
      appliedPayload.applicationRecord.id,
      '--json',
    ]));

    expect(rollback.exitCode).toBe(0);
    expect(rollbackErr.read()).toBe('');
    const rollbackPayload = (JSON.parse(rollbackOut.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      snapshotId: string;
      rollbackId: string;
      applicationRecord: { level: string; targetKind: string; status: string; applied: boolean };
      rolledBackContentRefs: Array<{ uri: string }>;
    } }).data;
    expect(rollbackPayload).toMatchObject({
      gateStatus: 'rolled-back',
      gateCode: 'READY',
      snapshotId: appliedPayload.snapshotId,
      rollbackId: appliedPayload.rollbackId,
      applicationRecord: {
        level: 'L1',
        targetKind: 'runner-profile',
        status: 'rolled-back',
        applied: false,
      },
    });
    expect(rollbackPayload.rolledBackContentRefs[0]?.uri).toBe(`haro-sidecar://assets/current/runner-profile/${encodedAssetId}.json`);
    expect(readFileSync(join(currentProfileDir, `${encodedAssetId}.json`), 'utf8')).toBe(previousContent);
    const rolledBackEvents = readAssetEvents(root).filter((event) => event.status === 'rolled-back');
    expect(rolledBackEvents).toHaveLength(1);
    expect(rolledBackEvents[0]).toMatchObject({
      kind: 'runner-profile',
      contentHash: sha256(previousContent),
    });
    expect(readAssetManifests(root).find((item) => item.id === assetId)).toMatchObject({
      status: 'rolled-back',
      contentHash: sha256(previousContent),
    });
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('apply --proposal-id blocks when sidecar-local proposal content is missing', async () => {
    const root = newHome('agentdock-apply-missing-content');
    const proposalDir = join(root, 'evolution', 'proposals');
    const validationDir = join(root, 'evolution', 'validations');
    mkdirSync(proposalDir, { recursive: true });
    mkdirSync(validationDir, { recursive: true });
    const proposal = {
      id: 'proposal_missing_apply_content',
      title: 'Tune prompt wording without content',
      status: 'validated',
      level: 'L0',
      targetKind: 'prompt',
      riskLevel: 'low',
      sourceObservationRefs: [{ id: 'obs-missing-content', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'update',
          targetRef: { id: 'prompt-missing-content', kind: 'prompt' },
          summary: 'Clarify prompt wording',
        },
      ],
      testPlan: {
        requiredCommands: ['git diff --check'],
        manualChecks: [],
        regressionRisks: ['prompt drift'],
      },
      rollbackPlan: {
        strategy: 'restore previous prompt content',
        snapshotRequired: true,
        rollbackRefs: [],
      },
      ...approvedProposalFields('approval-missing-apply-content'),
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    };
    writeFileSync(join(proposalDir, 'proposal_missing_apply_content.json'), `${JSON.stringify(proposal, null, 2)}\n`);
    writeFileSync(join(validationDir, 'validation_missing_apply_content.json'), `${JSON.stringify({
      id: 'validation_missing_apply_content',
      proposalId: proposal.id,
      riskVerdict: 'low',
      requiredTests: ['git diff --check'],
      rollbackReady: true,
      applyEligible: true,
      blockingReasons: [],
      evidenceRefs: [{ id: proposal.id, kind: 'evolution-proposal' }],
      createdAt: '2026-05-08T12:01:00.000Z',
    }, null, 2)}\n`);
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'apply',
      '--proposal-id',
      proposal.id,
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      applied: boolean;
      applicationRecordCount: number;
      blockingReasons: string[];
    } }).data;
    expect(payload).toMatchObject({
      gateStatus: 'blocked',
      gateCode: 'APPLY_CONTENT_REQUIRED',
      applied: false,
      applicationRecordCount: 0,
    });
    expect(payload.blockingReasons.join('\n')).toContain('No sidecar-local proposal content');
    expect(readSnapshotRecords(root)).toHaveLength(1);
    expect(readRollbackRecords(root)).toHaveLength(1);
    expect(readApplicationRecords(root)).toHaveLength(0);
    expect(readAssetEvents(root).filter((event) => event.status === 'applied')).toHaveLength(0);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('apply --proposal-id does not follow sidecar proposal-content symlinks', async () => {
    const root = newHome('agentdock-apply-symlink-content');
    const proposalDir = join(root, 'evolution', 'proposals');
    const validationDir = join(root, 'evolution', 'validations');
    const proposalContentDir = join(root, 'evolution', 'proposal-content', 'proposal_symlink_apply_content');
    mkdirSync(proposalDir, { recursive: true });
    mkdirSync(validationDir, { recursive: true });
    mkdirSync(proposalContentDir, { recursive: true });
    const assetId = 'prompt-symlink-apply';
    const encodedAssetId = Buffer.from(assetId, 'utf8').toString('base64url');
    const outsidePath = join(root, 'outside-proposal-secret.md');
    writeFileSync(outsidePath, 'must not be applied\n');
    symlinkSync(outsidePath, join(proposalContentDir, `0000-${encodedAssetId}.md`));
    const proposal = {
      id: 'proposal_symlink_apply_content',
      title: 'Reject symlinked apply content source',
      status: 'validated',
      level: 'L0',
      targetKind: 'prompt',
      riskLevel: 'low',
      sourceObservationRefs: [{ id: 'obs-symlink-apply-content', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'update',
          targetRef: { id: assetId, kind: 'prompt' },
          summary: 'Clarify prompt wording',
        },
      ],
      testPlan: {
        requiredCommands: ['git diff --check'],
        manualChecks: [],
        regressionRisks: ['prompt drift'],
      },
      rollbackPlan: {
        strategy: 'restore previous prompt content',
        snapshotRequired: true,
        rollbackRefs: [],
      },
      ...approvedProposalFields('approval-symlink-apply-content'),
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    };
    writeFileSync(join(proposalDir, 'proposal_symlink_apply_content.json'), `${JSON.stringify(proposal, null, 2)}\n`);
    writeFileSync(join(validationDir, 'validation_symlink_apply_content.json'), `${JSON.stringify({
      id: 'validation_symlink_apply_content',
      proposalId: proposal.id,
      riskVerdict: 'low',
      requiredTests: ['git diff --check'],
      rollbackReady: true,
      applyEligible: true,
      blockingReasons: [],
      evidenceRefs: [{ id: proposal.id, kind: 'evolution-proposal' }],
      createdAt: '2026-05-08T12:01:00.000Z',
    }, null, 2)}\n`);
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'apply',
      '--proposal-id',
      proposal.id,
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      applied: boolean;
      applicationRecordCount: number;
    } }).data;
    expect(payload).toMatchObject({
      gateStatus: 'blocked',
      gateCode: 'APPLY_CONTENT_REQUIRED',
      applied: false,
      applicationRecordCount: 0,
    });
    expect(existsSync(join(root, 'assets', 'current', 'prompt', `${encodedAssetId}.md`))).toBe(false);
    expect(readApplicationRecords(root)).toHaveLength(0);
    expect(readAssetEvents(root).filter((event) => event.status === 'applied')).toHaveLength(0);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('apply --proposal-id rejects snapshot and rollback refs from another proposal', async () => {
    const root = newHome('agentdock-apply-cross-proposal-refs');
    const proposalDir = join(root, 'evolution', 'proposals');
    const validationDir = join(root, 'evolution', 'validations');
    const snapshotDir = join(root, 'evolution', 'snapshots');
    const rollbackDir = join(root, 'evolution', 'rollbacks');
    const proposalContentDir = join(root, 'evolution', 'proposal-content', 'proposal_cross_refs');
    mkdirSync(proposalDir, { recursive: true });
    mkdirSync(validationDir, { recursive: true });
    mkdirSync(snapshotDir, { recursive: true });
    mkdirSync(rollbackDir, { recursive: true });
    mkdirSync(proposalContentDir, { recursive: true });
    const assetId = 'prompt-cross-refs';
    const encodedAssetId = Buffer.from(assetId, 'utf8').toString('base64url');
    const nextContent = 'new prompt\n';
    writeFileSync(join(proposalContentDir, `0000-${encodedAssetId}.md`), nextContent);
    const foreignSnapshot = AssetSnapshotRecordSchema.parse({
      id: 'snapshot_foreign',
      proposalId: 'proposal_foreign',
      validationId: 'validation_foreign',
      level: 'L0',
      targetKind: 'prompt',
      sourceRef: { id: 'proposal_foreign', kind: 'evolution-proposal' },
      entries: [
        {
          changeIndex: 0,
          targetRef: { id: assetId, kind: 'prompt' },
          assetId,
          existed: false,
          snapshotSource: 'absent',
        },
      ],
      createdAt: '2026-05-08T12:00:00.000Z',
    });
    const foreignRollback = RollbackRecordSchema.parse({
      id: 'rollback_foreign',
      proposalId: 'proposal_foreign',
      validationId: 'validation_foreign',
      snapshotRef: { id: foreignSnapshot.id, kind: 'asset-snapshot' },
      sourceRef: { id: foreignSnapshot.id, kind: 'asset-snapshot' },
      reversible: true,
      entries: [
        {
          changeIndex: 0,
          targetRef: { id: assetId, kind: 'prompt' },
          assetId,
          action: 'delete-created-asset',
          existedBefore: false,
        },
      ],
      createdAt: '2026-05-08T12:00:00.000Z',
    });
    writeFileSync(join(snapshotDir, 'snapshot_foreign.json'), `${JSON.stringify(foreignSnapshot, null, 2)}\n`);
    writeFileSync(join(rollbackDir, 'rollback_foreign.json'), `${JSON.stringify(foreignRollback, null, 2)}\n`);
    const proposal = {
      id: 'proposal_cross_refs',
      title: 'Reject foreign snapshot refs',
      status: 'validated',
      level: 'L0',
      targetKind: 'prompt',
      riskLevel: 'low',
      sourceObservationRefs: [{ id: 'obs-cross-refs', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'update',
          targetRef: { id: assetId, kind: 'prompt' },
          contentHash: sha256(nextContent),
          summary: 'Clarify prompt wording',
        },
      ],
      testPlan: {
        requiredCommands: ['git diff --check'],
        manualChecks: [],
        regressionRisks: ['prompt drift'],
      },
      rollbackPlan: {
        strategy: 'restore previous prompt content',
        snapshotRequired: true,
        rollbackRefs: [
          { id: foreignSnapshot.id, kind: 'asset-snapshot' },
          { id: foreignRollback.id, kind: 'rollback-ref' },
        ],
      },
      ...approvedProposalFields('approval-cross-refs'),
      createdAt: '2026-05-08T12:00:00.000Z',
      updatedAt: '2026-05-08T12:00:00.000Z',
    };
    writeFileSync(join(proposalDir, 'proposal_cross_refs.json'), `${JSON.stringify(proposal, null, 2)}\n`);
    writeFileSync(join(validationDir, 'validation_cross_refs.json'), `${JSON.stringify({
      id: 'validation_cross_refs',
      proposalId: proposal.id,
      riskVerdict: 'low',
      requiredTests: ['git diff --check'],
      rollbackReady: true,
      applyEligible: true,
      blockingReasons: [],
      evidenceRefs: [{ id: proposal.id, kind: 'evolution-proposal' }],
      createdAt: '2026-05-08T12:01:00.000Z',
    }, null, 2)}\n`);
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'apply',
      '--proposal-id',
      proposal.id,
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      gateStatus: string;
      gateCode: string;
      blockingReasons: string[];
      applicationRecordCount: number;
    } }).data;
    expect(payload).toMatchObject({
      gateStatus: 'blocked',
      gateCode: 'SNAPSHOT_FAILED',
      applicationRecordCount: 0,
    });
    expect(payload.blockingReasons.join('\n')).toContain('belongs to proposal proposal_foreign');
    expect(existsSync(join(root, 'assets', 'current', 'prompt', `${encodedAssetId}.md`))).toBe(false);
    expect(readApplicationRecords(root)).toHaveLength(0);
    expect(readAssetEvents(root).filter((event) => event.status === 'applied')).toHaveLength(0);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('intake frontier writes schema-valid signals and is idempotent by source ref', async () => {
    const root = newHome('frontier-intake');
    const sourceConfigPath = join(root, 'frontier-sources.json');
    writeFileSync(sourceConfigPath, JSON.stringify({ signals: [frontierSignal()] }, null, 2));
    const stdout = captureStream();
    const stderr = captureStream();

    const first = await runCli(commonOpts(root, stdout, stderr, [
      'intake',
      'frontier',
      '--source-config',
      sourceConfigPath,
      '--json',
    ]));

    expect(first.exitCode).toBe(0);
    expect(first.action).toBe('intake');
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: {
      command: string;
      signalCount: number;
      wroteSignalCount: number;
      duplicateSignalCount: number;
      pendingSignalCount: number;
      signalIds: string[];
      signalPaths: string[];
      cursor: string;
    } }).data;
    expect(payload.command).toBe('intake frontier');
    expect(payload.signalCount).toBe(1);
    expect(payload.wroteSignalCount).toBe(1);
    expect(payload.duplicateSignalCount).toBe(0);
    expect(payload.pendingSignalCount).toBe(0);
    expect(payload.signalIds).toEqual(['frontier-signal-001']);
    expect(payload.cursor).toBe('2026-05-08T10:00:00.000Z');
    expect(existsSync(payload.signalPaths[0]!)).toBe(true);
    expect(readdirSync(join(root, 'evolution', 'frontier-signals'))).toHaveLength(1);
    expect(existsSync(join(root, 'memory'))).toBe(false);

    const repeatOut = captureStream();
    const repeatErr = captureStream();
    const repeat = await runCli(commonOpts(root, repeatOut, repeatErr, [
      'intake',
      'frontier',
      '--source-config',
      sourceConfigPath,
      '--json',
    ]));

    expect(repeat.exitCode).toBe(0);
    expect(repeatErr.read()).toBe('');
    const repeatPayload = (JSON.parse(repeatOut.read()) as { data: {
      wroteSignalCount: number;
      duplicateSignalCount: number;
      skippedBySinceCount: number;
    } }).data;
    expect(repeatPayload.wroteSignalCount).toBe(0);
    expect(repeatPayload.duplicateSignalCount).toBe(1);
    expect(repeatPayload.skippedBySinceCount).toBe(0);
    expect(readdirSync(join(root, 'evolution', 'frontier-signals'))).toHaveLength(1);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('intake frontier reports corrupt existing signal files without silently ignoring them', async () => {
    const root = newHome('frontier-intake-corrupt');
    const sourceConfigPath = join(root, 'frontier-sources.json');
    const frontierDir = join(root, 'evolution', 'frontier-signals');
    mkdirSync(frontierDir, { recursive: true });
    writeFileSync(join(frontierDir, 'broken.json'), '{ broken json');
    writeFileSync(sourceConfigPath, JSON.stringify({ signals: [frontierSignal('frontier-signal-002', {
      sourceRef: {
        id: 'agent-benchmark-2026-05-08',
        kind: 'benchmark-report',
        uri: 'https://example.com/benchmarks/agent',
      },
      sourceType: 'benchmark-report',
      title: 'Agent benchmark report',
    })] }, null, 2));
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'intake',
      'frontier',
      '--source-config',
      sourceConfigPath,
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(stderr.read()).toContain('skipped 1 corrupt frontier signal');
    const payload = (JSON.parse(stdout.read()) as { data: {
      wroteSignalCount: number;
      skippedCorruptSignalCount: number;
    } }).data;
    expect(payload.wroteSignalCount).toBe(1);
    expect(payload.skippedCorruptSignalCount).toBe(1);
    expect(readdirSync(frontierDir)).toHaveLength(2);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('intake frontier rejects invalid signals before writing', async () => {
    const root = newHome('frontier-intake-invalid');
    const sourceConfigPath = join(root, 'frontier-sources.json');
    const invalid: Record<string, unknown> = { ...frontierSignal() };
    delete invalid.sourceRef;
    delete invalid.summary;
    writeFileSync(sourceConfigPath, JSON.stringify({ signals: [invalid] }, null, 2));
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'intake',
      'frontier',
      '--source-config',
      sourceConfigPath,
      '--json',
    ]));

    expect(result.exitCode).toBe(1);
    expect(stdout.read()).toBe('');
    const error = JSON.parse(stderr.read()) as { error: { message: string } };
    expect(error.error.message).toContain('sourceRef');
    expect(error.error.message).toContain('summary');
    expect(existsSync(join(root, 'evolution', 'frontier-signals'))).toBe(false);
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('status summarizes an empty sidecar store without creating memory', async () => {
    const root = newHome('agentdock-status-empty');
    const stdout = captureStream();
    const stderr = captureStream();

    const result = await runCli(commonOpts(root, stdout, stderr, [
      'status',
      '--json',
    ]));

    expect(result.exitCode).toBe(0);
    expect(result.action).toBe('status');
    expect(stderr.read()).toBe('');
    const payload = (JSON.parse(stdout.read()) as { data: { sidecar: {
      command: string;
      connection: { configured: boolean; valid: boolean; connectionCount: number };
      cursors: { count: number; corruptCount: number };
      observations: { batchCount: number; corruptCount: number; semanticObservationCount: number };
      proposals: { count: number; pendingCount: number; validatedCount: number; corruptCount: number };
      validations: { count: number; corruptCount: number };
      approvalRequests: { count: number; pendingCount: number; corruptCount: number };
      snapshots: { count: number; corruptCount: number };
      rollbacks: { count: number; corruptCount: number };
      applications: { count: number; readyCount: number; appliedCount: number; rolledBackCount: number; corruptCount: number };
      patchBranches: { count: number; plannedCount: number; corruptCount: number };
      frontierSignals: {
        count: number;
        activeCount: number;
        rejectedCount: number;
        supersededCount: number;
        corruptCount: number;
      };
    } } }).data.sidecar;
    expect(payload.command).toBe('status');
    expect(payload.connection).toMatchObject({ configured: false, valid: true, connectionCount: 0 });
    expect(payload.cursors).toMatchObject({ count: 0, corruptCount: 0 });
    expect(payload.observations).toMatchObject({ batchCount: 0, corruptCount: 0, semanticObservationCount: 0 });
    expect(payload.proposals).toMatchObject({ count: 0, pendingCount: 0, validatedCount: 0, corruptCount: 0 });
    expect(payload.validations).toMatchObject({ count: 0, corruptCount: 0 });
    expect(payload.approvalRequests).toMatchObject({ count: 0, pendingCount: 0, corruptCount: 0 });
    expect(payload.snapshots).toMatchObject({ count: 0, corruptCount: 0 });
    expect(payload.rollbacks).toMatchObject({ count: 0, corruptCount: 0 });
    expect(payload.applications).toMatchObject({
      count: 0,
      readyCount: 0,
      appliedCount: 0,
      rolledBackCount: 0,
      corruptCount: 0,
    });
    expect(payload.patchBranches).toMatchObject({ count: 0, plannedCount: 0, corruptCount: 0 });
    expect(payload.frontierSignals).toMatchObject({
      count: 0,
      activeCount: 0,
      rejectedCount: 0,
      supersededCount: 0,
      corruptCount: 0,
    });
    expect(existsSync(join(root, 'memory'))).toBe(false);
  });

  it('status reports connection and evolution store counts including corrupt artifacts', async () => {
    const root = newHome('agentdock-status-populated');
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

    const validateOut = captureStream();
    const validateErr = captureStream();
    const validate = await runCli(commonOpts(root, validateOut, validateErr, [
      'validate',
      '--pending',
      '--json',
    ]));
    expect(validate.exitCode).toBe(0);

    writeFileSync(join(root, 'evolution', 'cursors', 'broken.json'), '{ broken json');
    writeFileSync(join(root, 'evolution', 'observations', 'broken.json'), '{ broken json');
    writeFileSync(join(root, 'evolution', 'proposals', 'broken.json'), '{ broken json');
    writeFileSync(join(root, 'evolution', 'validations', 'broken.json'), '{ broken json');
    const frontierDir = join(root, 'evolution', 'frontier-signals');
    mkdirSync(frontierDir, { recursive: true });
    writeFileSync(join(frontierDir, 'frontier-signal-001.json'), `${JSON.stringify(frontierSignal(), null, 2)}\n`);
    writeFileSync(join(frontierDir, 'broken.json'), '{ broken json');

    const statusOut = captureStream();
    const statusErr = captureStream();
    const status = await runCli(commonOpts(root, statusOut, statusErr, [
      'status',
      '--json',
    ]));

    expect(status.exitCode).toBe(0);
    expect(statusErr.read()).toBe('');
    const payload = (JSON.parse(statusOut.read()) as { data: { sidecar: {
      connection: {
        configured: boolean;
        valid: boolean;
        connectionCount: number;
        defaultConnectionId?: string;
        connections: Array<{ id: string; baseUrl: string; hasAuthRef: boolean }>;
      };
      cursors: { count: number; corruptCount: number };
      observations: { batchCount: number; corruptCount: number; semanticObservationCount: number };
      proposals: { count: number; pendingCount: number; validatedCount: number; corruptCount: number };
      validations: { count: number; corruptCount: number };
      approvalRequests: { count: number; pendingCount: number; corruptCount: number };
      snapshots: { count: number; corruptCount: number };
      rollbacks: { count: number; corruptCount: number };
      applications: { count: number; readyCount: number; appliedCount: number; rolledBackCount: number; corruptCount: number };
      patchBranches: { count: number; plannedCount: number; corruptCount: number };
      frontierSignals: {
        count: number;
        activeCount: number;
        rejectedCount: number;
        supersededCount: number;
        corruptCount: number;
      };
    } } }).data.sidecar;
    expect(payload.connection).toMatchObject({
      configured: true,
      valid: true,
      connectionCount: 1,
      defaultConnectionId: 'agentdock-local',
    });
    expect(payload.connection.connections).toEqual([
      expect.objectContaining({ id: 'agentdock-local', baseUrl: 'http://agentdock.local', hasAuthRef: false }),
    ]);
    expect(payload.cursors).toMatchObject({ count: 1, corruptCount: 1 });
    expect(payload.observations.batchCount).toBe(1);
    expect(payload.observations.semanticObservationCount).toBeGreaterThan(0);
    expect(payload.observations.corruptCount).toBe(1);
    expect(payload.proposals).toMatchObject({ count: 1, pendingCount: 0, validatedCount: 1, corruptCount: 1 });
    expect(payload.validations).toMatchObject({ count: 1, corruptCount: 1 });
    expect(payload.approvalRequests).toMatchObject({ count: 0, pendingCount: 0, corruptCount: 0 });
    expect(payload.snapshots).toMatchObject({ count: 0, corruptCount: 0 });
    expect(payload.rollbacks).toMatchObject({ count: 0, corruptCount: 0 });
    expect(payload.applications).toMatchObject({
      count: 0,
      readyCount: 0,
      appliedCount: 0,
      rolledBackCount: 0,
      corruptCount: 0,
    });
    expect(payload.patchBranches).toMatchObject({ count: 0, plannedCount: 0, corruptCount: 0 });
    expect(payload.frontierSignals).toMatchObject({
      count: 1,
      activeCount: 1,
      rejectedCount: 0,
      supersededCount: 0,
      corruptCount: 1,
    });
    expect(existsSync(join(root, 'memory'))).toBe(false);
    expect(connectErr.read()).toBe('');
    expect(observeErr.read()).toBe('');
    expect(proposeErr.read()).toBe('');
    expect(validateErr.read()).toBe('');
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
