import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
      now: () => new Date('2026-05-21T14:00:00.000Z'),
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
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

function proposal(id: string, overrides: Record<string, unknown> = {}) {
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
      contentHash: `sha256:${id}`,
      summary: '新增一条 ModelHub timeout 处理规则',
    }],
    testPlan: {
      requiredCommands: ['pnpm -F @haro/cli test -- test/feedback-revision-cli.test.ts'],
      manualChecks: ['核对 dry-run planner 输出'],
      regressionRisks: ['planner 误判会生成无效修订计划'],
    },
    rollbackPlan: { strategy: 'dry-run 不写数据，无需回滚。', snapshotRequired: false, rollbackRefs: [] },
    humanReviewRequired: true,
    humanApprovalRefs: [],
    createdAt: '2026-05-21T13:00:00.000Z',
    updatedAt: '2026-05-21T13:00:00.000Z',
    ...overrides,
  };
}

function approvalRequest(id: string, proposalId: string) {
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
    howChange: ['本轮只做 dry-run 规划。'],
    expectedBenefits: ['减少无效重复修改。'],
    scope: ['只读规划，不写数据。'],
    requiredTests: [],
    manualChecks: [],
    regressionRisks: [],
    rollbackPlan: { strategy: 'dry-run 不写入，无需回滚。', snapshotRequired: false, rollbackRefs: [] },
    decisionOptions: ['approve', 'reject', 'request-changes'],
    reviewerInstruction: '请人工复核。',
    humanReviewRequired: true,
    evidenceRefs: [],
    createdAt: '2026-05-21T13:05:00.000Z',
    updatedAt: '2026-05-21T13:05:00.000Z',
  };
}

function validation(proposalId: string) {
  return {
    id: `validation_${proposalId}`,
    proposalId,
    riskVerdict: 'medium',
    requiredTests: ['git diff --check'],
    rollbackReady: true,
    applyEligible: true,
    blockingReasons: [],
    evidenceRefs: [],
    createdAt: '2026-05-21T13:07:00.000Z',
  };
}

function approvalDecision(
  id: string,
  approvalRequestId: string,
  proposalId: string,
  decision: 'approve' | 'reject' | 'request-changes',
  direction = '请收窄范围，只针对 ModelHub timeout 做具体 change。',
) {
  return {
    id,
    approvalRequestId,
    proposalId,
    validationId: `validation_${proposalId}`,
    decision,
    ...(decision === 'request-changes' || decision === 'reject' ? { direction } : {}),
    reviewer: { source: 'test', role: 'owner' },
    sourceRef: { kind: 'approval-request', id: approvalRequestId, uri: `haro://approval-requests/${approvalRequestId}` },
    createdAt: '2026-05-21T13:10:00.000Z',
    updatedAt: '2026-05-21T13:10:00.000Z',
  };
}

function revisionMetadata(revisionDepth: number) {
  return {
    revisionId: 'revision_prior',
    rootProposalId: 'proposal_root',
    revisionOfProposalId: 'proposal_parent',
    revisionDepth,
    sourceApprovalRequestId: 'approval_parent',
    sourceDecisionId: 'decision_parent',
    sourceDecisionDirection: '上一轮意见。',
    sourceConversationRefs: [],
    supersedesProposalIds: ['proposal_parent'],
    supersedesBlockedEventIds: [],
    resubmissionReason: '上一轮 request-changes 后重新提交。',
    incorporatedFeedback: [],
    unresolvedFeedback: [],
    noOpCheck: {
      verdict: 'substantive-change',
      priorProposalContentHashes: ['sha256:prior'],
      revisedProposalContentHashes: ['sha256:current'],
      revisionDepth,
      changedFields: ['changeSet'],
      reason: '已有实际变更。',
    },
    createdAt: '2026-05-21T12:00:00.000Z',
    updatedAt: '2026-05-21T12:00:00.000Z',
  };
}

function seedDecision(root: string, direction: string, decision: 'approve' | 'reject' | 'request-changes' = 'request-changes', proposalOverrides: Record<string, unknown> = {}) {
  const proposalId = `proposal_${Math.random().toString(16).slice(2)}`;
  const approvalRequestId = `approval_${proposalId}`;
  const decisionId = `decision_${proposalId}`;
  writeArtifact(root, 'proposals', proposalId, proposal(proposalId, proposalOverrides));
  writeArtifact(root, 'validations', `validation_${proposalId}`, validation(proposalId));
  writeArtifact(root, 'approval-requests', approvalRequestId, approvalRequest(approvalRequestId, proposalId));
  writeArtifact(root, 'approval-decisions', decisionId, approvalDecision(decisionId, approvalRequestId, proposalId, decision, direction));
  return { proposalId, approvalRequestId, decisionId };
}


function parseJsonData<T>(stdout: Capture): T {
  const payload = JSON.parse(stdout.read()) as { ok: boolean; data: T };
  expect(payload.ok).toBe(true);
  return payload.data;
}

function evolutionFileCounts(root: string) {
  const names = ['proposals', 'validations', 'approval-requests', 'approval-decisions', 'feedback-revisions', 'blocked-proposal-events'];
  return Object.fromEntries(names.map((name) => {
    const dir = join(root, 'evolution', name);
    return [name, existsSync(dir) ? readdirSync(dir).sort() : []];
  }));
}

