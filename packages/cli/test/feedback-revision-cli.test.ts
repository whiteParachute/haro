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

function revisionMetadata(revisionDepth: number, overrides: Record<string, unknown> = {}) {
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
    ...overrides,
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

function feedbackContext(priorDecisionId: string, priorProposalId: string) {
  return {
    priorDecisionId,
    priorProposalId,
    priorDirection: '请收窄范围，只针对具体错误。',
    incorporatedAt: '2026-05-21T13:30:00.000Z',
    incorporationNote: '测试修订提案引用上一次意见。',
  };
}

function seedPendingRevision(
  root: string,
  source: { proposalId: string; approvalRequestId: string; decisionId: string },
  proposalOverrides: Record<string, unknown> = {},
) {
  const proposalId = `proposal_revision_${Math.random().toString(16).slice(2)}`;
  const approvalRequestId = `approval_${proposalId}`;
  const base = proposal(source.proposalId);
  const revision = proposal(proposalId, {
    title: base.title,
    changeSet: base.changeSet,
    feedbackSemanticFingerprint: 'same-semantic-fingerprint',
    feedbackContext: feedbackContext(source.decisionId, source.proposalId),
    revisionMetadata: revisionMetadata(1, {
      revisionId: `revision_${proposalId}`,
      rootProposalId: source.proposalId,
      revisionOfProposalId: source.proposalId,
      sourceApprovalRequestId: source.approvalRequestId,
      sourceDecisionId: source.decisionId,
      sourceDecisionDirection: '请收窄范围，只针对具体错误。',
      supersedesProposalIds: [source.proposalId],
      noOpCheck: {
        verdict: 'substantive-change',
        priorProposalContentHashes: [`sha256:${source.proposalId}`],
        revisedProposalContentHashes: [`sha256:${proposalId}`],
        revisionDepth: 1,
        changedFields: ['changeSet'],
        reason: 'fixture default substantive revision.',
      },
    }),
    ...proposalOverrides,
  });
  writeArtifact(root, 'proposals', proposalId, revision);
  writeArtifact(root, 'approval-requests', approvalRequestId, approvalRequest(approvalRequestId, proposalId));
  return { proposalId, approvalRequestId };
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
    expect(stderr.read()).toContain('requires exactly one of --dry-run or --confirm');
    expect(evolutionFileCounts(root)).toEqual(before);
  });

  it('rejects dry-run plus confirm and does not write files', async () => {
    const root = tempRoot();
    const { decisionId } = seedDecision(root, '请收窄范围。');
    const before = evolutionFileCounts(root);
    const { result, stderr } = runWithCapturedOutput(root, ['revise', 'feedback', '--dry-run', '--confirm', '--decision-id', decisionId, '--human']);

    await expect(result).resolves.toMatchObject({ exitCode: 2 });
    expect(stderr.read()).toMatch(/exactly one|--dry-run|--confirm/iu);
    expect(evolutionFileCounts(root)).toEqual(before);
  });

  it('rejects decision-id and pending together and does not write files', async () => {
    const root = tempRoot();
    const { decisionId } = seedDecision(root, '请收窄范围。');
    const before = evolutionFileCounts(root);
    const { result, stderr } = runWithCapturedOutput(root, ['revise', 'feedback', '--dry-run', '--decision-id', decisionId, '--pending', '--human']);

    await expect(result).resolves.toMatchObject({ exitCode: 2 });
    expect(stderr.read()).toMatch(/not both|互斥/iu);
    expect(evolutionFileCounts(root)).toEqual(before);
  });

  it('confirms a request-changes rewrite by writing revised artifacts and a new approval request', async () => {
    const root = tempRoot();
    const source = seedDecision(root, '请收窄范围，只针对 ModelHub timeout 做一个具体 change，并补充证据和回滚。');
    const before = evolutionFileCounts(root);
    const { result, stdout } = runWithCapturedOutput(root, ['revise', 'feedback', '--confirm', '--decision-id', source.decisionId, '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    const payload = parseJsonData<{
      mode: string;
      dryRun: boolean;
      wouldWrite: boolean;
      confirmed: boolean;
      revisedProposalId: string;
      revisedValidationId: string;
      revisedApprovalRequestId: string;
      feedbackRevisionId: string;
      actualActions: {
        wroteRevisedProposal: boolean;
        wroteValidation: boolean;
        wroteFeedbackRevision: boolean;
        wroteApprovalRequest: boolean;
        idempotent: boolean;
      };
    }>(stdout);
    expect(payload).toMatchObject({
      mode: 'confirm',
      dryRun: false,
      wouldWrite: true,
      confirmed: true,
      actualActions: {
        wroteRevisedProposal: true,
        wroteValidation: true,
        wroteFeedbackRevision: true,
        wroteApprovalRequest: true,
        idempotent: false,
      },
    });

    const after = evolutionFileCounts(root);
    expect(after.proposals).toHaveLength(before.proposals.length + 1);
    expect(after.validations).toHaveLength(before.validations.length + 1);
    expect(after['approval-requests']).toHaveLength(before['approval-requests'].length + 1);
    expect(after['feedback-revisions']).toHaveLength(before['feedback-revisions'].length + 1);
    expect(after['approval-decisions']).toEqual(before['approval-decisions']);
    expect(after['blocked-proposal-events']).toEqual(before['blocked-proposal-events']);

    const revisedProposal = JSON.parse(readFileSync(join(root, 'evolution', 'proposals', `${payload.revisedProposalId}.json`), 'utf8')) as {
      id: string;
      status: string;
      revisionMetadata: { sourceDecisionId: string; noOpCheck: { verdict: string }; supersedesProposalIds: string[] };
    };
    expect(revisedProposal).toMatchObject({ id: payload.revisedProposalId, status: 'validated' });
    expect(revisedProposal.revisionMetadata).toMatchObject({
      sourceDecisionId: source.decisionId,
      noOpCheck: { verdict: 'substantive-change' },
      supersedesProposalIds: [source.proposalId],
    });

    const feedbackRevision = JSON.parse(readFileSync(join(root, 'evolution', 'feedback-revisions', `${payload.feedbackRevisionId}.json`), 'utf8')) as {
      status: string;
      revisedProposalId: string;
      revisedValidationId: string;
      revisedApprovalRequestId: string;
      sourceDecisionId: string;
    };
    expect(feedbackRevision).toMatchObject({
      status: 'revised',
      revisedProposalId: payload.revisedProposalId,
      revisedValidationId: payload.revisedValidationId,
      revisedApprovalRequestId: payload.revisedApprovalRequestId,
      sourceDecisionId: source.decisionId,
    });

    const approval = JSON.parse(readFileSync(join(root, 'evolution', 'approval-requests', `${payload.revisedApprovalRequestId}.json`), 'utf8')) as {
      proposalId: string;
      validationId: string;
      whyChange: string[];
    };
    expect(approval).toMatchObject({ proposalId: payload.revisedProposalId, validationId: payload.revisedValidationId });
    expect(approval.whyChange.join('\n')).toContain('上一次审批意见');
  });

  it('is idempotent when confirming the same decision twice', async () => {
    const root = tempRoot();
    const source = seedDecision(root, '请收窄范围，只针对 ModelHub timeout 做一个具体 change。');
    const first = runWithCapturedOutput(root, ['revise', 'feedback', '--confirm', '--decision-id', source.decisionId, '--json']);
    await expect(first.result).resolves.toMatchObject({ exitCode: 0 });
    const firstPayload = parseJsonData<{ revisedProposalId: string; feedbackRevisionId: string }>(first.stdout);
    const afterFirst = evolutionFileCounts(root);

    const second = runWithCapturedOutput(root, ['revise', 'feedback', '--confirm', '--decision-id', source.decisionId, '--json']);
    await expect(second.result).resolves.toMatchObject({ exitCode: 0 });
    const secondPayload = parseJsonData<{ revisedProposalId: string; feedbackRevisionId: string; actualActions: { idempotent: boolean; wroteRevisedProposal: boolean } }>(second.stdout);
    expect(secondPayload).toMatchObject({
      revisedProposalId: firstPayload.revisedProposalId,
      feedbackRevisionId: firstPayload.feedbackRevisionId,
      actualActions: { idempotent: true, wroteRevisedProposal: false },
    });
    expect(evolutionFileCounts(root)).toEqual(afterFirst);
  });

  it('does not write on stale decisions, no-op/manual-check plans, or confirm pending', async () => {
    const staleRoot = tempRoot();
    const staleSource = seedDecision(staleRoot, '请收窄范围。');
    writeArtifact(staleRoot, 'approval-decisions', 'decision_later_same_target', {
      ...approvalDecision('decision_later_same_target', staleSource.approvalRequestId, staleSource.proposalId, 'request-changes', '后续意见。'),
      createdAt: '2026-05-21T13:20:00.000Z',
      updatedAt: '2026-05-21T13:20:00.000Z',
    });
    const staleBefore = evolutionFileCounts(staleRoot);
    const stale = runWithCapturedOutput(staleRoot, ['revise', 'feedback', '--confirm', '--decision-id', staleSource.decisionId, '--json']);
    await expect(stale.result).resolves.toMatchObject({ exitCode: 0 });
    const stalePayload = parseJsonData<{ confirmed: boolean; actualActions: { wroteRevisedProposal: boolean } }>(stale.stdout);
    expect(stalePayload.confirmed).toBe(false);
    expect(stalePayload.actualActions.wroteRevisedProposal).toBe(false);
    expect(evolutionFileCounts(staleRoot)).toEqual(staleBefore);

    const noOpRoot = tempRoot();
    const noOpSource = seedDecision(noOpRoot, '请收窄范围。');
    seedPendingRevision(noOpRoot, noOpSource, {
      revisionMetadata: revisionMetadata(1, {
        rootProposalId: noOpSource.proposalId,
        revisionOfProposalId: noOpSource.proposalId,
        sourceApprovalRequestId: noOpSource.approvalRequestId,
        sourceDecisionId: noOpSource.decisionId,
        supersedesProposalIds: [noOpSource.proposalId],
        noOpCheck: {
          verdict: 'no-op',
          priorProposalContentHashes: [`sha256:${noOpSource.proposalId}`],
          revisedProposalContentHashes: [`sha256:${noOpSource.proposalId}`],
          revisionDepth: 1,
          changedFields: [],
          reason: 'metadata-only fixture.',
        },
      }),
    });
    const noOpBefore = evolutionFileCounts(noOpRoot);
    const noOp = runWithCapturedOutput(noOpRoot, ['revise', 'feedback', '--confirm', '--decision-id', noOpSource.decisionId, '--json']);
    await expect(noOp.result).resolves.toMatchObject({ exitCode: 0 });
    const noOpPayload = parseJsonData<{ confirmed: boolean; actualActions: { wroteFeedbackRevision: boolean } }>(noOp.stdout);
    expect(noOpPayload.confirmed).toBe(false);
    expect(noOpPayload.actualActions.wroteFeedbackRevision).toBe(false);
    expect(evolutionFileCounts(noOpRoot)).toEqual(noOpBefore);

    const pendingRoot = tempRoot();
    seedDecision(pendingRoot, '请收窄范围。');
    const pendingBefore = evolutionFileCounts(pendingRoot);
    const pending = runWithCapturedOutput(pendingRoot, ['revise', 'feedback', '--confirm', '--pending', '--human']);
    await expect(pending.result).resolves.toMatchObject({ exitCode: 2 });
    expect(pending.stderr.read()).toMatch(/confirm --pending|not implemented/iu);
    expect(evolutionFileCounts(pendingRoot)).toEqual(pendingBefore);
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

  it('reports REVISION_NO_OP for a metadata-only pending revision', async () => {
    const root = tempRoot();
    const source = seedDecision(root, '请收窄范围，只针对具体错误。');
    seedPendingRevision(root, source, {
      feedbackSemanticFingerprint: 'same-semantic-fingerprint',
      revisionMetadata: revisionMetadata(1, {
        revisionId: 'revision_metadata_only',
        rootProposalId: source.proposalId,
        revisionOfProposalId: source.proposalId,
        sourceApprovalRequestId: source.approvalRequestId,
        sourceDecisionId: source.decisionId,
        supersedesProposalIds: [source.proposalId],
        noOpCheck: {
          verdict: 'no-op',
          priorProposalContentHashes: [`sha256:${source.proposalId}`],
          revisedProposalContentHashes: [`sha256:${source.proposalId}`],
          revisionDepth: 1,
          changedFields: [],
          reason: 'metadata-only fixture.',
        },
      }),
    });

    const { result, stdout } = runWithCapturedOutput(root, ['revise', 'feedback', '--dry-run', '--decision-id', source.decisionId, '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    const payload = parseJsonData<{ noOpCheck: { verdict: string }; validationBlockingReasons: string[]; blockedReasons: string[] }>(stdout);
    expect(payload.noOpCheck.verdict).toBe('no-op');
    expect(payload.validationBlockingReasons.join('\n')).toContain('REVISION_NO_OP');
    expect(payload.blockedReasons.join('\n')).toContain('REVISION_NO_OP');
  });

  it('manual-checks partial contentHash coverage instead of comparing a filtered subset', async () => {
    const root = tempRoot();
    const partialChangeSet = [
      {
        op: 'update',
        targetRef,
        contentHash: 'sha256:partial-a',
        summary: '第一条带 hash。',
      },
      {
        op: 'update',
        targetRef: { ...targetRef, id: 'haro-sidecar:runner-profile:secondary' },
        summary: '第二条缺 hash。',
      },
    ];
    const source = seedDecision(root, '请补充证据。', 'request-changes', { changeSet: partialChangeSet });
    seedPendingRevision(root, source, { changeSet: partialChangeSet });
    const { result, stdout } = runWithCapturedOutput(root, ['revise', 'feedback', '--dry-run', '--decision-id', source.decisionId, '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    const payload = parseJsonData<{ noOpCheck: { verdict: string; reason: string }; validationBlockingReasons: string[] }>(stdout);
    expect(payload.noOpCheck.verdict).toBe('manual-check');
    expect(payload.noOpCheck.reason).toContain('partial contentHash');
    expect(payload.validationBlockingReasons.join('\n')).toContain('FEEDBACK_REWRITE_MANUAL_CHECK_REQUIRED');
  });

  it('keeps readability-only feedback as a controlled manual-check exception', async () => {
    const root = tempRoot();
    const { decisionId } = seedDecision(root, '请把文案说人话，提升可读性。');
    const { result, stdout } = runWithCapturedOutput(root, ['revise', 'feedback', '--dry-run', '--decision-id', decisionId, '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    const payload = parseJsonData<{
      plannerVerdict: string;
      parsedRequirements: Array<{ category: string }>;
      noOpCheck: { verdict: string; changedFields: string[] };
      validationBlockingReasons: string[];
    }>(stdout);
    expect(payload.parsedRequirements.map((item) => item.category)).toContain('readability');
    expect(payload.plannerVerdict).toBe('manual-check');
    expect(payload.noOpCheck).toMatchObject({ verdict: 'manual-check' });
    expect(payload.noOpCheck.changedFields).toEqual(expect.arrayContaining(['title', 'description']));
    expect(payload.validationBlockingReasons.join('\n')).toContain('FEEDBACK_REWRITE_MANUAL_CHECK_REQUIRED');
  });

  it('manual-checks stale decisions, newer pending revisions, and missing artifacts conservatively', async () => {
    const root = tempRoot();
    const source = seedDecision(root, '请收窄范围。');
    writeArtifact(root, 'approval-decisions', 'decision_later_same_target', {
      ...approvalDecision('decision_later_same_target', source.approvalRequestId, source.proposalId, 'request-changes', '后续意见。'),
      createdAt: '2026-05-21T13:20:00.000Z',
      updatedAt: '2026-05-21T13:20:00.000Z',
    });
    seedPendingRevision(root, source, {
      changeSet: [{
        op: 'update',
        targetRef,
        contentHash: 'sha256:real-revision',
        summary: '真的改变处理规则。',
      }],
    });
    const { result, stdout } = runWithCapturedOutput(root, ['revise', 'feedback', '--dry-run', '--decision-id', source.decisionId, '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    const payload = parseJsonData<{ plannerVerdict: string; manualCheckReasons: string[]; validationBlockingReasons: string[] }>(stdout);
    expect(payload.plannerVerdict).toBe('manual-check');
    expect(payload.manualCheckReasons.join('\n')).toContain('stale decision');
    expect(payload.manualCheckReasons.join('\n')).toContain('newer revision');
    expect(payload.validationBlockingReasons.join('\n')).toContain('STALE_FEEDBACK_DECISION');

    const missingRoot = tempRoot();
    writeArtifact(missingRoot, 'approval-decisions', 'decision_missing_artifacts', approvalDecision(
      'decision_missing_artifacts',
      'approval_missing',
      'proposal_missing',
      'request-changes',
      '请补充证据。',
    ));
    const missing = runWithCapturedOutput(missingRoot, ['revise', 'feedback', '--dry-run', '--decision-id', 'decision_missing_artifacts', '--json']);
    await expect(missing.result).resolves.toMatchObject({ exitCode: 0 });
    const missingPayload = parseJsonData<{ plannerVerdict: string; manualCheckReasons: string[] }>(missing.stdout);
    expect(missingPayload.plannerVerdict).toBe('manual-check');
    expect(missingPayload.manualCheckReasons.join('\n')).toContain('source proposal artifact missing');
  });

  it('validation blocks revised proposals with feedback revision blockers', async () => {
    const root = tempRoot();
    const source = seedDecision(root, '请收窄范围。');
    const revised = seedPendingRevision(root, source, {
      revisionMetadata: revisionMetadata(1, {
        revisionId: 'revision_blocked',
        rootProposalId: source.proposalId,
        revisionOfProposalId: source.proposalId,
        sourceApprovalRequestId: source.approvalRequestId,
        sourceDecisionId: source.decisionId,
        supersedesProposalIds: [source.proposalId],
        unresolvedFeedback: [{
          id: 'requirement_unresolved',
          category: 'evidence-required',
          disposition: 'needs-human',
          userText: '请补证据。',
          normalizedRequirement: '补充证据。',
          proposalChangeRefs: [],
          evidenceRefs: [],
          explanation: 'fixture unresolved feedback.',
        }],
        noOpCheck: {
          verdict: 'no-op',
          priorProposalContentHashes: [`sha256:${source.proposalId}`],
          revisedProposalContentHashes: [`sha256:${source.proposalId}`],
          revisionDepth: 1,
          changedFields: [],
          reason: 'metadata-only fixture.',
        },
      }),
    });
    const { result, stdout } = runWithCapturedOutput(root, ['validate', '--pending', '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    const payload = parseJsonData<{ validations: Array<{ proposalId: string; applyEligible: boolean; blockingReasons: string[] }> }>(stdout);
    const validationReport = payload.validations.find((item) => item.proposalId === revised.proposalId);
    expect(validationReport?.applyEligible).toBe(false);
    const reasons = validationReport?.blockingReasons.join('\n') ?? '';
    expect(reasons).toContain('REVISION_NO_OP');
    expect(reasons).toContain('UNRESOLVED_FEEDBACK');
  });

  it('allows a substantive revised proposal without feedback revision blockers', async () => {
    const root = tempRoot();
    const source = seedDecision(root, '请收窄范围，并补充具体证据。');
    const revised = seedPendingRevision(root, source, {
      changeSet: [{
        op: 'update',
        targetRef,
        contentHash: 'sha256:substantive-revision',
        summary: '只新增 ModelHub timeout 的具体处理规则。',
      }],
      revisionMetadata: revisionMetadata(1, {
        revisionId: 'revision_substantive_happy_path',
        rootProposalId: source.proposalId,
        revisionOfProposalId: source.proposalId,
        sourceApprovalRequestId: source.approvalRequestId,
        sourceDecisionId: source.decisionId,
        sourceDecisionDirection: '请收窄范围，并补充具体证据。',
        supersedesProposalIds: [source.proposalId],
        incorporatedFeedback: [{
          id: 'requirement_scope',
          category: 'scope-reduction',
          disposition: 'incorporated',
          userText: '请收窄范围。',
          normalizedRequirement: '只针对 ModelHub timeout。',
          proposalChangeRefs: [{ kind: 'change-set', id: '0' }],
          evidenceRefs: [],
          explanation: '修订 changeSet 已收窄为一条具体规则。',
        }],
        unresolvedFeedback: [],
        noOpCheck: {
          verdict: 'substantive-change',
          priorProposalContentHashes: [`sha256:${source.proposalId}`],
          revisedProposalContentHashes: ['sha256:substantive-revision'],
          priorSemanticFingerprint: 'prior-semantic',
          revisedSemanticFingerprint: 'revised-semantic',
          revisionDepth: 1,
          changedFields: ['changeSet', 'testPlan', 'rollbackPlan'],
          reason: '修订包含实质 changeSet 和测试计划变化。',
        },
      }),
    });

    const { result, stdout } = runWithCapturedOutput(root, ['validate', '--pending', '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    const payload = parseJsonData<{ validations: Array<{ proposalId: string; blockingReasons: string[] }> }>(stdout);
    const validationReport = payload.validations.find((item) => item.proposalId === revised.proposalId);
    expect(validationReport).toBeDefined();
    const reasons = validationReport?.blockingReasons.join('\n') ?? '';
    expect(reasons).not.toMatch(/REVISION_|FEEDBACK_|UNRESOLVED_FEEDBACK|STALE_FEEDBACK_DECISION/);
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
      'noOpCheck',
      'validationBlockingReasons',
      'plannerVerdict',
      'revisionDepth',
      'revisionDepthLimit',
      'exceedsRevisionDepthLimit',
    ]));
    expect((payload.plans as unknown[])).toHaveLength(1);
  });
});
