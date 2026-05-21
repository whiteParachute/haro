import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRegistry, ProviderRegistry } from '@haro/core';
import type { AgentEvent, AgentProvider, AgentQueryParams } from '@haro/core/provider';
import { runCli } from '../src/index.js';

class StubProvider implements AgentProvider {
  readonly id = 'codex';

  capabilities() {
    return { streaming: false, toolLoop: false, contextCompaction: false, contextContinuation: true } as const;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async listModels(): Promise<readonly { id: string }[]> {
    return [{ id: 'codex-primary' }];
  }

  async *query(params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
    yield { type: 'result', content: `echo:${params.prompt}`, responseId: 'resp-1' };
  }
}

interface Capture {
  stream: NodeJS.WritableStream;
  read: () => string;
}

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

function runWithCapturedOutput(root: string, argv: readonly string[]) {
  const stdout = captureStream();
  const stderr = captureStream();
  return {
    stdout,
    stderr,
    result: runCli({
      argv,
      root,
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => new Date('2026-05-21T10:00:00.000Z'),
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
      createAdditionalChannels: async () => [],
    }),
  };
}

const targetRef = {
  kind: 'runner-profile',
  id: 'haro-sidecar:runner-profile:error-recovery-policy',
  uri: 'haro://assets/runner-profile/error-recovery-policy',
};

function writeArtifact(root: string, dirName: string, id: string, value: unknown): void {
  const dir = join(root, 'evolution', dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(value, null, 2));
}

function proposal(id: string, contentHash?: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: '给 Haro 运行错误加处理规则',
    status: 'proposed',
    level: 'L1',
    targetKind: 'runner-profile',
    riskLevel: 'medium',
    sourceObservationRefs: [{ kind: 'observation-batch', id: 'obs-1', uri: 'haro://observations/obs-1' }],
    changeSet: [{
      op: 'update',
      targetRef,
      ...(contentHash ? { contentHash } : {}),
      summary: '新增一条 ModelHub timeout 处理规则',
    }],
    testPlan: {
      requiredCommands: ['pnpm -F @haro/cli test -- test/agentdock-sidecar-cli.test.ts'],
      manualChecks: ['核对提案是否只处理一类错误'],
      regressionRisks: ['规则过宽会误导审批人'],
    },
    rollbackPlan: { strategy: '删除该 runner-profile 字段', snapshotRequired: true, rollbackRefs: [] },
    humanReviewRequired: true,
    humanApprovalRefs: [],
    createdAt: '2026-05-21T09:00:00.000Z',
    updatedAt: '2026-05-21T09:00:00.000Z',
    ...overrides,
  };
}

function approvalRequest(id: string, proposalId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    proposalId,
    validationId: `validation_${proposalId}`,
    status: 'pending',
    title: '给 Haro 运行错误加处理规则',
    level: 'L1',
    targetKind: 'runner-profile',
    riskLevel: 'medium',
    sourceRef: { kind: 'proposal', id: proposalId, uri: `haro://proposals/${proposalId}` },
    validationRef: { kind: 'validation', id: `validation_${proposalId}`, uri: `haro://validations/validation_${proposalId}` },
    whyChange: ['旧提案没有说清具体错误。'],
    howChange: ['本轮只做 dry-run 扫描。'],
    expectedBenefits: ['减少重复提案干扰。'],
    scope: ['只读扫描，不写数据。'],
    requiredTests: [],
    manualChecks: [],
    regressionRisks: [],
    rollbackPlan: { strategy: '无需回滚；dry-run 不写入。', snapshotRequired: false, rollbackRefs: [] },
    decisionOptions: ['approve', 'reject', 'request-changes'],
    reviewerInstruction: '请人工复核。',
    humanReviewRequired: true,
    evidenceRefs: [],
    createdAt: '2026-05-21T09:10:00.000Z',
    updatedAt: '2026-05-21T09:10:00.000Z',
    ...overrides,
  };
}