describe('haro revise feedback --dry-run [FEAT-076B]', () => {
  const roots: string[] = [];

  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'haro-revise-feedback-'));
    roots.push(root);
    return root;
  }

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('plans a scope-reduction request-changes rewrite without writing files', async () => {
    const root = tempRoot();
    const { decisionId, approvalRequestId, proposalId } = seedDecision(root, '请收窄范围，只针对 ModelHub timeout 做一个具体 change。');
    const before = evolutionFileCounts(root);
    const { result, stdout } = runWithCapturedOutput(root, ['revise', 'feedback', '--dry-run', '--decision-id', decisionId, '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    const payload = parseJsonData<{
      dryRun: boolean;
      wouldWrite: boolean;
      decisionId: string;
      approvalRequestId: string;
      proposalId: string;
      plannerVerdict: string;
      parsedRequirements: Array<{ category: string }>;
    }>(stdout);
    expect(payload).toMatchObject({ dryRun: true, wouldWrite: false, decisionId, approvalRequestId, proposalId, plannerVerdict: 'can-rewrite' });
    expect(payload.parsedRequirements.map((item) => item.category)).toContain('scope-reduction');
    expect(evolutionFileCounts(root)).toEqual(before);
  });

  it('classifies evidence-required and risk-rollback-change feedback', async () => {
    const root = tempRoot();
    const { decisionId } = seedDecision(root, '请列出错误样本和 turn 证据，也要说明风险和回滚。');
    const { result, stdout } = runWithCapturedOutput(root, ['revise', 'feedback', '--dry-run', '--decision-id', decisionId, '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    const payload = parseJsonData<{ plannerVerdict: string; parsedRequirements: Array<{ category: string }> }>(stdout);
    expect(payload.plannerVerdict).toBe('can-rewrite');
    expect(payload.parsedRequirements.map((item) => item.category)).toEqual(expect.arrayContaining(['evidence-required', 'risk-rollback-change']));
  });

  it('returns needs-more-info for clarification-only feedback', async () => {
    const root = tempRoot();
    const { decisionId } = seedDecision(root, '我看不懂，什么是 Haro 运行出现错误？请说明。');
    const { result, stdout } = runWithCapturedOutput(root, ['revise', 'feedback', '--dry-run', '--decision-id', decisionId, '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    const payload = parseJsonData<{ plannerVerdict: string; parsedRequirements: Array<{ category: string }> }>(stdout);
    expect(payload.plannerVerdict).toBe('needs-more-info');
    expect(payload.parsedRequirements.map((item) => item.category)).toEqual(['needs-more-info']);
  });

  it('blocks out-of-scope or policy-blocked feedback', async () => {
    const root = tempRoot();
    const { decisionId } = seedDecision(root, '这个不在范围，安全边界不允许改。');
    const { result, stdout } = runWithCapturedOutput(root, ['revise', 'feedback', '--dry-run', '--decision-id', decisionId, '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    const payload = parseJsonData<{ plannerVerdict: string; blockedReasons: string[]; parsedRequirements: Array<{ category: string }> }>(stdout);
    expect(payload.plannerVerdict).toBe('blocked');
    expect(payload.blockedReasons.length).toBeGreaterThan(0);
    expect(payload.parsedRequirements.map((item) => item.category)).toEqual(expect.arrayContaining(['out-of-scope', 'policy-blocked']));
  });

  it('does not process non request-changes decisions', async () => {
    const root = tempRoot();
    const { decisionId } = seedDecision(root, '', 'approve');
    const { result, stdout } = runWithCapturedOutput(root, ['revise', 'feedback', '--dry-run', '--decision-id', decisionId, '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    const payload = parseJsonData<{ plannerVerdict: string; skippedReasons: string[] }>(stdout);
    expect(payload.plannerVerdict).toBe('manual-check');
    expect(payload.skippedReasons[0]).toContain('only request-changes');
  });

  it('fails closed without dry-run and does not write files', async () => {
    const root = tempRoot();
    const { decisionId } = seedDecision(root, '请收窄范围。');
    const before = evolutionFileCounts(root);
    const { result, stderr } = runWithCapturedOutput(root, ['revise', 'feedback', '--decision-id', decisionId, '--human']);

    await expect(result).resolves.toMatchObject({ exitCode: 2 });
    expect(stderr.read()).toContain('only supports --dry-run');
    expect(evolutionFileCounts(root)).toEqual(before);
  });

  it('manual-checks when next revisionDepth exceeds the default limit', async () => {
    const root = tempRoot();
    const { decisionId } = seedDecision(root, '请收窄范围。', 'request-changes', { revisionMetadata: revisionMetadata(3) });
    const { result, stdout } = runWithCapturedOutput(root, ['revise', 'feedback', '--dry-run', '--decision-id', decisionId, '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    const payload = parseJsonData<{ plannerVerdict: string; revisionDepth: number; revisionDepthLimit: number; exceedsRevisionDepthLimit: boolean; manualCheckReasons: string[] }>(stdout);
    expect(payload).toMatchObject({ plannerVerdict: 'manual-check', revisionDepth: 4, revisionDepthLimit: 3, exceedsRevisionDepthLimit: true });
    expect(payload.manualCheckReasons.join('\n')).toContain('exceeds default limit');
  });

  it('keeps JSON output shape stable for dry-run plans', async () => {
    const root = tempRoot();
    const { decisionId } = seedDecision(root, '请收窄范围。');
    const { result, stdout } = runWithCapturedOutput(root, ['revise', 'feedback', '--dry-run', '--decision-id', decisionId, '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    const payload = parseJsonData<Record<string, unknown>>(stdout);
    expect(Object.keys(payload).sort()).toEqual(expect.arrayContaining([
      'command',
      'mode',
      'dryRun',
      'wouldWrite',
      'planCount',
      'plans',
      'decisionId',
      'approvalRequestId',
      'proposalId',
      'parsedRequirements',
      'plannerVerdict',
      'revisionDepth',
      'revisionDepthLimit',
      'exceedsRevisionDepthLimit',
    ]));
    expect((payload.plans as unknown[])).toHaveLength(1);
  });
});