function approvalDecision(id: string, approvalRequestId: string, proposalId: string, decision: string) {
  return {
    id,
    approvalRequestId,
    proposalId,
    validationId: `validation_${proposalId}`,
    decision,
    ...(decision === 'request-changes' || decision === 'reject'
      ? { direction: '这个提案像元策略，不是一个具体改动。' }
      : {}),
    reviewer: { source: 'test', role: 'supervisor' },
    sourceRef: { kind: 'approval-request', id: approvalRequestId, uri: `haro://approval-requests/${approvalRequestId}` },
    createdAt: '2026-05-21T09:20:00.000Z',
    updatedAt: '2026-05-21T09:20:00.000Z',
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

describe('haro self-heal duplicates --dry-run', () => {
  const roots: string[] = [];

  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'haro-self-heal-'));
    roots.push(root);
    return root;
  }

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds a pending residual duplicate with the same contentHash without writing artifacts', async () => {
    const root = tempRoot();
    writeArtifact(root, 'proposals', 'proposal_prior', proposal('proposal_prior', 'hash-1'));
    writeArtifact(root, 'approval-requests', 'approval_prior', approvalRequest('approval_prior', 'proposal_prior'));
    writeArtifact(root, 'approval-decisions', 'decision_prior', approvalDecision('decision_prior', 'approval_prior', 'proposal_prior', 'request-changes'));
    writeArtifact(root, 'proposals', 'proposal_current', proposal('proposal_current', 'hash-1'));
    writeArtifact(root, 'approval-requests', 'approval_current', approvalRequest('approval_current', 'proposal_current'));
    const before = readJson(join(root, 'evolution', 'proposals', 'proposal_current.json'));

    const { result, stdout } = runWithCapturedOutput(root, ['self-heal', 'duplicates', '--dry-run', '--human']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    expect(stdout.read()).toContain('Self-heal duplicate approval requests: dry-run');
    expect(stdout.read()).toContain('approval_current');
    expect(stdout.read()).toContain('proposal_prior');
    expect(stdout.read()).toContain('decision_prior');
    expect(stdout.read()).toContain('matchType: contentHash');
    expect(stdout.read()).toContain('dry-run: no writes');
    expect(readdirSync(join(root, 'evolution', 'approval-decisions'))).toEqual(['decision_prior.json']);
    expect(existsSync(join(root, 'evolution', 'blocked-proposal-events'))).toBe(false);
    expect(readJson(join(root, 'evolution', 'proposals', 'proposal_current.json'))).toEqual(before);
  });

  it('does not process an already approved request', async () => {
    const root = tempRoot();
    writeArtifact(root, 'proposals', 'proposal_current', proposal('proposal_current', 'hash-1'));
    writeArtifact(root, 'approval-requests', 'approval_current', approvalRequest('approval_current', 'proposal_current'));
    writeArtifact(root, 'approval-decisions', 'decision_approved', approvalDecision('decision_approved', 'approval_current', 'proposal_current', 'approve'));

    const { result, stdout } = runWithCapturedOutput(root, ['self-heal', 'duplicates', '--dry-run', '--human']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    expect(stdout.read()).toContain('Candidates: 0');
    expect(stdout.read()).toContain('already decided: approve');
  });

  it('routes uncertain artifacts to manual check and keeps the fixture unchanged', async () => {
    const root = tempRoot();
    writeArtifact(root, 'approval-requests', 'approval_missing_proposal', approvalRequest('approval_missing_proposal', 'proposal_missing'));
    writeArtifact(root, 'proposals', 'proposal_no_hash', proposal('proposal_no_hash'));
    writeArtifact(root, 'approval-requests', 'approval_no_hash', approvalRequest('approval_no_hash', 'proposal_no_hash'));
    const proposalBefore = readJson(join(root, 'evolution', 'proposals', 'proposal_no_hash.json'));

    const { result, stdout } = runWithCapturedOutput(root, ['self-heal', 'duplicates', '--dry-run', '--human']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    expect(stdout.read()).toContain('Manual check: 2');
    expect(stdout.read()).toContain('current proposal artifact missing');
    expect(stdout.read()).toContain('current proposal has no contentHash');
    expect(existsSync(join(root, 'evolution', 'approval-decisions'))).toBe(false);
    expect(existsSync(join(root, 'evolution', 'blocked-proposal-events'))).toBe(false);
    expect(readJson(join(root, 'evolution', 'proposals', 'proposal_no_hash.json'))).toEqual(proposalBefore);
  });

  it('exposes structured JSON dry-run results', async () => {
    const root = tempRoot();
    writeArtifact(root, 'proposals', 'proposal_prior', proposal('proposal_prior', 'hash-1'));
    writeArtifact(root, 'approval-requests', 'approval_prior', approvalRequest('approval_prior', 'proposal_prior'));
    writeArtifact(root, 'approval-decisions', 'decision_prior', approvalDecision('decision_prior', 'approval_prior', 'proposal_prior', 'reject'));
    writeArtifact(root, 'proposals', 'proposal_current', proposal('proposal_current', 'hash-1'));
    writeArtifact(root, 'approval-requests', 'approval_current', approvalRequest('approval_current', 'proposal_current'));

    const { result, stdout } = runWithCapturedOutput(root, ['self-heal', 'duplicates', '--dry-run', '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    const parsed = JSON.parse(stdout.read()) as { data: { dryRun: boolean; candidateCount: number; candidates: Array<{ matchType: string }> } };
    expect(parsed.data.dryRun).toBe(true);
    expect(parsed.data.candidateCount).toBe(1);
    expect(parsed.data.candidates[0]?.matchType).toBe('contentHash');
  });
});
